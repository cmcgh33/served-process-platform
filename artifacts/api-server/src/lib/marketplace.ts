import {
  db,
  subscriptionsTable,
  serverCredentialsTable,
  payoutsTable,
  jobsTable,
  serversTable,
  usersTable,
  type UserRole,
  type Job,
} from "@workspace/db";
import { getUncachableStripeClient } from "../stripeClient";
import { logger } from "./logger";
import { sendPayoutFailedEmail } from "./mailer";
import {
  PROSERVE_TIERS,
  splitFee,
  getServePrice,
  type PricingTier,
  type ProServeTier,
  type ServiceType,
} from "@workspace/pricing";
import { eq, and, gte, isNull, isNotNull, inArray, desc, sql } from "drizzle-orm";

/**
 * Default Stripe Express payout delay when we can't read the connected
 * account's schedule (e.g. account retrieve failed). Two business days is
 * Stripe's standard for new US accounts.
 */
export const DEFAULT_PAYOUT_DELAY_BUSINESS_DAYS = 2;

/**
 * Stripe instance type — pulled at use site so we don't drag in a top-level
 * `import Stripe from 'stripe'` (the client is constructed asynchronously
 * via `getUncachableStripeClient`). Exported so test suites can build a
 * structurally-typed fake without instantiating the real SDK.
 */
export type StripeClient = Awaited<ReturnType<typeof getUncachableStripeClient>>;

/**
 * Add `n` business days (skipping Sat/Sun) to `from`. We don't model bank
 * holidays — Stripe's actual arrival_date may differ by a day, but this is
 * close enough for an ETA and matches the wording shown in the wallet UI
 * ("arrives by ~Date").
 */
export function addBusinessDays(from: Date, n: number): Date {
  const result = new Date(from.getTime());
  let added = 0;
  while (added < n) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}

export async function getActiveSubscriptionTier(
  userId: string,
  role: UserRole | null,
): Promise<ProServeTier | null> {
  if (role !== "attorney") return null;
  const rows = await db
    .select({ tier: subscriptionsTable.tier, status: subscriptionsTable.status })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row || row.status !== "active") return null;
  return (PROSERVE_TIERS as readonly string[]).includes(row.tier)
    ? (row.tier as ProServeTier)
    : null;
}

export async function getPricingTierForCreator(
  userId: string,
  role: UserRole | null,
): Promise<PricingTier> {
  if (role === "attorney") {
    const tier = await getActiveSubscriptionTier(userId, role);
    return tier ?? "public";
  }
  return "public";
}

export function priceJob(tier: PricingTier, serviceType: ServiceType): {
  pricingTier: PricingTier;
  serviceType: ServiceType;
  grossCents: number;
  platformFeeCents: number;
  serverPayoutCents: number;
} {
  const grossCents = getServePrice(tier, serviceType);
  const { platformCents, serverCents } = splitFee(grossCents);
  return {
    pricingTier: tier,
    serviceType,
    grossCents,
    platformFeeCents: platformCents,
    serverPayoutCents: serverCents,
  };
}

export type ServerVerifiedOutcome =
  | { ok: true }
  | {
      ok: false;
      status: "unpaid" | "pending" | "failed" | "missing";
      message: string;
    };

export async function assertServerVerified(
  serverUserId: string,
): Promise<ServerVerifiedOutcome> {
  const rows = await db
    .select({ status: serverCredentialsTable.status })
    .from(serverCredentialsTable)
    .where(eq(serverCredentialsTable.userId, serverUserId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      status: "missing",
      message: "Server credentialing not started.",
    };
  }
  if (row.status === "verified") return { ok: true };
  if (row.status === "unpaid") {
    return { ok: false, status: "unpaid", message: "Credentialing fee not paid." };
  }
  if (row.status === "pending") {
    return { ok: false, status: "pending", message: "Background check pending." };
  }
  return { ok: false, status: "failed", message: "Background check failed." };
}

