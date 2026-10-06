ALTER TABLE "jobs" ADD COLUMN "document_handling" text DEFAULT 'prints' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "pickup_address" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "pickup_city" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "pickup_state" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "pickup_zip" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "pickup_contact_name" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "pickup_contact_phone" text;