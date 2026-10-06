import type Stripe from "stripe";
import {
  PROSERVE_MONTHLY_CENTS,
  SERVER_CREDENTIALING_CENTS,
  VAULT_PLANS,
  type ProServeTier,
  type VaultTier,
} from "@workspace/pricing";
import { db, subscriptionsTable, vaultSubscriptionsTable } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { getUncachableStripeClient } from "../stripeClient";
import { logger } from "./logger";

const proServeLookupKey = (tier: ProServeTier) =>
  `served_proserve_${tier}_monthly`;
const vaultLookupKey = (tier: VaultTier) => `served_vault_${tier}_monthly`;

const proServeProductLookup = (tier: ProServeTier) =>
  `served_proserve_${tier}` as const;
const vaultProductLookup = (tier: VaultTier) =>
  `served_vault_${tier}` as const;

const PROSERVE_LABELS: Record<ProServeTier, string> = {
  solo: "ProServe Solo",
  firm: "ProServe Firm",
  firm_pro: "ProServe Firm Pro",
};

const priceCache = new Map<string, string>();

async function findOrCreateProduct(
  stripe: Stripe,
  productName: string,
  metadataKey: string,
): Promise<Stripe.Product> {
  const existing = await stripe.products.search({
    query: `metadata['served_lookup']:'${metadataKey}'`,
    limit: 1,
  });
  if (existing.data[0]) return existing.data[0];

  return stripe.products.create({
    name: productName,
    metadata: { served_lookup: metadataKey },
  });
}

async function findOrCreatePrice(
  stripe: Stripe,
  args: {
    productId: string;
    amountCents: number;
    lookupKey: string;
  },
): Promise<Stripe.Price> {
  const list = await stripe.prices.list({
    lookup_keys: [args.lookupKey],
    active: true,
    limit: 1,
  });
  const found = list.data[0];
  if (found && found.unit_amount === args.amountCents) return found;

  if (found && found.unit_amount !== args.amountCents) {
    await stripe.prices.update(found.id, {
      active: false,
      lookup_key: undefined,
    });
    logger.info(
      { lookupKey: args.lookupKey, oldCents: found.unit_amount, newCents: args.amountCents },
      "Stripe price amount changed — deactivated old price",
    );
  }

  return stripe.prices.create({
    currency: "usd",
    unit_amount: args.amountCents,
    recurring: { interval: "month" },
    product: args.productId,
    lookup_key: args.lookupKey,
    transfer_lookup_key: true,
  });
}

export async function getOrCreateProServePrice(
  tier: ProServeTier,
): Promise<string> {
  const lookupKey = proServeLookupKey(tier);
  const cached = priceCache.get(lookupKey);
  if (cached) return cached;

  const stripe = await getUncachableStripeClient();
  const product = await findOrCreateProduct(
    stripe,
    PROSERVE_LABELS[tier],
    proServeProductLookup(tier),
  );
  const price = await findOrCreatePrice(stripe, {
    productId: product.id,
    amountCents: PROSERVE_MONTHLY_CENTS[tier],
    lookupKey,
  });
  priceCache.set(lookupKey, price.id);
  return price.id;
}

// ── One-time price: server background-check fee ($24.99) ─────────────────────
//
// Lives in the same Stripe catalog as subscriptions but uses a non-recurring
// price so checkout runs in `mode: 'payment'`. Lookup key is recognized by
// `parseLookupKey` (kind = "credentialing") so the webhook handler can route
// `checkout.session.completed` events to credentialing logic.
const CREDENTIALING_LOOKUP_KEY = "served_credentialing_fee";
const CREDENTIALING_PRODUCT_LOOKUP = "served_credentialing";

