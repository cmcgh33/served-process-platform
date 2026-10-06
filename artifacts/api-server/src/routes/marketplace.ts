import { Router, type IRouter } from "express";
import {
  db,
  subscriptionsTable,
  vaultSubscriptionsTable,
  serverCredentialsTable,
  serversTable,
  payoutsTable,
  jobsTable,
  uploadReservationsTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  PROSERVE_MONTHLY_CENTS,
  SERVE_PRICES_CENTS,
  SERVER_CREDENTIALING_CENTS,
  VAULT_PLANS,
  PLATFORM_FEE_RATE,
} from "@workspace/pricing";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  getServerByUserId,
  getServerPayoutTotalCents,
  addBusinessDays,
  DEFAULT_PAYOUT_DELAY_BUSINESS_DAYS,
  refreshPendingPayoutArrivalDate,
} from "../lib/marketplace";
import { getUncachableStripeClient } from "../stripeClient";

const router: IRouter = Router();

router.get("/pricing", requireAuth, (_req, res) => {
  res.json({
    servePricesCents: SERVE_PRICES_CENTS,
    proServeMonthlyCents: PROSERVE_MONTHLY_CENTS,
    vaultPlans: VAULT_PLANS,
    serverCredentialingCents: SERVER_CREDENTIALING_CENTS,
    platformFeeRate: PLATFORM_FEE_RATE,
  });
});

router.get("/me/subscription", requireRole("attorney"), async (req, res) => {
  const rows = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, req.userId!))
    .limit(1);
  const sub = rows[0];
  if (!sub) {
    res.status(404).json({ error: "No subscription" });
    return;
  }
  res.json(sub);
});

router.get("/me/vault-subscription", requireRole("requester"), async (req, res) => {
  const rows = await db
    .select()
    .from(vaultSubscriptionsTable)
    .where(eq(vaultSubscriptionsTable.userId, req.userId!))
    .limit(1);
  const sub = rows[0];
  if (!sub) {
    res.status(404).json({ error: "No vault subscription" });
    return;
  }
  res.json(sub);
});

router.get("/me/credentialing", requireRole("server"), async (req, res) => {
  const rows = await db
    .select()
    .from(serverCredentialsTable)
    .where(eq(serverCredentialsTable.userId, req.userId!))
    .limit(1);
  const cred = rows[0];
  if (!cred) {
    res.status(404).json({ error: "Not started" });
    return;
  }
  res.json(cred);
});

