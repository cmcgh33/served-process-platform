import { Router, type Request, type Response } from "express";
import {
  db,
  jobsTable,
  clientsTable,
  serversTable,
  serviceAttemptsTable,
  serverDismissedJobsTable,
  jobReleaseEventsTable,
  jobServedDocumentsTable,
  serverCredentialsTable,
} from "@workspace/db";
import { and, eq, or, sql, inArray, notInArray, desc, type InferSelectModel } from "drizzle-orm";
import {
  CreateJobBody,
  UpdateJobBody,
  ListJobsQueryParams,
  LogServiceAttemptBody,
  ReleaseJobBody,
  ConfirmJobMailingBody,
} from "@workspace/api-zod";
import type { ServiceType } from "@workspace/pricing";
import { nanoid } from "nanoid";
import { requireRole } from "../middlewares/auth";
import { validateAttemptBody } from "../lib/attemptValidation";
import {
  ACTIVE_JOB_STATUSES,
  MAX_ACTIVE_JOBS_PER_SERVER,
  assertServerCanAccept,
  assertServerVerified,
  countActiveJobsForServer,
  enqueuePayoutForServedJob,
  getActiveSubscriptionTier,
  getPricingTierForCreator,
  getServerByUserId,
  getServerUserIdById,
  isAdminUser,
  priceJob,
  processPayoutTransfer,
} from "../lib/marketplace";
import {
  generateAndStoreAffidavit,
  generateAndStoreNoticeOfMail,
} from "../lib/affidavit";
import { deriveRequiresLicensedServer } from "../lib/licensedServerRules";
import { claimPickupAndNotifyRequester } from "../lib/pickupNotificationEmail";
import { claimAttemptAndNotifyRequester } from "../lib/attemptNotificationEmail";

const anyRole = requireRole("requester", "attorney", "server");

function generatePlatformRef(): string {
  const year = new Date().getFullYear();
  return `SERVED-${year}-${nanoid(8).toUpperCase()}`;
}

async function getServerIdForUser(userId: string): Promise<number | null> {
  const [row] = await db
    .select({ id: serversTable.id })
    .from(serversTable)
    .where(eq(serversTable.userId, userId));
  return row?.id ?? null;
}

const router = Router();

router.get("/jobs", anyRole, async (req, res) => {
  const params = ListJobsQueryParams.safeParse(req.query);
  const query = params.success ? params.data : {};
  const userId = req.userId!;
  const role = req.userRole!;

  const myServerId = role === "server" ? await getServerIdForUser(userId) : null;
  const scopeWhere =
    role === "server"
      ? or(
          eq(jobsTable.status, "pending"),
          myServerId != null ? eq(jobsTable.serverId, myServerId) : sql`false`,
        )
      : eq(jobsTable.requesterUserId, userId);

  const filters = [scopeWhere];

  // Drafts are pre-payment shells. Servers must never see them in the
  // marketplace queue. Requesters/attorneys see their own drafts because
  // the scopeWhere already restricts to `requesterUserId = me`, so this
  // guard is only needed on the server branch.
  if (role === "server") {
    filters.push(sql`${jobsTable.status} <> 'draft'`);
    // NV-PILB licensing gate. Jobs whose docs include subpoena / civil-
    // litigation types are stamped `requires_licensed_server = true` at
    // create time. Servers without `is_licensed_nv_server` should never
    // see them in the available feed (still see them when assigned to
    // them, in case admin manually placed an unlicensed server on a
    // licensed job — they need to keep working it).
    if (myServerId != null) {
      filters.push(
        sql`(${jobsTable.requiresLicensedServer} = false OR ${jobsTable.serverId} = ${myServerId} OR EXISTS (
          SELECT 1 FROM ${serversTable} sv
          WHERE sv.id = ${myServerId} AND sv.is_licensed_nv_server = true
        ))`,
      );
    } else {
      // No server row yet → can't see licensed-required jobs at all.
      filters.push(sql`${jobsTable.requiresLicensedServer} = false`);
    }
  }
  // Servers shouldn't see jobs they've dismissed from the Available feed —
  // exclude them, but never hide an assignment they actually own.
  if (role === "server" && myServerId != null) {
    filters.push(
      sql`(${jobsTable.serverId} = ${myServerId} OR NOT EXISTS (
        SELECT 1 FROM ${serverDismissedJobsTable}
        WHERE ${serverDismissedJobsTable.serverId} = ${myServerId}
        AND ${serverDismissedJobsTable.jobId} = ${jobsTable.id}
      ))`,
    );
  }
  if (query.status) filters.push(eq(jobsTable.status, query.status));
  if (query.clientId) filters.push(eq(jobsTable.clientId, query.clientId));
  if (query.serverId) filters.push(eq(jobsTable.serverId, query.serverId));

  const attemptCountSql = sql<number>`(
    SELECT COUNT(*)::int FROM ${serviceAttemptsTable}
    WHERE ${serviceAttemptsTable.jobId} = ${jobsTable.id}
  )`;

  const allJobs = await db
    .select({
      job: jobsTable,
      client: clientsTable,
      server: serversTable,
      attemptCount: attemptCountSql,
    })
    .from(jobsTable)
    .leftJoin(clientsTable, eq(jobsTable.clientId, clientsTable.id))
    .leftJoin(serversTable, eq(jobsTable.serverId, serversTable.id))
    .where(and(...filters))
    .orderBy(sql`${jobsTable.createdAt} DESC`);

  res.json(
    allJobs.map(({ job, client, server, attemptCount }) => ({
      ...job,
      client: client ?? undefined,
      server: server ?? undefined,
      attemptCount,
    })),
  );
});

