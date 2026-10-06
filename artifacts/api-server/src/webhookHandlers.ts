import type Stripe from 'stripe';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  db,
  subscriptionsTable,
  vaultSubscriptionsTable,
  serverCredentialsTable,
  serversTable,
  paymentsTable,
  jobsTable,
  payoutsTable,
  draftCheckoutQueuesTable,
  type InsertSubscription,
  type InsertVaultSubscription,
} from '@workspace/db';
import { SERVER_CREDENTIALING_CENTS, VAULT_PLANS } from '@workspace/pricing';
import { submitCheck } from '@workspace/integrations-certn';
import {
  getStripeSync,
  getStripeConnectWebhookSecret,
  getUncachableStripeClient,
} from './stripeClient';
import { logger } from './lib/logger';
import { isProServeTier, isVaultTier, parseLookupKey } from './lib/stripeProducts';

type ServedKind = 'proserve' | 'vault';

interface ServedMeta {
  servedUserId?: string;
  servedKind?: ServedKind | string;
  servedTier?: string;
  jobId?: string;
  jobIds?: string;
  draftQueueId?: string;
}

function readMeta(meta: Stripe.Metadata | null | undefined): ServedMeta {
  if (!meta) return {};
  return {
    servedUserId: meta.servedUserId,
    servedKind: meta.servedKind,
    servedTier: meta.servedTier,
    jobId: meta.jobId,
    jobIds: meta.jobIds,
    draftQueueId: meta.draftQueueId,
  };
}

/** Map Stripe subscription status onto the limited set we persist. */
function normalizeStatus(s: Stripe.Subscription.Status | string): string {
  // Our schema enum: active | past_due | canceled | incomplete
  switch (s) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return 'incomplete';
  }
}

function periodEndOf(sub: Stripe.Subscription): Date | null {
  // The Stripe Node SDK exposes `current_period_end` on each subscription
  // item in newer API versions; we check both shapes for safety.
  const subAny = sub as unknown as { current_period_end?: number };
  const top = subAny.current_period_end;
  if (typeof top === 'number') return new Date(top * 1000);
  const itemEnd = sub.items?.data?.[0]
    ? (sub.items.data[0] as unknown as { current_period_end?: number }).current_period_end
    : undefined;
  if (typeof itemEnd === 'number') return new Date(itemEnd * 1000);
  return null;
}

/** Transaction handle compatible with both top-level `db` and inside `db.transaction(...)`. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function upsertProServe(
  tx: Tx,
  args: {
    userId: string;
    tier: string;
    status: string;
    stripeSubscriptionId: string | null;
    stripeCustomerId: string | null;
    stripePriceId: string | null;
    currentPeriodEnd: Date | null;
  },
): Promise<void> {
  const values: InsertSubscription = {
    userId: args.userId,
    tier: args.tier,
    status: args.status,
    stripeSubscriptionId: args.stripeSubscriptionId,
    stripeCustomerId: args.stripeCustomerId,
    stripePriceId: args.stripePriceId,
    currentPeriodEnd: args.currentPeriodEnd,
  };
  await tx
    .insert(subscriptionsTable)
    .values(values)
    .onConflictDoUpdate({
      target: subscriptionsTable.userId,
      set: {
        tier: values.tier,
        status: values.status,
        stripeSubscriptionId: values.stripeSubscriptionId,
        stripeCustomerId: values.stripeCustomerId,
        stripePriceId: values.stripePriceId,
        currentPeriodEnd: values.currentPeriodEnd,
        updatedAt: new Date(),
      },
    });
}

async function upsertVault(
  tx: Tx,
  args: {
    userId: string;
    tier: string;
    status: string;
    storageGb: number;
    stripeSubscriptionId: string | null;
    stripeCustomerId: string | null;
    stripePriceId: string | null;
    currentPeriodEnd: Date | null;
  },
): Promise<void> {
  const values: InsertVaultSubscription = {
    userId: args.userId,
    tier: args.tier,
    status: args.status,
    storageGb: args.storageGb,
    stripeSubscriptionId: args.stripeSubscriptionId,
    stripeCustomerId: args.stripeCustomerId,
    stripePriceId: args.stripePriceId,
    currentPeriodEnd: args.currentPeriodEnd,
  };
  await tx
    .insert(vaultSubscriptionsTable)
    .values(values)
    .onConflictDoUpdate({
      target: vaultSubscriptionsTable.userId,
      set: {
        tier: values.tier,
        status: values.status,
        storageGb: values.storageGb,
        stripeSubscriptionId: values.stripeSubscriptionId,
        stripeCustomerId: values.stripeCustomerId,
        stripePriceId: values.stripePriceId,
        currentPeriodEnd: values.currentPeriodEnd,
        updatedAt: new Date(),
      },
    });
}

/**
 * Look up the existing locally-stored Stripe subscription id for (userId, kind),
 * so we can guard against stale `subscription.updated`/`deleted` events
 * regressing a newer subscription. Returns `null` if no row yet.
 */
