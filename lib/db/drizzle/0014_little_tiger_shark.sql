CREATE TABLE "job_served_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"title" text NOT NULL,
	"document_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "business_address" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "is_licensed_nv_server" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "license_county" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "court_name" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "petitioner" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "respondent" text;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "service_address" text;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "service_city" text;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "service_state" text;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "service_zip" text;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "method_narrative" text;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "recipient_relationship" text;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "recipient_description" text;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "mailing_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "mailing_address" text;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "posting_location_description" text;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_served_documents" ADD CONSTRAINT "job_served_documents_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_served_documents_job_idx" ON "job_served_documents" USING btree ("job_id");