router.post("/jobs", requireRole("requester", "attorney"), async (req, res) => {
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }
  // When the caller asks the server to pick up physical documents, all the
  // pickup address + contact fields must be present. Schema-level "required"
  // is conditional, so we enforce it here.
  if (
    parsed.data.documentHandling === "pickup" ||
    parsed.data.documentHandling === "either"
  ) {
    const missing: string[] = [];
    if (!parsed.data.pickupAddress?.trim()) missing.push("pickupAddress");
    if (!parsed.data.pickupCity?.trim()) missing.push("pickupCity");
    if (!parsed.data.pickupState?.trim()) missing.push("pickupState");
    if (!parsed.data.pickupZip?.trim()) missing.push("pickupZip");
    if (!parsed.data.pickupContactName?.trim()) missing.push("pickupContactName");
    if (!parsed.data.pickupContactPhone?.trim()) missing.push("pickupContactPhone");
    if (missing.length > 0) {
      res.status(400).json({
        error: `Pickup details required when documentHandling = ${parsed.data.documentHandling}`,
        missing,
      });
      return;
    }
  }
  // Publish-time gates. Drafts are exempt — an attorney saving a partial
  // draft can fill the rest before submitting.
  // Universal (all jurisdictions):
  //   • requesterName, requesterEmail (snapshot the affidavit cites as
  //     "Requesting party")
  //   • at least one documentsServed entry (the affidavit must list the
  //     EXACT documents — not a generic "documents")
  // Nevada-only adds:
  //   • courtName, petitioner, respondent (case caption on NV form)
  if (parsed.data.initialStatus !== "draft") {
    const missing: string[] = [];
    if (!parsed.data.requesterName?.trim()) missing.push("requesterName");
    if (!parsed.data.requesterEmail?.trim()) missing.push("requesterEmail");
    // Universal docs-served rule (mirrors the UI catalogue):
    //   • a documentType must be picked
    //   • when documentType === "Other", a custom title is required
    //     (a generic "Other" title is not enough — the affidavit needs
    //     a real description for the court).
    if (
      !parsed.data.documentsServed ||
      parsed.data.documentsServed.length === 0 ||
      !parsed.data.documentsServed.some((d) => {
        const type = d.documentType?.trim();
        if (!type) return false;
        if (type === "Other") {
          const title = d.title?.trim();
          return Boolean(title) && title.toLowerCase() !== "other";
        }
        return true;
      })
    ) {
      missing.push("documentsServed");
    }
    const isNevada =
      typeof parsed.data.recipientState === "string" &&
      parsed.data.recipientState.trim().toUpperCase() === "NV";
    if (isNevada) {
      if (!parsed.data.courtName?.trim()) missing.push("courtName");
      if (!parsed.data.petitioner?.trim()) missing.push("petitioner");
      if (!parsed.data.respondent?.trim()) missing.push("respondent");
    }
    if (missing.length > 0) {
      res.status(400).json({
        error:
          "Job is missing fields required at publish time. Drafts are exempt.",
        missing,
      });
      return;
    }
  }
  // If a clientId is supplied, verify the caller owns it.
  if (parsed.data.clientId != null) {
    const [client] = await db
      .select({ ownerUserId: clientsTable.ownerUserId })
      .from(clientsTable)
      .where(eq(clientsTable.id, parsed.data.clientId));
    if (!client || client.ownerUserId !== req.userId) {
      res.status(403).json({ error: "You do not own that client" });
      return;
    }
  }

  if (parsed.data.serverId != null) {
    const targetUserId = await getServerUserIdById(parsed.data.serverId);
    if (!targetUserId) {
      res.status(400).json({ error: "Unknown server" });
      return;
    }
    const verified = await assertServerVerified(targetUserId);
    if (!verified.ok) {
      req.log.warn(
        { targetServerId: parsed.data.serverId, status: verified.status },
        "Refused to create job assigned to uncredentialed server",
      );
      res.status(409).json({
        error: "Cannot assign — server is not verified",
        credentialingStatus: verified.status,
        message: verified.message,
      });
      return;
    }
  }

  const serviceType: ServiceType = parsed.data.serviceType ?? "standard";
  const pricingTier = await getPricingTierForCreator(req.userId!, req.userRole ?? null);
  const priced = priceJob(pricingTier, serviceType);

  // initialStatus lets the caller park the job in a hidden state until
  // payment is collected:
  //   - `pending_payment`: requester pays via Stripe Checkout immediately;
  //     webhook flips to `pending` on success.
  //   - `draft`: attorney saved the job for later batch payment; will be
  //     paid via /stripe/draft-jobs/checkout (one or many at a time).
  //   - `pending` (default): no per-job payment required (subscriber, or
  //     direct-create path).
  // `draft` is attorney-only — a requester sending it gets a 400.
  const requestedStatus = parsed.data.initialStatus;
  if (requestedStatus === "draft" && req.userRole !== "attorney") {
    res.status(400).json({
      error: "Only attorneys can save draft jobs",
    });
    return;
  }

  // Payment-bypass guard for attorneys: a non-subscribing attorney must
  // either save a draft (paid later via /stripe/draft-jobs/checkout) or
  // pay immediately (`pending_payment`). They cannot post directly to
  // `pending` and skip Stripe. Subscribed attorneys (and requesters)
  // post directly to `pending` as before.
  if (req.userRole === "attorney") {
    const wantsDirectPending =
      requestedStatus === undefined || requestedStatus === "pending";
    if (wantsDirectPending) {
      const activeSub = await getActiveSubscriptionTier(
        req.userId!,
        req.userRole,
      );
      if (!activeSub) {
        res.status(402).json({
          error:
            "Payment required: non-subscribers must save as draft or pay at submit",
          code: "subscription_or_payment_required",
        });
        return;
      }
    }
  }

  const initialStatus: "pending" | "pending_payment" | "draft" =
    requestedStatus === "pending_payment"
      ? "pending_payment"
      : requestedStatus === "draft"
        ? "draft"
        : "pending";

  const platformRef = generatePlatformRef();
  const {
    serviceType: _ignoredService,
    initialStatus: _ignoredStatus,
    documentsServed: documentsServedInput,
    ...rest
  } = parsed.data;
  void _ignoredService;
  void _ignoredStatus;
  // Derive the NV-PILB licensing gate from the documents-served catalogue
  // BEFORE the insert so the column is set in a single round-trip and the
  // marketplace feed can use an O(1) boolean filter from the moment the
  // row exists. Empty/missing catalogue → false (the universal publish
  // gate elsewhere in this handler already requires ≥1 doc at non-draft
  // statuses).
  const requiresLicensedServer = deriveRequiresLicensedServer(documentsServedInput);
  const [job] = await db
    .insert(jobsTable)
    .values({
      ...rest,
      requesterUserId: req.userId!,
      platformRef,
      status: initialStatus,
      // If the requester pre-assigned a server at create time, stamp the
      // assignment moment so the timeline can show "Assigned to {server}".
      ...(rest.serverId != null ? { assignedAt: new Date() } : {}),
      serviceType: priced.serviceType,
      pricingTier: priced.pricingTier,
      grossCents: priced.grossCents,
      platformFeeCents: priced.platformFeeCents,
      serverPayoutCents: priced.serverPayoutCents,
      requiresLicensedServer,
    })
    .returning();
  // Persist the documents-served catalogue (Nevada affidavit list). We
  // insert one row per entry so the affidavit pipeline can read them in
  // a deterministic order without cracking JSON.
  let documentsServed: Array<{
    id: number;
    jobId: number;
    title: string;
    documentType: string;
    createdAt: Date;
  }> = [];
  if (documentsServedInput && documentsServedInput.length > 0) {
    documentsServed = await db
      .insert(jobServedDocumentsTable)
      .values(
        documentsServedInput.map((d) => ({
          jobId: job.id,
          title: d.title,
          documentType: d.documentType,
        })),
      )
      .returning();
  }
  req.log.info(
    {
      jobId: job.id,
      pricingTier: priced.pricingTier,
      serviceType: priced.serviceType,
      grossCents: priced.grossCents,
      status: initialStatus,
      documentsServedCount: documentsServed.length,
    },
    "Job created and priced",
  );
  res.status(201).json({ ...job, documentsServed });
});

router.get("/jobs/:id", anyRole, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const userId = req.userId!;
  const role = req.userRole!;

  const [result] = await db
    .select({ job: jobsTable, client: clientsTable, server: serversTable })
    .from(jobsTable)
    .leftJoin(clientsTable, eq(jobsTable.clientId, clientsTable.id))
    .leftJoin(serversTable, eq(jobsTable.serverId, serversTable.id))
    .where(eq(jobsTable.id, id));

  if (!result) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // Authorize: requester/attorney must own; server must be assigned, or job is pending.
  if (role === "requester" || role === "attorney") {
    if (result.job.requesterUserId !== userId) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
  } else {
    const myServerId = await getServerIdForUser(userId);
    const isAssigned = result.job.serverId != null && result.job.serverId === myServerId;
    const isOpen = result.job.status === "pending";
    if (!isAssigned && !isOpen) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
  }

  const [{ count: attemptCount }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(serviceAttemptsTable)
    .where(eq(serviceAttemptsTable.jobId, id));

  const documentsServed = await db
    .select()
    .from(jobServedDocumentsTable)
    .where(eq(jobServedDocumentsTable.jobId, id))
    .orderBy(jobServedDocumentsTable.id);

  res.json({
    ...result.job,
    client: result.client ?? undefined,
    server: result.server ?? undefined,
    attemptCount,
    documentsServed,
  });
});

