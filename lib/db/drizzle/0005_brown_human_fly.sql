ALTER TABLE "service_attempts" ADD COLUMN "substitute_recipient_name" text;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "substitute_over_18" boolean;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "substitute_verified_residence" boolean;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "unable_reason" text;--> statement-breakpoint
UPDATE "service_attempts" SET "unable_reason" = "outcome", "outcome" = 'unable' WHERE "outcome" IN ('no_answer', 'refused', 'wrong_address', 'gated', 'other');--> statement-breakpoint
UPDATE "service_attempts" SET "outcome" = 'personal' WHERE "outcome" = 'served';
