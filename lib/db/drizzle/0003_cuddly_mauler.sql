CREATE TABLE "service_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"server_id" integer NOT NULL,
	"outcome" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gps_lat" double precision NOT NULL,
	"gps_lng" double precision NOT NULL,
	"notes" text,
	"photo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "proof_photo_url" text;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD CONSTRAINT "service_attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_attempts" ADD CONSTRAINT "service_attempts_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_attempts_job_idx" ON "service_attempts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "service_attempts_job_attempted_idx" ON "service_attempts" USING btree ("job_id","attempted_at");