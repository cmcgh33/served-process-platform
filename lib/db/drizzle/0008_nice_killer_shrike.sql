ALTER TABLE "service_attempts" ADD COLUMN "substitute_recipient_age" integer;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "substitute_is_co_resident" boolean;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "acknowledge_mail_followup" boolean;