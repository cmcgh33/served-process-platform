CREATE TABLE IF NOT EXISTS "clients" (
        "id" serial PRIMARY KEY NOT NULL,
        "owner_user_id" varchar(64),
        "firm_name" text NOT NULL,
        "contact_name" text NOT NULL,
        "email" text NOT NULL,
        "phone" text,
        "address" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "servers" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" varchar(64),
        "name" text NOT NULL,
        "email" text NOT NULL,
        "phone" text,
        "server_tier" text DEFAULT 'basic' NOT NULL,
        "license_number" text,
        "service_area" text,
        "active" boolean DEFAULT true NOT NULL,
        "jobs_completed" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
        "id" serial PRIMARY KEY NOT NULL,
        "requester_user_id" varchar(64),
        "status" text DEFAULT 'pending' NOT NULL,
        "document_type" text NOT NULL,
        "recipient_name" text NOT NULL,
        "recipient_address" text NOT NULL,
        "recipient_city" text NOT NULL,
        "recipient_state" text NOT NULL,
        "recipient_zip" text NOT NULL,
        "case_number" text,
        "matter_name" text,
        "notes" text,
        "client_id" integer,
        "server_id" integer,
        "served_at" timestamp,
        "gps_lat" double precision,
        "gps_lng" double precision,
        "platform_ref" text NOT NULL,
        "service_type" text DEFAULT 'standard' NOT NULL,
        "gross_cents" integer DEFAULT 0 NOT NULL,
        "platform_fee_cents" integer DEFAULT 0 NOT NULL,
        "server_payout_cents" integer DEFAULT 0 NOT NULL,
        "pricing_tier" text DEFAULT 'public' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "service_type" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "gross_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "platform_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "server_payout_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "pricing_tier" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
        "id" varchar(64) PRIMARY KEY NOT NULL,
        "email" text,
        "first_name" text,
        "last_name" text,
        "role" text,
        "plan" text DEFAULT 'firm' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
        "id" serial PRIMARY KEY NOT NULL,
        "owner_user_id" varchar(64) NOT NULL,
        "job_id" integer,
        "name" text NOT NULL,
        "size" bigint NOT NULL,
        "content_type" text NOT NULL,
        "object_path" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "upload_reservations" (
        "object_path" text PRIMARY KEY NOT NULL,
        "owner_user_id" varchar(64) NOT NULL,
        "expected_size" bigint NOT NULL,
        "content_type" text NOT NULL,
        "name" text NOT NULL,
        "job_id" integer,
        "expires_at" timestamp NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" varchar(64) NOT NULL,
        "tier" text NOT NULL,
        "status" text DEFAULT 'incomplete' NOT NULL,
        "stripe_subscription_id" text,
        "stripe_customer_id" text,
        "stripe_price_id" text,
        "current_period_end" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vault_subscriptions" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" varchar(64) NOT NULL,
        "tier" text NOT NULL,
        "status" text DEFAULT 'incomplete' NOT NULL,
        "storage_gb" integer NOT NULL,
        "stripe_subscription_id" text,
        "stripe_customer_id" text,
        "stripe_price_id" text,
        "current_period_end" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "server_credentials" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" varchar(64) NOT NULL,
        "status" text DEFAULT 'unpaid' NOT NULL,
        "stripe_payment_intent_id" text,
        "payment_id" integer,
        "background_check_id" text,
        "failure_reason" text,
        "verified_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" varchar(64) NOT NULL,
        "kind" text NOT NULL,
        "amount_cents" integer NOT NULL,
        "platform_fee_cents" integer DEFAULT 0 NOT NULL,
        "server_payout_cents" integer DEFAULT 0 NOT NULL,
        "currency" varchar(3) DEFAULT 'usd' NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "job_id" integer,
        "subscription_id" integer,
        "vault_subscription_id" integer,
        "server_credential_id" integer,
        "stripe_payment_intent_id" text,
        "stripe_invoice_id" text,
        "stripe_charge_id" text,
        "description" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payouts" (
        "id" serial PRIMARY KEY NOT NULL,
        "server_id" integer NOT NULL,
        "user_id" varchar(64) NOT NULL,
        "job_id" integer NOT NULL,
        "amount_cents" integer NOT NULL,
        "currency" varchar(3) DEFAULT 'usd' NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "stripe_transfer_id" text,
        "stripe_account_id" text,
        "paid_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_client_id_clients_id_fk') THEN
                ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_server_id_servers_id_fk') THEN
                ALTER TABLE "jobs" ADD CONSTRAINT "jobs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_job_id_jobs_id_fk') THEN
                ALTER TABLE "documents" ADD CONSTRAINT "documents_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upload_reservations_job_id_jobs_id_fk') THEN
                ALTER TABLE "upload_reservations" ADD CONSTRAINT "upload_reservations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_job_id_jobs_id_fk') THEN
                ALTER TABLE "payments" ADD CONSTRAINT "payments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_subscription_id_subscriptions_id_fk') THEN
                ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_vault_subscription_id_vault_subscriptions_id_fk') THEN
                ALTER TABLE "payments" ADD CONSTRAINT "payments_vault_subscription_id_vault_subscriptions_id_fk" FOREIGN KEY ("vault_subscription_id") REFERENCES "public"."vault_subscriptions"("id") ON DELETE no action ON UPDATE no action;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_server_credential_id_server_credentials_id_fk') THEN
                ALTER TABLE "payments" ADD CONSTRAINT "payments_server_credential_id_server_credentials_id_fk" FOREIGN KEY ("server_credential_id") REFERENCES "public"."server_credentials"("id") ON DELETE no action ON UPDATE no action;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payouts_server_id_servers_id_fk') THEN
                ALTER TABLE "payouts" ADD CONSTRAINT "payouts_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payouts_job_id_jobs_id_fk') THEN
                ALTER TABLE "payouts" ADD CONSTRAINT "payouts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;
        END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_owner_idx" ON "clients" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "servers_user_idx" ON "servers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_requester_idx" ON "jobs" USING btree ("requester_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_server_idx" ON "jobs" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_owner_idx" ON "documents" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_job_idx" ON "documents" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "documents_object_path_uniq" ON "documents" USING btree ("object_path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_reservations_owner_idx" ON "upload_reservations" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_reservations_expires_idx" ON "upload_reservations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_user_uniq" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vault_subscriptions_user_uniq" ON "vault_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vault_subscriptions_status_idx" ON "vault_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "server_credentials_user_uniq" ON "server_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "server_credentials_status_idx" ON "server_credentials" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_user_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_job_idx" ON "payments" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_subscription_idx" ON "payments" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_vault_subscription_idx" ON "payments" USING btree ("vault_subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_server_credential_idx" ON "payments" USING btree ("server_credential_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_kind_status_idx" ON "payments" USING btree ("kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_stripe_pi_uniq" ON "payments" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_stripe_invoice_uniq" ON "payments" USING btree ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payouts_server_idx" ON "payouts" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payouts_user_idx" ON "payouts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payouts_status_idx" ON "payouts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payouts_job_uniq" ON "payouts" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payouts_stripe_transfer_uniq" ON "payouts" USING btree ("stripe_transfer_id");--> statement-breakpoint
UPDATE "jobs"
SET
        "service_type" = 'standard',
        "pricing_tier" = 'public',
        "gross_cents" = 7500,
        "platform_fee_cents" = 1500,
        "server_payout_cents" = 6000
WHERE "gross_cents" = 0;
