ALTER TABLE "servers" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "deleted_reason" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "requester_name" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "requester_email" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "requester_phone" text;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "mailing_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "mailing_proof_photo_url" text;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "mailing_confirmed_by_user_id" text;