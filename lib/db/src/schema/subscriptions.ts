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

export const subscriptionsTable = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    tier: text("tier").notNull(),
    status: text("status").notNull().default("incomplete"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCustomerId: text("stripe_customer_id"),
    stripePriceId: text("stripe_price_id"),
    currentPeriodEnd: timestamp("current_period_end"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userUniq: uniqueIndex("subscriptions_user_uniq").on(t.userId),
    statusIdx: index("subscriptions_status_idx").on(t.status),
  }),
);

export type Subscription = typeof subscriptionsTable.$inferSelect;
export type InsertSubscription = typeof subscriptionsTable.$inferInsert;

export const vaultSubscriptionsTable = pgTable(
  "vault_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    tier: text("tier").notNull(),
    status: text("status").notNull().default("incomplete"),
    storageGb: integer("storage_gb").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCustomerId: text("stripe_customer_id"),
    stripePriceId: text("stripe_price_id"),
    currentPeriodEnd: timestamp("current_period_end"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userUniq: uniqueIndex("vault_subscriptions_user_uniq").on(t.userId),
    statusIdx: index("vault_subscriptions_status_idx").on(t.status),
  }),
);

export type VaultSubscription = typeof vaultSubscriptionsTable.$inferSelect;
export type InsertVaultSubscription = typeof vaultSubscriptionsTable.$inferInsert;