export async function getServerPayoutTotalCents(serverUserId: string): Promise<{
  paidCents: number;
  pendingCents: number;
  failedCents: number;
}> {
  const rows = await db
    .select({ status: payoutsTable.status, amount: payoutsTable.amountCents })
    .from(payoutsTable)
    .where(eq(payoutsTable.userId, serverUserId));
  let paidCents = 0;
  let pendingCents = 0;
  let failedCents = 0;
  for (const r of rows) {
    if (r.status === "paid") paidCents += r.amount;
    else if (r.status === "pending" || r.status === "in_transit")
      pendingCents += r.amount;
    else if (r.status === "failed") failedCents += r.amount;
  }
  return { paidCents, pendingCents, failedCents };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

/**
 * Idempotently insert a pending payout for a served job. Uses ON CONFLICT
 * on the unique jobId index so repeat calls (e.g. confirm retries) are safe.
 * Pass a transaction handle to participate in a larger atomic operation.
 * Returns true if a new row was inserted, false if one already existed.
 * Throws if the job has no assigned server or the server row is missing —
 * callers in atomic flows should let these throws roll back the txn.
 */
export async function enqueuePayoutForServedJob(
  job: Job,
  tx: DbOrTx = db,
): Promise<boolean> {
  if (!job.serverId) return false;
  if (job.serverPayoutCents <= 0 || job.grossCents <= 0) {
    throw new Error(
      `job ${job.id} has invalid pricing snapshot ` +
        `(grossCents=${job.grossCents}, serverPayoutCents=${job.serverPayoutCents}); ` +
        `cannot enqueue payout`,
    );
  }

  const serverRow = await tx
    .select({ userId: serversTable.userId })
    .from(serversTable)
    .where(eq(serversTable.id, job.serverId))
    .limit(1);
  const serverUserId = serverRow[0]?.userId;
  if (!serverUserId) {
    throw new Error(`server ${job.serverId} has no userId`);
  }

  const inserted = await tx
    .insert(payoutsTable)
    .values({
      serverId: job.serverId,
      userId: serverUserId,
      jobId: job.id,
      amountCents: job.serverPayoutCents,
      status: "pending",
    })
    .onConflictDoNothing({ target: payoutsTable.jobId })
    .returning({ id: payoutsTable.id });

  return inserted.length > 0;
}

export async function getJobById(jobId: number): Promise<Job | undefined> {
  const rows = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
  return rows[0];
}

export async function getServerUserIdById(serverId: number): Promise<string | null> {
  const rows = await db
    .select({ userId: serversTable.userId })
    .from(serversTable)
    .where(eq(serversTable.id, serverId))
    .limit(1);
  return rows[0]?.userId ?? null;
}

/** Lookup the full server profile row by Clerk userId. */
export async function getServerByUserId(userId: string) {
  const rows = await db
    .select()
    .from(serversTable)
    .where(eq(serversTable.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Combined gating used when a server attempts to accept / patch / confirm a
 * job. They must be both `verified` (background check cleared) AND have a
 * working Stripe Connect account (`payoutsEnabled`). The two checks are
 * surfaced separately so the client can render the right banner.
 */
export type ServerCanAcceptOutcome =
  | { ok: true }
  | { ok: false; reason: "not_verified"; status: string; message: string }
  | { ok: false; reason: "no_payouts"; message: string }
  | {
      ok: false;
      reason: "status_blocked";
      serverStatus: "pending" | "suspended" | "inactive";
      message: string;
    };

/**
 * Friendly explanation for why a non-active status blocks acceptance. Surfaced
 * to both API responses and the UI banner.
 */
function statusBlockedMessage(
  status: "pending" | "suspended" | "inactive",
): string {
  switch (status) {
    case "pending":
      return "Your server account is pending review. We'll email you when you're activated.";
    case "suspended":
      return "Your server account is suspended. Contact support@servedapp.co to reactivate.";
    case "inactive":
      return "Your server account is inactive. Contact support@servedapp.co if this is unexpected.";
  }
}

export async function assertServerCanAccept(
  userId: string,
): Promise<ServerCanAcceptOutcome> {
  // Status gate first — credentialing/payouts only matter once the admin
  // has flipped the row to `active`. A suspended/inactive server should
  // see the lifecycle banner, not a "go pay your background check" CTA.
  const server = await getServerByUserId(userId);
  if (server && server.status !== "active") {
    return {
      ok: false,
      reason: "status_blocked",
      serverStatus: server.status as "pending" | "suspended" | "inactive",
      message: statusBlockedMessage(
        server.status as "pending" | "suspended" | "inactive",
      ),
    };
  }
  const verified = await assertServerVerified(userId);
  if (!verified.ok) {
    return {
      ok: false,
      reason: "not_verified",
      status: verified.status,
      message: verified.message,
    };
  }
  if (!server || !server.stripeAccountId || !server.payoutsEnabled) {
    return {
      ok: false,
      reason: "no_payouts",
      message:
        "Connect a bank account via Stripe Express to start accepting jobs.",
    };
  }
  return { ok: true };
}

/**
 * Hard cap on how many active (in_progress + en_route) jobs a single server
 * may hold at once. Per the MVP audit: 3. Centralized here so the cap is
 * applied everywhere acceptance is granted.
 */
export const MAX_ACTIVE_JOBS_PER_SERVER = 3;

/** Job statuses that count toward the per-server active-job cap. */
export const ACTIVE_JOB_STATUSES = ["in_progress", "en_route"] as const;

/**
 * Count the jobs currently held by `serverId` that count toward the cap
 * (in_progress + en_route). `assigned` is intentionally excluded — it
 * represents a requester-initiated assignment that the server hasn't yet
 * accepted, and it doesn't tie up the server's calendar the same way.
 */
export async function countActiveJobsForServer(
  serverId: number,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.serverId, serverId),
        inArray(jobsTable.status, ACTIVE_JOB_STATUSES as unknown as string[]),
      ),
    );
  return rows[0]?.count ?? 0;
}

/**
 * Admin allowlist via env. We don't model an `admin` user role yet because
 * there's nothing else in the app that needs one (Task #6 covers a real
 * admin role); a hardcoded allowlist keeps the manual-verify endpoint
 * usable today without schema churn.
 */
export function getAdminUserIds(): Set<string> {
  return new Set(
    (process.env.ADMIN_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isAdminUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return getAdminUserIds().has(userId);
}

/**
 * Move funds from the platform balance to the server's connected Stripe
 * Express account, mirroring the result onto the existing pending payout
 * row. Idempotent on `transfer_group` so a retry after a partial failure
 * won't double-pay.
 *
 * Preconditions (callers MUST check before calling):
 *   - The job has been finalized as `served`.
 *   - A pending payout row exists for this jobId (enqueueAt confirm time).
 *   - The server has `stripeAccountId` and `payoutsEnabled = true`.
 *
 * Status semantics: a successful transfer only puts funds onto the
 * connected account's Stripe balance — the bank deposit happens later
 * via Stripe's automatic payout schedule (1–2 business days for US
 * Express). We mark the row `in_transit` here and let
 * `refreshPendingPayoutArrivalDate` / `handlePayoutEvent` promote it to
 * `paid` once Stripe confirms the actual bank deposit.
 *
 * Returns true on a fresh transfer, false if a transfer was already recorded.
 * Catches Stripe errors, logs them, and marks the payout row as `failed`
 * with a short `failureReason` summarized from the Stripe error so the
 * wallet UI can surface it. The platform can retry later (e.g. via an
 * admin tool that flips the row back to `pending`); a successful retry
 * clears `failureReason`. Never throws.
 */
export async function processPayoutTransfer(args: {
  jobId: number;
  serverUserId: string;
  amountCents: number;
  destinationAccountId: string;
  /**
   * Optional Stripe client override. Production callers omit this and we
   * fetch the real client lazily; tests inject a fake to exercise the DB
   * state machine without hitting Stripe.
   */
  stripe?: StripeClient;
}): Promise<boolean> {
  // Skip if there's already a transfer recorded for this payout.
  const [existing] = await db
    .select({ id: payoutsTable.id, transferId: payoutsTable.stripeTransferId })
    .from(payoutsTable)
    .where(eq(payoutsTable.jobId, args.jobId))
    .limit(1);
  if (!existing) {
    logger.warn(
      { jobId: args.jobId },
      "processPayoutTransfer called but no payout row exists",
    );
    return false;
  }
  if (existing.transferId) {
    return false;
  }

  try {
    const stripe = args.stripe ?? (await getUncachableStripeClient());
    const transfer = await stripe.transfers.create(
      {
        amount: args.amountCents,
        currency: "usd",
        destination: args.destinationAccountId,
        transfer_group: `served_job_${args.jobId}`,
        metadata: {
          servedJobId: String(args.jobId),
          servedServerUserId: args.serverUserId,
        },
      },
      // Idempotency key keyed on jobId so a retry after a network blip
      // doesn't double-create a transfer in Stripe.
      { idempotencyKey: `served_job_payout_${args.jobId}` },
    );
    const now = new Date();
    // Compute the best arrival date estimate we can get *now*. Authority
    // ladder (highest first):
    //   1. The connected-account balance transaction `available_on` —
    //      Stripe's authoritative "funds usable for payout" timestamp,
    //      derived from the account's actual schedule.
    //   2. The schedule's `delay_days` added in business days.
    //   3. A flat 2-business-day default if both Stripe calls fail.
    // (Once Stripe schedules an actual Payout that consumes this transfer,
    // `refreshPendingPayoutArrivalDate` upgrades the row to use the
    // Payout's real `arrival_date`.)
    const arrivalDate = await computeInitialArrivalDate(
      stripe,
      args.destinationAccountId,
      transfer.id,
      now,
    );
    await db
      .update(payoutsTable)
      .set({
        // Funds are on the connected account's Stripe balance but not yet
        // in the server's bank — `paid` is reserved for after the bank
        // deposit is confirmed (payout.paid webhook or poll-time check).
        status: "in_transit",
        stripeTransferId: transfer.id,
        stripeAccountId: args.destinationAccountId,
        // Don't set paidAt here — the row hasn't actually been paid out
        // yet. paidAt is stamped when the bank deposit clears.
        arrivalDate,
        // Clear any prior failure reason so a successful retry doesn't
        // leave stale "balance_insufficient" text on a now-in-transit row.
        failureReason: null,
        // Reset the notification marker too so a *future* failure on the
        // same row (very rare, but possible after admin reset → retry →
        // re-fail) is allowed to email the server again.
        failureNotifiedAt: null,
        updatedAt: now,
      })
      .where(eq(payoutsTable.id, existing.id));
    logger.info(
      {
        jobId: args.jobId,
        amountCents: args.amountCents,
        transferId: transfer.id,
      },
      "Server payout transferred to Connect account (in_transit pending bank deposit)",
    );
    return true;
  } catch (err) {
    const failureReason = summarizeTransferError(err);
    logger.error(
      { err, jobId: args.jobId, amountCents: args.amountCents, failureReason },
      "Stripe transfer failed; payout marked failed for manual retry",
    );
    // Mark the row as failed so the wallet UI can surface it; an admin
    // retry tool will reset to pending once the underlying issue is fixed.
    const now = new Date();
    try {
      await db
        .update(payoutsTable)
        .set({
          status: "failed",
          failureReason,
          updatedAt: now,
        })
        .where(eq(payoutsTable.id, existing.id));
    } catch (innerErr) {
      logger.error(
        { err: innerErr, jobId: args.jobId },
        "Failed to mark payout as failed after transfer error",
      );
      // If we couldn't even persist the failure, don't try to send a
      // notification — the next retry will see the same state and we
      // can attempt notification then.
      return false;
    }

    // Atomically claim the notification slot: only one writer can flip
    // `failure_notified_at` from NULL to `now`. The `RETURNING` row count
    // tells us whether *we* won the claim, so two concurrent retry workers
    // hitting the same payout won't both email the server.
    let claimed = false;
    try {
      const claimRows = await db
        .update(payoutsTable)
        .set({ failureNotifiedAt: now, updatedAt: now })
        .where(
          and(
            eq(payoutsTable.id, existing.id),
            isNull(payoutsTable.failureNotifiedAt),
          ),
        )
        .returning({ id: payoutsTable.id });
      claimed = claimRows.length > 0;
    } catch (claimErr) {
      logger.error(
        { err: claimErr, jobId: args.jobId },
        "Failed to claim payout-failure notification slot",
      );
    }

    if (claimed) {
      // Fire-and-forget the email. `notifyPayoutFailure` swallows its own
      // errors so the surrounding payout flow is never disrupted by a
      // mailer or DB lookup failure.
      void notifyPayoutFailure({
        jobId: args.jobId,
        serverUserId: args.serverUserId,
        amountCents: args.amountCents,
        failureReason,
      });
    }
    return false;
  }
}

/**
 * Look up the server's contact details + the job reference and send the
 * payout-failure notification email. Never throws — all error paths log
 * and return so this can safely be `void`-ed by the caller. Called from
 * `processPayoutTransfer`'s catch block exactly once per failure cycle
 * (idempotency is enforced by `failure_notified_at` on the payout row).
 */
async function notifyPayoutFailure(args: {
  jobId: number;
  serverUserId: string;
  amountCents: number;
  failureReason: string;
}): Promise<void> {
  try {
    // Pull email + name preferences and the job's platformRef in two small
    // lookups. Server profile email wins (it's what the server signed up
    // with at invite time); fall back to the linked Clerk user record.
    const [serverRow] = await db
      .select({
        email: serversTable.email,
        name: serversTable.name,
      })
      .from(serversTable)
      .where(eq(serversTable.userId, args.serverUserId))
      .limit(1);

    let to: string | null = serverRow?.email ?? null;
    let serverName: string | null = serverRow?.name ?? null;

    if (!to) {
      const [userRow] = await db
        .select({
          email: usersTable.email,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
        })
        .from(usersTable)
        .where(eq(usersTable.id, args.serverUserId))
        .limit(1);
      to = userRow?.email ?? null;
      if (!serverName && userRow) {
        const composed = [userRow.firstName, userRow.lastName]
          .filter(Boolean)
          .join(" ")
          .trim();
        serverName = composed || null;
      }
    }

    if (!to) {
      logger.warn(
        { jobId: args.jobId, serverUserId: args.serverUserId },
        "Cannot send payout-failure email — no email on file for server",
      );
      return;
    }

    const [jobRow] = await db
      .select({ platformRef: jobsTable.platformRef })
      .from(jobsTable)
      .where(eq(jobsTable.id, args.jobId))
      .limit(1);
    const jobReference = jobRow?.platformRef ?? `job #${args.jobId}`;

    const delivered = await sendPayoutFailedEmail({
      to,
      serverName,
      amountCents: args.amountCents,
      jobReference,
      failureReason: args.failureReason,
    });
    logger.info(
      { jobId: args.jobId, to, delivered },
      "Payout-failure notification dispatched",
    );
  } catch (err) {
    logger.error(
      { err, jobId: args.jobId },
      "Failed to send payout-failure notification email",
    );
  }
}

/**
 * Maximum length we persist for a failure reason. Wallet UI shows it inline
 * so we want it short enough to read at a glance, but long enough to keep
 * Stripe's actionable copy ("Your destination account does not have a bank
 * account…"). 280 chars matches the schema comment.
 */
const FAILURE_REASON_MAX_LEN = 280;

/**
 * Build a short, server-safe summary of a Stripe transfer error for display
 * in the wallet UI. We pull `code` (or `type`) and `message` off the Stripe
 * error shape when present, and fall back to the generic Error message
 * otherwise. Anything we don't recognize collapses to a stable string so
 * the UI never has to render "[object Object]".
 */
function summarizeTransferError(err: unknown): string {
  let raw: string;
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; type?: unknown; message?: unknown };
    const codePart =
      typeof e.code === "string" && e.code
        ? e.code
        : typeof e.type === "string" && e.type
          ? e.type
          : null;
    const messagePart = typeof e.message === "string" ? e.message : "";
    raw = codePart && messagePart
      ? `${codePart}: ${messagePart}`
      : codePart ?? messagePart ?? "Unknown Stripe error";
  } else {
    raw = "Unknown Stripe error";
  }
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= FAILURE_REASON_MAX_LEN) return collapsed;
  return collapsed.slice(0, FAILURE_REASON_MAX_LEN - 1) + "…";
}