router.patch("/jobs/:id", anyRole, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const parsed = UpdateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }
  const userId = req.userId!;
  const role = req.userRole!;

  const [existing] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // Authorization first — verify the caller actually owns or is
  // assigned to this job before leaking any state-specific 4xx (e.g.
  // 409 draft-only validation) that could be used to probe job IDs.
  if (role === "requester" || role === "attorney") {
    if (existing.requesterUserId !== userId) {
      res.status(403).json({ error: "Not your job" });
      return;
    }
    if (
      parsed.data.serverId != null &&
      parsed.data.serverId !== existing.serverId
    ) {
      const targetUserId = await getServerUserIdById(parsed.data.serverId);
      if (!targetUserId) {
        res.status(400).json({ error: "Unknown server" });
        return;
      }
      const verified = await assertServerVerified(targetUserId);
      if (!verified.ok) {
        req.log.warn(
          { jobId: id, targetServerId: parsed.data.serverId, status: verified.status },
          "Refused to assign uncredentialed server",
        );
        res.status(409).json({
          error: "Cannot assign — server is not verified",
          credentialingStatus: verified.status,
          message: verified.message,
        });
        return;
      }
    }
  } else {
    const myServerId = await getServerIdForUser(userId);
    if (existing.serverId == null || existing.serverId !== myServerId) {
      res.status(403).json({ error: "Not your assignment" });
      return;
    }

    const ok = await assertServerCanAccept(userId);
    if (!ok.ok) {
      req.log.warn(
        { userId, reason: ok.reason, jobId: id },
        "Server attempted to PATCH job without being able to accept",
      );
      const errorTitle =
        ok.reason === "not_verified"
          ? "Server not verified"
          : ok.reason === "no_payouts"
            ? "Payouts not connected"
            : `Server ${ok.serverStatus}`;
      res.status(403).json({
        error: errorTitle,
        reason: ok.reason,
        ...(ok.reason === "not_verified"
          ? { credentialingStatus: ok.status }
          : {}),
        ...(ok.reason === "status_blocked"
          ? { serverStatus: ok.serverStatus }
          : {}),
        message: ok.message,
      });
      return;
    }
  }

  // Pickup-handling validation. If this PATCH would leave the job in
  // pickup-or-either mode, all firm pickup fields must be present
  // (mirrors the POST /jobs guard so an attorney can't bypass the
  // requirement by saving a draft, then PATCHing documentHandling
  // without addresses).
  const nextHandling =
    parsed.data.documentHandling ?? existing.documentHandling;
  if (nextHandling === "pickup" || nextHandling === "either") {
    const merged = {
      pickupAddress: parsed.data.pickupAddress ?? existing.pickupAddress,
      pickupCity: parsed.data.pickupCity ?? existing.pickupCity,
      pickupState: parsed.data.pickupState ?? existing.pickupState,
      pickupZip: parsed.data.pickupZip ?? existing.pickupZip,
      pickupContactName:
        parsed.data.pickupContactName ?? existing.pickupContactName,
      pickupContactPhone:
        parsed.data.pickupContactPhone ?? existing.pickupContactPhone,
    };
    const missing: string[] = [];
    if (!merged.pickupAddress?.trim()) missing.push("pickupAddress");
    if (!merged.pickupCity?.trim()) missing.push("pickupCity");
    if (!merged.pickupState?.trim()) missing.push("pickupState");
    if (!merged.pickupZip?.trim()) missing.push("pickupZip");
    if (!merged.pickupContactName?.trim()) missing.push("pickupContactName");
    if (!merged.pickupContactPhone?.trim()) missing.push("pickupContactPhone");
    if (missing.length > 0) {
      res.status(400).json({
        error: `Pickup details required when documentHandling = ${nextHandling}`,
        missing,
      });
      return;
    }
  }

  const TERMINAL_OUTCOMES = new Set(["served", "failed"]);
  if (parsed.data.status && TERMINAL_OUTCOMES.has(parsed.data.status)) {
    res.status(403).json({
      error: "Use POST /jobs/:id/attempts to record a serve outcome",
    });
    return;
  }

  // Unpaid-job dispatch guard. A job in `pending_payment` was created
  // but checkout never completed — there's no money in escrow to pay
  // the server. Block any transition that would dispatch a server
  // (assigning a server, or flipping status into the live lifecycle)
  // until the customer pays. The frontend already swaps the assign
  // dropdown for a "Payment required" card, but UI is a soft guard;
  // this is the authoritative one. Cancelling unpaid jobs is fine
  // (and intentional: the requester's "discard" button uses it).
  if (existing.status === "pending_payment") {
    const triesToAssignServer =
      parsed.data.serverId != null && parsed.data.serverId !== existing.serverId;
    // UpdateJobBody's zod validator restricts inbound `status` to the
    // live-lifecycle set ("pending"|"in_progress"|"assigned"|...) and
    // never accepts "pending_payment", so any defined non-cancel
    // status here would advance the job out of the unpaid state.
    const triesToAdvanceStatus =
      parsed.data.status != null && parsed.data.status !== "cancelled";
    if (triesToAssignServer || triesToAdvanceStatus) {
      req.log.warn(
        {
          jobId: id,
          attemptedServerId: parsed.data.serverId ?? null,
          attemptedStatus: parsed.data.status ?? null,
          actorRole: role,
        },
        "Refused to dispatch unpaid job",
      );
      res.status(409).json({
        error: "Cannot dispatch a job that hasn't been paid for",
        currentStatus: existing.status,
      });
      return;
    }
  }

  // Recipient/document/service-speed fields are pre-payment edits that
  // attorneys make from the post-job form when fixing up a draft. Once
  // the draft has been paid for and the job is live in the marketplace,
  // these fields are locked — changing the recipient or service speed
  // after a server has already been priced/assigned would be a data
  // integrity problem and a billing problem (price recomputes on
  // serviceType change).
  const DRAFT_ONLY_FIELDS = [
    "documentType",
    "serviceType",
    "recipientName",
    "recipientAddress",
    "recipientCity",
    "recipientState",
    "recipientZip",
    "caseNumber",
    "deptNumber",
    "matterName",
    "courtName",
    "petitioner",
    "respondent",
    "documentsServed",
  ] as const;
  const draftOnlyTouched = DRAFT_ONLY_FIELDS.filter(
    (f) => parsed.data[f] !== undefined,
  );
  if (draftOnlyTouched.length > 0 && existing.status !== "draft") {
    res.status(409).json({
      error:
        "Recipient and service-speed fields can only be edited while the job is still a draft",
      fields: draftOnlyTouched,
      currentStatus: existing.status,
    });
    return;
  }

  // If the attorney swapped the service speed on a draft, the price has
  // changed too — recompute it before checkout so they're not charged the
  // old amount. We keep the existing pricingTier (subscription tier they
  // were on when they first saved the draft).
  const repricing =
    parsed.data.serviceType !== undefined &&
    parsed.data.serviceType !== existing.serviceType &&
    existing.status === "draft"
      ? priceJob(
          existing.pricingTier as Parameters<typeof priceJob>[0],
          parsed.data.serviceType as ServiceType,
        )
      : null;

  // Stamp assignedAt whenever the requester newly assigns a server (or
  // swaps to a different server). Mirrors the timestamp set by
  // POST /jobs/:id/accept and POST /admin/jobs/:id/assign so the unified
  // timeline can render an "Assigned to {server}" event.
  const isNewAssignment =
    parsed.data.serverId != null &&
    parsed.data.serverId !== existing.serverId;

  const { documentsServed: documentsServedInput, ...jobUpdate } = parsed.data;
  const [job] = await db
    .update(jobsTable)
    .set({
      ...jobUpdate,
      ...(isNewAssignment ? { assignedAt: new Date() } : {}),
      ...(repricing
        ? {
            grossCents: repricing.grossCents,
            platformFeeCents: repricing.platformFeeCents,
            serverPayoutCents: repricing.serverPayoutCents,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(jobsTable.id, id))
    .returning();
  // Replace-all semantics for documentsServed: if the caller sent the
  // field, treat the whole list as authoritative. Sending [] clears it.
  // Only writeable while the job is still in `draft` (enforced above).
  let documentsServed:
    | Array<{
        id: number;
        jobId: number;
        title: string;
        documentType: string;
        createdAt: Date;
      }>
    | undefined;
  if (documentsServedInput !== undefined) {
    await db
      .delete(jobServedDocumentsTable)
      .where(eq(jobServedDocumentsTable.jobId, id));
    if (documentsServedInput.length > 0) {
      documentsServed = await db
        .insert(jobServedDocumentsTable)
        .values(
          documentsServedInput.map((d) => ({
            jobId: id,
            title: d.title,
            documentType: d.documentType,
          })),
        )
        .returning();
    } else {
      documentsServed = [];
    }
  }
  if (repricing) {
    req.log.info(
      {
        jobId: id,
        oldServiceType: existing.serviceType,
        newServiceType: repricing.serviceType,
        oldGrossCents: existing.grossCents,
        newGrossCents: repricing.grossCents,
      },
      "Draft re-priced after service type change",
    );
  }
  res.json({
    ...job,
    ...(documentsServed !== undefined ? { documentsServed } : {}),
  });
});

router.delete("/jobs/:id", requireRole("attorney"), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const userId = req.userId!;

  // Atomic delete: a single statement gated on owner + draft status so a
  // concurrent webhook flipping draft→pending mid-request can't lose a
  // posted job. If 0 rows are deleted we re-read to give the caller a
  // useful 404 vs 409 vs 403 error.
  const deleted = await db
    .delete(jobsTable)
    .where(
      and(
        eq(jobsTable.id, id),
        eq(jobsTable.requesterUserId, userId),
        sql`${jobsTable.status} = 'draft'`,
      ),
    )
    .returning({ id: jobsTable.id });

  if (deleted.length > 0) {
    res.status(204).end();
    return;
  }

  // Diagnose why nothing was deleted.
  const [existing] = await db
    .select({
      requesterUserId: jobsTable.requesterUserId,
      status: jobsTable.status,
    })
    .from(jobsTable)
    .where(eq(jobsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (existing.requesterUserId !== userId) {
    res.status(403).json({ error: "Not your job" });
    return;
  }
  res
    .status(409)
    .json({ error: "Only draft jobs can be deleted", status: existing.status });
});

// --- Server marketplace lifecycle endpoints --------------------------------
// accept / en-route / release / dismiss. These are server-only and operate
// on the calling user's server identity.

/** Resolve the calling user's server row id, or send 403 + return null. */
async function resolveCallingServerId(
  req: Request,
  res: Response,
): Promise<number | null> {
  const server = await getServerByUserId(req.userId!);
  if (!server) {
    res.status(403).json({ error: "Server profile not found." });
    return null;
  }
  return server.id;
}

/**
 * Onboarding training gate. Blocks ANY server-initiated job-progression
 * action (accept, en-route, attempts/mark-served) until the server has
 * completed the in-portal training video and stamped
 * `server_credentials.training_completed_at`. Pre-assigned servers
 * (assigned by requester/admin) are not exempt — the gate is universal.
 *
 * Returns true when the response has been sent (caller must return).
 */
async function blockIfTrainingIncomplete(
  req: Request,
  res: Response,
): Promise<boolean> {
  const [cred] = await db
    .select({ trainingAt: serverCredentialsTable.trainingCompletedAt })
    .from(serverCredentialsTable)
    .where(eq(serverCredentialsTable.userId, req.userId!))
    .limit(1);
  if (!cred?.trainingAt) {
    res.status(403).json({
      error:
        "Finish the SERVED. server training video before working jobs.",
      reason: "training_required",
    });
    return true;
  }
  return false;
}

router.post("/jobs/:id/accept", requireRole("server"), async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const ok = await assertServerCanAccept(req.userId!);
  if (!ok.ok) {
    res.status(ok.reason === "not_verified" ? 403 : 403).json({
      error: ok.message,
      reason: ok.reason,
      ...(ok.reason === "not_verified" ? { status: ok.status } : {}),
    });
    return;
  }

  if (await blockIfTrainingIncomplete(req, res)) return;

  const serverId = await resolveCallingServerId(req, res);
  if (serverId == null) return;

  // NV-PILB licensing gate — block the claim before the transaction so the
  // server gets a clean explanation instead of a generic "not_pending"
  // after the row stays unassigned. We re-read the job (it's a single PK
  // lookup) plus the server's licensing flag.
  const [jobLicenseRow] = await db
    .select({ requiresLicensed: jobsTable.requiresLicensedServer })
    .from(jobsTable)
    .where(eq(jobsTable.id, id))
    .limit(1);
  if (jobLicenseRow?.requiresLicensed) {
    const [serverRow] = await db
      .select({ isLicensedNvServer: serversTable.isLicensedNvServer })
      .from(serversTable)
      .where(eq(serversTable.id, serverId))
      .limit(1);
    if (!serverRow?.isLicensedNvServer) {
      res.status(403).json({
        error:
          "This job requires a Nevada PILB licensed process server. Update your credentialing page if you hold a current PILB work card.",
        reason: "license_required",
      });
      return;
    }
  }

  // Atomically grab the job + cap-check + assign in one transaction so two
  // tabs racing on the same job can't double-accept and can't blow past the
  // 3-active cap.
  try {
    const updated = await db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(jobsTable)
        .where(eq(jobsTable.id, id))
        .for("update");
      if (!job) {
        const err = new Error("not_found");
        (err as Error & { httpStatus?: number }).httpStatus = 404;
        throw err;
      }
      if (job.status !== "pending" || job.serverId != null) {
        const err = new Error("not_pending");
        (err as Error & { httpStatus?: number; code?: string }).httpStatus = 409;
        (err as Error & { httpStatus?: number; code?: string }).code = "not_pending";
        throw err;
      }
      const activeCount = await countActiveJobsForServer(serverId);
      if (activeCount >= MAX_ACTIVE_JOBS_PER_SERVER) {
        const err = new Error("active_job_cap") as Error & {
          httpStatus?: number;
          code?: string;
          activeJobCount?: number;
          maxActiveJobs?: number;
        };
        err.httpStatus = 409;
        err.code = "active_job_cap";
        err.activeJobCount = activeCount;
        err.maxActiveJobs = MAX_ACTIVE_JOBS_PER_SERVER;
        throw err;
      }
      const now = new Date();
      const [next] = await tx
        .update(jobsTable)
        .set({
          serverId,
          status: "in_progress",
          // Stamp the moment this server claimed the job. Cleared on
          // release so the next acceptor will get their own claim time.
          assignedAt: now,
          updatedAt: now,
        })
        .where(eq(jobsTable.id, id))
        .returning();
      return next;
    });
    res.json(updated);
  } catch (e) {
    const err = e as Error & {
      httpStatus?: number;
      code?: string;
      activeJobCount?: number;
      maxActiveJobs?: number;
    };
    const status = err.httpStatus ?? 500;
    if (status === 404) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (err.code === "active_job_cap") {
      res.status(409).json({
        error: `You already have ${err.activeJobCount} active jobs. The limit is ${err.maxActiveJobs}.`,
        code: "active_job_cap",
        activeJobCount: err.activeJobCount,
        maxActiveJobs: err.maxActiveJobs,
      });
      return;
    }
    if (err.code === "not_pending") {
      res.status(409).json({
        error: "This job is no longer available.",
        code: "not_pending",
      });
      return;
    }
    req.log.error({ err }, "accept job failed");
    res.status(500).json({ error: "Failed to accept job" });
  }
});

