import {
  pgTable,
  serial,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { serversTable } from "./servers";
import { jurisdictionsTable } from "./jurisdictions";

/**
 * Whether a server may currently serve in a jurisdiction:
 *   - eligible    — holds every required credential, all verified + unexpired.
 *   - pending     — has uploaded the required credentials but at least one is
 *                   still awaiting verification.
 *   - ineligible  — missing one or more required credentials (or has a
 *                   rejected/expired one).
 */
export const eligibilityStatusEnum = pgEnum("eligibility_status", [
  "eligible",
  "pending",
  "ineligible",
]);
export const ELIGIBILITY_STATUSES = [
  "eligible",
  "pending",
  "ineligible",
] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

/**
 * A CACHE of computed eligibility, one row per (server, jurisdiction). It is
 * derived from `jurisdiction_requirements` + `server_jurisdiction_credentials`
 * and recomputed whenever a credential or requirement changes (or on a
 * schedule). Storing it (rather than computing on every read) keeps job
 * matching fast: "show me eligible servers for this CO job" becomes a single
 * indexed lookup.
 *
 * `missingCredentials` holds the credential-type codes still outstanding, so
 * the onboarding UI can tell the server exactly what to upload next.
 */
export const serverJurisdictionEligibilityTable = pgTable(
  "server_jurisdiction_eligibility",
  {
    id: serial("id").primaryKey(),
    serverId: integer("server_id")
      .notNull()
      .references(() => serversTable.id, { onDelete: "cascade" }),
    jurisdictionId: integer("jurisdiction_id")
      .notNull()
      .references(() => jurisdictionsTable.id, { onDelete: "cascade" }),
    status: eligibilityStatusEnum("status").notNull().default("ineligible"),
    // string[] of credential_type codes still missing or unverified.
    missingCredentials: jsonb("missing_credentials")
      .notNull()
      .default([])
      .$type<string[]>(),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    uniq: uniqueIndex("server_jurisdiction_eligibility_uniq").on(
      t.serverId,
      t.jurisdictionId,
    ),
    // "All servers eligible in jurisdiction X" — the job-matching query.
    jurisdictionStatusIdx: index(
      "server_jurisdiction_eligibility_jur_status_idx",
    ).on(t.jurisdictionId, t.status),
  }),
);

export const insertServerJurisdictionEligibilitySchema = createInsertSchema(
  serverJurisdictionEligibilityTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertServerJurisdictionEligibility = z.infer<
  typeof insertServerJurisdictionEligibilitySchema
>;
export type ServerJurisdictionEligibility =
  typeof serverJurisdictionEligibilityTable.$inferSelect;