/**
 * Best-effort initial arrival-date computation for a freshly created
 * transfer. Tries Stripe's authoritative `available_on` from the connected
 * account's balance transaction first, then the schedule's `delay_days`,
 * then a 2-business-day default.
 */
async function computeInitialArrivalDate(
  stripe: StripeClient,
  destinationAccountId: string,
  transferId: string,
  now: Date,
): Promise<Date> {
  // 1. Connected-account balance transaction created by the transfer:
  //    bt.available_on is the unix timestamp at which funds become payable.
  try {
    const list = await stripe.balanceTransactions.list(
      { source: transferId, limit: 1 },
      { stripeAccount: destinationAccountId },
    );
    const bt = list.data[0];
    if (bt && typeof bt.available_on === "number" && bt.available_on > 0) {
      return new Date(bt.available_on * 1000);
    }
  } catch (err) {
    logger.warn(
      { err, transferId, accountId: destinationAccountId },
      "Could not fetch connected-account balance transaction; falling back to schedule",
    );
  }

  // 2. Connected account's payout schedule.
  try {
    const account = await stripe.accounts.retrieve(destinationAccountId);
    const rawDelay = account.settings?.payouts?.schedule?.delay_days;
    const delayDays =
      typeof rawDelay === "number" && rawDelay >= 0
        ? rawDelay
        : DEFAULT_PAYOUT_DELAY_BUSINESS_DAYS;
    return addBusinessDays(now, delayDays);
  } catch (acctErr) {
    logger.warn(
      { err: acctErr, accountId: destinationAccountId },
      "Could not fetch Connect payout schedule; using default ETA",
    );
  }

  // 3. Default: 2 business days.
  return addBusinessDays(now, DEFAULT_PAYOUT_DELAY_BUSINESS_DAYS);
}

