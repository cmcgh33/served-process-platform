CREATE TABLE "job_release_events" (
"id" serial PRIMARY KEY NOT NULL,
"job_id" integer NOT NULL,
"server_id" integer NOT NULL,
"reason" text NOT NULL,
"released_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_release_events" ADD CONSTRAINT "job_release_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_release_events" ADD CONSTRAINT "job_release_events_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_release_events_job_idx" ON "job_release_events" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_release_events_job_released_idx" ON "job_release_events" USING btree ("job_id","released_at");
