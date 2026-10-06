import { Router, type IRouter } from 'express';
import { eq, and, inArray } from 'drizzle-orm';
import {
  db,
  subscriptionsTable,
  vaultSubscriptionsTable,
  serverCredentialsTable,
  serversTable,
  usersTable,
  jobsTable,
  jobServedDocumentsTable,
  type Subscription,
  type VaultSubscription,
} from '@workspace/db';
import { VAULT_PLANS, type ProServeTier, type VaultTier } from '@workspace/pricing';
import { getUncachableStripeClient, getStripePublishableKey } from '../stripeClient';
import { requireAuth, requireRole } from '../middlewares/auth';
import {
  getOrCreateCredentialingPrice,
  getOrCreateProServePrice,
  getOrCreateVaultPrice,
  getOrCreateStripeCustomerForUser,
  isProServeTier,
  isVaultTier,
} from '../lib/stripeProducts';
import { getServerByUserId } from '../lib/marketplace';
import { appBaseUrl } from '../lib/appBaseUrl';

// Authenticated Stripe endpoints additionally require a chosen role —
// no checkout or product browsing before the user finishes onboarding.
const anyRole = requireRole("requester", "attorney", "server");

const router: IRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the user's row, ensuring the FK target for subscription writes exists. */
async function loadUser(userId: string) {
  const [row] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return row;
}

function isActiveStatus(status: string | null | undefined): boolean {
  return status === 'active' || status === 'trialing' || status === 'past_due';
}

// ── Public / general Stripe endpoints (existing) ──────────────────────────────

