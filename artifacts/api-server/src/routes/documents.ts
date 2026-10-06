import { Router } from "express";
import {
  db,
  documentsTable,
  jobsTable,
  serversTable,
  uploadReservationsTable,
  usersTable,
  type AttorneyPlan,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { CreateDocumentBody } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { quotaForPlan } from "../lib/quota";
import { isAdminUser } from "../lib/marketplace";

const router = Router();
const attorneyOnly = requireRole("attorney");
const objectStorageService = new ObjectStorageService();

async function loadAttorneyPlan(userId: string): Promise<AttorneyPlan> {
  const rows = await db
    .select({ plan: usersTable.plan })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return (rows[0]?.plan ?? "firm") as AttorneyPlan;
}

async function totalBytesForOwner(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${documentsTable.size}), 0)::bigint` })
    .from(documentsTable)
    .where(eq(documentsTable.ownerUserId, userId));
  return Number(row?.total ?? 0);
}

router.get("/documents/usage", attorneyOnly, async (req, res) => {
  const plan = await loadAttorneyPlan(req.userId!);
  const usedBytes = await totalBytesForOwner(req.userId!);
  res.json({
    usedBytes,
    quotaBytes: quotaForPlan(plan),
    plan,
  });
});

router.get("/documents", attorneyOnly, async (req, res) => {
  const jobIdRaw = req.query.jobId;
  const filters = [eq(documentsTable.ownerUserId, req.userId!)];
  if (typeof jobIdRaw === "string" && jobIdRaw.length > 0) {
    const jobId = parseInt(jobIdRaw, 10);
    if (Number.isFinite(jobId)) filters.push(eq(documentsTable.jobId, jobId));
  }
  const docs = await db
    .select()
    .from(documentsTable)
    .where(and(...filters))
    .orderBy(documentsTable.createdAt);
  res.json(docs);
});

// POST /documents — finalize an upload. The client only needs to send
// `objectPath` (other fields are accepted for backward-compat but ignored;
// we trust the reservation + GCS metadata, never the client). This prevents:
//   - quota bypass via under-reported size (we use file.getMetadata().size)
//   - IDOR via path claim (objectPath must match a reservation owned by req.userId)
//   - duplicate finalize (unique index on documents.object_path)
router.post("/documents", requireRole("attorney", "requester"), async (req, res) => {
  const parsed = CreateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }
  const { objectPath } = parsed.data;

  // 1. Verify a reservation exists for this path AND belongs to caller.
  const [reservation] = await db
    .select()
    .from(uploadReservationsTable)
    .where(eq(uploadReservationsTable.objectPath, objectPath))
    .limit(1);
  if (!reservation) {
    res.status(404).json({ error: "No upload reservation for that objectPath" });
    return;
  }
  if (reservation.ownerUserId !== req.userId) {
    // Do not reveal whether the reservation belongs to someone else.
    res.status(404).json({ error: "No upload reservation for that objectPath" });
    return;
  }
  if (reservation.expiresAt.getTime() < Date.now()) {
    await db
      .delete(uploadReservationsTable)
      .where(eq(uploadReservationsTable.objectPath, objectPath));
    res.status(410).json({ error: "Upload reservation expired" });
    return;
  }

  // 2. Fetch ACTUAL object metadata from GCS (server-side truth, not client).
  let actualSize: number;
  let actualContentType: string;
  try {
    const file = await objectStorageService.getObjectEntityFile(objectPath);
    const [meta] = await file.getMetadata();
    actualSize = Number(meta.size ?? 0);
    actualContentType = String(meta.contentType ?? reservation.contentType);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(409).json({ error: "Object not yet uploaded" });
      return;
    }
    req.log.error({ err, objectPath }, "Failed to read GCS object metadata");
    res.status(500).json({ error: "Failed to verify upload" });
    return;
  }
  if (!Number.isFinite(actualSize) || actualSize <= 0) {
    res.status(409).json({ error: "Object has no readable size" });
    return;
  }

  // 3. Re-check quota using the REAL size — a malicious client could have
  // declared 1 byte and uploaded GB. Only attorneys are subject to plan quotas;
  // requesters pay per job, so no storage cap applies.
  if (req.userRole === "attorney") {
    const plan = await loadAttorneyPlan(req.userId!);
    const used = await totalBytesForOwner(req.userId!);
    const q = quotaForPlan(plan);
    if (q >= 0 && used + actualSize > q) {
      try {
        const file = await objectStorageService.getObjectEntityFile(objectPath);
        await file.delete();
      } catch (cleanupErr) {
        req.log.warn({ err: cleanupErr, objectPath }, "Failed to clean up over-quota orphan blob");
      }
      await db
        .delete(uploadReservationsTable)
        .where(eq(uploadReservationsTable.objectPath, objectPath));
      res.status(413).json({
        error: "Storage quota exceeded for plan",
        plan,
        quotaBytes: q,
        usedBytes: used,
        attemptedBytes: actualSize,
      });
      return;
    }
  }

  // 4. Insert document and clear reservation in a single transaction so a
  // crash between the two cannot leave a stuck reservation.
  try {
    const doc = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(documentsTable)
        .values({
          ownerUserId: req.userId!,
          jobId: reservation.jobId,
          name: reservation.name,
          size: actualSize,
          contentType: actualContentType,
          objectPath,
        })
        .returning();
      await tx
        .delete(uploadReservationsTable)
        .where(eq(uploadReservationsTable.objectPath, objectPath));
      return inserted;
    });
    res.status(201).json(doc);
  } catch (err) {
    // Unique violation on object_path means this path was already finalized.
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      res.status(409).json({ error: "Document already finalized" });
      return;
    }
    req.log.error({ err, objectPath }, "Failed to finalize document");
    res.status(500).json({ error: "Failed to finalize document" });
  }
});

// GET /jobs/:id/documents — list documents attached to a job for any party
// allowed to see them: attorney owner of the docs, the job's requester, the
// assigned server, or admin. Returns minimal metadata + a downloadUrl that
// the recipient can fetch via the existing /storage/objects/* endpoint
// (authorization there is delegated to canReadObject, which has been
// extended to grant assigned servers and requesters access to job-linked
// documents).
router.get("/jobs/:id/documents", requireAuth, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const userId = req.userId!;

  const [job] = await db
    .select({
      id: jobsTable.id,
      requesterUserId: jobsTable.requesterUserId,
      serverUserId: serversTable.userId,
    })
    .from(jobsTable)
    .leftJoin(serversTable, eq(jobsTable.serverId, serversTable.id))
    .where(eq(jobsTable.id, id))
    .limit(1);
  // Uniform 404 to avoid leaking job existence to unrelated callers.
  const notFound = () => {
    res.status(404).json({ error: "Job not found" });
  };
  if (!job) {
    notFound();
    return;
  }

  let allowed = false;
  if (isAdminUser(userId)) allowed = true;
  else if (job.requesterUserId === userId) allowed = true;
  else if (job.serverUserId === userId) allowed = true;
  // Attorney owner of any document attached to this job is also allowed.
  if (!allowed) {
    const [docOwner] = await db
      .select({ id: documentsTable.id })
      .from(documentsTable)
      .where(
        and(
          eq(documentsTable.jobId, id),
          eq(documentsTable.ownerUserId, userId),
        ),
      )
      .limit(1);
    if (docOwner) allowed = true;
  }
  if (!allowed) {
    notFound();
    return;
  }

  const docs = await db
    .select({
      id: documentsTable.id,
      name: documentsTable.name,
      size: documentsTable.size,
      contentType: documentsTable.contentType,
      objectPath: documentsTable.objectPath,
      createdAt: documentsTable.createdAt,
    })
    .from(documentsTable)
    .where(eq(documentsTable.jobId, id))
    .orderBy(documentsTable.createdAt);

  res.json(
    docs.map((d) => {
      // objectPath is stored as "/objects/<rest>"; expose a relative URL the
      // browser can hit through the existing proxied /api mount point.
      const downloadUrl = d.objectPath.startsWith("/objects/")
        ? `/api/storage${d.objectPath}`
        : `/api/storage/objects/${d.objectPath.replace(/^\/+/, "")}`;
      return {
        id: d.id,
        name: d.name,
        size: d.size,
        contentType: d.contentType,
        createdAt: d.createdAt,
        downloadUrl,
      };
    }),
  );
});

router.delete("/documents/:id", attorneyOnly, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.id, id), eq(documentsTable.ownerUserId, req.userId!)));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  // Remove DB row first so usage reflects the deletion immediately, then
  // best-effort GCS delete. Worst case: orphaned blob, but no double-billing
  // and no visible row pointing at a missing object.
  await db.delete(documentsTable).where(eq(documentsTable.id, id));
  try {
    const file = await objectStorageService.getObjectEntityFile(doc.objectPath);
    await file.delete();
  } catch (err) {
    if (!(err instanceof ObjectNotFoundError)) {
      req.log.warn({ err, objectPath: doc.objectPath }, "Failed to delete GCS object after DB row removal");
    }
  }
  res.status(204).send();
});

export default router;