async function existingSubId(
  tx: Tx,
  userId: string,
  kind: ServedKind,
): Promise<string | null> {
  if (kind === 'proserve') {
    const rows = await tx
      .select({ subId: subscriptionsTable.stripeSubscriptionId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);
    return rows[0]?.subId ?? null;
  }
  const rows = await tx
    .select({ subId: vaultSubscriptionsTable.stripeSubscriptionId })
    .from(vaultSubscriptionsTable)
    .where(eq(vaultSubscriptionsTable.userId, userId))
    .limit(1);
  return rows[0]?.subId ?? null;
}

/**
 * Apply a Stripe Subscription to our local tables based on its metadata.
 *
 * Stale-event protection (Stripe makes no ordering guarantees):
 * - For events that target a specific existing subscription (`updated`,
 *   `deleted`), the incoming `sub.id` MUST match the locally stored one;
 *   otherwise the event is ignored. This stops a delayed delete for an old
 *   `sub_A` from clobbering a fresh `sub_B`.
 * - For "user-initiated" events (`checkout.session.completed`,
 *   `customer.subscription.created`) callers pass `allowReplace: true`, but
 *   we still verify monotonicity: when the incoming `sub.id` differs from the
 *   stored one, we fetch the stored sub from Stripe and only allow replacement
 *   if the incoming sub's `created` timestamp is at least as recent. This
 *   prevents a delayed `created`/`checkout.completed` for an old `sub_A` from
 *   overwriting a newer active `sub_B`.
 */
async function syncSubscription(
  sub: Stripe.Subscription,
  opts: { allowReplace?: boolean } = {},
): Promise<void> {
  const meta = readMeta(sub.metadata);
  if (!meta.servedUserId) {
    logger.warn(
      { subId: sub.id },
      'Subscription event missing servedUserId metadata — skipping local sync',
    );
    return;
  }
  const userId = meta.servedUserId;

  // Source of truth for kind+tier is the active price's lookup_key, NOT
  // metadata. Stripe Billing Portal plan changes do not rewrite our
  // servedTier metadata, so trusting metadata would leave the local row on
  // the old tier. Fall back to metadata only when the lookup_key is missing
  // or unrecognized (e.g. legacy subs created before lookup_keys existed).
  const priceObj = sub.items.data[0]?.price ?? null;
  const lookupKey = priceObj?.lookup_key ?? null;
  const parsed = parseLookupKey(lookupKey);

  let kind: ServedKind;
  let tier: string;
  if (parsed && parsed.kind !== 'credentialing') {
    kind = parsed.kind;
    tier = parsed.tier;
  } else if (
    parsed?.kind === 'credentialing'
  ) {
    // Credentialing is a one-time payment, not a subscription. If we ever
    // get a subscription with a credentialing lookup_key something is very
    // wrong upstream — log loudly and skip.
    logger.warn(
      { subId: sub.id },
      'Subscription event with credentialing lookup_key — skipping local sync',
    );
    return;
  } else if (
    (meta.servedKind === 'proserve' || meta.servedKind === 'vault') &&
    meta.servedTier
  ) {
    kind = meta.servedKind;
    tier = meta.servedTier;
    logger.warn(
      { subId: sub.id, lookupKey, metaKind: kind, metaTier: tier },
      'Falling back to metadata for kind/tier (price lookup_key missing or unrecognized)',
    );
  } else {
    logger.warn(
      { subId: sub.id, lookupKey, metaKind: meta.servedKind, metaTier: meta.servedTier },
      'Cannot determine subscription kind/tier from price or metadata — skipping local sync',
    );
    return;
  }

  // Serialize the read-check + write per (userId, kind) inside a transaction
  // so two concurrent webhook deliveries cannot both pass the freshness check
  // and then race on the upsert. Advisory lock key is a stable hash of
  // `${userId}:${kind}` so different users / kinds remain parallelizable.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${kind}`}))`,
    );

    const existing = await existingSubId(tx, userId, kind);
    if (existing && existing !== sub.id) {
      if (!opts.allowReplace) {
        logger.warn(
          { userId, kind, eventSubId: sub.id, storedSubId: existing },
          'Ignoring stale subscription event (id does not match current row, allowReplace=false)',
        );
        return;
      }
      // allowReplace path: verify monotonicity. Compare Stripe-side `created`
      // timestamps; only replace if incoming is STRICTLY newer (equal seconds
      // are treated as stale to avoid second-resolution tie-breaker bugs).
      try {
        const stripe = await getUncachableStripeClient();
        const existingSub = await stripe.subscriptions.retrieve(existing);
        if (sub.created <= existingSub.created) {
          logger.warn(
            {
              userId,
              kind,
              eventSubId: sub.id,
              eventSubCreated: sub.created,
              storedSubId: existing,
              storedSubCreated: existingSub.created,
            },
            'Ignoring stale create/checkout event (incoming sub not strictly newer than stored)',
          );
          return;
        }
      } catch (err) {
        const stripeErr = err as { statusCode?: number; code?: string };
        if (stripeErr.statusCode === 404) {
          // Stored sub was deleted from Stripe — replacement is safe.
          logger.info(
            { userId, kind, storedSubId: existing },
            'Stored subscription not found in Stripe; allowing replacement',
          );
        } else {
          // Unexpected error — be conservative and skip rather than risk
          // overwriting a newer active row with potentially-stale data.
          // The mirrored event in `stripe.events` can be replayed once the
          // underlying Stripe issue resolves.
          logger.error(
            { err, userId, kind, storedSubId: existing },
            'Failed to verify existing sub freshness; skipping replacement',
          );
          return;
        }
      }
    }

    const status = normalizeStatus(sub.status);
    const priceId = sub.items.data[0]?.price?.id ?? null;
    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
    const periodEnd = periodEndOf(sub);

    if (kind === 'proserve' && isProServeTier(tier)) {
      await upsertProServe(tx, {
        userId,
        tier,
        status,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: customerId,
        stripePriceId: priceId,
        currentPeriodEnd: periodEnd,
      });
      logger.info({ userId, tier, status, subId: sub.id }, 'ProServe subscription synced');
    } else if (kind === 'vault' && isVaultTier(tier)) {
      await upsertVault(tx, {
        userId,
        tier,
        status,
        storageGb: VAULT_PLANS[tier].storageGb,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: customerId,
        stripePriceId: priceId,
        currentPeriodEnd: periodEnd,
      });
      logger.info({ userId, tier, status, subId: sub.id }, 'Vault subscription synced');
    } else {
      logger.warn({ kind, tier }, 'Unknown servedKind/servedTier combination — skipping');
    }
  });
}