export async function getOrCreateCredentialingPrice(): Promise<string> {
  const cached = priceCache.get(CREDENTIALING_LOOKUP_KEY);
  if (cached) return cached;

  const stripe = await getUncachableStripeClient();
  const product = await findOrCreateProduct(
    stripe,
    "SERVED. Server Background Check",
    CREDENTIALING_PRODUCT_LOOKUP,
  );

  // findOrCreatePrice assumes recurring — for credentialing we need a flat
  // one-time price, so handle it inline.
  const list = await stripe.prices.list({
    lookup_keys: [CREDENTIALING_LOOKUP_KEY],
    active: true,
    limit: 1,
  });
  const found = list.data[0];
  if (found && found.unit_amount === SERVER_CREDENTIALING_CENTS && !found.recurring) {
    priceCache.set(CREDENTIALING_LOOKUP_KEY, found.id);
    return found.id;
  }
  if (found) {
    await stripe.prices.update(found.id, {
      active: false,
      lookup_key: undefined,
    });
    logger.info(
      { lookupKey: CREDENTIALING_LOOKUP_KEY, oldCents: found.unit_amount },
      "Credentialing price changed shape — deactivated old price",
    );
  }
  const created = await stripe.prices.create({
    currency: "usd",
    unit_amount: SERVER_CREDENTIALING_CENTS,
    product: product.id,
    lookup_key: CREDENTIALING_LOOKUP_KEY,
    transfer_lookup_key: true,
  });
  priceCache.set(CREDENTIALING_LOOKUP_KEY, created.id);
  return created.id;
}

export async function getOrCreateVaultPrice(tier: VaultTier): Promise<string> {
  const lookupKey = vaultLookupKey(tier);
  const cached = priceCache.get(lookupKey);
  if (cached) return cached;

  const stripe = await getUncachableStripeClient();
  const plan = VAULT_PLANS[tier];
  const product = await findOrCreateProduct(
    stripe,
    plan.label,
    vaultProductLookup(tier),
  );
  const price = await findOrCreatePrice(stripe, {
    productId: product.id,
    amountCents: plan.monthlyCents,
    lookupKey,
  });
  priceCache.set(lookupKey, price.id);
  return price.id;
}

export async function getOrCreateStripeCustomerForUser(args: {
  userId: string;
  email: string | null;
  name: string | null;
}): Promise<string> {
  const subRows = await db
    .select({ stripeCustomerId: subscriptionsTable.stripeCustomerId })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.userId, args.userId),
        isNotNull(subscriptionsTable.stripeCustomerId),
      ),
    )
    .limit(1);
  if (subRows[0]?.stripeCustomerId) return subRows[0].stripeCustomerId;

  const vaultRows = await db
    .select({ stripeCustomerId: vaultSubscriptionsTable.stripeCustomerId })
    .from(vaultSubscriptionsTable)
    .where(
      and(
        eq(vaultSubscriptionsTable.userId, args.userId),
        isNotNull(vaultSubscriptionsTable.stripeCustomerId),
      ),
    )
    .limit(1);
  if (vaultRows[0]?.stripeCustomerId) return vaultRows[0].stripeCustomerId;

  const stripe = await getUncachableStripeClient();
  const customer = await stripe.customers.create({
    email: args.email ?? undefined,
    name: args.name ?? undefined,
    metadata: { servedUserId: args.userId },
  });
  return customer.id;
}

export function isProServeTier(value: unknown): value is ProServeTier {
  return value === "solo" || value === "firm" || value === "firm_pro";
}

export function isVaultTier(value: unknown): value is VaultTier {
  return value === "basic" || value === "legal" || value === "pro";
}

export type ParsedLookupKey =
  | { kind: "proserve"; tier: ProServeTier }
  | { kind: "vault"; tier: VaultTier }
  | { kind: "credentialing" };

export function parseLookupKey(
  lookupKey: string | null | undefined,
): ParsedLookupKey | null {
  if (!lookupKey) return null;
  if (lookupKey === CREDENTIALING_LOOKUP_KEY) return { kind: "credentialing" };
  const proMatch = /^served_proserve_(.+)_monthly$/.exec(lookupKey);
  if (proMatch && isProServeTier(proMatch[1])) {
    return { kind: "proserve", tier: proMatch[1] };
  }
  const vaultMatch = /^served_vault_(.+)_monthly$/.exec(lookupKey);
  if (vaultMatch && isVaultTier(vaultMatch[1])) {
    return { kind: "vault", tier: vaultMatch[1] };
  }
  return null;
}