// Get publishable key for Stripe.js on the frontend — public so the
// unauthenticated marketing/pricing pages can initialize Stripe.js.
router.get('/stripe/config', async (_req, res) => {
  try {
    const publishableKey = await getStripePublishableKey();
    res.json({ publishableKey });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List active products with prices (for the job pricing UI) — auth-only so
// we don't expose our Stripe catalog to crawlers / arbitrary callers.
router.get('/stripe/products', requireAuth, anyRole, async (_req, res) => {
  try {
    const stripe = await getUncachableStripeClient();
    const products = await stripe.products.list({ active: true, limit: 20 });
    const prices = await stripe.prices.list({ active: true, limit: 50 });

    const enriched = products.data
      .map((p) => ({
        ...p,
        prices: prices.data.filter((pr) => pr.product === p.id),
      }))
      .filter((p) => p.prices.length > 0);

    res.json({ data: enriched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create a Stripe Checkout session for a one-time job payment — auth-only.
//
// `jobId` is the row in `jobsTable` that the requester just created with
// status=`pending_payment`. We stamp it on BOTH the session metadata AND
// the payment_intent metadata so the webhook handler can flip the row to
// `pending` regardless of which event arrives first.
router.post('/stripe/checkout', requireAuth, anyRole, async (req, res) => {
  try {
    const { priceId, jobTitle, recipientName, email, jobId } = req.body as {
      priceId: string;
      jobTitle?: string;
      recipientName?: string;
      email?: string;
      jobId?: number | string;
    };

    if (!priceId) {
      return res.status(400).json({ error: 'priceId is required' });
    }

    const stripe = await getUncachableStripeClient();
    const baseUrl = appBaseUrl(req);
    const jobIdStr =
      typeof jobId === 'number' || typeof jobId === 'string' ? String(jobId) : '';

    // Ownership + state guard: when a jobId is supplied, ensure the row exists,
    // belongs to the calling user, and is still awaiting payment. This blocks a
    // signed-in user from paying for (and thereby publishing) somebody else's job.
    if (jobIdStr) {
      const numericJobId = Number(jobIdStr);
      if (!Number.isInteger(numericJobId) || numericJobId <= 0) {
        return res.status(400).json({ error: 'Invalid jobId' });
      }
      const [job] = await db
        .select({
          id: jobsTable.id,
          status: jobsTable.status,
          requesterUserId: jobsTable.requesterUserId,
        })
        .from(jobsTable)
        .where(eq(jobsTable.id, numericJobId))
        .limit(1);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }
      if (job.requesterUserId !== req.userId) {
        return res.status(403).json({ error: 'Not your job' });
      }
      if (job.status !== 'pending_payment') {
        return res
          .status(409)
          .json({ error: 'Job is not awaiting payment', status: job.status });
      }
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'payment',
      customer_email: email ?? undefined,
      // Enable Stripe-hosted promo code field so marketing offers like
      // "first serve on us for new firm pro signups" work end-to-end.
      // Server payouts are funded via separate `transfers.create` calls
      // from the platform balance (see lib/marketplace.ts), so a 100%-off
      // discount does NOT short-pay the server — the platform absorbs it.
      allow_promotion_codes: true,
      metadata: {
        jobTitle: jobTitle ?? '',
        recipientName: recipientName ?? '',
        ...(jobIdStr ? { servedKind: 'job', jobId: jobIdStr } : {}),
      },
      ...(jobIdStr
        ? {
            payment_intent_data: {
              metadata: { servedKind: 'job', jobId: jobIdStr },
            },
          }
        : {}),
      // Route is `/app/requester/jobs` (see App.tsx). Earlier copy used
      // `/my-jobs` which 404s after a successful checkout — bug surfaced
      // by the first end-to-end coupon test.
      success_url: `${baseUrl}/app/requester/jobs?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/app/requester/post-job?payment=cancelled`,
    });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Attorney draft-jobs batch checkout ───────────────────────────────────────
// Pay for one or many `draft` jobs in a single Stripe Checkout session. Each
// included job becomes its own line item priced ad hoc from the snapshot
// `grossCents` we recorded at job-create time, so a price change between
// "save draft" and "pay" doesn't move the goalposts. The webhook handler
// flips every listed job from `draft` → `pending` on completion.
router.post(
  '/stripe/draft-jobs/checkout',
  requireAuth,
  requireRole('attorney'),
  async (req, res) => {
    try {
      const body = req.body as { jobIds?: unknown; queueId?: unknown };
      if (!Array.isArray(body.jobIds) || body.jobIds.length === 0) {
        return res
          .status(400)
          .json({ error: 'jobIds must be a non-empty array' });
      }
      if (body.jobIds.length > 50) {
        return res
          .status(400)
          .json({ error: 'At most 50 draft jobs per checkout' });
      }
      const jobIds: number[] = [];
      for (const raw of body.jobIds) {
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) {
          return res.status(400).json({ error: 'Invalid jobId in list' });
        }
        jobIds.push(n);
      }
      // Optional — passed by the multi-batch flow so the webhook can
      // advance the persisted resume queue once Stripe confirms payment.
      let queueId: number | null = null;
      if (body.queueId !== undefined && body.queueId !== null) {
        const n = Number(body.queueId);
        if (!Number.isInteger(n) || n <= 0) {
          return res.status(400).json({ error: 'Invalid queueId' });
        }
        queueId = n;
      }
      const userId = req.userId!;

      const jobs = await db
        .select({
          id: jobsTable.id,
          status: jobsTable.status,
          requesterUserId: jobsTable.requesterUserId,
          grossCents: jobsTable.grossCents,
          serviceType: jobsTable.serviceType,
          recipientName: jobsTable.recipientName,
          recipientState: jobsTable.recipientState,
          requesterName: jobsTable.requesterName,
          requesterEmail: jobsTable.requesterEmail,
          courtName: jobsTable.courtName,
          petitioner: jobsTable.petitioner,
          respondent: jobsTable.respondent,
          platformRef: jobsTable.platformRef,
          documentHandling: jobsTable.documentHandling,
          pickupAddress: jobsTable.pickupAddress,
          pickupCity: jobsTable.pickupCity,
          pickupState: jobsTable.pickupState,
          pickupZip: jobsTable.pickupZip,
          pickupContactName: jobsTable.pickupContactName,
          pickupContactPhone: jobsTable.pickupContactPhone,
        })
        .from(jobsTable)
        .where(
          and(
            inArray(jobsTable.id, jobIds),
            eq(jobsTable.requesterUserId, userId),
          ),
        );

      if (jobs.length !== jobIds.length) {
        return res.status(404).json({
          error: 'One or more jobs not found or not yours',
        });
      }
      const notDraft = jobs.find((j) => j.status !== 'draft');
      if (notDraft) {
        return res.status(409).json({
          error: 'All jobs must be in draft status',
          offendingJobId: notDraft.id,
          status: notDraft.status,
        });
      }
      const missingPrice = jobs.find(
        (j) => j.grossCents == null || j.grossCents <= 0,
      );
      if (missingPrice) {
        return res.status(400).json({
          error: 'Draft job is missing a snapshot price',
          offendingJobId: missingPrice.id,
        });
      }

      // Publish-time gate. Drafts get a one-time pass through this same
      // checkpoint when they're paid for: the gate that POST /jobs
      // skipped (because initialStatus=draft) must run here, otherwise
      // an attorney could pay for a draft missing requester contact or
      // documents-served and have it land in `pending` un-validated.
      // Mirror the routes/jobs.ts rules exactly so client + server
      // stay in lockstep.
      const incompleteJobs: Array<{ id: number; missing: string[] }> = [];
      for (const j of jobs) {
        const docRows = await db
          .select({
            title: jobServedDocumentsTable.title,
            documentType: jobServedDocumentsTable.documentType,
          })
          .from(jobServedDocumentsTable)
          .where(eq(jobServedDocumentsTable.jobId, j.id));
        const missingForJob: string[] = [];
        if (!j.requesterName?.trim()) missingForJob.push('requesterName');
        if (!j.requesterEmail?.trim()) missingForJob.push('requesterEmail');
        const docOk = docRows.some((d) => {
          const type = d.documentType?.trim();
          if (!type) return false;
          if (type === 'Other') {
            const title = d.title?.trim();
            return Boolean(title) && title.toLowerCase() !== 'other';
          }
          return true;
        });
        if (!docOk) missingForJob.push('documentsServed');
        const isNevada =
          typeof j.recipientState === 'string' &&
          j.recipientState.trim().toUpperCase() === 'NV';
        if (isNevada) {
          if (!j.courtName?.trim()) missingForJob.push('courtName');
          if (!j.petitioner?.trim()) missingForJob.push('petitioner');
          if (!j.respondent?.trim()) missingForJob.push('respondent');
        }
        // Pickup gate — when the saved draft says the server picks up
        // (or the firm offered "either"), the firm address + contact
        // must be on file before we flip the job to pending.
        if (
          j.documentHandling === 'pickup' ||
          j.documentHandling === 'either'
        ) {
          if (!j.pickupAddress?.trim()) missingForJob.push('pickupAddress');
          if (!j.pickupCity?.trim()) missingForJob.push('pickupCity');
          if (!j.pickupState?.trim()) missingForJob.push('pickupState');
          if (!j.pickupZip?.trim()) missingForJob.push('pickupZip');
          if (!j.pickupContactName?.trim())
            missingForJob.push('pickupContactName');
          if (!j.pickupContactPhone?.trim())
            missingForJob.push('pickupContactPhone');
        }
        if (missingForJob.length > 0) {
          incompleteJobs.push({ id: j.id, missing: missingForJob });
        }
      }
      if (incompleteJobs.length > 0) {
        return res.status(400).json({
          error:
            'One or more drafts are missing fields required to publish. Open the draft to complete it before paying.',
          incompleteJobs,
        });
      }

      const stripe = await getUncachableStripeClient();
      const baseUrl = appBaseUrl(req);
      const totalCents = jobs.reduce((sum, j) => sum + (j.grossCents ?? 0), 0);

      const lineItems = jobs.map((j) => ({
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: j.grossCents!,
          product_data: {
            name: `Serve #${j.platformRef} — ${j.recipientName ?? 'recipient'}`,
            metadata: { jobId: String(j.id) },
          },
        },
      }));

      const jobIdsCsv = jobs.map((j) => j.id).join(',');
      // Stripe metadata values are capped at 500 chars. With 50 jobs and
      // 10-digit ids worst case is ~549 chars, so guard explicitly. The
      // attorney can split into smaller batches to stay under the cap.
      if (jobIdsCsv.length > 500) {
        return res.status(400).json({
          error:
            'Too many draft jobs in one batch — please split into smaller batches',
        });
      }

      // Include the resume-queue id in metadata so the webhook can
      // increment the persisted `paidCount` once Stripe confirms the
      // session — that's how the resume banner advances on its own.
      const metadata: Record<string, string> = {
        servedKind: 'job_drafts',
        jobIds: jobIdsCsv,
      };
      if (queueId) metadata.draftQueueId = String(queueId);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: lineItems,
        // Same reasoning as the single-job checkout above: server payouts
        // are decoupled from the customer charge, so promo codes are safe
        // for marketing campaigns ("first batch on us", "20% off launch").
        allow_promotion_codes: true,
        metadata,
        payment_intent_data: {
          metadata,
        },
        success_url: `${baseUrl}/app/attorney/jobs?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/app/attorney/jobs?payment=cancelled`,
      });

      if (!session.url) {
        return res
          .status(500)
          .json({ error: 'Stripe did not return a checkout url' });
      }
      return res.json({
        url: session.url,
        sessionId: session.id,
        totalCents,
      });
    } catch (err: any) {
      req.log.error({ err }, 'draft-jobs checkout failed');
      return res.status(500).json({ error: err.message });
    }
  },
);

// ── Subscription checkout: ProServe (attorney) ────────────────────────────────

router.post(
  '/stripe/proserve-checkout',
  requireAuth,
  requireRole('attorney'),
  async (req, res) => {
    const tier = req.body?.tier as unknown;
    if (!isProServeTier(tier)) {
      res.status(400).json({ error: 'Invalid tier' });
      return;
    }

    const user = await loadUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const newPriceId = await getOrCreateProServePrice(tier);

    // Active sub? Switch in place via Stripe subscription update.
    const [existing] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, user.id))
      .limit(1);

    if (
      existing &&
      isActiveStatus(existing.status) &&
      existing.stripeSubscriptionId
    ) {
      const sub = await stripe.subscriptions.retrieve(existing.stripeSubscriptionId);
      const itemId = sub.items.data[0]?.id;
      if (!itemId) {
        res.status(500).json({ error: 'Existing subscription has no items' });
        return;
      }
      const updated = await stripe.subscriptions.update(
        existing.stripeSubscriptionId,
        {
          items: [{ id: itemId, price: newPriceId }],
          proration_behavior: 'create_prorations',
          metadata: {
            servedUserId: user.id,
            servedKind: 'proserve',
            servedTier: tier,
          },
        },
      );

      // Mirror locally immediately for snappy UX; webhook will reconcile.
      await db
        .update(subscriptionsTable)
        .set({
          tier,
          status: updated.status,
          stripePriceId: newPriceId,
          updatedAt: new Date(),
        })
        .where(eq(subscriptionsTable.id, existing.id));

      req.log.info(
        { userId: user.id, tier, subId: existing.stripeSubscriptionId },
        'ProServe tier switched in place',
      );
      res.json({ mode: 'switched', tier });
      return;
    }

    // No active sub → hosted checkout.
    const customerId = await getOrCreateStripeCustomerForUser({
      userId: user.id,
      email: user.email,
      name:
        [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    });

    const baseUrl = appBaseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: newPriceId, quantity: 1 }],
      metadata: {
        servedUserId: user.id,
        servedKind: 'proserve',
        servedTier: tier,
      },
      subscription_data: {
        metadata: {
          servedUserId: user.id,
          servedKind: 'proserve',
          servedTier: tier,
        },
      },
      success_url: `${baseUrl}/app/attorney/subscription?subscribed=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/app/attorney/subscription?subscribed=0`,
    });

    req.log.info(
      { userId: user.id, tier, sessionId: session.id },
      'ProServe checkout session created',
    );
    res.json({ mode: 'checkout', url: session.url });
  },
);

