import app from "./app";
import { logger } from "./lib/logger";
import { startPayoutPoller } from "./lib/marketplace";
import { scheduleJob } from "./lib/scheduler";
import { runLicenseExpiryNotifications } from "./lib/licenseExpiryEmails";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const PAYOUT_CONNECT_EVENTS = [
  "payout.created",
  "payout.updated",
  "payout.paid",
  "account.updated",
] as const;

async function initStripe() {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      logger.warn("DATABASE_URL not set — skipping Stripe sync");
      return;
    }

    const { runMigrations } = await import("stripe-replit-sync");
    await runMigrations({ databaseUrl, logger });
    logger.info("Stripe schema ready");

    const {
      getStripeSync,
      getUncachableStripeClient,
      setStripeConnectWebhookSecret,
    } = await import("./stripeClient");
    const stripeSync = await getStripeSync();

    const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;

    // Platform managed webhook (subscription/customer/invoice events
    // mirrored into the `stripe` schema). Owned by stripe-replit-sync;
    // its `processWebhook` looks up the secret out of `_managed_webhooks`.
    const platformUrl = `${webhookBaseUrl}/api/stripe/webhook`;
    await stripeSync.findOrCreateManagedWebhook(platformUrl);
    logger.info("Stripe platform webhook configured");

    // Connect managed webhook — separate signing secret, subscribed
    // ONLY to the events our Connect handlers care about. This is the
    // real-time path that fires `handlePayoutEvent` /
    // `handleConnectAccountUpdated` within seconds of Stripe scheduling
    // or completing a payout, so wallet "Arrives <date>" labels no
    // longer wait up to 10 minutes for the poller to catch up.
    //
    // Managed entirely outside `stripe-replit-sync` — see
    // `lib/connectWebhook.ts` for why we can't piggy-back on
    // `findOrCreateManagedWebhook` (it would thrash with the platform
    // webhook because its cleanup pass deletes any DB row whose URL
    // doesn't match the URL being created).
    const connectUrl = `${webhookBaseUrl}/api/stripe/webhook/connect`;
    try {
      const { ensureConnectWebhook } = await import("./lib/connectWebhook");
      const stripe = await getUncachableStripeClient();
      const ensured = await ensureConnectWebhook(
        stripe,
        connectUrl,
        PAYOUT_CONNECT_EVENTS,
      );
      setStripeConnectWebhookSecret(ensured.secret);
      logger.info(
        { id: ensured.id, events: ensured.enabledEvents },
        "Stripe Connect webhook configured",
      );
    } catch (err) {
      logger.error(
        { err, url: connectUrl },
        "Stripe Connect webhook setup failed — falling back to 10-minute poller until the next restart",
      );
    }

    stripeSync.syncBackfill()
      .then(() => logger.info("Stripe backfill complete"))
      .catch((err: unknown) => logger.error({ err }, "Stripe backfill error"));
  } catch (err: unknown) {
    logger.error({ err }, "Stripe init failed — payments will be unavailable");
  }
}

// Daily license-expiry notifier. Idempotent via its own dedup table, so the
// boot-time fire + 24h interval can't double-email a server.
scheduleJob({
  name: "license-expiry-notifications",
  intervalMs: 24 * 60 * 60 * 1000,
  run: () => runLicenseExpiryNotifications(),
});

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");

  // Run Stripe initialization in the background so the deployment
  // healthcheck on /api/healthz can pass immediately. Stripe migrations
  // and the managed-webhook API call (now two — platform + Connect) can
  // take many seconds on a cold production boot, which exceeds the
  // deployment's startup window if we await them before .listen().
  // Payment routes degrade gracefully until init completes (initStripe
  // swallows its own errors). Connect-webhook deliveries that arrive
  // before init finishes will fail signature verification and Stripe
  // will retry — that's the correct behaviour.
  initStripe().catch((err: unknown) =>
    logger.error({ err }, "initStripe rejected unexpectedly"),
  );

  // Backstop sweep: the Stripe Connect webhook (`account.updated`,
  // `payout.{created,updated,paid}`) is now the primary path for
  // refreshing `payouts.arrival_date`. This poller stays as a safety
  // net for missed deliveries (Stripe outages, dropped 200s, replays
  // after a webhook misconfiguration). Started after the listener is
  // up so a startup error doesn't fire a sweep against a half-
  // initialized server.
  startPayoutPoller();
  logger.info(
    { intervalMs: 10 * 60 * 1000 },
    "Payout arrival-date poller started (backstop for Connect webhook)",
  );
});
