import {
  pgTable,
  serial,
  integer,
  text,
  varchar,
  date,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { serversTable } from "./servers";
import { jurisdictionsTable } from "./jurisdictions";
import { credentialTypesTable } from "./credentialTypes";

/**
 * Lifecycle of a single credential instance:
 *   - pending   — uploaded/entered, awaiting admin (or automated) review.
 *   - verified  — confirmed valid; counts toward eligibility.
 *   - rejected  — reviewer found it invalid; does NOT count.
 *   - expired   — was verified, but `expiresAt` has passed; does NOT count.
 *                 The daily expiry job flips verified → expired.
 */
export const credentialVerificationStatusEnum = pgEnum(
  "credential_verification_status",
  ["pending", "verified", "rejected", "expired"],
);
export const CREDENTIAL_VERIFICATION_STATUSES = [
  "pending",
  "verified",
  "rejected",
  "expired",
] as const;
export type CredentialVerificationStatus =
  (typeof CREDENTIAL_VERIFICATION_STATUSES)[number];

/**
 * An actual credential a server holds — one row per (server, credential type,
 * jurisdiction). This is the per-instance counterpart to `credential_types`.
 *
 * `jurisdictionId` is nullable: some credentials are national and not tied to
 * one state (e.g. E&O insurance, a W-9), while others are jurisdiction-scoped
 * (e.g. an Arizona court certification).
 *
 * NOTE: this is intentionally separate from the existing `server_credentials`
 * table, which is a single per-user onboarding/background-check record. This
 * table is the multi-state credential ledger.
 */
export const serverJurisdictionCredentialsTable = pgTable(
  "server_jurisdiction_credentials",
  {
    id: serial("id").primaryKey(),
    serverId: integer("server_id")
      .notNull()
      .references(() => serversTable.id, { onDelete: "cascade" }),
    credentialTypeId: integer("credential_type_id")
      .notNull()
      .references(() => credentialTypesTable.id),
    // Null for national credentials not scoped to a single jurisdiction.
    jurisdictionId: integer("jurisdiction_id").references(
      () => jurisdictionsTable.id,
    ),
    // License/certification/policy/PI number, etc.
    identifier: text("identifier"),
    issuingAuthority: text("issuing_authority"),
    issuedAt: date("issued_at"),
    expiresAt: date("expires_at"),
    // Uploaded proof in Replit Object Storage (presigned-URL flow).
    documentUrl: text("document_url"),
    verificationStatus: credentialVerificationStatusEnum("verification_status")
      .notNull()
      .default("pending"),
    // Clerk user id of the admin who reviewed it.
    verifiedBy: varchar("verified_by", { length: 64 }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    // One credential row per (server, credential type, jurisdiction) so a
    // re-upload/renewal updates the existing record instead of creating an
    // ambiguous duplicate. Two partial indexes because Postgres treats NULL
    // jurisdiction (national credentials like E&O / W-9) as distinct.
    scopedUniq: uniqueIndex("server_jurisdiction_credentials_scoped_uniq")
      .on(t.serverId, t.credentialTypeId, t.jurisdictionId)
      .where(sql`${t.jurisdictionId} IS NOT NULL`),
    nationalUniq: uniqueIndex("server_jurisdiction_credentials_national_uniq")
      .on(t.serverId, t.credentialTypeId)
      .where(sql`${t.jurisdictionId} IS NULL`),
    serverIdx: index("server_jurisdiction_credentials_server_idx").on(
      t.serverId,
    ),
    serverJurisdictionIdx: index(
      "server_jurisdiction_credentials_server_jur_idx",
    ).on(t.serverId, t.jurisdictionId),
    statusIdx: index("server_jurisdiction_credentials_status_idx").on(
      t.verificationStatus,
    ),
    expiryIdx: index("server_jurisdiction_credentials_expiry_idx").on(
      t.expiresAt,
    ),
  }),
);

export const insertServerJurisdictionCredentialSchema = createInsertSchema(
  serverJurisdictionCredentialsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertServerJurisdictionCredential = z.infer<
  typeof insertServerJurisdictionCredentialSchema
>;
export type ServerJurisdictionCredential =
  typeof serverJurisdictionCredentialsTable.$inferSelect;