// ── Subscription checkout: Personal Vault (requester) ─────────────────────────

router.post(
  '/stripe/vault-checkout',
  requireAuth,
  requireRole('requester'),
  async (req, res) => {
    const tier = req.body?.tier as unknown;
    if (!isVaultTier(tier)) {
      res.status(400).json({ error: 'Invalid tier' });
      return;
    }

    const user = await loadUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const newPriceId = await getOrCreateVaultPrice(tier);

    const [existing] = await db
      .select()
      .from(vaultSubscriptionsTable)
      .where(eq(vaultSubscriptionsTable.userId, user.id))
      .limit(1);

    if (
      existing &&
      isActiveStatus(existing.status) &&
      existing.stripeSubscriptionId
    ) {
      const sub = await stripe.subscriptions.retrieve(existing.stripeSubscriptionId);
      const itemId = sub.items.data[0]?.id;
      if (!itemId) {
        res.status(500).json({ error: 'Existing subscription has no items' });
        return;
      }
      const updated = await stripe.subscriptions.update(
        existing.stripeSubscriptionId,
        {
          items: [{ id: itemId, price: newPriceId }],
          proration_behavior: 'create_prorations',
          metadata: {
            servedUserId: user.id,
            servedKind: 'vault',
            servedTier: tier,
          },
        },
      );

      await db
        .update(vaultSubscriptionsTable)
        .set({
          tier,
          status: updated.status,
          storageGb: VAULT_PLANS[tier].storageGb,
          stripePriceId: newPriceId,
          updatedAt: new Date(),
        })
        .where(eq(vaultSubscriptionsTable.id, existing.id));

      req.log.info(
        { userId: user.id, tier, subId: existing.stripeSubscriptionId },
        'Vault tier switched in place',
      );
      res.json({ mode: 'switched', tier });
      return;
    }

    const customerId = await getOrCreateStripeCustomerForUser({
      userId: user.id,
      email: user.email,
      name:
        [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    });

    const baseUrl = appBaseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: newPriceId, quantity: 1 }],
      metadata: {
        servedUserId: user.id,
        servedKind: 'vault',
        servedTier: tier,
      },
      subscription_data: {
        metadata: {
          servedUserId: user.id,
          servedKind: 'vault',
          servedTier: tier,
        },
      },
      success_url: `${baseUrl}/app/requester/vault?subscribed=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/app/requester/vault?subscribed=0`,
    });

    req.log.info(
      { userId: user.id, tier, sessionId: session.id },
      'Vault checkout session created',
    );
    res.json({ mode: 'checkout', url: session.url });
  },
);

