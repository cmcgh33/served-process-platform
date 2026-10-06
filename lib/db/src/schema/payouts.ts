import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";
import { serversTable } from "./servers";

/**
 * Outbound money to a server. One row per job (unique on jobId), keyed
 * to a serverId for efficient per-server reconciliation. amountCents
 * mirrors the source job's serverPayoutCents snapshot at confirm time.
 */
export const PAYOUT_STATUSES = [
  "pending",
  "in_transit",
  "paid",
  "failed",
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const payoutsTable = pgTable(
  "payouts",
  {
    id: serial("id").primaryKey(),
    serverId: integer("server_id")
      .notNull()
      .references(() => serversTable.id),
    userId: varchar("user_id", { length: 64 }).notNull(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id),
    amountCents: integer("amount_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("usd"),
    status: text("status").notNull().default("pending"),
    stripeTransferId: text("stripe_transfer_id"),
    stripeAccountId: text("stripe_account_id"),
    // Stripe Payout id on the connected account once the automatic payout
    // that includes our transfer has been scheduled. When set, callers can
    // look up the authoritative `arrival_date` directly from Stripe.
    stripePayoutId: text("stripe_payout_id"),
    paidAt: timestamp("paid_at"),
    // Expected date funds will land in the server's bank account. Set from
    // the most authoritative source available (in priority order):
    //   1. The Stripe Payout `arrival_date` once one has been scheduled.
    //   2. The connected-account balance transaction `available_on` (i.e.
    //      when the funds become payable per the schedule's delay_days).
    //   3. A schedule-based estimate (now + delay_days business days).
    //   4. A 2 business-day default if all Stripe lookups fail.
    // May be null for legacy rows; the wallet UI tolerates a missing value
    // by falling back to paidAt/createdAt.
    arrivalDate: timestamp("arrival_date"),
    // Short, human-readable reason populated when a transfer fails so the
    // wallet UI can explain *why* a row is in `failed` rather than just
    // showing a red badge. Typically the Stripe error code + truncated
    // message (e.g. "balance_insufficient: Your destination account ...").
    // Cleared back to null on a successful retry. Capped to 280 chars when
    // written so we never store an arbitrarily long Stripe error blob.
    failureReason: text("failure_reason"),
    // Set the first time we email the server about a transfer failure.
    // Used purely for idempotency: while non-null we won't re-send the
    // notification, even if `processPayoutTransfer` is retried and the row
    // is updated again. Cleared back to null on a successful retry so that
    // a *subsequent* failure can re-notify.
    failureNotifiedAt: timestamp("failure_notified_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    serverIdx: index("payouts_server_idx").on(t.serverId),
    userIdx: index("payouts_user_idx").on(t.userId),
    statusIdx: index("payouts_status_idx").on(t.status),
    jobUniq: uniqueIndex("payouts_job_uniq").on(t.jobId),
    transferUniq: uniqueIndex("payouts_stripe_transfer_uniq").on(t.stripeTransferId),
  }),
);

export type Payout = typeof payoutsTable.$inferSelect;
export type InsertPayout = typeof payoutsTable.$inferInsert;