router.post("/jobs/:id/en-route", requireRole("server"), async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (await blockIfTrainingIncomplete(req, res)) return;
  const serverId = await resolveCallingServerId(req, res);
  if (serverId == null) return;

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.serverId !== serverId) {
    res.status(403).json({ error: "Not your job" });
    return;
  }
  if (job.status === "en_route") {
    // Idempotent — return current state without re-stamping enRouteAt.
    res.json(job);
    return;
  }
  if (
    job.status !== "pending" &&
    job.status !== "assigned" &&
    job.status !== "in_progress"
  ) {
    res.status(409).json({ error: `Cannot mark en route from ${job.status}.` });
    return;
  }

  const [next] = await db
    .update(jobsTable)
    .set({
      status: "en_route",
      enRouteAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(jobsTable.id, id))
    .returning();
  res.json(next);
});

// Servers can't release the same job over and over within this many seconds
// — prevents griefing the queue / requester. Tunable; 60s is enough to
// recover from a fat-finger but blocks ping-ponging.
const RELEASE_COOLDOWN_SECONDS = 60;

router.post("/jobs/:id/release", requireRole("server"), async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = ReleaseJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Reason is required (3–500 chars)." });
    return;
  }
  const serverId = await resolveCallingServerId(req, res);
  if (serverId == null) return;

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.serverId !== serverId) {
    res.status(403).json({ error: "Not your job" });
    return;
  }
  if (
    job.status !== "in_progress" &&
    job.status !== "en_route" &&
    job.status !== "assigned"
  ) {
    res.status(409).json({ error: `Cannot release a ${job.status} job.` });
    return;
  }
  if (
    job.releasedAt &&
    Date.now() - job.releasedAt.getTime() < RELEASE_COOLDOWN_SECONDS * 1000
  ) {
    res.status(429).json({
      error: `Please wait ${RELEASE_COOLDOWN_SECONDS}s before releasing this job again.`,
    });
    return;
  }

  // Update the job and append a release-history row in the same txn so the
  // next server who picks it up (and the requester on the detail page) can
  // see why it came back to the queue. The job row keeps `releaseReason` /
  // `releasedAt` for the most-recent release as a quick-access summary;
  // `job_release_events` holds the full audit trail.
  const next = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(jobsTable)
      .set({
        serverId: null,
        status: "pending",
        releaseReason: parsed.data.reason,
        releasedAt: new Date(),
        // Clear en_route + assigned timestamps so the next acceptor's
        // claim re-stamps them with their own times.
        enRouteAt: null,
        assignedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(jobsTable.id, id))
      .returning();
    await tx.insert(jobReleaseEventsTable).values({
      jobId: id,
      serverId,
      reason: parsed.data.reason,
    });
    return updated;
  });
  res.json(next);
});

router.post("/jobs/:id/dismiss", requireRole("server"), async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const serverId = await resolveCallingServerId(req, res);
  if (serverId == null) return;

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  await db
    .insert(serverDismissedJobsTable)
    .values({ serverId, jobId: id })
    .onConflictDoNothing();
  res.status(204).end();
});

// Shared "mark this job as served" path used by POST /jobs/:id/attempts when
// the outcome is `personal` or `substitute`. Updates the job row, inserts a
// service_attempts row with the corresponding outcome, increments the server's
// completed count, enqueues the payout, and (post-commit) kicks off the Stripe
// transfer. Returns the updated job + the inserted attempt.
//
// Exported so the affidavit-pipeline integration test
// (`src/lib/affidavitPipeline.test.ts`) can drive the same DB-state-machine
// the route uses, without needing to stand up Clerk + HTTP plumbing in tests.
export async function markJobServed(args: {
  jobId: number;
  serverUserId: string;
  myServerId: number;
  outcome:
    | "personal"
    | "substitute"
    | "mail"
    | "posting"
    | "publication"
    | "non_est";
  gpsLat: number;
  gpsLng: number;
  // Provenance of the GPS fix ("gps", "gps_assisted", "network"),
  // captured by the client from the geolocation API's accuracy field.
  gpsProvider?: string;
  // How the server confirmed the recipient's identity at the door.
  // Required by the Mark-Served wizard for personal/substitute outcomes;
  // forwarded from the LogAttemptBody.
  identityMethod?: string;
  identityOtherText?: string;
  notes?: string;
  photoUrl?: string;
  substituteRecipientName?: string;
  substituteOver18?: boolean;
  substituteVerifiedResidence?: boolean;
  substituteRecipientAge?: number;
  substituteIsCoResident?: boolean;
  acknowledgeMailFollowup?: boolean;
  // Nevada-style attempt detail. Optional but forwarded to the
  // affidavit pipeline so the rendered PDF mirrors what the server
  // captured in the Mark-Served wizard.
  serviceAddress?: string;
  serviceCity?: string;
  serviceState?: string;
  serviceZip?: string;
  methodNarrative?: string;
  recipientRelationship?: string;
  recipientDescription?: string;
  // Structured physical-description fields for substitute outcomes —
  // estimated age / gender / height / weight / identifying features.
  // All optional; the affidavit renderer falls back to recipientDescription
  // when these aren't populated.
  recipientAgeEstimate?: string;
  recipientGender?: string;
  recipientHeight?: string;
  recipientWeight?: string;
  recipientIdentifyingFeatures?: string;
  mailingDate?: Date;
  mailingAddress?: string;
  postingLocationDescription?: string;
  postingHasCourtOrder?: boolean;
  // Service-by-Publication (NRS 14.040) and Return-of-Non-Est branches.
  publicationOrderRef?: string;
  publicationNewspaper?: string;
  publicationCounty?: string;
  publicationFirstDate?: Date;
  publicationLastDate?: Date;
  publicationHasCourtOrder?: boolean;
  nonEstSummary?: string;
  // Actual moment of service. Defaults to now if the caller omits it; the
  // stepped Mark-Served wizard always sends an explicit value so the
  // affidavit reflects the real service time, not the confirmation time.
  attemptedAt?: Date;
  // Required when /attempts records a personal/substitute outcome — drives
  // affidavit generation and stamps the signature into jobs.
  signatureTypedName?: string;
  signatureImageUrl?: string;
  log: { info: Function; warn: Function; error: Function };
}): Promise<
  | { ok: true; job: InferSelectModel<typeof jobsTable>; attemptId: number }
  | { ok: false; status: number; error: string }
