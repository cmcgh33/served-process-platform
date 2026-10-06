CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "picked_up_at" timestamp;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "failure_notified_at" timestamp;