async function handleCheckoutCompleted(
  event: Stripe.CheckoutSessionCompletedEvent,
): Promise<void> {
  const session = event.data.object;
  const meta = readMeta(session.metadata);

  // Credentialing checkout (one-time payment, not a subscription).
  if (session.mode === 'payment' && meta.servedKind === 'credentialing') {
    await handleCredentialingCheckout(session);
    return;
  }

  // One-time job-payment checkout (requester paid for a serve). The job row
  // was created with status=`pending_payment` BEFORE checkout; we now flip
  // it to `pending` so it appears in the server marketplace feed.
  if (session.mode === 'payment' && meta.servedKind === 'job' && meta.jobId) {
    await handleJobCheckoutCompleted(session, meta.jobId);
    return;
  }

  // Attorney batch draft-jobs checkout. metadata.jobIds is a comma-separated
  // list of job ids that were created with status=`draft`. Flip every one
  // that's still in draft to `pending` so they appear in the marketplace.
  if (
    session.mode === 'payment' &&
    meta.servedKind === 'job_drafts' &&
    typeof meta.jobIds === 'string' &&
    meta.jobIds.length > 0
  ) {
    await handleDraftJobsCheckoutCompleted(
      session,
      meta.jobIds,
      meta.draftQueueId,
    );
    return;
  }

  // Subscription-mode checkouts feed our sub tables; one-time job payments
  // use a different flow and are mirrored via stripe-replit-sync.
  if (session.mode !== 'subscription' || !session.subscription) return;

  const stripe = await getUncachableStripeClient();
  const subId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription.id;
  const sub = await stripe.subscriptions.retrieve(subId);
  // Checkout completion is an explicit user action — always wins, even over an
  // older active row whose `subscription.deleted` may not have arrived yet.
  await syncSubscription(sub, { allowReplace: true });
}