> {
  const {
    jobId,
    serverUserId,
    myServerId,
    outcome,
    gpsLat,
    gpsLng,
    gpsProvider,
    identityMethod,
    identityOtherText,
    notes,
    photoUrl,
    substituteRecipientName,
    substituteOver18,
    substituteVerifiedResidence,
    substituteRecipientAge,
    substituteIsCoResident,
    acknowledgeMailFollowup,
    serviceAddress,
    serviceCity,
    serviceState,
    serviceZip,
    methodNarrative,
    recipientRelationship,
    recipientDescription,
    recipientAgeEstimate,
    recipientGender,
    recipientHeight,
    recipientWeight,
    recipientIdentifyingFeatures,
    mailingDate,
    mailingAddress,
    postingLocationDescription,
    postingHasCourtOrder,
    publicationOrderRef,
    publicationNewspaper,
    publicationCounty,
    publicationFirstDate,
    publicationLastDate,
    publicationHasCourtOrder,
    nonEstSummary,
    attemptedAt,
    signatureTypedName,
    signatureImageUrl,
    log,
  } = args;

  const ok = await assertServerCanAccept(serverUserId);
  if (!ok.ok) {
    log.warn({ userId: serverUserId, reason: ok.reason }, "Cannot accept (mark served)");
    return { ok: false, status: 403, error: ok.message ?? "Cannot accept" };
  }

  const [existing] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!existing) return { ok: false, status: 404, error: "Job not found" };
  if (existing.serverId !== myServerId) return { ok: false, status: 403, error: "Not your assignment" };
  if (
    existing.status === "served" ||
    existing.status === "failed" ||
    existing.status === "cancelled"
  ) {
    return { ok: false, status: 409, error: `Job already ${existing.status}` };
  }

  const now = new Date();
  // The actual service moment may pre-date confirmation (e.g. the server
  // confirms hours later when back online). Clamp to a sane window: never
  // future, never older than 30 days. `payoutEligibleAt`/`updatedAt` stay
  // anchored to `now` because they describe platform bookkeeping, not the
  // legal moment of service.
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const clampedAttemptedAt: Date = (() => {
    if (!attemptedAt) return now;
    const t = attemptedAt.getTime();
    if (Number.isNaN(t)) return now;
    if (t > now.getTime()) return now;
    if (now.getTime() - t > THIRTY_DAYS_MS) {
      return new Date(now.getTime() - THIRTY_DAYS_MS);
    }
    return attemptedAt;
  })();
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(jobsTable)
      .set({
        status: "served",
        servedAt: clampedAttemptedAt,
        gpsLat,
        gpsLng,
        ...(notes ? { notes } : {}),
        ...(photoUrl ? { proofPhotoUrl: photoUrl } : {}),
        ...(signatureTypedName ? { signatureTypedName } : {}),
        ...(signatureImageUrl ? { signatureImageUrl } : {}),
        // Stamping eligibility inside the same txn that flips status keeps
        // the payout batch processor's scope query trivially correct
        // (`payout_eligible_at IS NOT NULL AND <= NOW()`).
        payoutEligibleAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(jobsTable.id, jobId),
          notInArray(jobsTable.status, ["served", "failed", "cancelled"]),
        ),
      )
      .returning();

    if (!updated) {
      return {
        job: null as InferSelectModel<typeof jobsTable> | null,
        attemptId: 0,
        payoutCreated: false,
      };
    }

    const [attempt] = await tx
      .insert(serviceAttemptsTable)
      .values({
        jobId,
        serverId: myServerId,
        outcome,
        attemptedAt: clampedAttemptedAt,
        gpsLat,
        gpsLng,
        gpsProvider: gpsProvider ?? null,
        identityMethod:
          outcome === "personal" || outcome === "substitute"
            ? identityMethod ?? null
            : null,
        identityOtherText:
          (outcome === "personal" || outcome === "substitute") &&
          identityMethod === "other"
            ? identityOtherText ?? null
            : null,
        notes: notes ?? null,
        photoUrl: photoUrl ?? null,
        substituteRecipientName:
          outcome === "substitute" ? substituteRecipientName ?? null : null,
        substituteOver18:
          outcome === "substitute" ? substituteOver18 ?? null : null,
        substituteVerifiedResidence:
          outcome === "substitute" ? substituteVerifiedResidence ?? null : null,
        substituteRecipientAge:
          outcome === "substitute" ? substituteRecipientAge ?? null : null,
        substituteIsCoResident:
          outcome === "substitute" ? substituteIsCoResident ?? null : null,
        acknowledgeMailFollowup:
          outcome === "substitute" ? acknowledgeMailFollowup ?? null : null,
        serviceAddress: serviceAddress ?? null,
        serviceCity: serviceCity ?? null,
        serviceState: serviceState ?? null,
        serviceZip: serviceZip ?? null,
        methodNarrative: methodNarrative ?? null,
        recipientRelationship:
          outcome === "substitute" ? recipientRelationship ?? null : null,
        recipientDescription:
          outcome === "substitute" ? recipientDescription ?? null : null,
        recipientAgeEstimate:
          outcome === "substitute" ? recipientAgeEstimate ?? null : null,
        recipientGender:
          outcome === "substitute" ? recipientGender ?? null : null,
        recipientHeight:
          outcome === "substitute" ? recipientHeight ?? null : null,
        recipientWeight:
          outcome === "substitute" ? recipientWeight ?? null : null,
        recipientIdentifyingFeatures:
          outcome === "substitute"
            ? recipientIdentifyingFeatures ?? null
            : null,
        mailingDate:
          outcome === "mail" || outcome === "substitute"
            ? mailingDate ?? null
            : null,
        mailingAddress:
          outcome === "mail" || outcome === "substitute"
            ? mailingAddress ?? null
            : null,
        postingLocationDescription:
          outcome === "posting" ? postingLocationDescription ?? null : null,
        postingHasCourtOrder:
          outcome === "posting" ? postingHasCourtOrder ?? null : null,
        publicationOrderRef:
          outcome === "publication" ? publicationOrderRef ?? null : null,
        publicationNewspaper:
          outcome === "publication" ? publicationNewspaper ?? null : null,
        publicationCounty:
          outcome === "publication" ? publicationCounty ?? null : null,
        publicationFirstDate:
          outcome === "publication" ? publicationFirstDate ?? null : null,
        publicationLastDate:
          outcome === "publication" ? publicationLastDate ?? null : null,
        publicationHasCourtOrder:
          outcome === "publication" ? publicationHasCourtOrder ?? null : null,
        nonEstSummary:
          outcome === "non_est" ? nonEstSummary ?? null : null,
      })
      .returning({ id: serviceAttemptsTable.id });

    await tx
      .update(serversTable)
      .set({ jobsCompleted: sql`${serversTable.jobsCompleted} + 1` })
      .where(eq(serversTable.id, myServerId));

    const payoutCreated = await enqueuePayoutForServedJob(updated, tx);
    return { job: updated, attemptId: attempt.id, payoutCreated };
  });

  if (!result.job) return { ok: false, status: 409, error: "Job already finalized" };

  if (result.payoutCreated) {
    log.info(
      { jobId: result.job.id, amountCents: result.job.serverPayoutCents },
      "pending payout enqueued",
    );
    const server = await getServerByUserId(serverUserId);
    if (server?.stripeAccountId && server.payoutsEnabled) {
      await processPayoutTransfer({
        jobId: result.job.id,
        serverUserId,
        amountCents: result.job.serverPayoutCents,
        destinationAccountId: server.stripeAccountId,
      });
    } else {
      log.warn(
        {
          jobId: result.job.id,
          hasAccount: Boolean(server?.stripeAccountId),
          payoutsEnabled: server?.payoutsEnabled ?? false,
        },
        "Skipping Stripe transfer — server has no enabled Connect account",
      );
    }
  }

  return { ok: true, job: result.job, attemptId: result.attemptId };
}