// ── Billing portal ────────────────────────────────────────────────────────────

router.post('/stripe/portal-session', requireAuth, anyRole, async (req, res) => {
  const userId = req.userId!;

  const [proRow] = await db
    .select({ stripeCustomerId: subscriptionsTable.stripeCustomerId })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .limit(1);
  const [vaultRow] = await db
    .select({ stripeCustomerId: vaultSubscriptionsTable.stripeCustomerId })
    .from(vaultSubscriptionsTable)
    .where(eq(vaultSubscriptionsTable.userId, userId))
    .limit(1);

  const customerId =
    proRow?.stripeCustomerId ?? vaultRow?.stripeCustomerId ?? null;

  if (!customerId) {
    res.status(404).json({
      error: 'No billing account',
      message: 'Subscribe to a plan first to access the billing portal.',
    });
    return;
  }

  const stripe = await getUncachableStripeClient();
  const baseUrl = appBaseUrl(req);
  const returnPath = proRow?.stripeCustomerId
    ? '/app/attorney/subscription'
    : '/app/requester/vault';
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl}${returnPath}`,
  });

  req.log.info({ userId, customerId }, 'Stripe billing portal session created');
  res.json({ url: session.url });
});

// ── Server credentialing checkout ($24.99 background-check fee) ──────────────

router.post(
  '/stripe/credentialing-checkout',
  requireAuth,
  requireRole('server'),
  async (req, res) => {
    const user = await loadUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Block re-purchase if the server is already paid up. Only `unpaid` /
    // missing rows are eligible for a new checkout.
    const [existing] = await db
      .select({ status: serverCredentialsTable.status })
      .from(serverCredentialsTable)
      .where(eq(serverCredentialsTable.userId, user.id))
      .limit(1);
    if (
      existing &&
      existing.status !== 'unpaid'
    ) {
      res.status(409).json({
        error: 'Already initiated',
        status: existing.status,
        message:
          existing.status === 'verified'
            ? 'You are already verified.'
            : 'A background check is already in progress.',
      });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const priceId = await getOrCreateCredentialingPrice();
    const customerId = await getOrCreateStripeCustomerForUser({
      userId: user.id,
      email: user.email,
      name:
        [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    });

    const baseUrl = appBaseUrl(req);
    // Pre-create or reset the credentialing row to `unpaid` so the
    // status endpoint immediately reflects "checkout in progress" — the
    // webhook will flip it to `pending` after Stripe confirms the charge.
    await db
      .insert(serverCredentialsTable)
      .values({ userId: user.id, status: 'unpaid' })
      .onConflictDoUpdate({
        target: serverCredentialsTable.userId,
        set: { status: 'unpaid', updatedAt: new Date() },
      });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Both metadata blobs (session + payment_intent) so either webhook
      // event surface can identify the user without an extra Stripe lookup.
      metadata: {
        servedUserId: user.id,
        servedKind: 'credentialing',
      },
      payment_intent_data: {
        metadata: {
          servedUserId: user.id,
          servedKind: 'credentialing',
        },
      },
      success_url: `${baseUrl}/app/server/credentialing?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/app/server/credentialing?paid=0`,
    });

    req.log.info(
      { userId: user.id, sessionId: session.id },
      'Credentialing checkout session created',
    );
    res.json({ url: session.url, sessionId: session.id });
  },
);

// ── Stripe Connect Express onboarding (server payouts) ───────────────────────

/**
 * Create (or reuse) the server's Stripe Connect Express account, then
 * return a fresh AccountLink URL for the hosted onboarding flow. The
 * server returns to /app/server/dashboard?connect=return on success or
 * ?connect=refresh if the link expires mid-flow.
 */
router.post(
  '/stripe/connect/onboard',
  requireAuth,
  requireRole('server'),
  async (req, res) => {
    const userId = req.userId!;
    const user = await loadUser(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const server = await getServerByUserId(userId);
    if (!server) {
      res.status(404).json({
        error: 'Server profile not found',
        message: 'Create a server profile before connecting payouts.',
      });
      return;
    }

    const stripe = await getUncachableStripeClient();
    let accountId = server.stripeAccountId;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email ?? undefined,
        country: 'US',
        capabilities: {
          transfers: { requested: true },
        },
        business_type: 'individual',
        // Default every new server to weekly automatic payouts (Friday
        // anchor). Servers can still hit "Pay Now" on the wallet page to
        // trigger an off-schedule standard payout (~2 biz days). The
        // platform's own monthly payout cadence is configured separately
        // on the platform Stripe account dashboard.
        settings: {
          payouts: {
            schedule: { interval: 'weekly', weekly_anchor: 'friday' },
          },
        },
        metadata: { servedUserId: userId, servedServerId: String(server.id) },
      });
      accountId = account.id;
      await db
        .update(serversTable)
        .set({ stripeAccountId: accountId })
        .where(eq(serversTable.id, server.id));
      req.log.info(
        { userId, serverId: server.id, accountId },
        'Created Stripe Connect Express account',
      );
    }

    const baseUrl = appBaseUrl(req);
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${baseUrl}/app/server/dashboard?connect=refresh`,
      return_url: `${baseUrl}/app/server/dashboard?connect=return`,
    });
    res.json({ url: link.url, accountId });
  },
);