/**
 * Result of a single payout-row refresh against Stripe. `arrivalDate` is
 * the most recent date we know about (refreshed if available, otherwise
 * the row's existing value). `status` is set to `"paid"` only when this
 * call promoted the row from `in_transit` (or `pending`) to `paid`
 * because Stripe confirmed the bank deposit; otherwise `null`.
 * `paidAt` mirrors the timestamp written in that promotion case so
 * callers can update their in-memory row without a re-read.
 */
export interface RefreshPayoutResult {
  arrivalDate: Date | null;
  status: "paid" | null;
  paidAt: Date | null;
}

/**
 * For a single payout row, ask Stripe whether it has scheduled (and/or
 * settled) an actual Payout that consumes our transfer. We:
 *   - Persist the Payout id and the authoritative `arrival_date`.
 *   - Promote the row to `paid` (with `paidAt`) when Stripe reports the
 *     payout's status as `paid` — i.e. funds have actually landed in
 *     the server's bank.
 * Idempotent and safe to call repeatedly. Never throws — Stripe failures
 * fall back to the existing values already on the row.
 */
export async function refreshPendingPayoutArrivalDate(
  stripe: StripeClient,
  row: {
    id: number;
    status: string;
    stripeTransferId: string | null;
    stripeAccountId: string | null;
    stripePayoutId: string | null;
    arrivalDate: Date | null;
  },
): Promise<RefreshPayoutResult> {
  const noChange: RefreshPayoutResult = {
    arrivalDate: row.arrivalDate,
    status: null,
    paidAt: null,
  };
  if (!row.stripeTransferId || !row.stripeAccountId) return noChange;

  try {
    let payoutId = row.stripePayoutId;

    // Discover the Payout id from the connected-account balance
    // transaction if we don't have one yet. Stripe sets `bt.payout` once
    // the next automatic payout has been scheduled to include this BT.
    if (!payoutId) {
      const list = await stripe.balanceTransactions.list(
        { source: row.stripeTransferId, limit: 1 },
        { stripeAccount: row.stripeAccountId },
      );
      const bt = list.data[0] as
        | { payout?: string | { id: string } | null }
        | undefined;
      const candidate =
        bt && bt.payout
          ? typeof bt.payout === "string"
            ? bt.payout
            : bt.payout.id
          : null;
      payoutId = candidate;
    }

    if (!payoutId) return noChange;

    const payout = await stripe.payouts.retrieve(payoutId, {
      stripeAccount: row.stripeAccountId,
    });
    const newArrival =
      typeof payout.arrival_date === "number" && payout.arrival_date > 0
        ? new Date(payout.arrival_date * 1000)
        : row.arrivalDate;

    // Only promote to `paid` when Stripe says the bank deposit cleared.
    // Don't downgrade an already-`paid` row, and don't touch terminal
    // states like `failed`.
    const shouldPromoteToPaid =
      payout.status === "paid" && row.status !== "paid" && row.status !== "failed";
    const newPaidAt = shouldPromoteToPaid ? newArrival ?? new Date() : null;

    const arrivalChanged =
      newArrival?.getTime() !== row.arrivalDate?.getTime();
    const payoutIdChanged = row.stripePayoutId !== payoutId;
    const needsWrite = arrivalChanged || payoutIdChanged || shouldPromoteToPaid;

    if (needsWrite) {
      const setValues: Record<string, unknown> = {
        stripePayoutId: payoutId,
        updatedAt: new Date(),
      };
      if (arrivalChanged && newArrival) setValues.arrivalDate = newArrival;
      if (shouldPromoteToPaid) {
        setValues.status = "paid";
        setValues.paidAt = newPaidAt;
      }
      await db
        .update(payoutsTable)
        .set(setValues)
        .where(eq(payoutsTable.id, row.id));
      if (shouldPromoteToPaid) {
        logger.info(
          {
            payoutRowId: row.id,
            stripePayoutId: payoutId,
            arrivalDate: newArrival,
          },
          "Payout promoted to paid (bank deposit confirmed by Stripe)",
        );
      }
    }

    return {
      arrivalDate: newArrival,
      status: shouldPromoteToPaid ? "paid" : null,
      paidAt: newPaidAt,
    };
  } catch (err) {
    logger.warn(
      { err, payoutRowId: row.id },
      "Failed to refresh payout arrival_date from Stripe",
    );
    return noChange;
  }
}

