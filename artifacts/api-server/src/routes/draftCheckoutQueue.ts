import { Router, type IRouter } from "express";
import { and, eq, inArray, isNull, gt } from "drizzle-orm";
import {
  db,
  draftCheckoutQueuesTable,
  jobsTable,
  type DraftCheckoutQueue,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router: IRouter = Router();

// How long an undismissed queue stays "active" before we stop showing the
// resume banner. 7 days strikes a balance between "I closed my laptop on
// Friday and want to finish Monday morning" and "I abandoned this two
// weeks ago, please don't badger me".
const QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface PrunedQueue {
  row: DraftCheckoutQueue;
  /** True when pruning consumed all remaining chunks (queue is now done). */
  exhausted: boolean;
}

/**
 * Drops chunks whose jobs are no longer in `draft` status (e.g. paid via
 * the single-job button or via a previous batch's webhook) by advancing
 * `paidCount` past them. Mutates the row in the DB if anything changes.
 *
 * A chunk is considered "consumed" when *all* of its jobs have left
 * `draft` (so the user has nothing left to pay in that batch). A chunk
 * with a partial leftover (some still draft, some not) is treated as
 * still pending so the attorney can pay the surviving drafts manually.
 */
async function pruneQueue(
  queue: DraftCheckoutQueue,
  draftIds: Set<number>,
): Promise<PrunedQueue> {
  let { paidCount } = queue;
  const { chunks } = queue;
  while (paidCount < chunks.length) {
    const next = chunks[paidCount];
    const stillDraft = next.some((id) => draftIds.has(id));
    if (stillDraft) break;
    paidCount += 1;
  }
  if (paidCount !== queue.paidCount) {
    const [updated] = await db
      .update(draftCheckoutQueuesTable)
      .set({ paidCount, updatedAt: new Date() })
      .where(eq(draftCheckoutQueuesTable.id, queue.id))
      .returning();
    return {
      row: updated ?? { ...queue, paidCount },
      exhausted: paidCount >= chunks.length,
    };
  }
  return { row: queue, exhausted: paidCount >= chunks.length };
}

/** Public DTO — strip server-only fields before sending to the client. */
function toDto(row: DraftCheckoutQueue) {
  return {
    id: row.id,
    chunks: row.chunks,
    paidCount: row.paidCount,
    totalCents: row.totalCents,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

router.get(
  "/me/draft-checkout-queue",
  requireRole("attorney"),
  async (req, res) => {
    const userId = req.userId!;
    const now = new Date();

    const [row] = await db
      .select()
      .from(draftCheckoutQueuesTable)
      .where(
        and(
          eq(draftCheckoutQueuesTable.userId, userId),
          isNull(draftCheckoutQueuesTable.dismissedAt),
          gt(draftCheckoutQueuesTable.expiresAt, now),
        ),
      )
      .limit(1);

    if (!row) {
      return res.status(404).json({ error: "No active queue" });
    }
    if (row.paidCount >= row.chunks.length) {
      return res.status(404).json({ error: "No active queue" });
    }

    // Look up which referenced jobs are still actually drafts so we can
    // skip past chunks that have already been resolved another way (a
    // webhook for a previous batch firing after the user closed the tab,
    // a single-job "Pay" button, draft deletion, etc).
    const allIds = Array.from(new Set(row.chunks.flat()));
    const stillDrafts = allIds.length
      ? await db
          .select({ id: jobsTable.id })
          .from(jobsTable)
          .where(
            and(
              inArray(jobsTable.id, allIds),
              eq(jobsTable.status, "draft"),
              eq(jobsTable.requesterUserId, userId),
            ),
          )
      : [];
    const draftIds = new Set(stillDrafts.map((r) => r.id));

    const pruned = await pruneQueue(row, draftIds);
    if (pruned.exhausted) {
      return res.status(404).json({ error: "No active queue" });
    }
    return res.json(toDto(pruned.row));
  },
);

router.put(
  "/me/draft-checkout-queue",
  requireRole("attorney"),
  async (req, res) => {
    const userId = req.userId!;
    const body = req.body as {
      chunks?: unknown;
      totalCents?: unknown;
    };

    if (!Array.isArray(body.chunks) || body.chunks.length < 2) {
      return res
        .status(400)
        .json({ error: "chunks must be an array with at least 2 batches" });
    }
    const chunks: number[][] = [];
    for (const c of body.chunks) {
      if (!Array.isArray(c) || c.length === 0 || c.length > 50) {
        return res
          .status(400)
          .json({ error: "Each chunk must contain 1–50 job ids" });
      }
      const ids: number[] = [];
      for (const raw of c) {
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) {
          return res.status(400).json({ error: "Invalid jobId in chunk" });
        }
        ids.push(n);
      }
      chunks.push(ids);
    }
    const totalCents = Number(body.totalCents);
    if (!Number.isInteger(totalCents) || totalCents < 0) {
      return res.status(400).json({ error: "totalCents must be >= 0" });
    }

    // Validate every referenced job is currently a draft owned by the
    // caller. Prevents a malicious client from queueing jobs they don't
    // own (and therefore can't actually pay for) and prevents stale
    // selections from being persisted.
    const flatIds = Array.from(new Set(chunks.flat()));
    const ownedDrafts = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(
        and(
          inArray(jobsTable.id, flatIds),
          eq(jobsTable.status, "draft"),
          eq(jobsTable.requesterUserId, userId),
        ),
      );
    if (ownedDrafts.length !== flatIds.length) {
      return res.status(409).json({
        error:
          "One or more jobs are not in draft status or do not belong to you",
      });
    }

    const expiresAt = new Date(Date.now() + QUEUE_TTL_MS);
    const now = new Date();

    const [row] = await db
      .insert(draftCheckoutQueuesTable)
      .values({
        userId,
        chunks,
        paidCount: 0,
        totalCents,
        paidSessionIds: [],
        expiresAt,
        dismissedAt: null,
      })
      .onConflictDoUpdate({
        target: draftCheckoutQueuesTable.userId,
        set: {
          chunks,
          paidCount: 0,
          totalCents,
          paidSessionIds: [],
          expiresAt,
          dismissedAt: null,
          updatedAt: now,
        },
      })
      .returning();

    req.log.info(
      {
        userId,
        queueId: row.id,
        chunkCount: chunks.length,
        totalCents,
      },
      "Draft checkout queue persisted",
    );

    return res.json(toDto(row));
  },
);

router.delete(
  "/me/draft-checkout-queue",
  requireRole("attorney"),
  async (req, res) => {
    const userId = req.userId!;
    const result = await db
      .update(draftCheckoutQueuesTable)
      .set({ dismissedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(draftCheckoutQueuesTable.userId, userId),
          isNull(draftCheckoutQueuesTable.dismissedAt),
        ),
      )
      .returning({ id: draftCheckoutQueuesTable.id });

    if (result.length > 0) {
      req.log.info(
        { userId, queueId: result[0].id },
        "Draft checkout queue dismissed",
      );
    }
    return res.json({ dismissed: result.length > 0 });
  },
);

export default router;