/**
 * Server background-check checkout completion. Idempotent on
 * (servedUserId, paymentIntentId) so duplicate webhook deliveries never
 * double-submit to Certn or double-insert a payments row.
 *
 * Order of operations:
 *  1. Look up server profile + user metadata for the Certn applicant payload.
 *  2. Inside a txn: upsert credentials row to `pending`, insert payments row
 *     keyed on the unique (stripe_payment_intent_id) index, capture both ids.
 *  3. AFTER the txn commits, fire `submitCheck` (network IO) and write the
 *     resulting checkId back to the credentials row. If submitCheck fails, we
 *     log it and the admin can retry via the manual-verify endpoint.
 */
async function handleCredentialingCheckout(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const meta = readMeta(session.metadata);
  if (!meta.servedUserId) {
    logger.warn(
      { sessionId: session.id },
      'Credentialing checkout missing servedUserId metadata — skipping',
    );
    return;
  }
  const userId = meta.servedUserId;
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
  if (!paymentIntentId) {
    logger.warn(
      { sessionId: session.id, userId },
      'Credentialing checkout missing payment_intent — skipping',
    );
    return;
  }

  // Pull the server row + user row outside the txn so we have what we need
  // for the Certn submission once the txn commits.
  const [server] = await db
    .select()
    .from(serversTable)
    .where(eq(serversTable.userId, userId))
    .limit(1);
  if (!server) {
    logger.warn(
      { userId, sessionId: session.id },
      'Credentialing checkout for user with no server profile — skipping',
    );
    return;
  }
  const [, lastName = '', firstName = server.name] =
    /^(.*?)\s+(\S+)$/.exec(server.name.trim()) ?? [];

  let credentialId: number | null = null;
  await db.transaction(async (tx) => {
    // Advisory lock per-user so two webhook deliveries for the same checkout
    // don't race the upsert + payments insert.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`cred:${userId}`}))`,
    );

    const [credRow] = await tx
      .insert(serverCredentialsTable)
      .values({
        userId,
        status: 'pending',
        stripePaymentIntentId: paymentIntentId,
      })
      .onConflictDoUpdate({
        target: serverCredentialsTable.userId,
        set: {
          // Don't regress a verified row back to pending. If somehow we
          // received a late checkout for an already-verified server, leave
          // them verified.
          status: sql`CASE WHEN ${serverCredentialsTable.status} = 'verified' THEN ${serverCredentialsTable.status} ELSE 'pending' END`,
          stripePaymentIntentId: paymentIntentId,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: serverCredentialsTable.id,
        status: serverCredentialsTable.status,
      });
    credentialId = credRow.id;

    // Idempotent payments insert keyed on the unique stripe_pi index. If the
    // row already exists we just attach our credentialId.
    await tx
      .insert(paymentsTable)
      .values({
        userId,
        kind: 'server_credentialing',
        amountCents: session.amount_total ?? SERVER_CREDENTIALING_CENTS,
        platformFeeCents: session.amount_total ?? SERVER_CREDENTIALING_CENTS,
        serverPayoutCents: 0,
        currency: (session.currency ?? 'usd').toLowerCase(),
        status: 'succeeded',
        stripePaymentIntentId: paymentIntentId,
        serverCredentialId: credentialId,
        description: 'SERVED. server background check',
      })
      .onConflictDoUpdate({
        target: paymentsTable.stripePaymentIntentId,
        set: {
          status: 'succeeded',
          serverCredentialId: credentialId,
          updatedAt: new Date(),
        },
      });
  });

  // Side-effect: submit to Certn (or stub). Failure is logged but doesn't
  // fail the webhook — the admin manual-verify endpoint is the recovery path.
  try {
    const result = await submitCheck({
      applicantRef: `srv_${server.id}`,
      firstName: firstName || server.name,
      lastName,
      email: server.email,
    });
    if (credentialId !== null) {
      await db
        .update(serverCredentialsTable)
        .set({
          backgroundCheckId: result.checkId,
          updatedAt: new Date(),
        })
        .where(eq(serverCredentialsTable.id, credentialId));
    }
    logger.info(
      {
        userId,
        serverId: server.id,
        checkId: result.checkId,
        live: result.live,
      },
      'Certn background check submitted',
    );
  } catch (err) {
    logger.error(
      { err, userId, serverId: server.id },
      'submitCheck to Certn failed; credentials row left at pending',
    );
  }
}

/**
 * Job-payment checkout completion. The requester pre-created the job row
 * in `pending_payment` state; we now flip it to `pending` so the server
 * marketplace feed picks it up.
 *
 * Idempotency: the WHERE clause only matches rows still in `pending_payment`,
 * so duplicate webhook deliveries (or a manual replay) are no-ops. We do not
 * regress jobs that have already been advanced (e.g. cancelled, assigned)
 * past `pending`.
 *
 * Stripe's session.amount_total is mirrored back as `grossCents` in case the
 * locally-cached price drifted from the actual charge — keeps wallet/payout
 * math truthful to what the customer was billed.
 */
