import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Tiny key/value store for small pieces of operator-managed app state
 * that don't fit anywhere else and don't justify their own table.
 *
 * Current uses:
 *  - `stripe_connect_webhook_id` — Stripe webhook endpoint id we manage
 *    for Connect events (`payout.*`, `account.updated`).
 *  - `stripe_connect_webhook_secret` — signing secret for that endpoint.
 *    Stripe only returns the secret on creation, so we MUST persist it
 *    here or signature verification breaks across restarts.
 *  - `stripe_connect_webhook_url` — the URL we registered, so we can
 *    detect dev-domain hops and re-create when the host changes.
 *
 * Values are stored as plain text — keys are app-controlled, never
 * user-supplied. Treat the secret column with the same care as any
 * other Stripe credential at rest (it's already in DATABASE_URL's
 * trust boundary).
 */
export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AppSetting = typeof appSettingsTable.$inferSelect;
export type InsertAppSetting = typeof appSettingsTable.$inferInsert;
