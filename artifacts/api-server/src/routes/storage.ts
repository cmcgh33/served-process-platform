import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
  RequestServerPhotoUploadUrlBody,
  RequestServerPhotoUploadUrlResponse,
} from "@workspace/api-zod";
import {
  db,
  documentsTable,
  uploadReservationsTable,
  usersTable,
  jobsTable,
  serversTable,
  serviceAttemptsTable,
  type AttorneyPlan,
} from "@workspace/db";
import { and, eq, or, sql, lt, inArray } from "drizzle-orm";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { quotaForPlan } from "../lib/quota";
import { requireRole } from "../middlewares/auth";
import { isAdminUser } from "../lib/marketplace";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const attorneyOnly = requireRole("attorney");
const serverOnly = requireRole("server");
const anyAuthed = requireRole("requester", "attorney", "server");

const RESERVATION_TTL_MS = 60 * 60 * 1000; // 1 hour

async function loadAttorneyPlan(userId: string): Promise<AttorneyPlan> {
  const rows = await db
    .select({ plan: usersTable.plan })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return (rows[0]?.plan ?? "firm") as AttorneyPlan;
}

// Total bytes already committed by this owner across both finalized
// documents AND outstanding (non-expired) upload reservations. Reserving
// against in-flight uploads prevents quota bypass via parallel requests.
async function reservedBytesForOwner(userId: string): Promise<number> {
  const now = new Date();
  const [docs] = await db
    .select({ total: sql<number>`COALESCE(SUM(${documentsTable.size}), 0)::bigint` })
    .from(documentsTable)
    .where(eq(documentsTable.ownerUserId, userId));
  const [pending] = await db
    .select({ total: sql<number>`COALESCE(SUM(${uploadReservationsTable.expectedSize}), 0)::bigint` })
    .from(uploadReservationsTable)
    .where(
      and(
        eq(uploadReservationsTable.ownerUserId, userId),
        sql`${uploadReservationsTable.expiresAt} > ${now}`,
      ),
    );
  return Number(docs?.total ?? 0) + Number(pending?.total ?? 0);
}

