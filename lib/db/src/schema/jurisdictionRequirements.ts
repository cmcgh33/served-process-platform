import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  date,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jurisdictionsTable } from "./jurisdictions";
import { credentialTypesTable } from "./credentialTypes";
import { SERVER_TYPES } from "./servers";

/**
 * The RULES ENGINE: which credentials a server must hold (and have verified)
 * to be eligible to serve in a given jurisdiction.
 *
 *   - An unregulated jurisdiction (CO, UT) has ZERO rows here → any active
 *     server is eligible by default.
 *   - An individual_cert jurisdiction (AZ) has one row per required
 *     credential (e.g. az_court_cert, background_check).
 *   - `appliesToServerType` lets a requirement target only a subset of
 *     servers (e.g. NV's nv_pilb applies to `licensed_nv` servers, while
 *     registered servers satisfy NV through a QA/agency linkage handled
 *     separately). Null = applies to everyone.
 */
export const jurisdictionRequirementsTable = pgTable(
  "jurisdiction_requirements",
  {
    id: serial("id").primaryKey(),
    jurisdictionId: integer("jurisdiction_id")
      .notNull()
      .references(() => jurisdictionsTable.id, { onDelete: "cascade" }),
    credentialTypeId: integer("credential_type_id")
      .notNull()
      .references(() => credentialTypesTable.id),
    isRequired: boolean("is_required").notNull().default(true),
    // Optional narrowing to a `servers.server_type` value
    // (licensed_nv | registered | private | sheriff). Null = all servers.
    appliesToServerType: text("applies_to_server_type"),
    notes: text("notes"),
    effectiveDate: date("effective_date"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    // One rule per (jurisdiction, credential, server-type scope). Postgres
    // treats NULLs as distinct in unique indexes, so a single 3-column index
    // would NOT block duplicate "global" (null-scope) rules. Two partial
    // indexes cover both cases deterministically.
    scopedUniq: uniqueIndex("jurisdiction_requirements_scoped_uniq")
      .on(t.jurisdictionId, t.credentialTypeId, t.appliesToServerType)
      .where(sql`${t.appliesToServerType} IS NOT NULL`),
    globalUniq: uniqueIndex("jurisdiction_requirements_global_uniq")
      .on(t.jurisdictionId, t.credentialTypeId)
      .where(sql`${t.appliesToServerType} IS NULL`),
    jurisdictionIdx: index("jurisdiction_requirements_jurisdiction_idx").on(
      t.jurisdictionId,
    ),
  }),
);

export const insertJurisdictionRequirementSchema = createInsertSchema(
  jurisdictionRequirementsTable,
)
  .omit({ id: true, createdAt: true, updatedAt: true })
  // Constrain the scope to known server types (or null = all servers) so a
  // typo can't silently create a rule that never matches any server.
  .extend({
    appliesToServerType: z.enum(SERVER_TYPES).nullish(),
  });
export type InsertJurisdictionRequirement = z.infer<
  typeof insertJurisdictionRequirementSchema
>;
export type JurisdictionRequirement =
  typeof jurisdictionRequirementsTable.$inferSelect;