async function handleJobCheckoutCompleted(
  session: Stripe.Checkout.Session,
  jobIdRaw: string,
): Promise<void> {
  const jobId = Number.parseInt(jobIdRaw, 10);
  if (!Number.isFinite(jobId)) {
    logger.warn(
      { sessionId: session.id, jobIdRaw },
      'Job checkout completion has non-numeric jobId metadata — skipping',
    );
    return;
  }

  const amountTotal = typeof session.amount_total === 'number'
    ? session.amount_total
    : null;

  const updates: Record<string, unknown> = {
    status: 'pending',
    updatedAt: new Date(),
  };
  if (amountTotal != null && amountTotal > 0) {
    updates.grossCents = amountTotal;
  }

  const result = await db
    .update(jobsTable)
    .set(updates)
    .where(
      sql`${jobsTable.id} = ${jobId} AND ${jobsTable.status} = 'pending_payment'`,
    )
    .returning({ id: jobsTable.id, status: jobsTable.status });

  if (result.length === 0) {
    logger.info(
      { jobId, sessionId: session.id },
      'Job checkout completion — row not in pending_payment state (already advanced or missing); no-op',
    );
    return;
  }

  logger.info(
    { jobId, sessionId: session.id, amountTotal },
    'Job published to marketplace after Stripe payment',
  );
}

/**
 * Attorney "Pay & Post" / batch draft-jobs Checkout completion. Flips every
 * listed job from `draft` → `pending` so it appears in the marketplace.
 * Idempotent: if a webhook is delivered twice, the second update no-ops
 * because the WHERE filter requires `status = 'draft'`.
 */
export async function handleDraftJobsCheckoutCompleted(
  session: Stripe.Checkout.Session,
  jobIdsCsv: string,
  draftQueueIdRaw: string | undefined,
): Promise<void> {
  const jobIds = jobIdsCsv
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (jobIds.length === 0) {
    logger.warn(
      { sessionId: session.id, jobIdsCsv },
      'Draft jobs checkout completion has empty/invalid jobIds metadata — skipping',
    );
    return;
  }

  const result = await db
    .update(jobsTable)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(
      and(inArray(jobsTable.id, jobIds), eq(jobsTable.status, 'draft')),
    )
    .returning({ id: jobsTable.id });

  logger.info(
    {
      sessionId: session.id,
      requestedJobIds: jobIds,
      flippedJobIds: result.map((r) => r.id),
    },
    'Draft jobs published to marketplace after attorney Stripe payment',
  );

  // If this batch belonged to a multi-batch resume queue, advance it.
  // Idempotent: each session id is recorded in `paidSessionIds` so
  // redelivered webhooks don't double-increment, and the WHERE clause
  // `paidCount < array_length(chunks)` keeps us from running off the end.
  const queueId = draftQueueIdRaw
    ? Number.parseInt(draftQueueIdRaw, 10)
    : NaN;
  if (Number.isFinite(queueId) && queueId > 0) {
    await advanceDraftCheckoutQueue(queueId, session.id);
  }
}

async function advanceDraftCheckoutQueue(
  queueId: number,
  sessionId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(draftCheckoutQueuesTable)
      .where(eq(draftCheckoutQueuesTable.id, queueId))
      .for('update')
      .limit(1);
    if (!row) {
      logger.warn(
        { queueId, sessionId },
        'Draft queue not found while advancing — skipping',
      );
      return;
    }
    if (row.paidSessionIds.includes(sessionId)) {
      logger.info(
        { queueId, sessionId },
        'Draft queue already advanced for this session — skipping (idempotent)',
      );
      return;
    }
    if (row.paidCount >= row.chunks.length) {
      // Already complete; just record the session id so we don't re-check.
      await tx
        .update(draftCheckoutQueuesTable)
        .set({
          paidSessionIds: [...row.paidSessionIds, sessionId],
          updatedAt: new Date(),
        })
        .where(eq(draftCheckoutQueuesTable.id, queueId));
      return;
    }
    const newPaidCount = row.paidCount + 1;
    await tx
      .update(draftCheckoutQueuesTable)
      .set({
        paidCount: newPaidCount,
        paidSessionIds: [...row.paidSessionIds, sessionId],
        updatedAt: new Date(),
      })
      .where(eq(draftCheckoutQueuesTable.id, queueId));
    logger.info(
      {
        queueId,
        sessionId,
        paidCount: newPaidCount,
        totalChunks: row.chunks.length,
      },
      'Draft checkout queue advanced',
    );
  });
}

