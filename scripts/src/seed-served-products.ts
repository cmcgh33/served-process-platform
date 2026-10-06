/**
 * Seed SERVED. service products into Stripe.
 * Run: pnpm --filter @workspace/scripts exec tsx src/seed-served-products.ts
 *
 * Idempotent — safe to run multiple times.
 */
import Stripe from 'stripe';

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;
  if (!hostname || !xReplitToken) throw new Error('Missing Replit env vars — run inside the Replit workspace.');
  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', 'stripe');
  url.searchParams.set('environment', 'development');
  const resp = await fetch(url.toString(), { headers: { Accept: 'application/json', 'X-Replit-Token': xReplitToken } });
  const data = (await resp.json()) as { items?: Array<{ settings?: { secret?: string } }> };
  const secret = data.items?.[0]?.settings?.secret;
  if (!secret) throw new Error('Stripe secret key not found — ensure Stripe integration is connected.');
  return secret as string;
}

const TIERS = [
  {
    name: 'Standard Process Serving',
    description: 'Standard service in 3–5 business days. GPS-tracked, licensed server, digital affidavit included.',
    amount: 7500,
    metadata: { tier: 'standard', days: '3-5', urgency: 'standard' },
  },
  {
    name: 'Rush Process Serving',
    description: 'Rush service in 24–48 hours. Priority dispatch, GPS-tracked, licensed server, digital affidavit.',
    amount: 9500,
    metadata: { tier: 'rush', days: '1-2', urgency: 'rush' },
  },
  {
    name: 'Same Day Process Serving',
    description: 'Same-day service within hours. Immediate dispatch, licensed server, real-time GPS tracking.',
    amount: 15000,
    metadata: { tier: 'same_day', days: '0', urgency: 'same_day' },
  },
];

async function seed() {
  const secretKey = await getCredentials();
  const stripe = new Stripe(secretKey, { apiVersion: '2025-08-27.basil' as any });

  for (const tier of TIERS) {
    const existing = await stripe.products.search({ query: `name:'${tier.name}' AND active:'true'` });
    if (existing.data.length > 0) {
      console.log(`✓ Already exists: ${tier.name} (${existing.data[0].id})`);
      const prices = await stripe.prices.list({ product: existing.data[0].id, active: true });
      prices.data.forEach((p) => console.log(`  Price: $${(p.unit_amount! / 100).toFixed(2)} → ${p.id}`));
      continue;
    }

    const product = await stripe.products.create({ name: tier.name, description: tier.description, metadata: tier.metadata });
    console.log(`✓ Created product: ${product.name} (${product.id})`);

    const price = await stripe.prices.create({ product: product.id, unit_amount: tier.amount, currency: 'usd' });
    console.log(`  Price: $${(tier.amount / 100).toFixed(2)} → ${price.id}`);
  }

  console.log('\n✅ SERVED. products seeded successfully!');
}

seed().catch((e) => { console.error(e.message); process.exit(1); });
