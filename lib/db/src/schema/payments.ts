import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";
import { subscriptionsTable } from "./subscriptions";
import { vaultSubscriptionsTable } from "./subscriptions";
import { serverCredentialsTable } from "./serverCredentials";

/**
 * Inbound money. `kind` is one of:
 *   marketplace_serve | proserve_subscription | vault_subscription | server_credentialing
 *
 * Each charge links to its related entity via the matching FK column. For
 * marketplace_serve, platformFeeCents + serverPayoutCents mirror the snapshot
 * on the job row; subscription/credentialing rows put the full amount in
 * platformFeeCents (the platform keeps it all).
 */
export const PAYMENT_KINDS = [
  "marketplace_serve",
  "proserve_subscription",
  "vault_subscription",
  "server_credentialing",
] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const paymentsTable = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    kind: text("kind").notNull(),
    amountCents: integer("amount_cents").notNull(),
    platformFeeCents: integer("platform_fee_cents").notNull().default(0),
    serverPayoutCents: integer("server_payout_cents").notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("usd"),
    status: text("status").notNull().default("pending"),
    jobId: integer("job_id").references(() => jobsTable.id),
    subscriptionId: integer("subscription_id").references(() => subscriptionsTable.id),
    vaultSubscriptionId: integer("vault_subscription_id").references(
      () => vaultSubscriptionsTable.id,
    ),
    serverCredentialId: integer("server_credential_id").references(
      () => serverCredentialsTable.id,
    ),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeInvoiceId: text("stripe_invoice_id"),
    stripeChargeId: text("stripe_charge_id"),
    description: text("description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("payments_user_idx").on(t.userId),
    jobIdx: index("payments_job_idx").on(t.jobId),
    subIdx: index("payments_subscription_idx").on(t.subscriptionId),
    vaultSubIdx: index("payments_vault_subscription_idx").on(t.vaultSubscriptionId),
    credIdx: index("payments_server_credential_idx").on(t.serverCredentialId),
    kindStatusIdx: index("payments_kind_status_idx").on(t.kind, t.status),
    piUniq: uniqueIndex("payments_stripe_pi_uniq").on(t.stripePaymentIntentId),
    invoiceUniq: uniqueIndex("payments_stripe_invoice_uniq").on(t.stripeInvoiceId),
  }),
);

export type Payment = typeof paymentsTable.$inferSelect;
export type InsertPayment = typeof paymentsTable.$inferInsert;