// GET /jobs/:id/releases — full history of times this job was released back
// to the queue. Same access rules as GET /jobs/:id (requester/attorney
// owners, the currently-assigned server, or any server while the job is
// pending so the next acceptor can see prior context).
router.get("/jobs/:id/releases", anyRole, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const userId = req.userId!;
  const role = req.userRole!;

  const [existing] = await db
    .select({
      requesterUserId: jobsTable.requesterUserId,
      serverId: jobsTable.serverId,
      status: jobsTable.status,
    })
    .from(jobsTable)
    .where(eq(jobsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (role === "requester" || role === "attorney") {
    if (existing.requesterUserId !== userId) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
  } else {
    const myServerId = await getServerIdForUser(userId);
    const isAssigned = existing.serverId != null && existing.serverId === myServerId;
    const isOpen = existing.status === "pending";
    if (!isAssigned && !isOpen) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
  }

  const rows = await db
    .select({
      id: jobReleaseEventsTable.id,
      jobId: jobReleaseEventsTable.jobId,
      serverId: jobReleaseEventsTable.serverId,
      reason: jobReleaseEventsTable.reason,
      releasedAt: jobReleaseEventsTable.releasedAt,
      serverName: serversTable.name,
    })
    .from(jobReleaseEventsTable)
    .leftJoin(serversTable, eq(jobReleaseEventsTable.serverId, serversTable.id))
    .where(eq(jobReleaseEventsTable.jobId, id))
    .orderBy(desc(jobReleaseEventsTable.releasedAt));
  res.json(rows);
});

// POST /jobs/:id/pickup — assigned server confirms they collected the
// physical documents. Only valid for documentHandling=pickup jobs. Idempotent:
// repeated calls return the current job without changing pickedUpAt or status.
router.post("/jobs/:id/pickup", requireRole("server"), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  const myServerId = await getServerIdForUser(req.userId!);
  if (myServerId == null) {
    res.status(403).json({ error: "Server profile not found" });
    return;
  }

  const [existing] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (existing.serverId !== myServerId) {
    res.status(403).json({ error: "Not your assignment" });
    return;
  }
  if (
    existing.documentHandling !== "pickup" &&
    existing.documentHandling !== "either"
  ) {
    res.status(400).json({
      error: "This job does not offer document pickup",
    });
    return;
  }
  if (
    existing.status === "served" ||
    existing.status === "failed" ||
    existing.status === "cancelled"
  ) {
    res.status(409).json({ error: `Job already ${existing.status}` });
    return;
  }

  // Idempotent: if already picked up, return current row unchanged.
  // (Belt-and-suspenders — claimPickupAndNotifyRequester also gates on the
  // SQL update so two concurrent POSTs can never both send the email.)
  if (existing.pickedUpAt) {
    res.json(existing);
    return;
  }

  const nextStatus =
    existing.status === "pending" || existing.status === "assigned"
      ? "in_progress"
      : existing.status;

  // Atomic stamp + requester notify in one helper. Email send is gated on
  // the UPDATE returning a row, so a racing second POST sees `claimed: false`
  // and exits without re-sending.
  const result = await claimPickupAndNotifyRequester({
    jobId: id,
    nextStatus,
    log: req.log,
  });

  req.log.info(
    {
      jobId: id,
      serverId: myServerId,
      prevStatus: existing.status,
      nextStatus,
      claimed: result.claimed,
      emailDelivered: result.emailResult?.delivered,
      emailTransport: result.emailResult?.transport,
      emailSkippedNoRecipient: result.emailSkippedNoRecipient ?? false,
      smsDelivered: result.smsResult?.delivered,
      smsTransport: result.smsResult?.transport,
      smsSkippedReason: result.smsSkippedReason ?? null,
    },
    "Documents picked up by server",
  );
  res.json(result.job);
});

// GET /jobs/:id/attempts — anyone with read access to the job can list attempts.
router.get("/jobs/:id/attempts", anyRole, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const userId = req.userId!;
  const role = req.userRole!;

  const [existing] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // Stricter than GET /jobs/:id: pending jobs (status="pending") have no
  // assigned server, and attempt rows can leak GPS / notes / photo paths,
  // so we require *current* ownership for both requester/attorney and
  // server roles. A server who was unassigned mid-flight loses access.
  if (role === "requester" || role === "attorney") {
    if (existing.requesterUserId !== userId) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
  } else {
    const myServerId = await getServerIdForUser(userId);
    const isAssigned = existing.serverId != null && existing.serverId === myServerId;
    if (!isAssigned) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
  }

  const rows = await db
    .select()
    .from(serviceAttemptsTable)
    .where(eq(serviceAttemptsTable.jobId, id))
    .orderBy(desc(serviceAttemptsTable.attemptedAt));
  res.json(rows);
});

