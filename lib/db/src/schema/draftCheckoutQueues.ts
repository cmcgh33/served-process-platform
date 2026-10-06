import { pgTable, serial, integer, timestamp, varchar, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Server-side persistence of an attorney's split-checkout draft job queue.
 *
 * The attorney's "Pay & Activate Selected" flow may need to be split into
 * multiple sequential Stripe Checkout sessions because Stripe caps line
 * items per session AND we cap the metadata `jobIds` CSV at 500 chars (see
 * `chunkDraftIds` in the served-app). Previously the queue lived in
 * `sessionStorage`, which is scoped to a single browser tab — closing the
 * tab between batches lost the plan and left the attorney with no way to
 * resume the remaining batches.
 *
 * This row is the durable copy. Exactly one active queue per user; we
 * upsert by `userId`. A queue is considered "active" when:
 *   - `dismissedAt IS NULL`
 *   - `expiresAt > now()`
 *   - `paidCount < array_length(chunks)`
 *
 * Idempotency: each completed Stripe Checkout session id is appended to
 * `paidSessionIds`. The webhook handler uses this to make sure a single
 * session can't double-increment `paidCount` even if Stripe redelivers
 * the event.
 */
export const draftCheckoutQueuesTable = pgTable(
  "draft_checkout_queues",
  {
    id: serial("id").primaryKey(),
    // One active queue per attorney; enforced by the unique index below.
    userId: varchar("user_id", { length: 64 }).notNull(),
    // number[][] — chunks of draft job ids in the order they should be paid.
    chunks: jsonb("chunks").notNull().$type<number[][]>(),
    paidCount: integer("paid_count").notNull().default(0),
    // Snapshot of the total in cents at queue-creation time, just for
    // display in the resume banner.
    totalCents: integer("total_cents").notNull().default(0),
    // string[] — Stripe Checkout session ids whose completion has already
    // been applied to `paidCount`. Used purely for webhook idempotency.
    paidSessionIds: jsonb("paid_session_ids")
      .notNull()
      .default([])
      .$type<string[]>(),
    // Hard TTL — even an undismissed queue stops being shown after this
    // point so attorneys returning days later don't get a confusing
    // "continue your old checkout" banner for jobs they may have abandoned.
    expiresAt: timestamp("expires_at").notNull(),
    dismissedAt: timestamp("dismissed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userUq: uniqueIndex("draft_checkout_queues_user_uq").on(t.userId),
  }),
);

export type DraftCheckoutQueue = typeof draftCheckoutQueuesTable.$inferSelect;
export type InsertDraftCheckoutQueue =
  typeof draftCheckoutQueuesTable.$inferInsert;