/**
 * Connect `payout.{created,updated,paid}` — when Stripe schedules or
 * completes an automatic Payout from a connected account to the server's
 * bank, refresh the matching `payouts.arrival_date` rows with Stripe's
 * authoritative `arrival_date`. This replaces our best-effort estimate
 * (now + delay_days) with the real bank-arrival date Stripe is using and
 * keeps the wallet in sync if the date shifts (weekends, bank holidays,
 * delays).
 *
 * A single Stripe Payout typically aggregates many balance transactions on
 * the connected account; each BT references a `source` that — for our
 * money flow — is the platform→connect transfer id we already store on
 * the payouts row. We list those BTs to discover which transfers this
 * Payout covers and update every matching row.
 *
 * Status semantics: `processPayoutTransfer` parks rows in `in_transit`
 * once funds reach the connected account's Stripe balance. We promote
 * them to `paid` here only when Stripe confirms the actual bank deposit
 * (`payout.paid`, or any update where `payout.status === 'paid'`). We
 * never downgrade `paid`/`failed` rows. This complements the lazy
 * refresh in `/me/wallet` (`refreshPendingPayoutArrivalDate`) which
 * acts as a backstop if a webhook is missed.
 */
export async function handlePayoutEvent(
  event:
    | Stripe.PayoutCreatedEvent
    | Stripe.PayoutUpdatedEvent
    | Stripe.PayoutPaidEvent,
  /**
   * Optional Stripe client override. Production callers omit this and we
   * fetch the real client lazily; tests inject a fake to exercise the DB
   * state machine without hitting Stripe.
   */
  stripeOverride?: Stripe,
): Promise<void> {
  const payout = event.data.object;
  const connectedAccountId = event.account ?? null;
  // Platform-level payouts (the platform's own bank settlement) carry no
  // `event.account` and have nothing to do with our connect→bank flow.
  if (!connectedAccountId) return;
  if (!payout.id) return;

  const arrivalDate =
    typeof payout.arrival_date === 'number' && payout.arrival_date > 0
      ? new Date(payout.arrival_date * 1000)
      : null;

  // Discover which of OUR transfers this payout aggregates by listing the
  // connected account's balance transactions filtered by this payout id.
  // Each BT's `source` is the platform→connect transfer id we already
  // recorded on the payouts row (we ignore non-transfer sources like
  // refunds/adjustments — they aren't ours).
  const stripe = stripeOverride ?? (await getUncachableStripeClient());
  const transferIds: string[] = [];
  try {
    for await (const bt of stripe.balanceTransactions.list(
      { payout: payout.id, limit: 100 },
      { stripeAccount: connectedAccountId },
    )) {
      const src = bt.source;
      const sourceId = typeof src === 'string' ? src : src?.id ?? null;
      if (sourceId && sourceId.startsWith('tr_')) {
        transferIds.push(sourceId);
      }
    }
  } catch (err) {
    logger.error(
      {
        err,
        payoutId: payout.id,
        accountId: connectedAccountId,
        eventType: event.type,
      },
      'Failed to list balance transactions for payout — skipping refresh',
    );
    return;
  }

  if (transferIds.length === 0) {
    // The payout had no SERVED-originated transfers (could be unrelated
    // top-ups, manual reversals, or simply a payout we didn't fund).
    logger.debug(
      {
        payoutId: payout.id,
        accountId: connectedAccountId,
        eventType: event.type,
      },
      'Payout has no transfer-sourced balance transactions; nothing to update',
    );
    return;
  }

  // Promote to `paid` only on a confirmed bank deposit. Stripe surfaces
  // this via `payout.paid` *and* via `payout.updated` events whose
  // payload's status has flipped to `paid` — handle both. Don't clobber
  // `paid` or `failed` rows.
  const isPaidEvent = event.type === 'payout.paid' || payout.status === 'paid';
  const updateValues: Record<string, unknown> = {
    stripePayoutId: payout.id,
    stripeAccountId: connectedAccountId,
    updatedAt: new Date(),
  };
  if (arrivalDate) updateValues.arrivalDate = arrivalDate;
  if (isPaidEvent) {
    updateValues.status = 'paid';
    // Use COALESCE so re-deliveries of payout.paid don't overwrite the
    // first-confirmed paidAt timestamp.
    updateValues.paidAt = sql`COALESCE(${payoutsTable.paidAt}, ${arrivalDate ?? new Date()})`;
  }

  const whereClause = isPaidEvent
    ? // Don't promote a row that's already terminal (`paid` or `failed`),
      // but for non-paid events we still want to record arrival_date /
      // payout id on every matching row regardless of status.
      and(
        inArray(payoutsTable.stripeTransferId, transferIds),
        inArray(payoutsTable.status, ['pending', 'in_transit']),
      )
    : inArray(payoutsTable.stripeTransferId, transferIds);

  const updated = await db
    .update(payoutsTable)
    .set(updateValues)
    .where(whereClause)
    .returning({ id: payoutsTable.id, jobId: payoutsTable.jobId });

  logger.info(
    {
      eventType: event.type,
      payoutId: payout.id,
      accountId: connectedAccountId,
      arrivalDate,
      promotedToPaid: isPaidEvent,
      transferIdCount: transferIds.length,
      updatedRowCount: updated.length,
    },
    isPaidEvent
      ? 'Promoted payouts to paid from Stripe payout event'
      : 'Refreshed payouts.arrival_date from Stripe payout event',
  );
}

