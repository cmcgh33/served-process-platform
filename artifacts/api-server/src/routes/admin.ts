/**
 * Admin endpoints. Gated by an env-driven allowlist (`ADMIN_USER_IDS`,
 * comma-separated Clerk user ids). 404 (not 403) on miss so the surface
 * area of the admin namespace is invisible to regular users.
 *
 * NOT exposed via OpenAPI on purpose — admin pages call these directly
 * via fetch from `lib/admin.ts`, keeping the public spec free of
 * privileged surface area.
 */
import type { Response } from "express";
import { Router, type IRouter } from "express";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  parseAdminUsersQuery,
  buildAdminUsersWhere,
} from "../lib/adminUserFilters";
import {
  db,
  adminAuditLogTable,
  clientsTable,
  documentsTable,
  jobsTable,
  paymentsTable,
  payoutsTable,
  serverCredentialsTable,
  serversTable,
  subscriptionsTable,
  uploadReservationsTable,
  usersTable,
  licenseExpiryNotificationsTable,
  ADMIN_AUDIT_ACTIONS,
  SERVER_STATUSES,
  type AdminAuditAction,
  type ServerStatus,
  type UserRole,
} from "@workspace/db";
import { clerkClient } from "@clerk/express";
import { requireAuth } from "../middlewares/auth";
import { isAdminUser, processPayoutTransfer } from "../lib/marketplace";
import { runLicenseExpiryNotifications } from "../lib/licenseExpiryEmails";
import { generateAndStoreAffidavit } from "../lib/affidavit";
import { sendEmailDetailed, sendServerInviteEmail } from "../lib/mailer";
import { appBaseUrl } from "../lib/appBaseUrl";

const router: IRouter = Router();

/**
 * Admin-only middleware. 404 (not 403) on miss so the surface area of the
 * admin namespace is invisible to regular users.
 */
function requireAdmin(): (req: any, res: any, next: any) => void {
  return (req, res, next) => {
    if (!isAdminUser(req.userId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    next();
  };
}

/**
 * Persist an admin action to `admin_audit_log`. Best-effort: failures are
 * logged but do not break the originating request — the underlying mutation
 * has already been committed.
 *
 * Call AFTER the action has succeeded so we never record a phantom row for
 * a transaction that didn't take effect.
 */
async function recordAdminAudit(
  req: any,
  action: AdminAuditAction,
  opts: {
    targetServerId?: number | null;
    targetUserId?: string | null;
    details?: Record<string, unknown> | null;
  } = {},
): Promise<void> {
  try {
    await db.insert(adminAuditLogTable).values({
      actorUserId: req.userId,
      action,
      targetServerId: opts.targetServerId ?? null,
      targetUserId: opts.targetUserId ?? null,
      details: opts.details ?? null,
    });
  } catch (err: any) {
    req.log?.warn(
      { err: err?.message ?? String(err), action },
      "Failed to write admin audit log row",
    );
  }
}

// ---------------------------------------------------------------------------
// Overview — counts + revenue rollup for the admin landing page.
// ---------------------------------------------------------------------------
router.get("/admin/overview", requireAuth, requireAdmin(), async (_req, res) => {
  const [usersByRole, jobsByStatus, revenue, payoutAgg, subsCount] =
    await Promise.all([
      db
        .select({ role: usersTable.role, count: count() })
        .from(usersTable)
        .groupBy(usersTable.role),
      db
        .select({ status: jobsTable.status, count: count() })
        .from(jobsTable)
        .groupBy(jobsTable.status),
      db
        .select({
          gross: sql<number>`COALESCE(SUM(${jobsTable.grossCents}), 0)`,
          fees: sql<number>`COALESCE(SUM(${jobsTable.platformFeeCents}), 0)`,
        })
        .from(jobsTable)
        .where(eq(jobsTable.status, "served")),
      db
        .select({
          status: payoutsTable.status,
          totalCents: sql<number>`COALESCE(SUM(${payoutsTable.amountCents}), 0)`,
        })
        .from(payoutsTable)
        .groupBy(payoutsTable.status),
      db
        .select({ count: count() })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.status, "active")),
    ]);

  res.json({
    usersByRole: usersByRole.map((r) => ({
      role: r.role ?? "unassigned",
      count: Number(r.count),
    })),
    jobsByStatus: jobsByStatus.map((r) => ({
      status: r.status,
      count: Number(r.count),
    })),
    revenue: {
      grossCents: Number(revenue[0]?.gross ?? 0),
      platformFeeCents: Number(revenue[0]?.fees ?? 0),
    },
    payouts: payoutAgg.map((r) => ({
      status: r.status,
      totalCents: Number(r.totalCents),
    })),
    activeSubscriptions: Number(subsCount[0]?.count ?? 0),
  });
});

// ---------------------------------------------------------------------------
// Jobs list — joins requester + server names for the admin grid.
// ---------------------------------------------------------------------------
router.get("/admin/jobs", requireAuth, requireAdmin(), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
    200,
  );
  const offset = Math.max(
    Number.parseInt(String(req.query.offset ?? "0"), 10) || 0,
    0,
  );

  const where = status ? eq(jobsTable.status, status) : undefined;
  const rows = await db
    .select({
      id: jobsTable.id,
      status: jobsTable.status,
      documentType: jobsTable.documentType,
      recipientName: jobsTable.recipientName,
      recipientCity: jobsTable.recipientCity,
      recipientState: jobsTable.recipientState,
      caseNumber: jobsTable.caseNumber,
      requesterUserId: jobsTable.requesterUserId,
      serverId: jobsTable.serverId,
      grossCents: jobsTable.grossCents,
      serviceType: jobsTable.serviceType,
      createdAt: jobsTable.createdAt,
      servedAt: jobsTable.servedAt,
      proofPdfUrl: jobsTable.proofPdfUrl,
    })
    .from(jobsTable)
    .where(where)
    .orderBy(desc(jobsTable.createdAt))
    .limit(limit)
    .offset(offset);

  // Side joins for display names.
  const requesterIds = Array.from(
    new Set(rows.map((r) => r.requesterUserId).filter(Boolean) as string[]),
  );
  const serverIds = Array.from(
    new Set(rows.map((r) => r.serverId).filter(Boolean) as number[]),
  );
  const [requesters, serverRows] = await Promise.all([
    requesterIds.length
      ? db
          .select({
            id: usersTable.id,
            firstName: usersTable.firstName,
            lastName: usersTable.lastName,
            email: usersTable.email,
            plan: usersTable.plan,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, requesterIds))
      : Promise.resolve([] as any[]),
    serverIds.length
      ? db
          .select({
            id: serversTable.id,
            name: serversTable.name,
            email: serversTable.email,
          })
          .from(serversTable)
          .where(inArray(serversTable.id, serverIds))
      : Promise.resolve([] as any[]),
  ]);

  const requesterMap = new Map(requesters.map((u) => [u.id, u]));
  const serverMap = new Map(serverRows.map((s) => [s.id, s]));

  res.json({
    items: rows.map((r) => {
      const reqUser = r.requesterUserId
        ? requesterMap.get(r.requesterUserId)
        : null;
      const srv = r.serverId ? serverMap.get(r.serverId) : null;
      const reqName = reqUser
        ? [reqUser.firstName, reqUser.lastName].filter(Boolean).join(" ").trim() ||
          reqUser.email ||
          reqUser.id
        : null;
      return {
        ...r,
        requesterName: reqName,
        requesterEmail: reqUser?.email ?? null,
        // Surfacing the requester's billing tier in the row lets ops eyeball
        // which jobs are running on subscriber rates vs pay-as-you-go without
        // opening the user record. `plan` always exists on usersTable
        // (defaults to "public"), but we coalesce defensively.
        requesterPlan: reqUser?.plan ?? null,
        serverName: srv?.name ?? null,
      };
    }),
    limit,
    offset,
  });
});

// ---------------------------------------------------------------------------
// Manually assign a job to a server (status -> "assigned").
// ---------------------------------------------------------------------------
router.post(
  "/admin/jobs/:id/assign",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const jobId = Number.parseInt(String(req.params.id), 10);
    const serverId = Number.parseInt(String(req.body?.serverId), 10);
    if (!Number.isFinite(jobId) || !Number.isFinite(serverId)) {
      res.status(400).json({ error: "Invalid jobId or serverId" });
      return;
    }
    const [server] = await db
      .select()
      .from(serversTable)
      .where(eq(serversTable.id, serverId))
      .limit(1);
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    // Unpaid-job dispatch guard. Mirrors the check in PATCH /jobs/:id —
    // a job in `pending_payment` was created but checkout never
    // completed, so there's no money in escrow to pay the server.
    // Refuse to assign one even from the admin console; the customer
    // has to complete payment (or the job has to be discarded) first.
    const [existing] = await db
      .select({ status: jobsTable.status })
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (existing.status === "pending_payment") {
      req.log.warn(
        { jobId, serverId, currentStatus: existing.status },
        "Admin attempted to assign server to unpaid job",
      );
      res.status(409).json({
        error: "Cannot dispatch a job that hasn't been paid for",
        currentStatus: existing.status,
      });
      return;
    }
    const now = new Date();
    const [job] = await db
      .update(jobsTable)
      .set({
        serverId,
        status: "assigned",
        // Stamp the moment the admin handed this job to the server so
        // the unified job timeline can render an "Assigned to {server}"
        // event. Mirrors the timestamps set by POST /jobs/:id/accept and
        // PATCH /jobs/:id when a requester assigns a server.
        assignedAt: now,
        updatedAt: now,
      })
      .where(eq(jobsTable.id, jobId))
      .returning();
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    req.log.info(
      { adminUserId: req.userId, jobId, serverId },
      "Admin assigned job to server",
    );
    await recordAdminAudit(req, "job.assign", {
      targetServerId: serverId,
      details: { jobId },
    });
    res.json({ job });
  },
);

// ---------------------------------------------------------------------------
// Regenerate affidavit PDF for a served job. Idempotent: replaces
// `proof_pdf_url` with a freshly-generated blob. Useful when:
//   - The first generation failed at confirm time (transient storage error).
//   - The legal entity strings or PDF template change and a job needs a re-render.
// Requires the job to already be in `served` state and to have a captured
// signature (typed name) — the generator needs that to render the /s/ block.
// ---------------------------------------------------------------------------
router.post(
  "/admin/jobs/:id/regenerate-affidavit",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const jobId = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(jobId)) {
      res.status(400).json({ error: "Invalid jobId" });
      return;
    }
    const result = await generateAndStoreAffidavit(jobId, req.log);
    if (!result.ok) {
      // Forward the generator's status hint when present (422 =
      // completeness-gate failure on the persisted substitute attempt).
      // Defaults to 409 for back-compat with prior failure modes.
      const status = result.status ?? 409;
      res.status(status).json({ error: result.error ?? "Failed to regenerate" });
      return;
    }
    req.log.info(
      { adminUserId: req.userId, jobId, proofPdfUrl: result.proofPdfUrl },
      "Admin regenerated affidavit",
    );
    res.json({ jobId, proofPdfUrl: result.proofPdfUrl });
  },
);