/**
 * Backstop polling sweep for unsettled payout arrival dates.
 *
 * The PRIMARY path is the Stripe Connect webhook (registered in
 * `index.ts`, dispatched in `WebhookHandlers.processConnectWebhook`):
 * Stripe pushes `payout.created` / `payout.updated` / `payout.paid` the
 * moment its automatic Payout from a connected account schedules or
 * completes, and `handlePayoutEvent` writes the authoritative
 * `arrival_date` straight onto matching `payouts` rows.
 *
 * This poller is the safety net for the cases where the webhook never
 * lands — Stripe outage, our endpoint returning non-2xx during a deploy,
 * a Connect webhook misconfiguration, etc. It walks unsettled payout
 * rows and asks Stripe whether it has scheduled (or settled) an actual
 * Payout on the connected account that consumes our transfer. If so,
 * the row's `arrivalDate` is upgraded to Stripe's authoritative
 * `arrival_date`, `stripePayoutId` is recorded, and the row is promoted
 * from `in_transit` to `paid` once Stripe confirms the bank deposit.
 *
 * What we refresh:
 *   - rows with a `stripeTransferId` (we have something to look up)
 *   - rows still unsettled (`pending` / `in_transit`) — `paid` is
 *     terminal under the new status semantics (set only after the bank
 *     deposit clears) and `failed` rows aren't worth re-polling.
 *
 * What we skip:
 *   - rows with no transfer id (haven't been paid out yet)
 *   - rows older than 14 days (any reasonable Stripe payout schedule has
 *     resolved by then; keeps the poll cheap as the table grows)
 *
 * Failures inside `refreshPendingPayoutArrivalDate` are swallowed there,
 * so an outage on one row doesn't poison the whole sweep. Returns a
 * `{ examined, updated, promoted }` triple: `examined` is how many rows
 * we asked Stripe about; `updated` is how many came back with a real
 * arrival-date change; `promoted` is how many were transitioned to
 * `paid` because Stripe confirmed the bank deposit.
 */