/**
 * Connect `account.updated` — mirror payouts_enabled/charges_enabled onto
 * the local server row so the UI doesn't need a manual /refresh after
 * Stripe finishes verifying the connected account.
 */
async function handleConnectAccountUpdated(
  event: Stripe.AccountUpdatedEvent,
): Promise<void> {
  const account = event.data.object;
  if (!account.id) return;
  const payoutsEnabled = Boolean(
    account.payouts_enabled && account.charges_enabled,
  );
  const res = await db
    .update(serversTable)
    .set({ payoutsEnabled })
    .where(eq(serversTable.stripeAccountId, account.id))
    .returning({ id: serversTable.id });
  if (res.length === 0) {
    logger.info(
      { accountId: account.id },
      'account.updated for unknown Connect account — ignoring',
    );
    return;
  }
  logger.info(
    { accountId: account.id, payoutsEnabled, serverId: res[0].id },
    'Mirrored Connect account.updated to local server row',
  );
}

async function handleSubscriptionCreated(
  event: Stripe.CustomerSubscriptionCreatedEvent,
): Promise<void> {
  // A brand-new Stripe subscription is, by definition, the most current.
  await syncSubscription(event.data.object, { allowReplace: true });
}

async function handleSubscriptionUpdated(
  event: Stripe.CustomerSubscriptionUpdatedEvent,
): Promise<void> {
  // Updates only apply to the row referencing the same sub.id (default guard).
  await syncSubscription(event.data.object);
}

async function handleSubscriptionDeleted(
  event: Stripe.CustomerSubscriptionDeletedEvent,
): Promise<void> {
  const sub = event.data.object;
  const meta = readMeta(sub.metadata);
  // If we have metadata, sync normally (status will be canceled). Default
  // guard prevents a stale delete for an old sub from clobbering a newer one.
  if (meta.servedUserId && meta.servedKind) {
    await syncSubscription(sub);
    return;
  }
  // Fallback: locate the row by stripeSubscriptionId in either table and
  // mark it canceled.
  const updated = new Date();
  const proRes = await db
    .update(subscriptionsTable)
    .set({ status: 'canceled', updatedAt: updated })
    .where(eq(subscriptionsTable.stripeSubscriptionId, sub.id))
    .returning({ id: subscriptionsTable.id });
  if (proRes.length === 0) {
    await db
      .update(vaultSubscriptionsTable)
      .set({ status: 'canceled', updatedAt: updated })
      .where(eq(vaultSubscriptionsTable.stripeSubscriptionId, sub.id));
  }
}

async function handleInvoicePaymentFailed(
  event: Stripe.InvoicePaymentFailedEvent,
): Promise<void> {
  const invoice = event.data.object;
  // The invoice's parent subscription reference shape differs across SDK
  // versions; check both new and legacy fields to be robust.
  const invoiceAny = invoice as unknown as {
    subscription?: string | { id?: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id?: string } | null } } | null;
  };
  const subRef =
    invoiceAny.subscription ??
    invoiceAny.parent?.subscription_details?.subscription ??
    null;
  const subId =
    typeof subRef === 'string' ? subRef : (subRef as { id?: string } | null)?.id ?? null;
  if (!subId) return;

  const updated = new Date();
  const proRes = await db
    .update(subscriptionsTable)
    .set({ status: 'past_due', updatedAt: updated })
    .where(eq(subscriptionsTable.stripeSubscriptionId, subId))
    .returning({ id: subscriptionsTable.id });
  if (proRes.length === 0) {
    await db
      .update(vaultSubscriptionsTable)
      .set({ status: 'past_due', updatedAt: updated })
      .where(eq(vaultSubscriptionsTable.stripeSubscriptionId, subId));
  }
  logger.info({ subId }, 'Marked subscription past_due (invoice.payment_failed)');
}