// ---------------------------------------------------------------------------
// Failed payouts — list + retry.
//
// Lists every payout currently in `failed` state with enough context for
// the admin to decide whether to retry. Joined to `servers` so we can show
// the server name + their connected-account state on the same row.
// ---------------------------------------------------------------------------
router.get(
  "/admin/payouts/failed",
  requireAuth,
  requireAdmin(),
  async (_req, res) => {
    const rows = await db
      .select({
        id: payoutsTable.id,
        jobId: payoutsTable.jobId,
        serverId: payoutsTable.serverId,
        userId: payoutsTable.userId,
        amountCents: payoutsTable.amountCents,
        failureReason: payoutsTable.failureReason,
        createdAt: payoutsTable.createdAt,
        updatedAt: payoutsTable.updatedAt,
        serverName: serversTable.name,
        serverEmail: serversTable.email,
        stripeAccountId: serversTable.stripeAccountId,
        payoutsEnabled: serversTable.payoutsEnabled,
      })
      .from(payoutsTable)
      .leftJoin(serversTable, eq(serversTable.id, payoutsTable.serverId))
      .where(eq(payoutsTable.status, "failed"))
      .orderBy(desc(payoutsTable.createdAt));
    res.json({ payouts: rows });
  },
);

// ---------------------------------------------------------------------------
// Retry a failed payout transfer.
//
// Looks up the payout, validates it's in `failed` state and the server's
// Connect account is payouts-enabled, then re-runs `processPayoutTransfer`.
// That helper:
//   - is gated on `transferId IS NULL` so a row that quietly succeeded on
//     a prior attempt won't double-transfer;
//   - uses a deterministic Stripe idempotency key (`served_job_payout_<id>`)
//     so retries collapse at Stripe even if our row state lags;
//   - on success, flips the row to `in_transit`, stamps the transfer id,
//     and clears `failure_reason`.
// We don't manually reset status to `pending` first — `processPayoutTransfer`
// owns the row's terminal state on either branch.
// ---------------------------------------------------------------------------
router.post(
  "/admin/payouts/:id/retry",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const payoutId = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(payoutId)) {
      res.status(400).json({ error: "Invalid payoutId" });
      return;
    }
    const [row] = await db
      .select({
        id: payoutsTable.id,
        jobId: payoutsTable.jobId,
        serverId: payoutsTable.serverId,
        userId: payoutsTable.userId,
        amountCents: payoutsTable.amountCents,
        status: payoutsTable.status,
        stripeTransferId: payoutsTable.stripeTransferId,
        stripeAccountId: serversTable.stripeAccountId,
        payoutsEnabled: serversTable.payoutsEnabled,
      })
      .from(payoutsTable)
      .leftJoin(serversTable, eq(serversTable.id, payoutsTable.serverId))
      .where(eq(payoutsTable.id, payoutId))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Payout not found" });
      return;
    }
    if (row.stripeTransferId) {
      res.status(409).json({
        error:
          "Payout already has a Stripe transfer recorded; nothing to retry.",
      });
      return;
    }
    if (row.status !== "failed") {
      res.status(409).json({
        error: `Payout is in '${row.status}' state; only 'failed' payouts can be retried.`,
      });
      return;
    }
    if (!row.stripeAccountId || !row.payoutsEnabled) {
      res.status(409).json({
        error:
          "Server's Stripe Connect account isn't ready for payouts. Have them complete onboarding first.",
      });
      return;
    }
    const transferred = await processPayoutTransfer({
      jobId: row.jobId,
      serverUserId: row.userId,
      amountCents: row.amountCents,
      destinationAccountId: row.stripeAccountId,
    });
    // Re-read the row so the response reflects the post-attempt state
    // regardless of which branch processPayoutTransfer took.
    const [after] = await db
      .select({
        id: payoutsTable.id,
        status: payoutsTable.status,
        stripeTransferId: payoutsTable.stripeTransferId,
        failureReason: payoutsTable.failureReason,
        amountCents: payoutsTable.amountCents,
      })
      .from(payoutsTable)
      .where(eq(payoutsTable.id, payoutId))
      .limit(1);
    req.log.info(
      {
        adminUserId: req.userId,
        payoutId,
        jobId: row.jobId,
        transferred,
        resultStatus: after?.status,
      },
      "Admin retried failed payout",
    );
    await recordAdminAudit(req, "payout.retry", {
      targetUserId: row.userId,
      targetServerId: row.serverId,
      details: {
        payoutId,
        jobId: row.jobId,
        amountCents: row.amountCents,
        result: transferred ? "transferred" : "no_transfer",
        newStatus: after?.status,
        failureReason: after?.failureReason ?? null,
      },
    });
    res.json({
      ok: transferred,
      payout: after,
    });
  },
);

// ---------------------------------------------------------------------------
// Dismiss a failed payout — surgical cleanup for test rows.
//
// Deletes a single failed payout row and cancels its associated job.
// Intended for clearing pre-launch test data without nuking the whole
// operational dataset (the "Purge test data" action wipes servers/clients
// too — too aggressive once real onboarded servers exist).
//
// Guards:
//   - status must be `failed` (never destroy a `paid`/`in_transit` row)
//   - stripeTransferId must be null (defensive — a row with a transfer
//     would mean money is already moving on Stripe; refuse to silently
//     drop the trail)
//   - the linked job, if it's in `served` state, is moved to `cancelled`
//     so it stops appearing in served-stats; jobs in any other state are
//     left alone (don't second-guess unrelated state machines)
// ---------------------------------------------------------------------------
router.post(
  "/admin/payouts/:id/dismiss",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const payoutId = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(payoutId)) {
      res.status(400).json({ error: "Invalid payoutId" });
      return;
    }
    const [row] = await db
      .select({
        id: payoutsTable.id,
        jobId: payoutsTable.jobId,
        serverId: payoutsTable.serverId,
        userId: payoutsTable.userId,
        amountCents: payoutsTable.amountCents,
        status: payoutsTable.status,
        stripeTransferId: payoutsTable.stripeTransferId,
      })
      .from(payoutsTable)
      .where(eq(payoutsTable.id, payoutId))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Payout not found" });
      return;
    }
    if (row.status !== "failed") {
      res.status(409).json({
        error: `Only 'failed' payouts can be dismissed (this one is '${row.status}').`,
      });
      return;
    }
    if (row.stripeTransferId) {
      res.status(409).json({
        error:
          "Payout has a Stripe transfer recorded — refusing to dismiss to preserve the audit trail.",
      });
      return;
    }

    const result = await db.transaction(async (tx) => {
      await tx.delete(payoutsTable).where(eq(payoutsTable.id, payoutId));
      const [jobBefore] = await tx
        .select({ status: jobsTable.status })
        .from(jobsTable)
        .where(eq(jobsTable.id, row.jobId))
        .limit(1);
      let jobCancelled = false;
      if (jobBefore?.status === "served") {
        await tx
          .update(jobsTable)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(jobsTable.id, row.jobId));
        jobCancelled = true;
      }
      return { jobBefore: jobBefore?.status ?? null, jobCancelled };
    });

    req.log.warn(
      {
        adminUserId: req.userId,
        payoutId,
        jobId: row.jobId,
        amountCents: row.amountCents,
        prevJobStatus: result.jobBefore,
        jobCancelled: result.jobCancelled,
      },
      "Admin dismissed failed payout (test cleanup)",
    );
    await recordAdminAudit(req, "payout.dismiss", {
      targetUserId: row.userId,
      targetServerId: row.serverId,
      details: {
        payoutId,
        jobId: row.jobId,
        amountCents: row.amountCents,
        prevJobStatus: result.jobBefore,
        jobCancelled: result.jobCancelled,
      },
    });
    res.json({
      ok: true,
      payoutId,
      jobId: row.jobId,
      jobCancelled: result.jobCancelled,
    });
  },
);

// ---------------------------------------------------------------------------
// Cancel a job.
// ---------------------------------------------------------------------------
router.post(
  "/admin/jobs/:id/cancel",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const jobId = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(jobId)) {
      res.status(400).json({ error: "Invalid jobId" });
      return;
    }
    const [job] = await db
      .update(jobsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(jobsTable.id, jobId))
      .returning();
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    req.log.info({ adminUserId: req.userId, jobId }, "Admin cancelled job");
    await recordAdminAudit(req, "job.cancel", {
      details: { jobId },
    });
    res.json({ job });
  },
);

// ---------------------------------------------------------------------------
// Servers list — joined with credential status.
//
// For unlinked rows (`user_id IS NULL`) we also surface the live Clerk
// invitation state so admins can tell at a glance whether the outstanding
// invite is still pending, expired, revoked, or already accepted (the
// Clerk user just hasn't signed in yet to link the row).
// ---------------------------------------------------------------------------
type AdminInvitationSummary = {
  id: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
};

/**
 * Fetch the most recent Clerk invitation for each email in parallel.
 * Failures are logged + swallowed per-email — Clerk being down should not
 * black out the entire admin roster.
 */
async function fetchLatestInvitationsByEmail(
  emails: string[],
  log: { warn: (obj: any, msg: string) => void },
): Promise<Map<string, AdminInvitationSummary>> {
  const out = new Map<string, AdminInvitationSummary>();
  if (emails.length === 0) return out;
  await Promise.all(
    emails.map(async (email) => {
      try {
        const list = await clerkClient.invitations.getInvitationList({
          query: email,
        });
        const target = email.toLowerCase();
        const matching = (list?.data ?? [])
          .filter(
            (inv) => (inv.emailAddress ?? "").toLowerCase() === target,
          )
          .sort(
            (a, b) =>
              Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0),
          );
        const latest = matching[0];
        if (!latest) return;
        // `expires_at` lives on the raw API JSON; the typed wrapper class
        // doesn't expose it directly. Fall back gracefully if it's absent
        // (some Clerk plans / older instances don't return it).
        const rawExpiresAt = (latest.raw as any)?.expires_at;
        out.set(target, {
          id: latest.id,
          status: latest.status,
          createdAt: new Date(latest.createdAt).toISOString(),
          updatedAt: new Date(latest.updatedAt).toISOString(),
          expiresAt:
            typeof rawExpiresAt === "number"
              ? new Date(rawExpiresAt).toISOString()
              : null,
        });
      } catch (err: any) {
        log.warn(
          { err: err?.message ?? String(err), email },
          "Could not fetch Clerk invitations for server roster",
        );
      }
    }),
  );
  return out;
}

