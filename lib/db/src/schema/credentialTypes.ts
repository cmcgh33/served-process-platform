import {
  pgTable,
  serial,
  text,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * The catalogue of credential KINDS that can exist across all jurisdictions.
 * A credential type is a definition ("Arizona court certification"); an actual
 * instance a server holds lives in `server_jurisdiction_credentials`.
 *
 * Examples: az_court_cert, nv_pilb, eo_insurance, surety_bond,
 * background_check, pi_number, badge_number, w9.
 */
export const credentialTypesTable = pgTable(
  "credential_types",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 64 }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // Does an instance of this credential carry an expiration date that we
    // must monitor and auto-expire on? (e.g. certifications, bonds, insurance)
    hasExpiry: boolean("has_expiry").notNull().default(false),
    // Does verifying this credential require an uploaded document, or is it a
    // number/attestation only?
    hasDocument: boolean("has_document").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    codeUniq: uniqueIndex("credential_types_code_uniq").on(t.code),
  }),
);

export const insertCredentialTypeSchema = createInsertSchema(
  credentialTypesTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCredentialType = z.infer<typeof insertCredentialTypeSchema>;
export type CredentialType = typeof credentialTypesTable.$inferSelect;