// POST /jobs/:id/attempts — server logs an attempt. Outcome is one of
// "personal" | "substitute" | "mail" | "posting" | "unable". The first
// four complete service and delegate to the markJobServed helper; unable
// records the attempt without changing job status.
router.post("/jobs/:id/attempts", requireRole("server"), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const parsed = LogServiceAttemptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }

  if (await blockIfTrainingIncomplete(req, res)) return;

  const myServerId = await getServerIdForUser(req.userId!);
  if (myServerId == null) {
    res.status(403).json({ error: "Server profile not found" });
    return;
  }

  const data = parsed.data;

  // Load the job up-front so we can both authorise and pass its
  // jurisdiction (recipientState) into the state-aware validator. A 404
  // is returned consistently whether the job is missing or the caller
  // doesn't own it (handled further below for the "unable" branch).
  const [jobRow] = await db
    .select({
      id: jobsTable.id,
      status: jobsTable.status,
      serverId: jobsTable.serverId,
      recipientState: jobsTable.recipientState,
    })
    .from(jobsTable)
    .where(eq(jobsTable.id, id));
  if (!jobRow) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // Substitute service has a hard legal requirement (name + over-18 +
  // residence verified) plus state-specific overlays (CA/FL/NY), and
  // "unable to serve" requires a reason. The validation lives in a pure
  // helper so it can be unit-tested without booting Express, the DB, or
  // Clerk.
  const validation = validateAttemptBody(data, jobRow.recipientState);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  // Personal/Substitute/Mail/Posting all complete service — flow through
  // the same markJobServed helper so payout/state changes stay consistent.
  if (
    data.outcome === "personal" ||
    data.outcome === "substitute" ||
    data.outcome === "mail" ||
    data.outcome === "posting" ||
    data.outcome === "publication" ||
    data.outcome === "non_est"
  ) {
    // Signature capture is required for completing service so the affidavit
    // PDF can be generated with the server's printed name + drawn signature.
    const typedName = data.signatureTypedName?.trim() ?? "";
    if (typedName.length < 2) {
      res.status(400).json({ error: "Typed printed name is required to confirm service" });
      return;
    }
    if (!data.signatureImageUrl) {
      res.status(400).json({ error: "Signature image is required to confirm service" });
      return;
    }
    try {
      const result = await markJobServed({
        jobId: id,
        serverUserId: req.userId!,
        myServerId,
        outcome: data.outcome,
        gpsLat: data.gpsLat,
        gpsLng: data.gpsLng,
        gpsProvider: data.gpsProvider,
        identityMethod: data.identityMethod,
        identityOtherText: data.identityOtherText,
        notes: data.notes,
        photoUrl: data.photoUrl,
        substituteRecipientName: data.substituteRecipientName,
        substituteOver18: data.substituteOver18,
        substituteVerifiedResidence: data.substituteVerifiedResidence,
        substituteRecipientAge: data.substituteRecipientAge,
        substituteIsCoResident: data.substituteIsCoResident,
        acknowledgeMailFollowup: data.acknowledgeMailFollowup,
        serviceAddress: data.serviceAddress,
        serviceCity: data.serviceCity,
        serviceState: data.serviceState,
        serviceZip: data.serviceZip,
        methodNarrative: data.methodNarrative,
        recipientRelationship: data.recipientRelationship,
        recipientDescription: data.recipientDescription,
        recipientAgeEstimate: data.recipientAgeEstimate,
        recipientGender: data.recipientGender,
        recipientHeight: data.recipientHeight,
        recipientWeight: data.recipientWeight,
        recipientIdentifyingFeatures: data.recipientIdentifyingFeatures,
        mailingDate: data.mailingDate ? new Date(data.mailingDate) : undefined,
        mailingAddress: data.mailingAddress,
        postingLocationDescription: data.postingLocationDescription,
        postingHasCourtOrder: data.postingHasCourtOrder,
        publicationOrderRef: data.publicationOrderRef,
        publicationNewspaper: data.publicationNewspaper,
        publicationCounty: data.publicationCounty,
        publicationFirstDate: data.publicationFirstDate
          ? new Date(data.publicationFirstDate)
          : undefined,
        publicationLastDate: data.publicationLastDate
          ? new Date(data.publicationLastDate)
          : undefined,
        publicationHasCourtOrder: data.publicationHasCourtOrder,
        nonEstSummary: data.nonEstSummary,
        attemptedAt: data.attemptedAt ? new Date(data.attemptedAt) : undefined,
        signatureTypedName: typedName,
        signatureImageUrl: data.signatureImageUrl,
        log: req.log,
      });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      // Generate the affidavit PDF post-commit. The served-flip is durable
      // above; a render failure here logs and is recoverable via
      // POST /admin/jobs/:id/regenerate-affidavit.
      try {
        await generateAndStoreAffidavit(result.job.id, req.log);
      } catch (err) {
        req.log.error({ err, jobId: result.job.id }, "affidavit generation failed (post-commit)");
      }
      // Notify the requester that service is complete. Atomic claim of
      // service_attempts.notified_at gates the send so a replay (or a
      // concurrent retry from a flaky proxy) can't double-email. Email
      // failures are swallowed by the helper — they must NOT prevent the
      // 201 response, since the served flip and affidavit are already
      // durable.
      try {
        await claimAttemptAndNotifyRequester({
          attemptId: result.attemptId,
          log: req.log,
        });
      } catch (err) {
        req.log.error(
          { err, jobId: result.job.id, attemptId: result.attemptId },
          "served notify failed (post-commit)",
        );
      }
      // Return the freshly-inserted attempt row.
      const [attempt] = await db
        .select()
        .from(serviceAttemptsTable)
        .where(eq(serviceAttemptsTable.id, result.attemptId));
      res.status(201).json(attempt);
      return;
    } catch (err) {
      req.log.error({ err, jobId: id, outcome: data.outcome }, "log completing attempt failed");
      res.status(500).json({ error: "Failed to record attempt" });
      return;
    }
  }

  // outcome === "unable" — does not complete service. Only ownership of the
  // assignment is required; no payout-readiness check (servers can document
  // attempts even before their Stripe account is enabled). Reuse the row
  // we already loaded above for the validator.
  if (jobRow.serverId !== myServerId) {
    res.status(403).json({ error: "Not your assignment" });
    return;
  }
  if (jobRow.status === "served" || jobRow.status === "failed" || jobRow.status === "cancelled") {
    res.status(409).json({ error: `Job already ${jobRow.status}` });
    return;
  }

  const now = new Date();
  try {
    const [attempt] = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(serviceAttemptsTable)
        .values({
          jobId: id,
          serverId: myServerId,
          outcome: data.outcome,
          attemptedAt: now,
          gpsLat: data.gpsLat,
          gpsLng: data.gpsLng,
          gpsProvider: data.gpsProvider ?? null,
          notes: data.notes ?? null,
          photoUrl: data.photoUrl ?? null,
          unableReason: data.unableReason ?? null,
        })
        .returning();

      // Bump status to in_progress on the first unable attempt so the
      // requester sees movement immediately.
      if (jobRow.status === "pending" || jobRow.status === "assigned") {
        await tx
          .update(jobsTable)
          .set({ status: "in_progress", updatedAt: now })
          .where(eq(jobsTable.id, id));
      }
      return [inserted];
    });
    // Notify the requester that an attempt was logged. The pickup email
    // explicitly promised this — keep that promise. Atomic claim on
    // service_attempts.notified_at makes the dispatch exactly-once per
    // attempt id; an in-flight retry that re-enters this branch creates
    // a NEW attempt row (a NEW logical event), which will fire its own
    // single email. Email failures are swallowed by the helper so they
    // can't break the 201 response after the row is durably inserted.
    try {
      await claimAttemptAndNotifyRequester({
        attemptId: attempt.id,
        log: req.log,
      });
    } catch (err) {
      req.log.error(
        { err, jobId: id, attemptId: attempt.id },
        "attempt-logged notify failed (post-commit)",
      );
    }
    res.status(201).json(attempt);
  } catch (err) {
    req.log.error({ err, jobId: id }, "log attempt failed");
    res.status(500).json({ error: "Failed to record attempt" });
  }
});

// POST /jobs/:id/confirm-mailing — server records actual completion of the
// substitute follow-up mailing. The original mark-served flow captures
// `mailingDate` + `mailingAddress` as the server's *commitment*; this
// endpoint stamps `mailingCompletedAt` on the latest substitute attempt
// to prove the commitment was actually fulfilled. Idempotent on
// `mailingCompletedAt`: a second call returns 409 with the existing row,
// so an accidental double-tap (or a redelivered network retry) cannot
// overwrite the original confirmation timestamp.
router.post(
  "/jobs/:id/confirm-mailing",
  requireRole("server"),
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid jobId" });
      return;
    }
    const parsed = ConfirmJobMailingBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
      return;
    }

    const myServerId = await getServerIdForUser(req.userId!);
    if (myServerId == null) {
      res.status(403).json({ error: "Server profile not found" });
      return;
    }

    const [job] = await db
      .select({ id: jobsTable.id, serverId: jobsTable.serverId })
      .from(jobsTable)
      .where(eq(jobsTable.id, id));
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (job.serverId !== myServerId) {
      res.status(403).json({ error: "Not your assignment" });
      return;
    }

    // Latest substitute attempt for this job. We intentionally don't
    // restrict to "the completing attempt" here because in theory a job
    // could have multiple substitute rows over its lifetime; the most
    // recent one is the one whose mailing is now being confirmed.
    const [attempt] = await db
      .select()
      .from(serviceAttemptsTable)
      .where(
        and(
          eq(serviceAttemptsTable.jobId, id),
          eq(serviceAttemptsTable.outcome, "substitute"),
        ),
      )
      .orderBy(desc(serviceAttemptsTable.attemptedAt))
      .limit(1);
    if (!attempt) {
      res.status(400).json({ error: "Job has no substitute attempt to confirm mailing for" });
      return;
    }
    if (!attempt.mailingDate || !attempt.mailingAddress) {
      res
        .status(400)
        .json({ error: "Substitute attempt has no committed follow-up mailing" });
      return;
    }
    if (attempt.mailingCompletedAt) {
      // Already-confirmed branch. Two sub-cases:
      //  (a) caller is uploading a receipt photo for the first time —
      //      we accept it (the original confirmation may have happened
      //      without a receipt on hand). Fills `mailingProofPhotoUrl`
      //      atomically only when still null, so a concurrent attach
      //      can't race in two competing photos.
      //  (b) anything else is treated as the existing idempotent path
      //      and surfaces the already-confirmed row with 409.
      const incomingPhoto = parsed.data.proofPhotoUrl?.trim();
      if (incomingPhoto && !attempt.mailingProofPhotoUrl) {
        const [attached] = await db
          .update(serviceAttemptsTable)
          .set({ mailingProofPhotoUrl: incomingPhoto })
          .where(
            and(
              eq(serviceAttemptsTable.id, attempt.id),
              sql`${serviceAttemptsTable.mailingProofPhotoUrl} IS NULL`,
            ),
          )
          .returning();
        if (attached) {
          req.log.info(
            { jobId: id, attemptId: attempt.id },
            "mailing receipt photo attached post-confirmation",
          );
          res.status(200).json(attached);
          return;
        }
        // Lost the race — fall through to surface the current row.
        const [current] = await db
          .select()
          .from(serviceAttemptsTable)
          .where(eq(serviceAttemptsTable.id, attempt.id));
        res.status(409).json(current);
        return;
      }
      res.status(409).json(attempt);
      return;
    }

    const completedAt = parsed.data.completedAt
      ? new Date(parsed.data.completedAt)
      : new Date();
    const proofPhotoUrl = parsed.data.proofPhotoUrl ?? null;

    // Atomic claim — the WHERE filter on `mailingCompletedAt IS NULL`
    // makes a concurrent second request a no-op (returning [] instead
    // of the updated row), at which point we re-read and return 409.
    const [updated] = await db
      .update(serviceAttemptsTable)
      .set({
        mailingCompletedAt: completedAt,
        mailingProofPhotoUrl: proofPhotoUrl,
        mailingConfirmedByUserId: req.userId!,
      })
      .where(
        and(
          eq(serviceAttemptsTable.id, attempt.id),
          sql`${serviceAttemptsTable.mailingCompletedAt} IS NULL`,
        ),
      )
      .returning();

    if (!updated) {
      const [current] = await db
        .select()
        .from(serviceAttemptsTable)
        .where(eq(serviceAttemptsTable.id, attempt.id));
      res.status(409).json(current);
      return;
    }

    req.log.info(
      { jobId: id, attemptId: attempt.id, completedAt },
      "substitute follow-up mailing confirmed",
    );
    res.status(200).json(updated);
  },
);