router.get("/admin/servers", requireAuth, requireAdmin(), async (req, res) => {
  // Optional `?state=NV` filter on the server's license state (2-letter code).
  const stateFilter =
    typeof req.query.state === "string" && /^[A-Za-z]{2}$/.test(req.query.state)
      ? req.query.state.toUpperCase()
      : null;

  const rows = await db
    .select({
      id: serversTable.id,
      userId: serversTable.userId,
      name: serversTable.name,
      email: serversTable.email,
      phone: serversTable.phone,
      serverTier: serversTable.serverTier,
      serviceArea: serversTable.serviceArea,
      status: serversTable.status,
      active: serversTable.active,
      licenseNumber: serversTable.licenseNumber,
      licenseState: serversTable.licenseState,
      licenseExpiry: serversTable.licenseExpiry,
      isLicensedNvServer: serversTable.isLicensedNvServer,
      licenseCounty: serversTable.licenseCounty,
      serverType: serversTable.serverType,
      businessAddress: serversTable.businessAddress,
      photoUrl: serversTable.photoUrl,
      jobsCompleted: serversTable.jobsCompleted,
      payoutsEnabled: serversTable.payoutsEnabled,
      stripeAccountId: serversTable.stripeAccountId,
      verifiedAt: serversTable.verifiedAt,
      createdAt: serversTable.createdAt,
      deletedAt: serversTable.deletedAt,
      deletedReason: serversTable.deletedReason,
      credentialStatus: serverCredentialsTable.status,
      credentialFailureReason: serverCredentialsTable.failureReason,
    })
    .from(serversTable)
    .leftJoin(
      serverCredentialsTable,
      eq(serverCredentialsTable.userId, serversTable.userId),
    )
    .where(
      stateFilter
        ? sql`upper(${serversTable.licenseState}) = ${stateFilter}`
        : sql`true`,
    )
    .orderBy(desc(serversTable.createdAt));

  const unlinkedEmails = Array.from(
    new Set(
      rows
        .filter((r) => !r.userId && !!r.email)
        .map((r) => r.email!.toLowerCase()),
    ),
  );
  const inviteMap = await fetchLatestInvitationsByEmail(
    unlinkedEmails,
    req.log,
  );

  res.json({
    items: rows.map((r) => ({
      ...r,
      invitation:
        !r.userId && r.email
          ? inviteMap.get(r.email.toLowerCase()) ?? null
          : null,
    })),
  });
});

