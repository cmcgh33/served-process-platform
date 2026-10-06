-- Backfills schema deltas that prior tasks applied via `drizzle-kit push`
-- without recording a migration. `IF NOT EXISTS` keeps this safe to re-apply
-- in environments that already have those columns.
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "payouts_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "verified_at" timestamp;--> statement-breakpoint
-- Task #13: surface next expected payout date in the wallet.
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "arrival_date" timestamp;
