ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sms_opt_out" boolean DEFAULT false NOT NULL;