// ---------------------------------------------------------------------------
// Full detail view for a single server (owner admin "click into a server").
// Returns the complete profile row (incl. photoUrl), the linked credential
// record, and a lifetime earnings breakdown computed from the payouts ledger.
// ---------------------------------------------------------------------------
router.get(
  "/admin/server/:serverId",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const serverId = Number(req.params.serverId);
    if (!Number.isInteger(serverId) || serverId <= 0) {
      res.status(400).json({ error: "Invalid server id" });
      return;
    }

    const [server] = await db
      .select()
      .from(serversTable)
      .where(eq(serversTable.id, serverId))
      .limit(1);

    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    const credential = server.userId
      ? (
          await db
            .select()
            .from(serverCredentialsTable)
            .where(eq(serverCredentialsTable.userId, server.userId))
            .limit(1)
        )[0] ?? null
      : null;

    // Earnings breakdown from the payouts ledger. `paid` = money that has
    // landed; `in_transit`/`pending` = on the way; lifetime = paid + on the
    // way (excludes failed). Amounts are integer cents.
    const earningRows = await db
      .select({
        status: payoutsTable.status,
        totalCents: sql<number>`coalesce(sum(${payoutsTable.amountCents}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(payoutsTable)
      .where(eq(payoutsTable.serverId, serverId))
      .groupBy(payoutsTable.status);

    const byStatus = (s: string) =>
      earningRows.find((r) => r.status === s) ?? { totalCents: 0, count: 0 };
    const paid = byStatus("paid");
    const inTransit = byStatus("in_transit");
    const pending = byStatus("pending");
    const failed = byStatus("failed");
    const num = (v: unknown) => Number(v) || 0;

    const earnings = {
      paidCents: num(paid.totalCents),
      inTransitCents: num(inTransit.totalCents),
      pendingCents: num(pending.totalCents),
      failedCents: num(failed.totalCents),
      lifetimeCents: num(paid.totalCents) + num(inTransit.totalCents),
      payoutCount:
        num(paid.count) +
        num(inTransit.count) +
        num(pending.count) +
        num(failed.count),
    };

    let invitation = null;
    if (!server.userId && server.email) {
      const inviteMap = await fetchLatestInvitationsByEmail(
        [server.email.toLowerCase()],
        req.log,
      );
      invitation = inviteMap.get(server.email.toLowerCase()) ?? null;
    }

    res.json({ server, credential, earnings, invitation });
  },
);

// ---------------------------------------------------------------------------
// Manually create a server profile.
//
// Two paths:
//   1) Email already belongs to a Clerk user → auto-verify credentials and
//      flip status to `active` (ops-driven onboarding without Certn / the
//      $24.99 background-check payment).
//   2) Email is brand new → send a Clerk invitation so the user receives the
//      "you've been invited to SERVED." email and pre-create a `servers`
//      row with `userId = NULL` + `status = pending`. The row is linked to
//      the new Clerk user on their first sign-in (see `me.ts`).
// ---------------------------------------------------------------------------

// 2-letter US/CA postal code; we don't enforce a closed list because some
// edge cases (territories, military APO) use codes outside the 50-state set.
const LICENSE_STATE_REGEX = /^[A-Za-z]{2}$/;

function parseLicenseExpiry(raw: unknown): {
  ok: true;
  value: string | null;
} | { ok: false; error: string } {
  if (raw == null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") {
    return { ok: false, error: "License expiry must be an ISO date (YYYY-MM-DD)" };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) {
    return { ok: false, error: "License expiry must be an ISO date (YYYY-MM-DD)" };
  }
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: "License expiry is not a valid date" };
  }
  // Strict future-only check (matches the UI's `min` + `> today` rule):
  // today or earlier is rejected.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (d.getTime() <= today.getTime()) {
    return { ok: false, error: "License expiry must be a future date" };
  }
  return { ok: true, value: raw };
}

router.post("/admin/servers", requireAuth, requireAdmin(), async (req, res) => {
  const email =
    typeof req.body?.userEmail === "string"
      ? req.body.userEmail.trim().toLowerCase()
      : null;
  const firstName =
    typeof req.body?.firstName === "string" ? req.body.firstName.trim() : "";
  const lastName =
    typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";
  const phone =
    typeof req.body?.phone === "string" ? req.body.phone.trim() : null;
  const serviceArea =
    typeof req.body?.serviceArea === "string"
      ? req.body.serviceArea.trim()
      : null;
  const licenseNumber =
    typeof req.body?.licenseNumber === "string"
      ? req.body.licenseNumber.trim() || null
      : null;
  const licenseStateRaw =
    typeof req.body?.licenseState === "string"
      ? req.body.licenseState.trim().toUpperCase()
      : "";
  // Optional Nevada-licensed-server fields. When the server holds an active
  // PILB work card, the admin captures the work-card number (in licenseNumber
  // above), the issuing county (licenseCounty), and flips isLicensedNvServer
  // so affidavits print the "licensed process server" attestation.
  // businessAddress is a per-server override of the platform business
  // address printed on affidavits — usually left blank for solo contractors.
  const isLicensedNvServer = req.body?.isLicensedNvServer === true;
  const licenseCounty =
    typeof req.body?.licenseCounty === "string"
      ? req.body.licenseCounty.trim() || null
      : null;
  const businessAddress =
    typeof req.body?.businessAddress === "string"
      ? req.body.businessAddress.trim() || null
      : null;
  if (!email) {
    res.status(400).json({ error: "userEmail is required" });
    return;
  }
  if (!licenseNumber) {
    res.status(400).json({ error: "licenseNumber is required" });
    return;
  }
  if (!licenseStateRaw) {
    res.status(400).json({ error: "licenseState is required" });
    return;
  }
  if (!LICENSE_STATE_REGEX.test(licenseStateRaw)) {
    res.status(400).json({ error: "License state must be a 2-letter code" });
    return;
  }
  const licenseState = licenseStateRaw;
  const expiryParse = parseLicenseExpiry(req.body?.licenseExpiry);
  if (!expiryParse.ok) {
    res.status(400).json({ error: expiryParse.error });
    return;
  }
  if (!expiryParse.value) {
    res.status(400).json({ error: "licenseExpiry is required" });
    return;
  }
  const licenseExpiry = expiryParse.value;

  // Admin can opt out of auto-verification (e.g. someone they need to vet
  // through Certn first). Default = true: most manual onboarding cases are
  // people the admin already knows are licensed and ready to work.
  const markVerified = req.body?.markVerified !== false;

  // Look up the Clerk user by email so we link the server row to a real userId.
  let clerkUserId: string | null = null;
  let clerkFirst = firstName;
  let clerkLast = lastName;
  try {
    const list = await clerkClient.users.getUserList({
      emailAddress: [email],
      limit: 1,
    });
    const cu = list.data?.[0];
    if (cu) {
      clerkUserId = cu.id;
      clerkFirst = clerkFirst || (cu.firstName ?? "");
      clerkLast = clerkLast || (cu.lastName ?? "");
    }
  } catch (err: any) {
    req.log.warn({ err: err?.message, email }, "Clerk user lookup failed");
  }

  const displayName =
    [clerkFirst, clerkLast].filter(Boolean).join(" ").trim() || email;
  const now = new Date();

  // ----- Path 2: brand-new email — send a Clerk invitation. -----
  if (!clerkUserId) {
    // Block double-invites for the same email by checking for a pending
    // unlinked server row first.
    const [pending] = await db
      .select({ id: serversTable.id, status: serversTable.status })
      .from(serversTable)
      .where(
        and(
          eq(serversTable.email, email),
          isNull(serversTable.userId),
          // Soft-deleted rows also have userId IS NULL but represent
          // closed accounts — they must not block a fresh re-invite.
          isNull(serversTable.deletedAt),
        ),
      )
      .limit(1);
    if (pending) {
      res.status(409).json({
        error:
          "An invitation is already pending for that email. Resend from Clerk dashboard or delete the pending row.",
      });
      return;
    }

    // Build a plain sign-up link for the invite email. We deliberately do
    // NOT use Clerk's invitation ticket mechanism here — in production
    // those tickets repeatedly 403 on /v1/tickets/accept and render the
    // invitee a blank white page, even after working around the
    // sign_in/sign_up status split. Instead we send a regular sign-up URL
    // with the invitee's email pre-filled; when they finish sign-up and
    // pick "server" in the role chooser, our backend links them to this
    // pending server row by email (see linkPendingServerByEmail in me.ts).
    //
    // CRITICAL: derive the redirect host from the *current request* (the
    // domain the inviting admin is on), not REPLIT_DOMAINS[0]. In prod
    // the same app is served on both servedapp.co AND a .replit.app
    // domain, each with its own Clerk publishable key. Sending the
    // invitee to the wrong domain loads a different Clerk instance and
    // the sign-up will fail. See lib/appBaseUrl.ts.
    const redirectBase = appBaseUrl(req);
    const invitationId: string | null = null;
    const invitationUrl: string =
      `${redirectBase}/sign-up?email=${encodeURIComponent(email)}` +
      `&intent=server&server_invite=1`;

    // Pre-create the server row with status=pending and no userId. The row
    // is linked on first sign-in (see getOrUpsertUser in me.ts). If the
    // admin marked them as pre-verified, stamp verifiedAt now so the link
    // path in me.ts can also create a verified credential row + flip the
    // server to active immediately on first sign-in.
    const [serverRow] = await db
      .insert(serversTable)
      .values({
        userId: null,
        name: displayName,
        email,
        phone,
        serviceArea,
        licenseNumber,
        licenseState,
        licenseExpiry,
        isLicensedNvServer,
        licenseCounty,
        businessAddress,
        status: "pending",
        active: false,
        verifiedAt: markVerified ? now : null,
      })
      .returning();

    req.log.info(
      {
        adminUserId: req.userId,
        invitationId,
        serverId: serverRow?.id,
        email,
        preVerified: markVerified,
      },
      "Admin invited new server via Clerk",
    );
    await recordAdminAudit(req, "server.invite", {
      targetServerId: serverRow?.id ?? null,
      details: { email, invitationId, preVerified: markVerified },
    });

    // Send the SERVED.-branded invitation email. Failure is non-fatal:
    // the Clerk invitation row already exists, so the admin can resend
    // from the Servers table if our mailer transiently misfires.
    let inviteEmailDelivered = false;
    if (invitationUrl) {
      try {
        inviteEmailDelivered = await sendServerInviteEmail({
          to: email,
          serverName: displayName,
          inviteUrl: invitationUrl,
          preVerified: markVerified,
        });
      } catch (err: any) {
        req.log.error(
          { err: err?.message ?? String(err), email, invitationId },
          "SERVED. server invite email send threw",
        );
      }
      if (!inviteEmailDelivered) {
        req.log.warn(
          { email, invitationId, serverId: serverRow?.id },
          "SERVED. server invite email did not deliver — admin can resend from Servers table",
        );
      }
    } else {
      req.log.warn(
        { email, invitationId },
        "Clerk invitation returned no URL — cannot send SERVED. invite email",
      );
    }

    res.json({
      server: serverRow,
      credential: null,
      invitationId,
      invited: true,
      inviteEmailDelivered,
      preVerified: markVerified,
    });
    return;
  }

  // ----- Path 1: Clerk user already exists — link + auto-verify. -----
  // Upsert the user row + force role=server.
  await db
    .insert(usersTable)
    .values({
      id: clerkUserId,
      email,
      firstName: clerkFirst || null,
      lastName: clerkLast || null,
      role: "server" as UserRole,
    })
    .onConflictDoUpdate({
      target: usersTable.id,
      set: {
        email,
        firstName: clerkFirst || null,
        lastName: clerkLast || null,
        role: "server" as UserRole,
        updatedAt: now,
      },
    });

  // Mirror role to Clerk metadata so the next sign-in lands on the server portal.
  try {
    await clerkClient.users.updateUser(clerkUserId, {
      publicMetadata: { role: "server" },
    });
  } catch (err: any) {
    req.log.warn(
      { err: err?.message, clerkUserId },
      "Clerk metadata role update failed (non-fatal)",
    );
  }

  // Upsert the server profile (uniq on userId).
  const [existing] = await db
    .select()
    .from(serversTable)
    .where(eq(serversTable.userId, clerkUserId))
    .limit(1);

  // markVerified=true (default) → server is active and credentials verified
  // immediately. markVerified=false → server is created but kept in
  // `pending` status with no credential record, so Certn/manual review can
  // gate them before they accept work.
  const serverStatus = markVerified ? "active" : "pending";
  const serverActive = markVerified;
  const serverVerifiedAt = markVerified ? now : null;

  let serverRow;
  if (existing) {
    [serverRow] = await db
      .update(serversTable)
      .set({
        name: displayName,
        email,
        phone,
        serviceArea,
        licenseNumber,
        licenseState,
        licenseExpiry,
        isLicensedNvServer,
        licenseCounty,
        businessAddress,
        verifiedAt: serverVerifiedAt,
        status: serverStatus,
        active: serverActive,
      })
      .where(eq(serversTable.id, existing.id))
      .returning();
  } else {
    [serverRow] = await db
      .insert(serversTable)
      .values({
        userId: clerkUserId,
        name: displayName,
        email,
        phone,
        serviceArea,
        licenseNumber,
        licenseState,
        licenseExpiry,
        isLicensedNvServer,
        licenseCounty,
        businessAddress,
        verifiedAt: serverVerifiedAt,
        status: serverStatus,
        active: serverActive,
      })
      .returning();
  }

  // Auto-verify credentials only when admin opted in. Otherwise leave the
  // credential row unset — the standard Certn pipeline will create it later.
  let credRow: typeof serverCredentialsTable.$inferSelect | null = null;
  if (markVerified) {
    [credRow] = await db
      .insert(serverCredentialsTable)
      .values({
        userId: clerkUserId,
        status: "verified",
        verifiedAt: now,
      })
      .onConflictDoUpdate({
        target: serverCredentialsTable.userId,
        set: {
          status: "verified",
          verifiedAt: now,
          failureReason: null,
          updatedAt: now,
        },
      })
      .returning();
  }

  req.log.info(
    {
      adminUserId: req.userId,
      clerkUserId,
      serverId: serverRow?.id,
      preVerified: markVerified,
    },
    markVerified
      ? "Admin created+verified server manually"
      : "Admin created server (pending verification)",
  );
  await recordAdminAudit(req, "server.create", {
    targetServerId: serverRow?.id ?? null,
    targetUserId: clerkUserId,
    details: { email, autoVerified: markVerified },
  });
  res.json({
    server: serverRow,
    credential: credRow,
    invited: false,
    preVerified: markVerified,
  });
});

// ---------------------------------------------------------------------------
// Edit a server's profile fields. Admins can repair any non-identity /
// non-Stripe field on the row: name, phone, license #, license state,
// license expiry, license county, NV PILB toggle, server type classification,
// business address, service area. Email is intentionally NOT editable here —
// it is the join key to Clerk and to the user's invite record. Stripe
// state (stripeAccountId, payoutsEnabled, verifiedAt) is also off-limits;
// those have their own admin actions.
// ---------------------------------------------------------------------------
router.patch(
  "/admin/server/:serverId/profile",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const serverId = Number.parseInt(String(req.params.serverId), 10);
    if (!Number.isFinite(serverId)) {
      res.status(400).json({ error: "Invalid serverId" });
      return;
    }
    const [existing] = await db
      .select()
      .from(serversTable)
      .where(eq(serversTable.id, serverId))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    const body = req.body as {
      name?: unknown;
      phone?: unknown;
      licenseNumber?: unknown;
      licenseState?: unknown;
      licenseExpiry?: unknown;
      licenseCounty?: unknown;
      isLicensedNvServer?: unknown;
      serverType?: unknown;
      businessAddress?: unknown;
      serviceArea?: unknown;
    };

    const ALLOWED_SERVER_TYPES = new Set([
      "licensed_nv",
      "registered",
      "private",
      "sheriff",
    ]);

    const patch: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};

    function pickStringNullable(field: keyof typeof body, col: string): boolean {
      const raw = body[field];
      if (raw === undefined) return true;
      if (raw !== null && typeof raw !== "string") {
        res.status(400).json({ error: `${field} must be a string or null` });
        return false;
      }
      const v = raw == null ? null : raw.trim();
      patch[col] = v && v.length > 0 ? v : null;
      before[col] = (existing as Record<string, unknown>)[col] ?? null;
      return true;
    }

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        res.status(400).json({ error: "name cannot be blank" });
        return;
      }
      patch.name = body.name.trim();
      before.name = existing.name;
    }
    if (!pickStringNullable("phone", "phone")) return;
    if (!pickStringNullable("licenseNumber", "licenseNumber")) return;
    if (!pickStringNullable("licenseCounty", "licenseCounty")) return;
    if (!pickStringNullable("businessAddress", "businessAddress")) return;
    if (!pickStringNullable("serviceArea", "serviceArea")) return;

    if (body.licenseState !== undefined) {
      if (body.licenseState === null || body.licenseState === "") {
        patch.licenseState = null;
      } else if (
        typeof body.licenseState !== "string" ||
        !LICENSE_STATE_REGEX.test(body.licenseState)
      ) {
        res.status(400).json({
          error: "licenseState must be a 2-letter postal code",
        });
        return;
      } else {
        patch.licenseState = body.licenseState.toUpperCase();
      }
      before.licenseState = existing.licenseState;
    }

    if (body.licenseExpiry !== undefined) {
      // Reuse the strict future-date parser used by the create flow. Allow
      // clearing (null/"") so admins can wipe an outdated value.
      const parsed = parseLicenseExpiry(body.licenseExpiry);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      patch.licenseExpiry = parsed.value;
      before.licenseExpiry = existing.licenseExpiry;
    }

    if (body.isLicensedNvServer !== undefined) {
      patch.isLicensedNvServer = Boolean(body.isLicensedNvServer);
      before.isLicensedNvServer = existing.isLicensedNvServer;
    }

    if (body.serverType !== undefined) {
      if (body.serverType === null || body.serverType === "") {
        patch.serverType = null;
      } else if (
        typeof body.serverType !== "string" ||
        !ALLOWED_SERVER_TYPES.has(body.serverType)
      ) {
        res.status(400).json({
          error:
            "serverType must be one of: licensed_nv, registered, private, sheriff",
        });
        return;
      } else {
        patch.serverType = body.serverType;
      }
      before.serverType = existing.serverType;
    }

    if (Object.keys(patch).length === 0) {
      res.json({ server: existing, changed: [] });
      return;
    }

    patch.updatedAt = new Date();

    const [updated] = await db
      .update(serversTable)
      .set(patch)
      .where(eq(serversTable.id, serverId))
      .returning();

    const changedFields = Object.keys(patch).filter((k) => k !== "updatedAt");

    await recordAdminAudit(req, "server.edit_profile", {
      targetServerId: serverId,
      targetUserId: existing.userId ?? null,
      details: {
        changed: changedFields,
        before,
        after: changedFields.reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (updated as Record<string, unknown>)[k] ?? null;
          return acc;
        }, {}),
      },
    });

    res.json({ server: updated, changed: changedFields });
  },
);

// ---------------------------------------------------------------------------
// Status transitions — flip a server through pending/active/suspended/inactive.
// The legacy `active` boolean is mirrored so old call sites (dashboard counts)
// keep working without a second sweep.
// ---------------------------------------------------------------------------
router.post(
  "/admin/server/:serverId/status",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const serverId = Number.parseInt(String(req.params.serverId), 10);
    if (!Number.isFinite(serverId)) {
      res.status(400).json({ error: "Invalid serverId" });
      return;
    }
    const target = req.body?.status as ServerStatus | undefined;
    if (!target || !(SERVER_STATUSES as readonly string[]).includes(target)) {
      res.status(400).json({
        error: `status must be one of: ${SERVER_STATUSES.join(", ")}`,
      });
      return;
    }
    const [server] = await db
      .select()
      .from(serversTable)
      .where(eq(serversTable.id, serverId))
      .limit(1);
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    const [updated] = await db
      .update(serversTable)
      .set({
        status: target,
        active: target === "active",
      })
      .where(eq(serversTable.id, serverId))
      .returning();
    req.log.info(
      {
        adminUserId: req.userId,
        serverId,
        from: server.status,
        to: target,
      },
      "Admin changed server status",
    );
    await recordAdminAudit(req, "server.status_change", {
      targetServerId: serverId,
      targetUserId: server.userId ?? null,
      details: { from: server.status, to: target },
    });
    res.json({ server: updated });
  },
);

// ---------------------------------------------------------------------------
// Users list — searchable by email/name.
// ---------------------------------------------------------------------------
router.get("/admin/users", requireAuth, requireAdmin(), async (req, res) => {
  // Param parsing + WHERE assembly live in `lib/adminUserFilters` so the
  // filter behavior (especially the bounded license-expiry window) can be
  // pinned down by integration tests against a real database.
  const q = parseAdminUsersQuery(req.query as Record<string, unknown>);
  const where = buildAdminUsersWhere(q);

  // Left-join the servers table so admins can see lifecycle status + license
  // expiry inline for any user with role='server'. The `servers_user_idx`
  // unique constraint guarantees at most one server row per userId, so this
  // does not fan rows out. Non-server users get null columns.
  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      role: usersTable.role,
      plan: usersTable.plan,
      createdAt: usersTable.createdAt,
      serverId: serversTable.id,
      serverStatus: serversTable.status,
      serverLicenseExpiry: serversTable.licenseExpiry,
    })
    .from(usersTable)
    .leftJoin(serversTable, eq(serversTable.userId, usersTable.id))
    .where(where)
    .orderBy(desc(usersTable.createdAt))
    .limit(q.limit)
    .offset(q.offset);

  res.json({ items: rows, limit: q.limit, offset: q.offset });
});

// ---------------------------------------------------------------------------
// User detail — surfaces the user's profile alongside their full billing
// posture (active subscription tier, status, current period end, the Stripe
// IDs ops needs to cross-reference, and a count of jobs they've placed).
// Lets admins answer "what plan is this attorney on, and when does it
// renew?" without bouncing into Stripe.
// ---------------------------------------------------------------------------
router.get(
  "/admin/users/:id",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const userId = String(req.params.id);
    if (!userId) {
      res.status(400).json({ error: "Missing user id" });
      return;
    }

    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        role: usersTable.role,
        plan: usersTable.plan,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // subscriptions has a uniqueIndex on user_id, so .limit(1) is exact.
    const [sub] = await db
      .select({
        id: subscriptionsTable.id,
        tier: subscriptionsTable.tier,
        status: subscriptionsTable.status,
        stripeSubscriptionId: subscriptionsTable.stripeSubscriptionId,
        stripeCustomerId: subscriptionsTable.stripeCustomerId,
        stripePriceId: subscriptionsTable.stripePriceId,
        currentPeriodEnd: subscriptionsTable.currentPeriodEnd,
        createdAt: subscriptionsTable.createdAt,
        updatedAt: subscriptionsTable.updatedAt,
      })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);

    // Lightweight job activity counter — quick gut-check on whether the
    // attorney is using their subscription. Cheap COUNT keyed on the
    // existing `jobs_requester_idx`.
    const [jobsAgg] = await db
      .select({ count: count() })
      .from(jobsTable)
      .where(eq(jobsTable.requesterUserId, userId));

    res.json({
      user,
      subscription: sub ?? null,
      jobsCount: Number(jobsAgg?.count ?? 0),
    });
  },
);

/**
 * Manual verify a server (escape hatch for stub mode + ops-driven approvals).
 * Mirrors the verifiedAt onto BOTH the credentials row (source of truth) and
 * the servers row (denormalized for fast roster joins).
 */
router.post(
  "/admin/server/:serverId/verify",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const serverId = Number.parseInt(String(req.params.serverId), 10);
    if (!Number.isFinite(serverId)) {
      res.status(400).json({ error: "Invalid serverId" });
      return;
    }

    const [server] = await db
      .select()
      .from(serversTable)
      .where(eq(serversTable.id, serverId))
      .limit(1);
    if (!server || !server.userId) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    const now = new Date();
    const [credRow] = await db
      .insert(serverCredentialsTable)
      .values({
        userId: server.userId,
        status: "verified",
        verifiedAt: now,
      })
      .onConflictDoUpdate({
        target: serverCredentialsTable.userId,
        set: {
          status: "verified",
          verifiedAt: now,
          failureReason: null,
          updatedAt: now,
        },
      })
      .returning();

    await db
      .update(serversTable)
      .set({ verifiedAt: now, status: "active", active: true })
      .where(eq(serversTable.id, serverId));

    req.log.info(
      { adminUserId: req.userId, serverId, targetUserId: server.userId },
      "Admin manual-verified server",
    );
    await recordAdminAudit(req, "server.verify", {
      targetServerId: serverId,
      targetUserId: server.userId,
    });
    res.json({ credential: credRow, serverId });
  },
);

/**
 * Best-effort revoke of every pending Clerk invitation for an email.
 * Used by the resend + delete flows so we don't leave orphan invites.
 * Errors are logged and swallowed — the caller should not block on this.
 */
async function revokePendingInvitationsForEmail(
  email: string,
  log: { warn: (obj: any, msg: string) => void },
): Promise<number> {
  let revoked = 0;
  try {
    const list = await clerkClient.invitations.getInvitationList({
      status: "pending",
      query: email,
    });
    const invites = list?.data ?? [];
    const target = email.toLowerCase();
    for (const inv of invites) {
      if ((inv.emailAddress ?? "").toLowerCase() !== target) continue;
      try {
        await clerkClient.invitations.revokeInvitation(inv.id);
        revoked += 1;
      } catch (err: any) {
        log.warn(
          { err: err?.message ?? String(err), invitationId: inv.id, email },
          "Failed to revoke prior Clerk invitation",
        );
      }
    }
  } catch (err: any) {
    log.warn(
      { err: err?.message ?? String(err), email },
      "Could not list prior Clerk invitations",
    );
  }
  return revoked;
}

/**
 * Resend a Clerk invitation for a server row that hasn't been linked yet
 * (`user_id IS NULL`). Revokes any outstanding pending invitations for the
 * same email first so the recipient only ever has one live link in their
 * inbox.
 */
router.post(
  "/admin/server/:serverId/resend-invite",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const serverId = Number.parseInt(String(req.params.serverId), 10);
    if (!Number.isFinite(serverId)) {
      res.status(400).json({ error: "Invalid serverId" });
      return;
    }
    const [server] = await db
      .select()
      .from(serversTable)
      .where(eq(serversTable.id, serverId))
      .limit(1);
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    if (server.userId) {
      res.status(409).json({
        error:
          "This server has already linked their Clerk account. Resend is only for pending invites.",
      });
      return;
    }
    if (!server.email) {
      res.status(400).json({ error: "Server has no email on file." });
      return;
    }

    // Best-effort cleanup of any historical Clerk invitations still
    // floating around for this email. We no longer create new ones (see
    // the new-invite path for why), but old ones may exist from earlier
    // resends — revoking them keeps the recipient's inbox tidy.
    await revokePendingInvitationsForEmail(server.email, req.log);

    // Derive redirect host from the request — see the new-invite path
    // above for the multi-domain rationale.
    const redirectBase = appBaseUrl(req);

    const invitationId: string | null = null;
    const invitationUrl: string =
      `${redirectBase}/sign-up?email=${encodeURIComponent(server.email)}` +
      `&intent=server&server_invite=1`;

    req.log.info(
      { adminUserId: req.userId, serverId, invitationId, email: server.email },
      "Admin resent server invite",
    );
    await recordAdminAudit(req, "server.resend_invite", {
      targetServerId: serverId,
      details: { email: server.email, invitationId },
    });

    // Send the SERVED.-branded invitation email. Failure is non-fatal —
    // the new Clerk invitation already exists and the admin can hit
    // Resend again if delivery transiently misfires.
    let inviteEmailDelivered = false;
    if (invitationUrl) {
      try {
        inviteEmailDelivered = await sendServerInviteEmail({
          to: server.email,
          serverName: server.name,
          inviteUrl: invitationUrl,
          preVerified: server.verifiedAt != null,
        });
      } catch (err: any) {
        req.log.error(
          { err: err?.message ?? String(err), email: server.email, invitationId, serverId },
          "SERVED. server invite resend email send threw",
        );
      }
      if (!inviteEmailDelivered) {
        req.log.warn(
          { email: server.email, invitationId, serverId },
          "SERVED. server invite resend email did not deliver",
        );
      }
    } else {
      req.log.warn(
        { email: server.email, invitationId, serverId },
        "Clerk invitation returned no URL on resend — cannot send SERVED. invite email",
      );
    }

    res.json({ ok: true, invitationId, inviteEmailDelivered });
  },
);

/**
 * One-click recovery for a "stuck" pending server row whose invitee
 * already has a Clerk account with a different role saved (e.g. they
 * previously signed up as an Individual / requester). The first-signup
 * self-heal in me.ts only fires when `users.role IS NULL`, so once a
 * deliberate role choice has been written we deliberately don't
 * overwrite it — admins use this endpoint to force the override.
 *
 * Looks up the Clerk user by the pending server row's email, sets
 * `users.role = "server"`, stamps Clerk publicMetadata.role for
 * cross-service consistency, and links the pending row to their userId
 * via the same `linkPendingServerByEmail` helper used at sign-up.
 *
 * Returns 404 if no Clerk user has signed up under that email yet —
 * Resend Invite is the right action in that case. Refuses to touch
 * rows that have already been linked (`server.userId !== null`) — the
 * row is no longer "stuck".
 */
router.post(
  "/admin/server/:serverId/recover-stuck-account",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const serverId = Number.parseInt(String(req.params.serverId), 10);
    if (!Number.isFinite(serverId)) {
      res.status(400).json({ error: "Invalid serverId" });
      return;
    }

    const [server] = await db
      .select()
      .from(serversTable)
      .where(eq(serversTable.id, serverId))
      .limit(1);
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    if (server.deletedAt) {
      res.status(409).json({
        error:
          "This server row has been deleted. Re-invite the email instead of recovering.",
      });
      return;
    }
    if (server.userId) {
      res.status(409).json({
        error:
          "This server row is already linked to a Clerk account. No recovery needed.",
      });
      return;
    }
    if (!server.email) {
      res.status(400).json({ error: "Server has no email on file." });
      return;
    }

    const normalizedEmail = server.email.toLowerCase();

    // Look up the existing users row by email. If found, we already
    // have the Clerk user id locally — no Clerk API round-trip needed.
    const [existingUser] = await db
      .select({
        id: usersTable.id,
        role: usersTable.role,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
      })
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail))
      .limit(1);

    if (!existingUser) {
      res.status(404).json({
        error:
          "No SERVED. account exists for this email yet. Use Resend Invite to send them a fresh sign-up link instead.",
      });
      return;
    }

    const previousRole = existingUser.role;
    const now = new Date();

    // 1. Flip role to server in our DB.
    await db
      .update(usersTable)
      .set({ role: "server" as UserRole, updatedAt: now })
      .where(eq(usersTable.id, existingUser.id));

    // 2. Best-effort stamp Clerk publicMetadata so other services see
    // the role without re-querying Postgres. Non-fatal — the DB row is
    // the source of truth and was already updated above.
    try {
      const cu = await clerkClient.users.getUser(existingUser.id);
      await clerkClient.users.updateUser(existingUser.id, {
        publicMetadata: { ...(cu.publicMetadata ?? {}), role: "server" },
      });
    } catch (err: any) {
      req.log.warn(
        { err: err?.message ?? String(err), userId: existingUser.id },
        "Could not stamp Clerk publicMetadata.role during stuck-account recovery (non-fatal)",
      );
    }

    // 3. Link the pending servers row → users row. Idempotent; also
    // creates the verified credential if the row was pre-verified at
    // invite time. Imported lazily to avoid the routes/me.ts → admin.ts
    // circular import that would happen on a top-level import.
    const { linkPendingServerByEmail } = await import("./me");
    const displayName =
      [existingUser.firstName, existingUser.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() || server.name;
    await linkPendingServerByEmail(
      existingUser.id,
      normalizedEmail,
      displayName,
    );

    req.log.info(
      {
        adminUserId: req.userId,
        serverId,
        targetUserId: existingUser.id,
        email: normalizedEmail,
        previousRole,
      },
      "Admin force-recovered stuck server account",
    );
    await recordAdminAudit(req, "server.recover_stuck_account", {
      targetServerId: serverId,
      targetUserId: existingUser.id,
      details: { email: normalizedEmail, previousRole },
    });

    res.json({
      ok: true,
      userId: existingUser.id,
      email: normalizedEmail,
      previousRole,
    });
  },
);

/**
 * Revoke a pending invitation by deleting the unlinked `servers` row and
 * (best effort) revoking any outstanding Clerk invitation for the email.
 * Refuses to touch rows that already linked to a Clerk user — those should
 * go through the suspend / mark-inactive flow instead.
 */
router.delete(
  "/admin/server/:serverId",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const serverId = Number.parseInt(String(req.params.serverId), 10);
    if (!Number.isFinite(serverId)) {
      res.status(400).json({ error: "Invalid serverId" });
      return;
    }
    const [server] = await db
      .select()
      .from(serversTable)
      .where(eq(serversTable.id, serverId))
      .limit(1);
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    if (server.userId) {
      res.status(409).json({
        error:
          "This server is already linked to a Clerk account. Use Mark Inactive instead.",
      });
      return;
    }

    let revokedCount = 0;
    if (server.email) {
      revokedCount = await revokePendingInvitationsForEmail(
        server.email,
        req.log,
      );
    }

    await db.delete(serversTable).where(eq(serversTable.id, serverId));

    req.log.info(
      {
        adminUserId: req.userId,
        serverId,
        email: server.email,
        revokedCount,
      },
      "Admin revoked pending server invite",
    );
    // Best-effort recording — note that the server row has been deleted, so
    // we keep the targetServerId for traceability even though it no longer
    // resolves in joins.
    await recordAdminAudit(req, "server.revoke_invite", {
      targetServerId: serverId,
      details: { email: server.email, revokedCount },
    });
    res.json({ ok: true, revokedCount });
  },
);

/**
 * Hard-delete a server's entire account so the email can be re-onboarded
 * from scratch. This is the "nuclear" option — distinct from Mark Inactive
 * (which keeps the row reactivatable). Use this when:
 *   - A test account needs to be wiped so the email can re-test sign-up.
 *   - A server has left and asked us to delete their data (GDPR/CCPA-ish).
 *
 * Order matters: we null out FKs on jobs first (so historical jobs stay
 * intact for accounting/audit but lose the link), then delete the server
 * row + credentials + user row, then revoke any Clerk invites and finally
 * delete the Clerk user. Clerk delete is last so a Clerk outage can't
 * leave us with a half-deleted DB state.
 */
router.delete(
  "/admin/server/:serverId/account",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const serverId = Number.parseInt(String(req.params.serverId), 10);
    if (!Number.isFinite(serverId)) {
      res.status(400).json({ error: "Invalid serverId" });
      return;
    }
    const [server] = await db
      .select()
      .from(serversTable)
      .where(eq(serversTable.id, serverId))
      .limit(1);
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    if (server.deletedAt) {
      res.status(409).json({ error: "Server account is already deleted." });
      return;
    }

    const linkedUserId = server.userId;
    const email = server.email;

    // SOFT DELETE — we keep the server row and all FK-attached history
    // (service_attempts, payouts, jobs, location pings, release events)
    // intact so attorneys/ops can pull the chain of custody for any past
    // job long after the account is gone. We only wipe the login surface
    // (Clerk user + server_credentials + users row) and stamp the server
    // row with `deletedAt` + `status=inactive` so existing marketplace
    // gates (which already exclude `inactive`) skip them.
    //
    // All DB mutations run in a single transaction so a partial failure
    // leaves nothing changed. Clerk delete + invite revoke run after the
    // commit so a Clerk outage can't roll back our DB updates.
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(serversTable)
          .set({
            deletedAt: new Date(),
            deletedReason: "admin_deleted",
            status: "inactive",
            active: false,
            // Null userId so the unique index doesn't block a brand-new
            // server row if this email ever re-onboards. The historical
            // server row keeps name/email/license for the audit trail.
            userId: null,
          })
          .where(eq(serversTable.id, serverId));

        if (linkedUserId) {
          await tx
            .delete(serverCredentialsTable)
            .where(eq(serverCredentialsTable.userId, linkedUserId));
          await tx.delete(usersTable).where(eq(usersTable.id, linkedUserId));
        }
      });
    } catch (err: any) {
      req.log.error(
        { err: err?.message ?? String(err), serverId, linkedUserId, email },
        "Admin account-delete transaction failed; nothing was changed",
      );
      res.status(500).json({
        error:
          "Couldn't delete account — the database transaction failed and was rolled back. No changes were made.",
        detail: err?.message ?? String(err),
      });
      return;
    }

    // Best-effort revoke of any Clerk invitations still floating for this
    // email (matters mostly for unlinked rows; a no-op for linked users).
    let revokedInvites = 0;
    if (email) {
      revokedInvites = await revokePendingInvitationsForEmail(email, req.log);
    }

    // Delete the Clerk user last so a Clerk failure can't leave the DB
    // half-deleted. Failures are non-fatal — we log and surface in the
    // response so the admin knows to clean up Clerk manually if needed.
    let clerkDeleted = false;
    let clerkError: string | null = null;
    if (linkedUserId) {
      try {
        await clerkClient.users.deleteUser(linkedUserId);
        clerkDeleted = true;
      } catch (err: any) {
        clerkError = err?.message ?? String(err);
        req.log.error(
          { err: clerkError, userId: linkedUserId, serverId, email },
          "Failed to delete Clerk user during admin account purge",
        );
      }
    }

    req.log.info(
      {
        adminUserId: req.userId,
        serverId,
        deletedClerkUserId: linkedUserId,
        email,
        revokedInvites,
        clerkDeleted,
      },
      "Admin hard-deleted server account",
    );
    await recordAdminAudit(req, "server.delete_account", {
      targetServerId: serverId,
      targetUserId: linkedUserId,
      details: {
        email,
        clerkDeleted,
        revokedInvites,
        clerkError,
        // Soft delete: history (service attempts, payouts, jobs, location
        // pings, release events) was preserved on the server roster row.
        softDelete: true,
      },
    });

    res.json({
      ok: true,
      clerkDeleted,
      revokedInvites,
      clerkError,
    });
  },
);

/**
 * Manual fail-out (e.g. the server's check came back failed but the
 * webhook hasn't fired yet). Captures a freeform reason for the audit log
 * and the wallet-page banner.
 */
router.post(
  "/admin/server/:serverId/fail",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const serverId = Number.parseInt(String(req.params.serverId), 10);
    if (!Number.isFinite(serverId)) {
      res.status(400).json({ error: "Invalid serverId" });
      return;
    }
    const reason =
      typeof req.body?.reason === "string" && req.body.reason.trim().length > 0
        ? req.body.reason.trim().slice(0, 500)
        : "Background check did not pass.";

    const [server] = await db
      .select()
      .from(serversTable)
      .where(eq(serversTable.id, serverId))
      .limit(1);
    if (!server || !server.userId) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    const now = new Date();
    const [credRow] = await db
      .insert(serverCredentialsTable)
      .values({
        userId: server.userId,
        status: "failed",
        failureReason: reason,
      })
      .onConflictDoUpdate({
        target: serverCredentialsTable.userId,
        set: {
          status: "failed",
          failureReason: reason,
          updatedAt: now,
        },
      })
      .returning();

    req.log.info(
      { adminUserId: req.userId, serverId, targetUserId: server.userId, reason },
      "Admin manual-failed server",
    );
    await recordAdminAudit(req, "server.fail", {
      targetServerId: serverId,
      targetUserId: server.userId,
      details: { reason },
    });
    res.json({ credential: credRow, serverId });
  },
);

// ---------------------------------------------------------------------------
// License-expiry notification log + manual trigger.
//
// The notifier runs automatically on a 24h cadence (see
// `artifacts/api-server/src/lib/scheduler.ts`). These endpoints exist so
// admins can:
//   1) inspect the audit trail of who's been emailed and when, and
//   2) re-run the job by hand without waiting for the next tick (dedup
//      guarantees this is safe to call repeatedly).
// ---------------------------------------------------------------------------
router.get(
  "/admin/license-notifications",
  requireAuth,
  requireAdmin(),
  async (_req, res) => {
    const rows = await db
      .select({
        id: licenseExpiryNotificationsTable.id,
        serverId: licenseExpiryNotificationsTable.serverId,
        licenseExpiry: licenseExpiryNotificationsTable.licenseExpiry,
        threshold: licenseExpiryNotificationsTable.threshold,
        sentAt: licenseExpiryNotificationsTable.sentAt,
      })
      .from(licenseExpiryNotificationsTable)
      .orderBy(desc(licenseExpiryNotificationsTable.sentAt))
      .limit(200);
    res.json({ items: rows });
  },
);

router.post(
  "/admin/license-notifications/run",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    try {
      const result = await runLicenseExpiryNotifications();
      req.log.info(
        { adminUserId: req.userId, result },
        "Admin triggered license-expiry notifications",
      );
      res.json(result);
    } catch (err) {
      req.log.error({ err }, "license-expiry: manual run failed");
      res.status(500).json({ error: "Run failed" });
    }
  },
);

// ---------------------------------------------------------------------------
// Mailer smoke test — POST /admin/mailer/test
//
// Calls the same `sendEmail` code path that production uses, so an op can
// verify SendGrid wiring (API key resolution, sender-domain verification,
// MAIL_FROM) end-to-end without waiting for a real payout failure or
// hand-crafting a forced bad transfer.
//
// Request body (all optional):
//   { "to"?: string, "subject"?: string, "body"?: string }
// Defaults:
//   to      → the calling admin's email on file (usersTable.email)
//   subject → "SERVED. mailer smoke test"
//   body    → a short timestamped paragraph identifying the actor
// Response always 200; payload includes `delivered`, `hadCredential`,
// optional SendGrid `status` + `detail`, and the resolved From address so
// the UI can show actionable error text inline.
// ---------------------------------------------------------------------------
router.post(
  "/admin/mailer/test",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const bodyIn = (req.body ?? {}) as {
      to?: unknown;
      subject?: unknown;
      body?: unknown;
    };

    let to =
      typeof bodyIn.to === "string" && bodyIn.to.trim().length > 0
        ? bodyIn.to.trim()
        : "";
    const subject =
      typeof bodyIn.subject === "string" && bodyIn.subject.trim().length > 0
        ? bodyIn.subject.trim().slice(0, 200)
        : "SERVED. mailer smoke test";
    const customBody =
      typeof bodyIn.body === "string" && bodyIn.body.trim().length > 0
        ? bodyIn.body.slice(0, 4000)
        : null;

    // Resolve the calling admin's email if no `to` was supplied. This is
    // the safest default — the admin gets the test in their own inbox and
    // there's no risk of accidentally mailing an unintended recipient.
    if (!to) {
      const [me] = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, req.userId!))
        .limit(1);
      if (me?.email) {
        to = me.email;
      }
    }

    if (!to) {
      res.status(400).json({
        error:
          "No recipient: pass { to: \"someone@example.com\" } or set an email on your admin account.",
      });
      return;
    }

    // Trivial RFC 5322-ish check — full validation is SendGrid's job, but
    // catching obviously-bad input here gives the UI a clear error.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      res.status(400).json({ error: `Invalid recipient address: ${to}` });
      return;
    }

    const sentAt = new Date().toISOString();
    const text =
      customBody ??
      [
        "This is a test email from the SERVED. admin console.",
        "",
        `Triggered by admin user: ${req.userId}`,
        `Timestamp: ${sentAt}`,
        "",
        "If you received this, the SendGrid integration is working end-to-end:",
        "the API key is resolving, the sender domain is verified, and MAIL_FROM",
        "is configured correctly.",
        "",
        "— SERVED.",
      ].join("\n");

    const result = await sendEmailDetailed({ to, subject, text });

    req.log.info(
      {
        adminUserId: req.userId,
        to,
        subject,
        delivered: result.delivered,
        hadCredential: result.hadCredential,
        status: result.status,
      },
      "Admin triggered mailer smoke test",
    );

    res.json({
      to,
      subject,
      from: result.from,
      delivered: result.delivered,
      hadCredential: result.hadCredential,
      status: result.status ?? null,
      detail: result.detail ?? null,
      sentAt,
    });
  },
);

// ---------------------------------------------------------------------------
// Email a user — POST /admin/users/:userId/email
//
// Lets an admin send a one-off message (welcome, nudge, check-in) to any
// user straight from the Users drawer. The recipient is always resolved
// from the user's row on file — the admin never types an address — so a
// message can only ever go to the selected account. Runs the same
// `sendEmailDetailed` SendGrid path as the rest of the app and writes a
// `user.email` audit row on success.
//
// Body: { subject: string, body: string }
// Response: { delivered, hadCredential, status, detail, to, from, sentAt }
// ---------------------------------------------------------------------------
router.post(
  "/admin/users/:userId/email",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const userId = String(req.params.userId);
    const bodyIn = (req.body ?? {}) as { subject?: unknown; body?: unknown };

    const subject =
      typeof bodyIn.subject === "string" && bodyIn.subject.trim().length > 0
        ? bodyIn.subject.trim().slice(0, 200)
        : "";
    const text =
      typeof bodyIn.body === "string" && bodyIn.body.trim().length > 0
        ? bodyIn.body.slice(0, 8000)
        : "";

    if (!subject || !text) {
      res
        .status(400)
        .json({ error: "Both a subject and a message body are required." });
      return;
    }

    const [target] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!target) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    if (!target.email) {
      res
        .status(400)
        .json({ error: "This user has no email address on file." });
      return;
    }

    const to = target.email;
    const sentAt = new Date().toISOString();
    const result = await sendEmailDetailed({ to, subject, text });

    req.log.info(
      {
        adminUserId: req.userId,
        targetUserId: userId,
        to,
        subject,
        delivered: result.delivered,
        hadCredential: result.hadCredential,
        status: result.status,
      },
      "Admin emailed a user",
    );

    if (result.delivered) {
      await recordAdminAudit(req, "user.email", {
        targetUserId: userId,
        details: { subject, to },
      });
    }

    res.json({
      to,
      from: result.from,
      delivered: result.delivered,
      hadCredential: result.hadCredential,
      status: result.status ?? null,
      detail: result.detail ?? null,
      sentAt,
    });
  },
);

// ---------------------------------------------------------------------------
// Maintenance — POST /admin/maintenance/purge-test-data
//
// One-shot factory-reset for the operational tables (jobs, servers, clients
// and their FK children). Intended for use right after launch when the
// production DB still has demo / pre-launch test rows the team wants gone
// before the first real customer touches the system.
//
// Preserves: users, app_settings, server_credentials, subscriptions,
// vault_subscriptions, draft_checkout_queues, admin_audit_log.
//
// Requires the admin to send `{ confirmation: "PURGE" }` in the body so
// it cannot be triggered by an accidental click. Returns row counts so the
// UI can show "deleted N jobs / N servers / N clients".
// ---------------------------------------------------------------------------
router.post(
  "/admin/maintenance/purge-test-data",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const body = (req.body ?? {}) as { confirmation?: unknown };
    if (body.confirmation !== "PURGE") {
      res.status(400).json({
        error:
          "Confirmation required. Send { confirmation: \"PURGE\" } to proceed.",
      });
      return;
    }

    const counts = await db.transaction(async (tx) => {
      const docs = await tx.delete(documentsTable).returning({ id: documentsTable.id });
      const reservations = await tx
        .delete(uploadReservationsTable)
        .returning({ key: uploadReservationsTable.objectPath });
      const payments = await tx.delete(paymentsTable).returning({ id: paymentsTable.id });
      const payouts = await tx.delete(payoutsTable).returning({ id: payoutsTable.id });
      const licenseNotifs = await tx
        .delete(licenseExpiryNotificationsTable)
        .returning({ id: licenseExpiryNotificationsTable.id });
      const jobs = await tx.delete(jobsTable).returning({ id: jobsTable.id });
      const servers = await tx
        .delete(serversTable)
        .returning({ id: serversTable.id });
      const clients = await tx
        .delete(clientsTable)
        .returning({ id: clientsTable.id });

      return {
        documents: docs.length,
        uploadReservations: reservations.length,
        payments: payments.length,
        payouts: payouts.length,
        licenseExpiryNotifications: licenseNotifs.length,
        jobs: jobs.length,
        servers: servers.length,
        clients: clients.length,
      };
    });

    req.log.warn(
      { adminUserId: req.userId, counts },
      "Admin purged test data from operational tables",
    );

    await recordAdminAudit(req, "maintenance.purge_test_data", {
      details: counts,
    });

    res.json({ ok: true, counts });
  },
);

// ---------------------------------------------------------------------------
// Audit log — read-only listing of admin actions for the audit sub-page.
// Filters: ?actor=<clerkUserId>, ?serverId=<int>, ?action=<enum>,
//          ?from=<ISO date>, ?to=<ISO date>.
// Returns the most recent rows first with display fields (actor name,
// target server name) so the UI doesn't need a second round-trip.
// ---------------------------------------------------------------------------

// `from` / `to` are accepted as either a date-only string (YYYY-MM-DD, what
// `<input type="date">` produces) or a full ISO datetime. Date-only inputs
// are anchored to UTC midnight and the `to` bound is widened to the next
// UTC midnight so the user-visible expectation "from the 1st to the 5th"
// includes everything that happened on the 5th. Invalid strings are
// silently ignored — admins can clear a bad filter from the UI.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseAuditFromParam(raw: unknown): Date | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const s = raw.trim();
  const d = DATE_ONLY_RE.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseAuditToParam(raw: unknown): Date | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const s = raw.trim();
  if (DATE_ONLY_RE.test(s)) {
    // End-of-day exclusive: midnight UTC of the following day.
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

router.get("/admin/audit", requireAuth, requireAdmin(), async (req, res) => {
  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? "100"), 10) || 100, 1),
    500,
  );
  const offset = Math.max(
    Number.parseInt(String(req.query.offset ?? "0"), 10) || 0,
    0,
  );
  const actor =
    typeof req.query.actor === "string" && req.query.actor.trim().length > 0
      ? req.query.actor.trim()
      : null;
  const serverIdRaw =
    typeof req.query.serverId === "string" ? req.query.serverId.trim() : "";
  const serverId =
    serverIdRaw && Number.isFinite(Number.parseInt(serverIdRaw, 10))
      ? Number.parseInt(serverIdRaw, 10)
      : null;
  const action =
    typeof req.query.action === "string" &&
    (ADMIN_AUDIT_ACTIONS as readonly string[]).includes(req.query.action)
      ? (req.query.action as AdminAuditAction)
      : null;
  const targetUserId =
    typeof req.query.targetUserId === "string" &&
    req.query.targetUserId.trim().length > 0
      ? req.query.targetUserId.trim()
      : null;
  const fromDate = parseAuditFromParam(req.query.from);
  const toDate = parseAuditToParam(req.query.to);

  const conds = [
    actor ? eq(adminAuditLogTable.actorUserId, actor) : null,
    serverId !== null ? eq(adminAuditLogTable.targetServerId, serverId) : null,
    action ? eq(adminAuditLogTable.action, action) : null,
    targetUserId ? eq(adminAuditLogTable.targetUserId, targetUserId) : null,
    fromDate ? gte(adminAuditLogTable.createdAt, fromDate) : null,
    toDate ? lt(adminAuditLogTable.createdAt, toDate) : null,
  ].filter(Boolean) as any[];
  const where = conds.length === 0
    ? undefined
    : conds.length === 1
      ? conds[0]
      : and(...conds);

  const rows = await db
    .select({
      id: adminAuditLogTable.id,
      actorUserId: adminAuditLogTable.actorUserId,
      action: adminAuditLogTable.action,
      targetServerId: adminAuditLogTable.targetServerId,
      targetUserId: adminAuditLogTable.targetUserId,
      details: adminAuditLogTable.details,
      createdAt: adminAuditLogTable.createdAt,
    })
    .from(adminAuditLogTable)
    .where(where)
    .orderBy(desc(adminAuditLogTable.createdAt))
    .limit(limit)
    .offset(offset);

  // Side joins so the UI can render names without another round-trip.
  const actorIds = Array.from(new Set(rows.map((r) => r.actorUserId)));
  const targetUserIds = Array.from(
    new Set(
      rows.map((r) => r.targetUserId).filter((v): v is string => Boolean(v)),
    ),
  );
  const allUserIds = Array.from(new Set([...actorIds, ...targetUserIds]));
  const targetServerIds = Array.from(
    new Set(
      rows
        .map((r) => r.targetServerId)
        .filter((v): v is number => typeof v === "number"),
    ),
  );

  const [userRows, serverRows] = await Promise.all([
    allUserIds.length
      ? db
          .select({
            id: usersTable.id,
            firstName: usersTable.firstName,
            lastName: usersTable.lastName,
            email: usersTable.email,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, allUserIds))
      : Promise.resolve([] as any[]),
    targetServerIds.length
      ? db
          .select({
            id: serversTable.id,
            name: serversTable.name,
            email: serversTable.email,
          })
          .from(serversTable)
          .where(inArray(serversTable.id, targetServerIds))
      : Promise.resolve([] as any[]),
  ]);

  const userMap = new Map(userRows.map((u) => [u.id, u]));
  const serverMap = new Map(serverRows.map((s) => [s.id, s]));

  function fmtUserName(id: string | null): string | null {
    if (!id) return null;
    const u = userMap.get(id);
    if (!u) return id;
    const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
    return name || u.email || id;
  }

  res.json({
    items: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt instanceof Date
        ? r.createdAt.toISOString()
        : r.createdAt,
      actorName: fmtUserName(r.actorUserId),
      actorEmail: userMap.get(r.actorUserId)?.email ?? null,
      targetUserName: fmtUserName(r.targetUserId),
      targetServerName: r.targetServerId
        ? serverMap.get(r.targetServerId)?.name ?? null
        : null,
    })),
    limit,
    offset,
    actions: ADMIN_AUDIT_ACTIONS,
  });
});

// ---------------------------------------------------------------------------
// Audit log — CSV export of the same filtered set as `/admin/audit`.
//
// Streams the CSV in pages so very large logs don't OOM either the server or
// the browser: we page through `admin_audit_log` in chunks and `res.write()`
// each batch out to the client as it's joined to the actor/target lookup
// tables. There is no `limit` cap — admins exporting for compliance need
// the full filtered history, not the first 500 rows. The same query filters
// (`actor`, `serverId`, `action`) as the JSON endpoint are honoured.
//
// Columns: timestamp, actor email, action, target server, target user,
// details (JSON-stringified). Header row is always emitted, even when the
// filter matches zero rows, so the downloaded file is still a valid CSV.
// ---------------------------------------------------------------------------
// Characters that, when they appear at the start of a CSV cell, get
// interpreted as a formula by Excel / Google Sheets / LibreOffice. Prefixing
// the cell with a single quote forces the spreadsheet to treat the value as
// a literal string and is the OWASP-recommended mitigation for CSV formula
// injection. Names, emails, and the JSON details blob can all carry
// user-influenced content, so we sanitize uniformly rather than trying to
// reason about which columns are "safe".
const FORMULA_INJECTION_PREFIX = /^[=+\-@\t\r]/;

function csvSanitize(v: string): string {
  return FORMULA_INJECTION_PREFIX.test(v) ? `'${v}` : v;
}

function csvEscape(v: string): string {
  const safe = csvSanitize(v);
  // RFC 4180: quote any field containing a comma, double-quote, CR, or LF;
  // escape embedded double quotes by doubling them.
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function csvRow(values: (string | null | undefined)[]): string {
  return values.map((v) => csvEscape(v ?? "")).join(",") + "\r\n";
}

/**
 * Backpressure-aware response write. If the kernel write buffer is full,
 * `res.write()` returns false; we wait for the `drain` event before queuing
 * more so a slow client (or a very large export) can't push the server into
 * unbounded in-memory buffering.
 *
 * The `drain` wait is raced against `close` and `error` so we don't hang
 * forever if the client disconnects mid-buffer (in which case `drain` will
 * never fire). All three listeners are removed in `finally` so a long
 * export that triggers backpressure many times doesn't accumulate dangling
 * listeners on the response object (which would eventually trigger Node's
 * MaxListenersExceededWarning). Callers should still re-check their abort
 * flag after the await returns and bail out cleanly.
 */
async function writeWithBackpressure(
  res: Response,
  chunk: string,
): Promise<void> {
  if (res.write(chunk)) return;
  await new Promise<void>((resolve) => {
    const done = (): void => {
      res.off("drain", done);
      res.off("close", done);
      res.off("error", done);
      resolve();
    };
    res.once("drain", done);
    res.once("close", done);
    res.once("error", done);
  });
}

router.get(
  "/admin/audit.csv",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const actor =
      typeof req.query.actor === "string" && req.query.actor.trim().length > 0
        ? req.query.actor.trim()
        : null;
    const serverIdRaw =
      typeof req.query.serverId === "string" ? req.query.serverId.trim() : "";
    const serverId =
      serverIdRaw && Number.isFinite(Number.parseInt(serverIdRaw, 10))
        ? Number.parseInt(serverIdRaw, 10)
        : null;
    const action =
      typeof req.query.action === "string" &&
      (ADMIN_AUDIT_ACTIONS as readonly string[]).includes(req.query.action)
        ? (req.query.action as AdminAuditAction)
        : null;
    const fromDate = parseAuditFromParam(req.query.from);
    const toDate = parseAuditToParam(req.query.to);

    const conds: SQL[] = [];
    if (actor) conds.push(eq(adminAuditLogTable.actorUserId, actor));
    if (serverId !== null)
      conds.push(eq(adminAuditLogTable.targetServerId, serverId));
    if (action) conds.push(eq(adminAuditLogTable.action, action));
    if (fromDate) conds.push(gte(adminAuditLogTable.createdAt, fromDate));
    if (toDate) conds.push(lt(adminAuditLogTable.createdAt, toDate));
    const where: SQL | undefined =
      conds.length === 0
        ? undefined
        : conds.length === 1
          ? conds[0]
          : and(...conds);

    const filename = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    res.setHeader("Cache-Control", "no-store");
    // Hint the proxy not to buffer so the download starts streaming
    // immediately for very large exports.
    res.setHeader("X-Accel-Buffering", "no");

    // Wire up disconnect detection BEFORE the first write so an early
    // cancellation (e.g. user closes the tab right after clicking Download)
    // short-circuits any DB work below. Listen on `res` rather than `req`:
    // in Express, `req` close can fire after the response is fully consumed
    // while `res` close fires precisely when the underlying socket is no
    // longer writable, which is what matters for paging decisions.
    let aborted = false;
    res.on("close", () => {
      aborted = true;
    });

    await writeWithBackpressure(
      res,
      csvRow([
        "timestamp",
        "actor email",
        "action",
        "target server",
        "target user",
        "details",
      ]),
    );

    // Page through results to keep memory bounded. The page size trades off
    // round-trip count vs. peak per-batch memory; 500 keeps each join lookup
    // small while still amortising query overhead.
    //
    // Keyset pagination on `id` (rather than LIMIT/OFFSET on createdAt) keeps
    // the export stable even if a new audit row is written mid-export — with
    // OFFSET, a concurrent insert at position 0 would shift every later row
    // down by one and we'd duplicate rows across pages. `id` is a serial PK
    // that grows in lockstep with `createdAt` for this append-only table, so
    // ordering by `id DESC` matches the visible "most recent first" order
    // the audit page uses, and `WHERE id < lastId` cleanly skips already-
    // emitted rows.
    const PAGE = 500;
    let cursor: number | null = null;

    while (!aborted) {
      const pageConds: SQL[] = [];
      if (where) pageConds.push(where);
      if (cursor !== null) pageConds.push(lt(adminAuditLogTable.id, cursor));
      const pageWhere: SQL | undefined =
        pageConds.length === 0
          ? undefined
          : pageConds.length === 1
            ? pageConds[0]
            : and(...pageConds);

      const rows = await db
        .select({
          id: adminAuditLogTable.id,
          actorUserId: adminAuditLogTable.actorUserId,
          action: adminAuditLogTable.action,
          targetServerId: adminAuditLogTable.targetServerId,
          targetUserId: adminAuditLogTable.targetUserId,
          details: adminAuditLogTable.details,
          createdAt: adminAuditLogTable.createdAt,
        })
        .from(adminAuditLogTable)
        .where(pageWhere)
        .orderBy(desc(adminAuditLogTable.id))
        .limit(PAGE);

      if (rows.length === 0) break;

      const actorIds = Array.from(new Set(rows.map((r) => r.actorUserId)));
      const targetUserIds = Array.from(
        new Set(
          rows
            .map((r) => r.targetUserId)
            .filter((v): v is string => Boolean(v)),
        ),
      );
      const allUserIds = Array.from(new Set([...actorIds, ...targetUserIds]));
      const targetServerIds = Array.from(
        new Set(
          rows
            .map((r) => r.targetServerId)
            .filter((v): v is number => typeof v === "number"),
        ),
      );

      const [userRows, serverRows] = await Promise.all([
        allUserIds.length
          ? db
              .select({
                id: usersTable.id,
                firstName: usersTable.firstName,
                lastName: usersTable.lastName,
                email: usersTable.email,
              })
              .from(usersTable)
              .where(inArray(usersTable.id, allUserIds))
          : Promise.resolve(
              [] as Array<{
                id: string;
                firstName: string | null;
                lastName: string | null;
                email: string | null;
              }>,
            ),
        targetServerIds.length
          ? db
              .select({
                id: serversTable.id,
                name: serversTable.name,
                email: serversTable.email,
              })
              .from(serversTable)
              .where(inArray(serversTable.id, targetServerIds))
          : Promise.resolve(
              [] as Array<{ id: number; name: string; email: string }>,
            ),
      ]);

      const userMap = new Map(userRows.map((u) => [u.id, u]));
      const serverMap = new Map(serverRows.map((s) => [s.id, s]));

      for (const r of rows) {
        const ts =
          r.createdAt instanceof Date
            ? r.createdAt.toISOString()
            : String(r.createdAt);
        // Prefer email for the actor column (it's the stable identifier
        // compliance reviewers care about); fall back to the raw Clerk id
        // for orphaned actors whose `users` row was hard-deleted.
        const actorEmail =
          userMap.get(r.actorUserId)?.email ?? r.actorUserId ?? "";
        const targetServer = r.targetServerId
          ? serverMap.get(r.targetServerId)?.name ??
            `server #${r.targetServerId} (deleted)`
          : "";
        const targetUserRow = r.targetUserId
          ? userMap.get(r.targetUserId)
          : null;
        let targetUser = "";
        if (r.targetUserId) {
          const fullName = [
            targetUserRow?.firstName,
            targetUserRow?.lastName,
          ]
            .filter(Boolean)
            .join(" ")
            .trim();
          targetUser =
            targetUserRow?.email ?? (fullName || r.targetUserId);
        }
        const details = r.details ? JSON.stringify(r.details) : "";
        await writeWithBackpressure(
          res,
          csvRow([ts, actorEmail, r.action, targetServer, targetUser, details]),
        );
        if (aborted) break;
      }

      if (rows.length < PAGE) break;
      // Advance the keyset cursor to the smallest id we just emitted so the
      // next page picks up strictly older rows.
      cursor = rows[rows.length - 1].id;
    }

    res.end();
  },
);

/**
 * Distinct actor + server lists, used to populate the audit-page filter
 * dropdowns. Returns recent actors (any admin who has written an entry)
 * and the active servers roster so the dropdowns aren't empty when no
 * audit rows exist yet.
 */
router.get(
  "/admin/audit/filters",
  requireAuth,
  requireAdmin(),
  async (_req, res) => {
    const [actorRows, serverRows] = await Promise.all([
      db
        .selectDistinct({ actorUserId: adminAuditLogTable.actorUserId })
        .from(adminAuditLogTable),
      db
        .select({
          id: serversTable.id,
          name: serversTable.name,
          email: serversTable.email,
        })
        .from(serversTable)
        .orderBy(desc(serversTable.createdAt)),
    ]);

    const actorIds = actorRows
      .map((r) => r.actorUserId)
      .filter((v): v is string => Boolean(v));

    const userRows = actorIds.length
      ? await db
          .select({
            id: usersTable.id,
            firstName: usersTable.firstName,
            lastName: usersTable.lastName,
            email: usersTable.email,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, actorIds))
      : [];
    const userMap = new Map(userRows.map((u) => [u.id, u]));

    res.json({
      actors: actorIds.map((id) => {
        const u = userMap.get(id);
        const name = u
          ? [u.firstName, u.lastName].filter(Boolean).join(" ").trim() ||
            u.email ||
            id
          : id;
        return { id, name, email: u?.email ?? null };
      }),
      servers: serverRows,
      actions: ADMIN_AUDIT_ACTIONS,
    });
  },
);

export default router;
