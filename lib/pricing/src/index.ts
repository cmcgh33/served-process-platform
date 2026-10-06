/**
 * @workspace/pricing — single source of truth for SERVED. money math.
 *
 * Rules:
 *   - All money is stored and computed in CENTS (integer). Never floats.
 *   - Display formatting (cents → "$x.yz") happens at the display layer only.
 *   - The platform takes 20%, the server gets 80%, both rounded so the sum
 *     equals the gross to the cent (server = gross - platform).
 *
 * The Stripe-subscription task (downstream) MUST read prices from this
 * module to build Stripe Products/Prices, so they stay in sync.
 */

// ──────────────────────────────────────────────────────────────────────────
// Tier + service-type literals
// ──────────────────────────────────────────────────────────────────────────

export const PROSERVE_TIERS = ["solo", "firm", "firm_pro"] as const;
export type ProServeTier = (typeof PROSERVE_TIERS)[number];

export const VAULT_TIERS = ["basic", "legal", "pro"] as const;
export type VaultTier = (typeof VAULT_TIERS)[number];

export const SERVICE_TYPES = ["standard", "rush", "licensed"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

/**
 * The tier used for pricing a serve. "public" means no ProServe sub
 * (individual requesters / unsubscribed attorneys). Internal: ProServe tiers.
 */
export const PRICING_TIERS = ["public", ...PROSERVE_TIERS] as const;
export type PricingTier = (typeof PRICING_TIERS)[number];

// ──────────────────────────────────────────────────────────────────────────
// Per-serve price tables (cents)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Per-serve prices in cents. Public rates apply to individual requesters
 * AND attorneys without an active ProServe subscription. Each ProServe tier
 * unlocks a discount.
 *
 * "licensed" service is offered at the public rate to all tiers — it
 * requires a state-licensed server and is not part of the standard
 * marketplace discount structure.
 */
export const SERVE_PRICES_CENTS: Record<PricingTier, Record<ServiceType, number>> = {
  public: {
    standard: 7500,   // $75
    rush: 9500,       // $95
    licensed: 12000,  // $120
  },
  solo: {
    standard: 6500,   // $65
    rush: 8500,       // $85
    licensed: 12000,  // $120 (licensed always public rate)
  },
  firm: {
    standard: 6000,   // $60
    rush: 7900,       // $79
    licensed: 12000,
  },
  firm_pro: {
    standard: 5500,   // $55
    rush: 7200,       // $72
    licensed: 12000,
  },
};

/** Look up a per-serve price in cents. */
export function getServePrice(tier: PricingTier, serviceType: ServiceType): number {
  return SERVE_PRICES_CENTS[tier][serviceType];
}

// ──────────────────────────────────────────────────────────────────────────
// Subscription monthly prices (cents)
// ──────────────────────────────────────────────────────────────────────────

export const PROSERVE_MONTHLY_CENTS: Record<ProServeTier, number> = {
  solo: 9900,       // $99
  firm: 19900,      // $199
  firm_pro: 29900,  // $299
};

export function getProServeMonthlyCents(tier: ProServeTier): number {
  return PROSERVE_MONTHLY_CENTS[tier];
}

/**
 * Personal Vault (consumer) subscription monthly prices in cents.
 * Storage limits in GB included for downstream quota enforcement.
 */
export const VAULT_PLANS: Record<
  VaultTier,
  { monthlyCents: number; storageGb: number; label: string }
> = {
  basic: { monthlyCents: 999, storageGb: 5, label: "Basic Vault" },     // $9.99 / 5 GB
  legal: { monthlyCents: 2999, storageGb: 25, label: "Legal Vault" },   // $29.99 / 25 GB
  pro: { monthlyCents: 5999, storageGb: 100, label: "Pro Vault" },      // $59.99 / 100 GB
};

export function getVaultMonthlyCents(tier: VaultTier): number {
  return VAULT_PLANS[tier].monthlyCents;
}

// ──────────────────────────────────────────────────────────────────────────
// Server credentialing (one-time)
// ──────────────────────────────────────────────────────────────────────────

/** One-time background-check fee charged to a server before they can accept jobs. */
export const SERVER_CREDENTIALING_CENTS = 2499; // $24.99

// ──────────────────────────────────────────────────────────────────────────
// Marketplace fee split (20 / 80)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Platform fee expressed in BASIS POINTS (1/100 of a percent). 2000 bps = 20%.
 * All split math is done in integer arithmetic against this constant —
 * floats are never used for money. PLATFORM_FEE_RATE is a derived float
 * exposed only for human-readable UI display ("20%"), never for math.
 */
export const PLATFORM_FEE_BPS = 2000;
export const BPS_DENOMINATOR = 10000;
export const PLATFORM_FEE_RATE = PLATFORM_FEE_BPS / BPS_DENOMINATOR; // 0.20 — display only

/**
 * Split a gross amount in cents into platform fee (20%) and server payout (80%).
 *
 * The platform fee is rounded HALF-UP to the nearest cent using pure integer
 * arithmetic; the server payout absorbs any rounding remainder so that
 *   platformCents + serverCents === grossCents (always exactly).
 *
 * Formula: floor((grossCents * BPS + DENOMINATOR / 2) / DENOMINATOR)
 *   - All operands stay integers; safe up to grossCents ≈ 9 × 10^11 cents
 *     (~$9 billion per job) before exceeding Number.MAX_SAFE_INTEGER.
 */
export function splitFee(grossCents: number): { platformCents: number; serverCents: number } {
  if (!Number.isInteger(grossCents) || grossCents < 0) {
    throw new Error(`splitFee requires a non-negative integer, got ${grossCents}`);
  }
  const platformCents = Math.floor(
    (grossCents * PLATFORM_FEE_BPS + BPS_DENOMINATOR / 2) / BPS_DENOMINATOR,
  );
  const serverCents = grossCents - platformCents;
  return { platformCents, serverCents };
}

// ──────────────────────────────────────────────────────────────────────────
// Display helper (re-export for UI convenience). Keep it tiny + dep-free.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Format a cents integer as a USD string. Whole-dollar amounts render
 * without a fractional part ($75) so price tables stay visually tidy;
 * non-whole amounts keep the cents ($75.49).
 */
export function formatCentsUsd(cents: number): string {
  const dollars = Math.floor(Math.abs(cents) / 100);
  const remainder = Math.abs(cents) % 100;
  const sign = cents < 0 ? "-" : "";
  if (remainder === 0) {
    return `${sign}$${dollars}`;
  }
  return `${sign}$${dollars}.${String(remainder).padStart(2, "0")}`;
}