router.get("/me/wallet", requireRole("server"), async (req, res) => {
  const userId = req.userId!;
  // Recent payout rows for the wallet ledger view. Capped at 50 — wallet
  // pages further back can paginate later if we add a need.
  const recent = await db
    .select({
      id: payoutsTable.id,
      jobId: payoutsTable.jobId,
      amountCents: payoutsTable.amountCents,
      status: payoutsTable.status,
      paidAt: payoutsTable.paidAt,
      arrivalDate: payoutsTable.arrivalDate,
      createdAt: payoutsTable.createdAt,
      stripeTransferId: payoutsTable.stripeTransferId,
      stripeAccountId: payoutsTable.stripeAccountId,
      stripePayoutId: payoutsTable.stripePayoutId,
      failureReason: payoutsTable.failureReason,
    })
    .from(payoutsTable)
    .where(eq(payoutsTable.userId, userId))
    .orderBy(desc(payoutsTable.createdAt))
    .limit(50);
  const server = await getServerByUserId(userId);

  // Best-effort refresh from Stripe: for unsettled rows that already have
  // a transfer, ask Stripe whether it has scheduled an actual Payout that
  // includes our transfer. If so, we persist the Payout id and overwrite
  // the row's arrivalDate with Stripe's authoritative `arrival_date`, and
  // promote the row from in_transit to paid when the bank deposit clears.
  // Capped at 5 to keep p99 latency bounded; older rows refresh on later
  // wallet loads. Failures inside the helper are swallowed.
  const refreshable = recent
    .filter(
      (r) =>
        (r.status === "pending" || r.status === "in_transit") &&
        r.stripeTransferId &&
        r.stripeAccountId,
    )
    .slice(0, 5);
  if (refreshable.length > 0) {
    try {
      const stripe = await getUncachableStripeClient();
      const refreshed = await Promise.all(
        refreshable.map((r) => refreshPendingPayoutArrivalDate(stripe, r)),
      );
      // Mutate the rows we'll return so the response reflects the refresh
      // without needing a second DB read. We mirror not just arrival_date
      // but also any in_transit→paid promotion so the wallet shows
      // "Arrived <date>" immediately when Stripe just confirmed the bank
      // deposit.
      for (let i = 0; i < refreshable.length; i++) {
        const result = refreshed[i];
        if (result.arrivalDate) refreshable[i].arrivalDate = result.arrivalDate;
        if (result.status === "paid") {
          refreshable[i].status = "paid";
          if (result.paidAt) refreshable[i].paidAt = result.paidAt;
        }
      }
    } catch (err) {
      req.log.warn(
        { err },
        "Could not refresh payout arrival dates from Stripe; using stored values",
      );
    }
  }

  // Compute aggregate totals AFTER the refresh so any in_transit→paid
  // promotion above is reflected in paidCents/pendingCents instead of
  // showing stale numbers for the page load that triggered the promotion.
  const totals = await getServerPayoutTotalCents(userId);

  // Lifetime "Career Pipeline" stats — count + sum of every successfully
  // served job for this server (status = 'served', payout-eligible). Source
  // of truth is the jobs table itself rather than payoutsTable so the count
  // matches "View all" on the completed-jobs page even for jobs whose
  // Stripe transfer hasn't settled yet. Returns 0/0 when the server has no
  // server row yet (pre-onboarding).
  let lifetimeJobsCompleted = 0;
  let lifetimeEarningsCents = 0;
  if (server?.id != null) {
    const [agg] = await db
      .select({
        completed: sql<number>`COUNT(*)::int`,
        earnings: sql<number>`COALESCE(SUM(${jobsTable.serverPayoutCents}), 0)::int`,
      })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.serverId, server.id),
          eq(jobsTable.status, "served"),
        ),
      );
    lifetimeJobsCompleted = agg?.completed ?? 0;
    lifetimeEarningsCents = agg?.earnings ?? 0;
  }

  // "Next expected payout" ETA. We pick the earliest known arrivalDate among
  // unpaid (pending/in_transit) rows; if none of those rows have an
  // arrivalDate yet but there's a pending balance, we fall back to the
  // standard ~2 business day Stripe Express default. This is a best-effort
  // estimate and the wallet UI labels it accordingly.
  let nextPayoutArrivalDate: Date | null = null;
  const unpaidArrivals = recent
    .filter((r) => (r.status === "pending" || r.status === "in_transit") && r.arrivalDate)
    .map((r) => r.arrivalDate as Date);
  if (unpaidArrivals.length > 0) {
    nextPayoutArrivalDate = unpaidArrivals.reduce((min, d) => (d < min ? d : min));
  } else if (totals.pendingCents > 0) {
    nextPayoutArrivalDate = addBusinessDays(
      new Date(),
      DEFAULT_PAYOUT_DELAY_BUSINESS_DAYS,
    );
  }

  // Best-effort fetch of the connected account's available balance + the
  // active payout schedule. Drives the wallet's "Pay Now" affordance and
  // the "Auto-payout: Weekly (Fridays)" status pill. Failures are
  // swallowed — the wallet still renders fine without these fields.
  let connectAvailableCents = 0;
  let payoutSchedule: {
    interval: string;
    weeklyAnchor: string | null;
    monthlyAnchor: number | null;
    delayDays: number | null;
  } | null = null;
  if (server?.stripeAccountId && server.payoutsEnabled) {
    try {
      const stripe = await getUncachableStripeClient();
      const [balance, account] = await Promise.all([
        stripe.balance.retrieve(undefined, {
          stripeAccount: server.stripeAccountId,
        }),
        stripe.accounts.retrieve(server.stripeAccountId),
      ]);
      const usd = balance.available.find((b) => b.currency === "usd");
      connectAvailableCents = usd?.amount ?? 0;
      let sch = account.settings?.payouts?.schedule;

      // Opportunistic backfill: accounts onboarded before the weekly-default
      // rollout sit on Stripe Connect Express's `daily` default. The
      // /stripe/connect/refresh endpoint already migrates these, but it
      // only runs when a server returns from hosted onboarding — so an
      // already-onboarded server would never get migrated. Mirror the same
      // safe migration here on every wallet load: flip ONLY when interval
      // is still the `daily` default. If the server has explicitly chosen
      // monthly or a different weekly anchor in their Stripe Express
      // dashboard, we respect that choice and never silently revert it.
      if (sch?.interval === "daily") {
        try {
          const updated = await stripe.accounts.update(server.stripeAccountId, {
            settings: {
              payouts: {
                schedule: { interval: "weekly", weekly_anchor: "friday" },
              },
            },
          });
          sch = updated.settings?.payouts?.schedule ?? sch;
          req.log.info(
            { userId, serverId: server.id },
            "Migrated Connect account from daily default to weekly/Friday on wallet load",
          );
        } catch (err) {
          req.log.warn(
            { err, userId, serverId: server.id },
            "Could not migrate Connect payout schedule on wallet load; leaving as-is",
          );
        }
      }

      if (sch) {
        payoutSchedule = {
          interval: sch.interval ?? "weekly",
          weeklyAnchor: sch.weekly_anchor ?? null,
          monthlyAnchor: sch.monthly_anchor ?? null,
          delayDays:
            typeof sch.delay_days === "number" ? sch.delay_days : null,
        };
      }
    } catch (err) {
      req.log.warn(
        { err },
        "Could not fetch Connect balance/schedule; wallet will show defaults",
      );
    }
  }

  res.json({
    paidCents: totals.paidCents,
    pendingCents: totals.pendingCents,
    failedCents: totals.failedCents,
    platformFeeRate: PLATFORM_FEE_RATE,
    payoutsEnabled: server?.payoutsEnabled ?? false,
    hasStripeAccount: Boolean(server?.stripeAccountId),
    connectAvailableCents,
    payoutSchedule,
    // Strip server-internal Stripe identifiers (stripeAccountId,
    // stripePayoutId) from the public response; we only needed them for
    // the per-row refresh above.
    recentPayouts: recent.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      amountCents: r.amountCents,
      status: r.status,
      paidAt: r.paidAt,
      arrivalDate: r.arrivalDate,
      createdAt: r.createdAt,
      stripeTransferId: r.stripeTransferId,
      failureReason: r.failureReason,
    })),
    nextPayoutArrivalDate,
    lifetimeJobsCompleted,
    lifetimeEarningsCents,
  });
});