// POST /storage/uploads/request-url — attorney or requester. Creates a quota
// reservation and returns a presigned URL only if the upload would not push
// the caller over their plan quota (counting both committed docs and other
// in-flight reservations). The reservation also binds the returned objectPath
// to req.userId so a different user cannot later finalize it.
router.post(
  "/storage/uploads/request-url",
  requireRole("attorney", "requester"),
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }
    try {
      const { name, size, contentType, jobId } = parsed.data;

      // Best-effort sweep of expired reservations + their orphan blobs.
      // This bounds the worst-case raw storage usage from never-finalized
      // uploads to ~1 reservation TTL window across all attorneys.
      const expired = await db
        .select({ objectPath: uploadReservationsTable.objectPath })
        .from(uploadReservationsTable)
        .where(lt(uploadReservationsTable.expiresAt, new Date()));
      if (expired.length > 0) {
        // Never delete a blob that's still referenced as a server's profile
        // headshot. Profile-photo reservations are finalized (deleted) on save
        // in PATCH /me/server-profile, but guard here too so a lingering or
        // legacy reservation can't orphan-delete an in-use photo.
        const expiredPaths = expired.map((e) => e.objectPath);
        const referenced = new Set(
          (
            await db
              .select({ photoUrl: serversTable.photoUrl })
              .from(serversTable)
              .where(inArray(serversTable.photoUrl, expiredPaths))
          )
            .map((r) => r.photoUrl)
            .filter((p): p is string => p !== null),
        );
        await Promise.allSettled(
          expired
            .filter(({ objectPath }) => !referenced.has(objectPath))
            .map(async ({ objectPath }) => {
              try {
                const file = await objectStorageService.getObjectEntityFile(objectPath);
                await file.delete();
              } catch (err) {
                if (!(err instanceof ObjectNotFoundError)) {
                  req.log.warn({ err, objectPath }, "Orphan blob cleanup failed");
                }
              }
            }),
        );
        await db
          .delete(uploadReservationsTable)
          .where(lt(uploadReservationsTable.expiresAt, new Date()));
      }

      // Verify jobId, if provided, belongs to this user.
      let resolvedJobId: number | null = null;
      if (jobId !== undefined && jobId !== null) {
        const [job] = await db
          .select({ id: jobsTable.id })
          .from(jobsTable)
          .where(and(eq(jobsTable.id, jobId), eq(jobsTable.requesterUserId, req.userId!)))
          .limit(1);
        if (!job) {
          res.status(403).json({ error: "Cannot attach to a job you do not own" });
          return;
        }
        resolvedJobId = job.id;
      }

      if (req.userRole === "attorney") {
        const plan = await loadAttorneyPlan(req.userId!);
        const used = await reservedBytesForOwner(req.userId!);
        const q = quotaForPlan(plan);
        if (q >= 0 && used + size > q) {
          res.status(413).json({
            error: "Storage quota exceeded for plan",
            plan,
            quotaBytes: q,
            usedBytes: used,
          });
          return;
        }
      }

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      // Persist the reservation BEFORE returning the URL so it counts against
      // the owner's quota immediately and binds the path to this user.
      await db.insert(uploadReservationsTable).values({
        objectPath,
        ownerUserId: req.userId!,
        expectedSize: size,
        contentType,
        name,
        jobId: resolvedJobId,
        expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
      });

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Error generating upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

// POST /storage/server-photo/request-url — server-only. Returns a presigned
// upload URL for a GPS-stamped service-attempt photo. Caller must be the
// assigned server on the job. No quota tracking (servers aren't on a plan).
router.post(
  "/storage/server-photo/request-url",
  serverOnly,
  async (req: Request, res: Response) => {
    const parsed = RequestServerPhotoUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }
    try {
      const { jobId } = parsed.data;
      const [serverRow] = await db
        .select({ id: serversTable.id })
        .from(serversTable)
        .where(eq(serversTable.userId, req.userId!))
        .limit(1);
      if (!serverRow) {
        res.status(403).json({ error: "Server profile not found" });
        return;
      }
      const [job] = await db
        .select({ id: jobsTable.id, serverId: jobsTable.serverId })
        .from(jobsTable)
        .where(eq(jobsTable.id, jobId))
        .limit(1);
      if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
      }
      if (job.serverId !== serverRow.id) {
        res.status(403).json({ error: "Not your assignment" });
        return;
      }

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestServerPhotoUploadUrlResponse.parse({ uploadURL, objectPath }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Error generating server photo upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

// POST /storage/profile-photo/request-url — server-only. Returns a presigned
// upload URL for the caller's own profile headshot. No job binding — any
// authenticated server may request one for themselves. The resulting
// objectPath is saved via PATCH /me/server-profile { photoUrl }.
router.post(
  "/storage/profile-photo/request-url",
  serverOnly,
  async (req: Request, res: Response) => {
    try {
      const [serverRow] = await db
        .select({ id: serversTable.id })
        .from(serversTable)
        .where(eq(serversTable.userId, req.userId!))
        .limit(1);
      if (!serverRow) {
        res.status(403).json({ error: "Server profile not found" });
        return;
      }

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      // Record provenance binding this object path to the requesting user so
      // PATCH /me/server-profile can verify the server only sets `photoUrl` to
      // a path it legitimately reserved (prevents pointing photoUrl at another
      // user's private object to gain read access via canReadObject). Size 0
      // keeps it out of any quota math; servers aren't on an upload plan.
      await db.insert(uploadReservationsTable).values({
        objectPath,
        ownerUserId: req.userId!,
        expectedSize: 0,
        contentType: "image",
        name: "profile-photo",
        expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
      });

      res.json(
        RequestServerPhotoUploadUrlResponse.parse({ uploadURL, objectPath }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Error generating profile photo upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

// Determine if the caller is allowed to read a private object. Permits:
// - attorney owner of a document row pointing at it
// - assigned server, requester (job owner), or admin for an attempt photo
//   or a job's proofPhotoUrl
async function canReadObject(objectPath: string, userId: string): Promise<boolean> {
  if (isAdminUser(userId)) return true;

  // A server's own profile headshot (servers.photo_url). Lets the server view
  // their own photo on the credentialing page.
  const [ownPhoto] = await db
    .select({ id: serversTable.id })
    .from(serversTable)
    .where(
      and(
        eq(serversTable.userId, userId),
        eq(serversTable.photoUrl, objectPath),
      ),
    )
    .limit(1);
  if (ownPhoto) return true;

  const [doc] = await db
    .select({
      ownerUserId: documentsTable.ownerUserId,
      jobId: documentsTable.jobId,
    })
    .from(documentsTable)
    .where(eq(documentsTable.objectPath, objectPath))
    .limit(1);
  if (doc) {
    if (doc.ownerUserId === userId) return true;
    // If this document is attached to a job, allow the assigned server and
    // the requester (job owner) to read it. Servers need to print/serve the
    // documents; the requester uploaded (or had uploaded) and may want to
    // re-download from their own job page.
    if (doc.jobId != null) {
      const [linkedJob] = await db
        .select({
          requesterUserId: jobsTable.requesterUserId,
          serverUserId: serversTable.userId,
        })
        .from(jobsTable)
        .leftJoin(serversTable, eq(jobsTable.serverId, serversTable.id))
        .where(eq(jobsTable.id, doc.jobId))
        .limit(1);
      if (linkedJob) {
        if (linkedJob.requesterUserId === userId) return true;
        if (linkedJob.serverUserId === userId) return true;
      }
    }
    return false;
  }

  // Photo path on a service_attempts row?
  const [attempt] = await db
    .select({
      requesterUserId: jobsTable.requesterUserId,
      serverUserId: serversTable.userId,
    })
    .from(serviceAttemptsTable)
    .innerJoin(jobsTable, eq(serviceAttemptsTable.jobId, jobsTable.id))
    .leftJoin(serversTable, eq(serviceAttemptsTable.serverId, serversTable.id))
    .where(
      // Match either the GPS-stamped service photo or the optional
      // mailing-receipt photo uploaded after substitute follow-up.
      // The earlier version only checked `photoUrl` which caused the
      // mailing-receipt thumbnail on the server proof page to render
      // as a broken image (404) even though the file existed in
      // object storage and the row pointed at the right path.
      or(
        eq(serviceAttemptsTable.photoUrl, objectPath),
        eq(serviceAttemptsTable.mailingProofPhotoUrl, objectPath),
      ),
    )
    .limit(1);
  if (attempt) {
    if (attempt.requesterUserId === userId) return true;
    if (attempt.serverUserId === userId) return true;
  }

  // Path stored on a job row? Matches any of the three job-level object
  // columns: proof photo, generated affidavit PDF, or canvas signature image.
  // Requester (owner), assigned server, or admin can read.
  const [job] = await db
    .select({
      requesterUserId: jobsTable.requesterUserId,
      serverUserId: serversTable.userId,
    })
    .from(jobsTable)
    .leftJoin(serversTable, eq(jobsTable.serverId, serversTable.id))
    .where(
      or(
        eq(jobsTable.proofPhotoUrl, objectPath),
        eq(jobsTable.proofPdfUrl, objectPath),
        eq(jobsTable.signatureImageUrl, objectPath),
      ),
    )
    .limit(1);
  if (job) {
    if (job.requesterUserId === userId) return true;
    if (job.serverUserId === userId) return true;
  }

  return false;
}

// GET /storage/objects/* — streams private objects. Authorization is delegated
// to canReadObject (attorney docs OR service-attempt photos OR proof photos).
router.get(
  "/storage/objects/*path",
  anyAuthed,
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.path;
      const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
      const objectPath = `/objects/${wildcardPath}`;

      const allowed = await canReadObject(objectPath, req.userId!);
      if (!allowed) {
        res.status(404).json({ error: "Object not found" });
        return;
      }

      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
      const response = await objectStorageService.downloadObject(objectFile);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        req.log.warn({ err: error }, "Object not found");
        res.status(404).json({ error: "Object not found" });
        return;
      }
      req.log.error({ err: error }, "Error serving object");
      res.status(500).json({ error: "Failed to serve object" });
    }
  },
);

export default router;
