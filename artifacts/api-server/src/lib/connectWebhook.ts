import type Stripe from "stripe";
import { sql } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Connect webhook lifecycle management — kept deliberately OUTSIDE
 * `stripe-replit-sync`'s managed-webhook system.
 *
 * Why we don't piggy-back on `findOrCreateManagedWebhook`:
 * The lib's findOrCreate is single-webhook-per-account by design. Its
 * cleanup loop walks every row of `stripe._managed_webhooks` and
 * deletes any whose URL doesn't match the URL being requested. So
 * calling it for both the platform URL and our Connect URL would
 * thrash — each call would delete the other's row and Stripe-side
 * endpoint. The lib's `processWebhook` also picks a secret with a
 * deterministic-but-unpredictable `LIMIT 1` query, which can't tell
 * the platform secret from a Connect secret.
 *
 * So we own the Connect webhook end-to-end:
 *  - Create it in Stripe with a distinct `metadata.managed_by` so the
 *    lib's orphan-cleanup pass leaves it alone (it only deletes
 *    `metadata.managed_by === 'stripe-sync'`).
 *  - Persist `(id, secret, url)` in `app_settings` so signature
 *    verification survives restarts (Stripe only returns the secret
 *    on creation).
 *  - On startup, reconcile: if the stored endpoint still matches what
 *    Stripe has at the requested URL, reuse its secret; otherwise
 *    delete + recreate and store the new secret.
 */

const MANAGED_BY_TAG = "served-connect";
const SETTING_KEY_ID = "stripe_connect_webhook_id";
const SETTING_KEY_SECRET = "stripe_connect_webhook_secret";
const SETTING_KEY_URL = "stripe_connect_webhook_url";

export interface EnsuredConnectWebhook {
  id: string;
  secret: string;
  url: string;
  enabledEvents: readonly string[];
}

interface StoredSettings {
  id: string | null;
  secret: string | null;
  url: string | null;
}

async function readStoredSettings(): Promise<StoredSettings> {
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(
      sql`${appSettingsTable.key} IN (${SETTING_KEY_ID}, ${SETTING_KEY_SECRET}, ${SETTING_KEY_URL})`,
    );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    id: map.get(SETTING_KEY_ID) ?? null,
    secret: map.get(SETTING_KEY_SECRET) ?? null,
    url: map.get(SETTING_KEY_URL) ?? null,
  };
}

async function writeStoredSettings(values: {
  id: string;
  secret: string;
  url: string;
}): Promise<void> {
  const now = new Date();
  // Three idempotent upserts; the table is keyed on `key` so concurrent
  // boot-time calls converge on the same final state.
  for (const [key, value] of [
    [SETTING_KEY_ID, values.id],
    [SETTING_KEY_SECRET, values.secret],
    [SETTING_KEY_URL, values.url],
  ] as const) {
    await db
      .insert(appSettingsTable)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: { value, updatedAt: now },
      });
  }
}

/**
 * Idempotently ensure a Connect webhook endpoint exists at `url`,
 * subscribed to `enabledEvents`. Returns the webhook id + signing
 * secret so the caller can verify deliveries.
 *
 * Concurrency note: this is intended to run once at startup. If two
 * server instances boot at the exact same moment they may both reach
 * the `webhookEndpoints.create` call and end up with two endpoints in
 * Stripe; the second one's settings will overwrite the first in
 * `app_settings` and the orphan will be cleaned up the next time
 * reconciliation runs (or by a manual sweep). This is acceptable —
 * cold-start churn is rare and Stripe charges nothing for unused
 * endpoints.
 */
export async function ensureConnectWebhook(
  stripe: Stripe,
  url: string,
  enabledEvents: readonly Stripe.WebhookEndpointCreateParams.EnabledEvent[],
): Promise<EnsuredConnectWebhook> {
  const stored = await readStoredSettings();

  // Fast path: stored row matches the URL we want, and Stripe still
  // has that endpoint enabled with no obvious drift. Reuse the secret
  // we already have without round-tripping a delete/create.
  if (stored.id && stored.secret && stored.url === url) {
    try {
      const existing = await stripe.webhookEndpoints.retrieve(stored.id);
      if (existing.status === "enabled" && existing.url === url) {
        return {
          id: existing.id,
          secret: stored.secret,
          url,
          enabledEvents,
        };
      }
      logger.info(
        { id: existing.id, status: existing.status, stripeUrl: existing.url, wantUrl: url },
        "Stored Connect webhook drifted from Stripe — recreating",
      );
    } catch (err) {
      const stripeErr = err as { statusCode?: number; code?: string };
      if (stripeErr.statusCode === 404 || stripeErr.code === "resource_missing") {
        logger.info(
          { id: stored.id },
          "Stored Connect webhook not found in Stripe — recreating",
        );
      } else {
        // Don't swallow unknown errors — better to fail init than to
        // continue without a verified webhook.
        throw err;
      }
    }
  }

  // Slow path: either nothing stored, URL changed, or Stripe lost the
  // endpoint. Clean up the previously-stored id (best effort) before
  // creating a fresh one.
  if (stored.id) {
    try {
      await stripe.webhookEndpoints.del(stored.id);
      logger.info({ id: stored.id }, "Deleted stale Connect webhook from Stripe");
    } catch (err) {
      const stripeErr = err as { statusCode?: number; code?: string };
      if (
        stripeErr.statusCode !== 404 &&
        stripeErr.code !== "resource_missing"
      ) {
        // Log but continue — leaving an orphan in Stripe is better than
        // failing to register a new endpoint.
        logger.warn(
          { err, id: stored.id },
          "Failed to delete stale Connect webhook (continuing)",
        );
      }
    }
  }

  // Also sweep up any other endpoints we created earlier with our
  // metadata tag (e.g. from a crashed boot before `app_settings` got
  // written). This keeps the Stripe dashboard from accumulating
  // never-used endpoints.
  try {
    for await (const ep of stripe.webhookEndpoints.list({ limit: 100 })) {
      if (
        ep.metadata?.managed_by === MANAGED_BY_TAG &&
        ep.id !== stored.id
      ) {
        try {
          await stripe.webhookEndpoints.del(ep.id);
          logger.info(
            { id: ep.id, url: ep.url },
            "Deleted orphaned Connect webhook (managed_by tag matched)",
          );
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to sweep orphaned Connect webhooks (continuing)");
  }

  const created = await stripe.webhookEndpoints.create({
    url,
    connect: true,
    enabled_events: [...enabledEvents],
    description: "SERVED. Connect webhook (managed by served-connect)",
    metadata: { managed_by: MANAGED_BY_TAG },
  });

  const secret = (created as { secret?: string }).secret;
  if (!secret) {
    throw new Error(
      "Stripe webhookEndpoints.create did not return a secret — cannot persist Connect webhook",
    );
  }

  await writeStoredSettings({ id: created.id, secret, url });

  return {
    id: created.id,
    secret,
    url,
    enabledEvents,
  };
}