/**
 * "Pay Now" — trigger an off-schedule standard payout from the server's
 * Stripe Connect Express balance straight to their bank. Uses Stripe's
 * default standard payout (typically ~2 business days). The connected
 * account's normal weekly schedule is unaffected; this just pulls the
 * currently-available balance forward.
 *
 * Idempotency: a 60-second-bucketed key prevents accidental double-clicks
 * from creating two payouts. After 60s the same caller can pay again
 * (e.g. if Stripe added more available balance).
 */
router.post("/me/payouts/instant", requireRole("server"), async (req, res) => {
  const userId = req.userId!;
  const server = await getServerByUserId(userId);
  if (!server || !server.stripeAccountId) {
    res.status(400).json({
      error: { code: "no_connect_account", message: "Connect your bank first." },
    });
    return;
  }
  if (!server.payoutsEnabled) {
    res.status(400).json({
      error: {
        code: "payouts_not_enabled",
        message: "Finish Stripe onboarding before requesting a payout.",
      },
    });
    return;
  }

  const stripe = await getUncachableStripeClient();
  const balance = await stripe.balance.retrieve(undefined, {
    stripeAccount: server.stripeAccountId,
  });
  const usd = balance.available.find((b) => b.currency === "usd");
  const available = usd?.amount ?? 0;
  if (available <= 0) {
    res.status(400).json({
      error: {
        code: "no_available_balance",
        message:
          "No funds are available to pay out yet. Stripe holds new transfers for ~2 business days before they become withdrawable.",
      },
    });
    return;
  }

  // 60-second bucket so a double-click within 60s coalesces, but the
  // caller can still trigger a second payout shortly after if more funds
  // become available.
  const bucket = Math.floor(Date.now() / 60000);
  const idempotencyKey = `pay_now_${server.stripeAccountId}_${bucket}`;

  try {
    const payout = await stripe.payouts.create(
      {
        amount: available,
        currency: "usd",
        metadata: {
          servedUserId: userId,
          servedServerId: String(server.id),
          trigger: "wallet_pay_now",
        },
      },
      {
        stripeAccount: server.stripeAccountId,
        idempotencyKey,
      },
    );
    req.log.info(
      {
        userId,
        serverId: server.id,
        payoutId: payout.id,
        amount: payout.amount,
      },
      "Triggered instant Pay Now payout",
    );
    res.json({
      payoutId: payout.id,
      amountCents: payout.amount,
      arrivalDate: payout.arrival_date
        ? new Date(payout.arrival_date * 1000).toISOString()
        : null,
      status: payout.status,
    });
  } catch (err) {
    const stripeErr = err as { message?: string; code?: string };
    req.log.warn(
      { err, userId, serverId: server.id },
      "Pay Now payout failed",
    );
    // Stripe returns `balance_insufficient` when funds are tied up in an
    // in-flight automatic payout (the Friday weekly batch may have already
    // claimed the available balance). Surface a clearer message — funds
    // are safe and will arrive via the normal weekly schedule.
    if (stripeErr.code === "balance_insufficient") {
      res.status(409).json({
        error: {
          code: "payout_already_in_progress",
          message:
            "An automatic payout is already in progress for this balance. It will arrive on the normal weekly schedule.",
        },
      });
      return;
    }
    res.status(400).json({
      error: {
        code: stripeErr.code ?? "payout_failed",
        message:
          stripeErr.message ??
          "Stripe rejected the payout request. Try again later.",
      },
    });
  }
});

