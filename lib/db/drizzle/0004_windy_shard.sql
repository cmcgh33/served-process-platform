CREATE TYPE "public"."server_status" AS ENUM('pending', 'active', 'suspended', 'inactive');--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "license_state" varchar(2);--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "license_expiry" date;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "status" "server_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
-- Backfill: any row that has been verified at any point becomes 'active';
-- everything else stays 'pending'. We deliberately ignore the legacy
-- `active` boolean here because it was used as a soft-disable flag and
-- conflating it with lifecycle state would silently block servers who
-- were briefly toggled off.
UPDATE "servers" SET "status" = 'active'
WHERE "verified_at" IS NOT NULL;
