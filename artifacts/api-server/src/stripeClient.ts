import Stripe from 'stripe';

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error('X-Replit-Token not found for repl/depl');
  }

  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  const targetEnvironment = isProduction ? 'production' : 'development';

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', 'stripe');
  url.searchParams.set('environment', targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X-Replit-Token': xReplitToken,
    },
    signal: AbortSignal.timeout(10_000),
  });

  const data = (await response.json()) as {
    items?: Array<{ settings?: { secret?: string; publishable?: string } }>;
  };
  const settings = data.items?.[0]?.settings;

  if (!settings?.secret || !settings?.publishable) {
    throw new Error(`Stripe ${targetEnvironment} connection not found. Connect Stripe via Integrations tab.`);
  }

  return {
    publishableKey: settings.publishable as string,
    secretKey: settings.secret as string,
  };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey, { apiVersion: '2025-08-27.basil' as any });
}

export async function getStripePublishableKey(): Promise<string> {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

// Module-scoped cache for the Connect webhook signing secret. Set during
// startup (`initStripe` in `index.ts`) once we've reconciled the
// endpoint with Stripe via `lib/connectWebhook.ts`. Connect webhooks
// live entirely outside `stripe-replit-sync`'s managed-webhook system
// (see `lib/connectWebhook.ts` for why), so we own caching here too.
let cachedConnectWebhookSecret: string | null = null;

export function setStripeConnectWebhookSecret(secret: string): void {
  cachedConnectWebhookSecret = secret;
}

/**
 * Return the cached Connect-webhook signing secret. Throws if `initStripe`
 * hasn't primed the cache yet — Connect deliveries that arrive before the
 * webhook is registered would fail signature verification anyway.
 */
export function getStripeConnectWebhookSecret(): string {
  if (!cachedConnectWebhookSecret) {
    throw new Error(
      'Stripe Connect webhook secret is not initialized — has initStripe run successfully?',
    );
  }
  return cachedConnectWebhookSecret;
}

export async function getStripeSync() {
  const { StripeSync } = await import('stripe-replit-sync');
  const { secretKey } = await getCredentials();
  return new StripeSync({
    poolConfig: { connectionString: process.env.DATABASE_URL!, max: 2 },
    stripeSecretKey: secretKey,
  });
}