/**
 * Combined gating + payouts status for the server portal. Lets the client
 * render the right banner (verified vs pending vs failed; bank connected
 * vs not) without firing two separate requests.
 */
/**
 * Self-fetch the caller's server profile for the credentialing page.
 * Returns 404 if no row exists yet (caller signed up but record hasn't
 * been provisioned by the admin/onboarding flow).
 */
router.get("/me/server-profile", requireRole("server"), async (req, res) => {
  const server = await getServerByUserId(req.userId!);
  if (!server) {
    res
      .status(404)
      .json({ error: { code: "not_found", message: "No server profile on file" } });
    return;
  }
  res.json(server);
});

/**
 * Self-edit the caller's server profile. Only writes the fields needed
 * for Nevada-compliant affidavits — never tier/active/Stripe IDs, which
 * stay admin-only.
 */
router.patch(
  "/me/server-profile",
  requireRole("server"),
  async (req, res) => {
    const server = await getServerByUserId(req.userId!);
    if (!server) {
      res.status(404).json({
        error: { code: "not_found", message: "No server profile on file" },
      });
      return;
    }

    const body = req.body as {
      businessAddress?: string | null;
      isLicensedNvServer?: boolean;
      licenseNumber?: string | null;
      licenseCounty?: string | null;
      serverType?: string | null;
      photoUrl?: string | null;
    };

    const ALLOWED_SERVER_TYPES = new Set([
      "licensed_nv",
      "registered",
      "private",
      "sheriff",
    ]);

    const patch: Record<string, unknown> = {};
    if (body.businessAddress !== undefined) {
      const v = body.businessAddress?.trim();
      patch.businessAddress = v ? v : null;
    }
    if (body.isLicensedNvServer !== undefined) {
      patch.isLicensedNvServer = Boolean(body.isLicensedNvServer);
    }
    if (body.licenseNumber !== undefined) {
      const v = body.licenseNumber?.trim();
      patch.licenseNumber = v ? v : null;
    }
    if (body.licenseCounty !== undefined) {
      const v = body.licenseCounty?.trim();
      patch.licenseCounty = v ? v : null;
    }
    if (body.serverType !== undefined) {
      const v = body.serverType?.trim() || null;
      if (v && !ALLOWED_SERVER_TYPES.has(v)) {
        res.status(400).json({
          error: {
            code: "invalid_server_type",
            message:
              "serverType must be one of: licensed_nv, registered, private, sheriff",
          },
        });
        return;
      }
      patch.serverType = v;
    }
    if (body.photoUrl !== undefined) {
      const v = body.photoUrl?.trim();
      if (v && v !== server.photoUrl) {
        // Provenance check: only allow setting photoUrl to an object path this
        // same user reserved via POST /storage/profile-photo/request-url. This
        // prevents a server from pointing photoUrl at another user's private
        // object to gain read access through canReadObject. No-op re-saves of
        // the already-stored path skip the check (the reservation may have
        // expired by then).
        const [reservation] = await db
          .select({ objectPath: uploadReservationsTable.objectPath })
          .from(uploadReservationsTable)
          .where(
            and(
              eq(uploadReservationsTable.objectPath, v),
              eq(uploadReservationsTable.ownerUserId, req.userId!),
            ),
          )
          .limit(1);
        if (!reservation) {
          res.status(400).json({
            error: {
              code: "invalid_photo_url",
              message:
                "photoUrl must be an upload URL issued to you via the profile-photo endpoint",
            },
          });
          return;
        }
      }
      patch.photoUrl = v ? v : null;
    }

    if (Object.keys(patch).length === 0) {
      res.json(server);
      return;
    }

    const [updated] = await db
      .update(serversTable)
      .set(patch)
      .where(eq(serversTable.id, server.id))
      .returning();

    // Finalize the profile-photo reservation so the periodic orphan-blob
    // sweeper (POST /storage/uploads/request-url) never deletes a headshot
    // that's now persisted on servers.photoUrl. Mirrors how document uploads
    // clear their reservation on finalize.
    if (typeof patch.photoUrl === "string" && patch.photoUrl) {
      await db
        .delete(uploadReservationsTable)
        .where(
          and(
            eq(uploadReservationsTable.objectPath, patch.photoUrl),
            eq(uploadReservationsTable.ownerUserId, req.userId!),
          ),
        );
    }

    res.json(updated);
  },
);

