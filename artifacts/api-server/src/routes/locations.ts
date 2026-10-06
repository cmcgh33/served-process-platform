import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, jobsTable, jobLocationPingsTable, serversTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { isAdminUser } from "../lib/marketplace";

const router: IRouter = Router();
router.use(requireAuth);

async function loadServerIdForUser(userId: string): Promise<number | null> {
  const [row] = await db
    .select({ id: serversTable.id })
    .from(serversTable)
    .where(eq(serversTable.userId, userId))
    .limit(1);
  return row?.id ?? null;
}

// POST /jobs/:id/location — assigned server publishes a GPS ping.
router.post(
  "/jobs/:id/location",
  requireRole("server"),
  async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }

    const lat = Number((req.body as { lat?: unknown })?.lat);
    const lng = Number((req.body as { lng?: unknown })?.lng);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 || lat > 90 ||
      lng < -180 || lng > 180
    ) {
      res.status(400).json({ error: "Invalid lat/lng" });
      return;
    }
    const accuracyM = numericOrNull((req.body as { accuracyM?: unknown })?.accuracyM);
    const headingDeg = numericOrNull((req.body as { headingDeg?: unknown })?.headingDeg);
    const speedMps = numericOrNull((req.body as { speedMps?: unknown })?.speedMps);

    const myServerId = await loadServerIdForUser(req.userId!);
    if (myServerId == null) {
      res.status(403).json({ error: "Server profile not found" });
      return;
    }

    // Atomic guard against TOCTOU: re-check assignment + status inside the
    // same transaction with a row lock so a concurrent serve/release/cancel
    // can't slip a late ping through.
    const result = await db.transaction(async (tx) => {
      const [job] = await tx
        .select({
          id: jobsTable.id,
          status: jobsTable.status,
          serverId: jobsTable.serverId,
        })
        .from(jobsTable)
        .where(eq(jobsTable.id, id))
        .for("update")
        .limit(1);
      if (!job) return { ok: false, code: 404, error: "Job not found" } as const;
      if (job.serverId !== myServerId) {
        return { ok: false, code: 403, error: "Not your assignment" } as const;
      }
      if (job.status !== "in_progress" && job.status !== "en_route") {
        return {
          ok: false,
          code: 409,
          error:
            "Live tracking only available while the job is en_route or in_progress",
          status: job.status,
        } as const;
      }
      await tx.insert(jobLocationPingsTable).values({
        jobId: id,
        serverId: myServerId,
        lat,
        lng,
        accuracyM,
        headingDeg,
        speedMps,
      });
      return { ok: true } as const;
    });

    if (!result.ok) {
      res.status(result.code).json({
        error: result.error,
        ...("status" in result ? { status: result.status } : {}),
      });
      return;
    }

    res.status(204).end();
  },
);

// GET /jobs/:id/location/latest — owner / attorney / assigned server / admin
// can read the most recent ping while the job is in_progress.
router.get("/jobs/:id/location/latest", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const userId = req.userId!;
  const role = req.userRole ?? null;

  const [job] = await db
    .select({
      id: jobsTable.id,
      status: jobsTable.status,
      serverId: jobsTable.serverId,
      requesterUserId: jobsTable.requesterUserId,
      recipientAddress: jobsTable.recipientAddress,
      recipientCity: jobsTable.recipientCity,
      recipientState: jobsTable.recipientState,
      recipientZip: jobsTable.recipientZip,
    })
    .from(jobsTable)
    .where(eq(jobsTable.id, id))
    .limit(1);
  // Uniform 404 for any caller that shouldn't see this job, including the
  // case where the job exists but isn't currently in_progress. We resolve
  // authorization BEFORE looking at status so we never leak the existence
  // or state of jobs the caller has no relationship to.
  const notFound = () => {
    res.status(404).json({ error: "Job not found" });
  };
  if (!job) {
    notFound();
    return;
  }

  let allowed = false;
  if (isAdminUser(userId)) {
    allowed = true;
  } else if (job.requesterUserId === userId) {
    // Covers both requester-created and attorney-created jobs (the attorney
    // is recorded as requesterUserId for jobs they posted).
    allowed = true;
  } else if (role === "server") {
    const myServerId = await loadServerIdForUser(userId);
    if (myServerId != null && job.serverId === myServerId) allowed = true;
  }
  if (!allowed) {
    notFound();
    return;
  }
  if (job.status !== "in_progress" && job.status !== "en_route") {
    notFound();
    return;
  }

  const [latest] = await db
    .select()
    .from(jobLocationPingsTable)
    .where(
      and(
        eq(jobLocationPingsTable.jobId, id),
        eq(jobLocationPingsTable.serverId, job.serverId ?? -1),
      ),
    )
    .orderBy(desc(jobLocationPingsTable.recordedAt))
    .limit(1);

  const destinationAddress = [
    job.recipientAddress,
    job.recipientCity,
    job.recipientState,
    job.recipientZip,
  ]
    .filter(Boolean)
    .join(", ");

  res.json({
    jobId: job.id,
    // Reflect the actual gating-status so the client can distinguish
    // "en_route to the recipient" vs "in_progress at the recipient" — both
    // permit live tracking, but the UX may want to label them differently.
    status: job.status as "in_progress" | "en_route",
    location: latest
      ? {
          lat: latest.lat,
          lng: latest.lng,
          accuracyM: latest.accuracyM,
          headingDeg: latest.headingDeg,
          speedMps: latest.speedMps,
          recordedAt: latest.recordedAt.toISOString(),
          ageSeconds: Math.max(
            0,
            Math.round((Date.now() - latest.recordedAt.getTime()) / 1000),
          ),
        }
      : null,
    destination: destinationAddress
      ? { address: destinationAddress, lat: null, lng: null }
      : null,
  });
});

function numericOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default router;