export interface PollPayoutSweepResult {
  examined: number;
  updated: number;
  promoted: number;
}

export async function pollPayoutArrivalDates(opts: {
  /** Cap on rows examined per sweep. Keeps poll latency bounded. */
  limit?: number;
} = {}): Promise<PollPayoutSweepResult> {
  const limit = opts.limit ?? 100;

  // Apply the freshness cutoff in SQL (not JS) so the LIMIT predictably
  // selects the most recent rows that haven't yet settled. Without this,
  // a backlog of older rows could starve newly-created payouts of their
  // refresh window. 14 days is well past any reasonable Stripe payout
  // schedule (Express defaults to 2 business days).
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: payoutsTable.id,
      stripeTransferId: payoutsTable.stripeTransferId,
      stripeAccountId: payoutsTable.stripeAccountId,
      stripePayoutId: payoutsTable.stripePayoutId,
      arrivalDate: payoutsTable.arrivalDate,
      createdAt: payoutsTable.createdAt,
      status: payoutsTable.status,
    })
    .from(payoutsTable)
    .where(
      and(
        isNotNull(payoutsTable.stripeTransferId),
        // `paid` is now terminal (set only after Stripe confirms the bank
        // deposit) so there's nothing left to refresh on those rows. We
        // continue to poll `pending` and `in_transit` so the poller can
        // both update arrival_date and promote rows to `paid` when the
        // connected payout settles.
        inArray(payoutsTable.status, ["pending", "in_transit"]),
        gte(payoutsTable.createdAt, cutoff),
      ),
    )
    // Newest first so the most user-visible payouts (recent wallet rows)
    // always win the per-sweep budget.
    .orderBy(desc(payoutsTable.createdAt))
    .limit(limit);

  if (rows.length === 0) return { examined: 0, updated: 0, promoted: 0 };

  const stripe = await getUncachableStripeClient();
  const results = await Promise.all(
    rows.map(async (r) => {
      const result = await refreshPendingPayoutArrivalDate(stripe, r);
      // Detect a real arrival-date change by comparing millisecond
      // timestamps (handles null on either side).
      const before = r.arrivalDate?.getTime() ?? null;
      const next = result.arrivalDate?.getTime() ?? null;
      const arrivalChanged = next !== null && next !== before;
      const promoted = result.status === "paid";
      return { arrivalChanged, promoted };
    }),
  );

  return {
    examined: rows.length,
    updated: results.filter((r) => r.arrivalChanged).length,
    promoted: results.filter((r) => r.promoted).length,
  };
}