router.get("/me/server-status", requireRole("server"), async (req, res) => {
  const userId = req.userId!;
  const [credRow] = await db
    .select()
    .from(serverCredentialsTable)
    .where(eq(serverCredentialsTable.userId, userId))
    .limit(1);
  const server = await getServerByUserId(userId);
  const serverStatus = (server?.status ?? "pending") as
    | "pending"
    | "active"
    | "suspended"
    | "inactive";
  res.json({
    credentialing: {
      status: credRow?.status ?? null,
      verifiedAt: credRow?.verifiedAt ?? null,
      failureReason: credRow?.failureReason ?? null,
      hasRow: Boolean(credRow),
    },
    trainingCompletedAt: credRow?.trainingCompletedAt ?? null,
    payouts: {
      hasStripeAccount: Boolean(server?.stripeAccountId),
      payoutsEnabled: server?.payoutsEnabled ?? false,
    },
    serverStatus,
    licenseExpiry: server?.licenseExpiry ?? null,
    canAcceptJobs:
      serverStatus === "active" &&
      credRow?.status === "verified" &&
      (server?.payoutsEnabled ?? false),
  });
});

/**
 * Mark the calling server's onboarding training as complete. Idempotent —
 * if the row already has a `trainingCompletedAt`, the existing timestamp
 * is kept and returned. If no `server_credentials` row exists yet (e.g.
 * the server was admin-provisioned without going through Certn checkout),
 * we insert a stub row so the timestamp can land somewhere.
 */
router.post(
  "/me/training/complete",
  requireRole("server"),
  async (req, res) => {
    const userId = req.userId!;
    const now = new Date();

    // Race-safe idempotent upsert:
    //   - INSERT ... ON CONFLICT (userId) DO UPDATE SET trainingCompletedAt = COALESCE(existing, now)
    //     preserves the first-ever timestamp under concurrent retries.
    //   - We never overwrite a non-null trainingCompletedAt.
    const [row] = await db
      .insert(serverCredentialsTable)
      .values({
        userId,
        status: "unpaid",
        trainingCompletedAt: now,
      })
      .onConflictDoUpdate({
        target: serverCredentialsTable.userId,
        set: {
          trainingCompletedAt: sql`COALESCE(${serverCredentialsTable.trainingCompletedAt}, ${now})`,
          updatedAt: now,
        },
      })
      .returning({ ts: serverCredentialsTable.trainingCompletedAt });

    res.json({ trainingCompletedAt: row!.ts!.toISOString() });
  },
);

export default router;