/**
 * Re-fetch the connected account from Stripe and mirror the
 * `payouts_enabled` / `charges_enabled` flags onto the local server row.
 * Called after the server returns from hosted onboarding so the UI can
 * un-gate accept-job actions without waiting for a webhook.
 */
router.post(
  '/stripe/connect/refresh',
  requireAuth,
  requireRole('server'),
  async (req, res) => {
    const userId = req.userId!;
    const server = await getServerByUserId(userId);
    if (!server || !server.stripeAccountId) {
      res
        .status(404)
        .json({ error: 'No Stripe Connect account', payoutsEnabled: false });
      return;
    }
    const stripe = await getUncachableStripeClient();
    const account = await stripe.accounts.retrieve(server.stripeAccountId);
    const payoutsEnabled = Boolean(
      account.payouts_enabled && account.charges_enabled,
    );
    await db
      .update(serversTable)
      .set({ payoutsEnabled })
      .where(eq(serversTable.id, server.id));

    // Backfill: migrate accounts that predate the weekly-default rollout
    // (Stripe Connect Express defaults new accounts to `daily` with a
    // 2-business-day delay) to weekly/Friday. We intentionally only touch
    // accounts still on the `daily` default — if a server has explicitly
    // chosen `monthly` or a different `weekly` anchor in their Stripe
    // Express dashboard, we respect that choice and never silently revert
    // it. We also gate on payoutsEnabled because Stripe rejects schedule
    // updates on accounts that haven't completed onboarding.
    if (payoutsEnabled) {
      const currentInterval = account.settings?.payouts?.schedule?.interval;
      if (currentInterval === 'daily') {
        try {
          await stripe.accounts.update(server.stripeAccountId, {
            settings: {
              payouts: {
                schedule: { interval: 'weekly', weekly_anchor: 'friday' },
              },
            },
          });
          req.log.info(
            { userId, serverId: server.id },
            'Migrated Connect account from daily default to weekly/Friday payout schedule',
          );
        } catch (err) {
          req.log.warn(
            { err, userId, serverId: server.id },
            'Could not update Connect payout schedule; leaving as-is',
          );
        }
      }
    }

    req.log.info(
      { userId, serverId: server.id, payoutsEnabled },
      'Connect status refreshed',
    );
    res.json({
      payoutsEnabled,
      stripeAccountId: server.stripeAccountId,
      detailsSubmitted: Boolean(account.details_submitted),
      requirementsCount: account.requirements?.currently_due?.length ?? 0,
    });
  },
);

/**
 * Mint a one-time login link to the server's Stripe Express dashboard so
 * they can see payout history, edit bank info, etc. Useful for the wallet
 * page CTA.
 */
router.post(
  '/stripe/connect/dashboard-login',
  requireAuth,
  requireRole('server'),
  async (req, res) => {
    const server = await getServerByUserId(req.userId!);
    if (!server || !server.stripeAccountId) {
      res.status(404).json({ error: 'No Stripe Connect account' });
      return;
    }
    const stripe = await getUncachableStripeClient();
    const link = await stripe.accounts.createLoginLink(server.stripeAccountId);
    res.json({ url: link.url });
  },
);

// Eliminate unused-import warnings for the type-only re-imports above.
export type { Subscription, VaultSubscription };

export default router;