// POST /jobs/:id/ensure-affidavit — idempotent self-heal. The "served" flow
// already triggers generateAndStoreAffidavit() post-commit, but a transient
// PDF/storage hiccup back then could leave a served job with a missing
// proofPdfUrl. Rather than make the requester wait for an admin to call
// /admin/jobs/:id/regenerate-affidavit, this lets any party already authorized
// to view the affidavit (the requester, the assigned server, an admin) trigger
// the same generator on demand. If the PDF already exists, we return its path
// unchanged (no overwrite — the regenerate behavior remains admin-only).
router.post("/jobs/:id/ensure-affidavit", anyRole, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const userId = req.userId!;

  // First pass — cheap read for authz + the common "already there" branch.
  // We deliberately don't take a row lock here so the typical case (PDF
  // already on file, just return the path) doesn't pay for a transaction.
  const [job] = await db
    .select({
      id: jobsTable.id,
      status: jobsTable.status,
      proofPdfUrl: jobsTable.proofPdfUrl,
      signatureTypedName: jobsTable.signatureTypedName,
      requesterUserId: jobsTable.requesterUserId,
      serverUserId: serversTable.userId,
    })
    .from(jobsTable)
    .leftJoin(serversTable, eq(jobsTable.serverId, serversTable.id))
    .where(eq(jobsTable.id, id))
    .limit(1);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // Authz: requester (job owner), assigned server, or admin only.
  const allowed =
    isAdminUser(userId) ||
    job.requesterUserId === userId ||
    job.serverUserId === userId;
  if (!allowed) {
    res.status(403).json({ error: "Not authorized for this job" });
    return;
  }

  if (job.proofPdfUrl) {
    res.status(200).json({ proofPdfUrl: job.proofPdfUrl, alreadyExisted: true });
    return;
  }

  if (job.status !== "served") {
    res.status(412).json({ error: "Affidavit is only available after service is completed" });
    return;
  }

  if (!job.signatureTypedName) {
    res.status(422).json({
      error:
        "This job was completed before signature capture was required, so an affidavit cannot be generated. Please contact support to file a manual affidavit.",
    });
    return;
  }

  // Concurrency note: the cheap pre-check above (`if (job.proofPdfUrl)`) is
  // the primary idempotency guard and handles the common case (page refresh
  // after a previous successful generation). Two near-simultaneous *first-
  // time* callers can still race past it and both invoke
  // generateAndStoreAffidavit, producing two functionally-identical PDFs
  // (same job row, same signature image, same date) with last-write-wins on
  // jobs.proof_pdf_url. The sole observable consequence is one orphan blob
  // in object storage. We deliberately do NOT take a SELECT FOR UPDATE here:
  // generateAndStoreAffidavit owns its own DB connection from the pool and
  // would deadlock against an outer row lock. A stronger guarantee would
  // require either (a) refactoring generateAndStoreAffidavit to accept a tx
  // (touches admin regenerate + the post-commit hook + tests) or (b) a
  // sentinel-claim pattern with cleanup-on-failure. Both are overkill for an
  // MVP self-heal endpoint whose race outcome is benign.
  const result = await generateAndStoreAffidavit(id, req.log);
  if (!result.ok || !result.proofPdfUrl) {
    // 422 = persisted attempt is missing legally-required fields (see the
    // completeness gate in generateAndStoreAffidavit). Anything else is
    // treated as a transient render/storage failure (500). The status hint
    // is set by the generator; default to 500 for back-compat.
    const status = result.status ?? 500;
    if (status === 422) {
      req.log.warn({ jobId: id, err: result.error }, "ensure-affidavit blocked by completeness gate");
    } else {
      req.log.error({ jobId: id, err: result.error }, "ensure-affidavit failed");
    }
    res.status(status).json({ error: result.error ?? "Failed to generate affidavit" });
    return;
  }
  res.status(200).json({ proofPdfUrl: result.proofPdfUrl, alreadyExisted: false });
});

// POST /jobs/:id/ensure-notice-of-mail — companion self-heal for the NRCP
// 4.2 Notice of Service by Mail. The notice is generated alongside the
// affidavit during the served-flip, but its upload failure is treated as
// non-fatal there (so the affidavit always lands). This endpoint is the
// targeted recovery: it never re-renders the affidavit and is safe to
// call on jobs that don't qualify (returns notApplicable=true).
router.post(
  "/jobs/:id/ensure-notice-of-mail",
  anyRole,
  async (req: Request, res: Response) => {
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
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const allowed =
      isAdminUser(userId) ||
      job.requesterUserId === userId ||
      job.serverUserId === userId;
    if (!allowed) {
      res.status(403).json({ error: "Not authorized for this job" });
      return;
    }

    const result = await generateAndStoreNoticeOfMail(id, req.log);
    if (!result.ok) {
      const status = result.status ?? 500;
      if (status >= 500) {
        req.log.error(
          { jobId: id, err: result.error },
          "ensure-notice-of-mail failed",
        );
      } else {
        req.log.warn(
          { jobId: id, err: result.error },
          "ensure-notice-of-mail rejected",
        );
      }
      res.status(status).json({ error: result.error ?? "Failed to generate notice" });
      return;
    }
    res.status(200).json({
      noticeOfMailPdfUrl: result.noticeOfMailPdfUrl ?? null,
      alreadyExisted: result.alreadyExisted ?? false,
      notApplicable: result.notApplicable ?? false,
    });
  },
);

// POST /jobs/:id/backfill-attempt-identity — server-only targeted self-heal
// for the affidavit completeness gate. The mark-served wizard requires
// `identityMethod` for personal/substitute outcomes, but a row may end up
// with NULL on prod (e.g. an older code path, a client that dropped the
// field on the wire, or a row that predates the rule). Without it, the
// affidavit pipeline rejects render with 422 and there is otherwise no
// in-app way to repair the row short of a manual SQL update.
//
// Write-once semantics: the WHERE clause filters on `identityMethod IS NULL`
// so a redelivered POST after success is a no-op (returns 409 with the
// existing value). Authorized only for the assigned server — the affidavit
// is sworn under their declaration and only they have first-hand knowledge
// of how identity was confirmed at the door.
router.post(
  "/jobs/:id/backfill-attempt-identity",
  requireRole("server"),
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid jobId" });
      return;
    }
    const body = (req.body ?? {}) as {
      identityMethod?: unknown;
      identityOtherText?: unknown;
    };
    const method = typeof body.identityMethod === "string" ? body.identityMethod : "";
    const ALLOWED = new Set(["verbal", "photo_match", "known", "other"]);
    if (!ALLOWED.has(method)) {
      res.status(400).json({
        error: "identityMethod must be one of: verbal, photo_match, known, other",
      });
      return;
    }
    const otherText =
      typeof body.identityOtherText === "string"
        ? body.identityOtherText.trim()
        : "";
    if (method === "other" && otherText.length < 2) {
      res.status(400).json({
        error: "identityOtherText is required (>=2 chars) when identityMethod is 'other'",
      });
      return;
    }

    const myServerId = await getServerIdForUser(req.userId!);
    if (myServerId == null) {
      res.status(403).json({ error: "Server profile not found" });
      return;
    }

    const [job] = await db
      .select({ id: jobsTable.id, serverId: jobsTable.serverId })
      .from(jobsTable)
      .where(eq(jobsTable.id, id))
      .limit(1);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (job.serverId !== myServerId) {
      res.status(403).json({ error: "Not your assignment" });
      return;
    }

    // Latest personal/substitute attempt — those are the outcomes whose
    // affidavit completeness gate enforces identity confirmation.
    const [attempt] = await db
      .select({
        id: serviceAttemptsTable.id,
        identityMethod: serviceAttemptsTable.identityMethod,
      })
      .from(serviceAttemptsTable)
      .where(
        and(
          eq(serviceAttemptsTable.jobId, id),
          inArray(serviceAttemptsTable.outcome, ["personal", "substitute"]),
        ),
      )
      .orderBy(desc(serviceAttemptsTable.attemptedAt))
      .limit(1);
    if (!attempt) {
      res
        .status(404)
        .json({ error: "Job has no personal/substitute attempt to backfill" });
      return;
    }
    if (attempt.identityMethod) {
      res.status(409).json({
        error: "Identity confirmation already recorded on this attempt",
      });
      return;
    }

    const [updated] = await db
      .update(serviceAttemptsTable)
      .set({
        identityMethod: method,
        identityOtherText: method === "other" ? otherText : null,
      })
      .where(
        and(
          eq(serviceAttemptsTable.id, attempt.id),
          sql`${serviceAttemptsTable.identityMethod} IS NULL`,
        ),
      )
      .returning({ id: serviceAttemptsTable.id });
    if (!updated) {
      // Lost the race against a concurrent backfill — surface idempotent 409.
      res.status(409).json({
        error: "Identity confirmation already recorded on this attempt",
      });
      return;
    }
    req.log.info(
      { jobId: id, attemptId: attempt.id, identityMethod: method },
      "attempt identity backfilled",
    );
    res.status(200).json({ ok: true });
  },
);

export default router;