/**
 * Backstop poll cadence in ms. With the Connect webhook handling the
 * fast path, this only runs to catch missed deliveries — 10 min is a
 * conservative safety net that keeps the table cold even at scale.
 */
export const PAYOUT_POLL_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Start the periodic payout-arrival-date poller. Returns the timer handle
 * (caller can clear it on shutdown if needed). Logs sweep results so we
 * can observe the poller in production logs.
 *
 * Behaviour:
 *  - Fires one immediate sweep on a short delay (1s) so a freshly-deployed
 *    instance picks up Stripe-side changes that occurred between deploys
 *    instead of waiting a full interval.
 *  - Then ticks every `intervalMs`.
 *  - Both timers are `unref()`'d so they don't block process exit.
 *  - An in-flight guard ensures a slow Stripe response can never cause two
 *    sweeps to overlap and double our load.
 */
export function startPayoutPoller(intervalMs: number = PAYOUT_POLL_INTERVAL_MS): NodeJS.Timeout {
  let inFlight = false;
  const tick = async () => {
    if (inFlight) {
      logger.warn("Payout arrival-date poll sweep skipped: previous sweep still running");
      return;
    }
    inFlight = true;
    try {
      const { examined, updated, promoted } = await pollPayoutArrivalDates();
      if (examined > 0) {
        logger.info(
          { rowsExamined: examined, rowsUpdated: updated, rowsPromoted: promoted },
          "Payout arrival-date poll sweep complete",
        );
      }
    } catch (err) {
      logger.error({ err }, "Payout arrival-date poll sweep failed");
    } finally {
      inFlight = false;
    }
  };
  // Kick off an immediate sweep on a short delay so the listener is fully
  // up before we hammer Stripe / the DB. Don't run synchronously here —
  // pollPayoutArrivalDates is async and we want startPayoutPoller to
  // return promptly.
  const initialHandle = setTimeout(tick, 1000);
  if (typeof initialHandle.unref === "function") initialHandle.unref();

  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}

export { and };
