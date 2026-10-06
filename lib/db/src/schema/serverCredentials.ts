import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  index,
  uniqueIndex,
  integer,
} from "drizzle-orm/pg-core";

export const serverCredentialsTable = pgTable(
  "server_credentials",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    status: text("status").notNull().default("unpaid"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    paymentId: integer("payment_id"),
    backgroundCheckId: text("background_check_id"),
    failureReason: text("failure_reason"),
    verifiedAt: timestamp("verified_at"),
    // Set when the server finishes the in-portal onboarding training video.
    // Gates POST /jobs/:id/accept so a brand-new server cannot claim their
    // first serve until they've watched the walkthrough.
    trainingCompletedAt: timestamp("training_completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userUniq: uniqueIndex("server_credentials_user_uniq").on(t.userId),
    statusIdx: index("server_credentials_status_idx").on(t.status),
  }),
);

export type ServerCredential = typeof serverCredentialsTable.$inferSelect;
export type InsertServerCredential = typeof serverCredentialsTable.$inferInsert;