export class WebhookHandlers {
  /**
   * Verify the Stripe signature (delegated to stripe-replit-sync, which mirrors
   * to the `stripe` schema), then dispatch our own subscription handlers.
   *
   * Idempotency: each handler upserts on the unique `(userId)` index for the
   * appropriate table. Out-of-order events naturally converge to the latest
   * subscription state because every event re-syncs the full Stripe object.
   *
   * Note: this handler is for the PLATFORM managed webhook only. Connect
   * events (`payout.*`, `account.updated`) are delivered to a separate
   * endpoint and dispatched via `processConnectWebhook` below. The
   * `payout.*` / `account.updated` cases are kept in the switch as a
   * defensive belt-and-suspenders for any future config that subscribes
   * the platform endpoint to these events.
   */
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'Payload must be a Buffer. Ensure webhook route is registered BEFORE express.json().',
      );
    }

    // 1. Sync verifies signature + mirrors the event's data into the `stripe`
    //    schema. Throws on bad signature, which surfaces as a 4xx in app.ts.
    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    // 2. Signature verified — now handle our own subscription business logic.
    let event: Stripe.Event;
    try {
      event = JSON.parse(payload.toString('utf8')) as Stripe.Event;
    } catch (err) {
      logger.error({ err }, 'Webhook payload is not valid JSON after signature pass');
      return;
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event);
          break;
        case 'customer.subscription.created':
          await handleSubscriptionCreated(event);
          break;
        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event);
          break;
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event);
          break;
        case 'invoice.payment_failed':
          await handleInvoicePaymentFailed(event);
          break;
        case 'account.updated':
          await handleConnectAccountUpdated(event);
          break;
        case 'payout.created':
        case 'payout.updated':
        case 'payout.paid':
          await handlePayoutEvent(event);
          break;
        default:
          // Many events are mirrored only — no app-level action needed.
          break;
      }
    } catch (err) {
      // Log but do not re-throw — sync.processWebhook already succeeded, so we
      // must return 200 to Stripe to avoid infinite retries on a transient
      // app-level bug. The mirrored event row in the `stripe` schema is the
      // backstop we can replay against once any bug here is fixed.
      logger.error(
        { err, eventType: event.type, eventId: event.id },
        'Subscription webhook handler failed (mirrored event still saved)',
      );
    }
  }

  /**
   * Verify a Stripe Connect webhook delivery (separate signing secret
   * from the platform endpoint) and dispatch to the payout / account
   * handlers. This is the PRIMARY path for keeping wallet rows in sync
   * with real Stripe payout state — the 10-minute poller in
   * `lib/marketplace.ts` is now only a backstop for missed deliveries.
   *
   * Connect events carry an `event.account` (the connected account that
   * generated them); the existing `handlePayoutEvent` /
   * `handleConnectAccountUpdated` already handle that field. We do NOT
   * route Connect events through `stripe-replit-sync` — the sync engine
   * doesn't model `payout.*` or `account.updated` as mirrored entities,
   * so there's nothing for it to upsert.
   *
   * Errors during dispatch are caught and logged so we still return 200
   * to Stripe; otherwise Stripe would retry indefinitely on a transient
   * bug. Signature failures DO bubble up to the route, which returns 400
   * and lets Stripe retry — that's the correct behaviour for an actual
   * verification failure.
   */
  static async processConnectWebhook(
    payload: Buffer,
    signature: string,
  ): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'Payload must be a Buffer. Ensure the connect webhook route is registered BEFORE express.json().',
      );
    }

    const secret = getStripeConnectWebhookSecret();
    const stripe = await getUncachableStripeClient();
    const event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      secret,
    );

    try {
      switch (event.type) {
        case 'payout.created':
        case 'payout.updated':
        case 'payout.paid':
          await handlePayoutEvent(event);
          break;
        case 'account.updated':
          await handleConnectAccountUpdated(event);
          break;
        default:
          // Subscribed events are configured at webhook registration
          // time, so anything else here is a Stripe-side surprise (new
          // event subtype, manual dashboard subscription, etc.). Log
          // and ignore.
          logger.debug(
            { eventType: event.type, eventId: event.id, account: event.account },
            'Unhandled Connect webhook event type — ignoring',
          );
          break;
      }
    } catch (err) {
      logger.error(
        { err, eventType: event.type, eventId: event.id, account: event.account },
        'Connect webhook handler failed',
      );
    }
  }
}
