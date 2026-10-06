import {
  pgTable,
  serial,
  text,
  varchar,
  boolean,
  date,
  timestamp,
  integer,
  pgEnum,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * How a jurisdiction regulates process serving. This is the single switch
 * that tells the platform which legal model applies:
 *   - unregulated     — anyone meeting the baseline (18+, not a party) may
 *                       serve. No credentials required. (e.g. CO, UT)
 *   - individual_cert — each individual server must hold a state/court
 *                       certification, but the platform/agency itself is not
 *                       licensed. The marketplace (1099) model applies. (e.g. AZ)
 *   - agency_licensed — the business that ARRANGES service must be licensed
 *                       (Qualifying Agent + registered/employee servers).
 *                       This is the strict model. (e.g. NV)
 */
export const regulatoryModelEnum = pgEnum("regulatory_model", [
  "unregulated",
  "individual_cert",
  "agency_licensed",
]);
export const REGULATORY_MODELS = [
  "unregulated",
  "individual_cert",
  "agency_licensed",
] as const;
export type RegulatoryModel = (typeof REGULATORY_MODELS)[number];

/** Geographic level. Counties hang off a state via `parentId`. */
export const jurisdictionLevelEnum = pgEnum("jurisdiction_level", [
  "state",
  "county",
]);
export const JURISDICTION_LEVELS = ["state", "county"] as const;
export type JurisdictionLevel = (typeof JURISDICTION_LEVELS)[number];

/**
 * A place where service of process happens and is regulated. Usually a US
 * state, but can be a county for states (like AZ) that administer
 * certification at the county level.
 *
 * Adding a new state to the platform should be a DATA-ENTRY task: insert a
 * row here, set its `regulatoryModel`, and add zero-or-more
 * `jurisdiction_requirements` rows. No code change required.
 */
export const jurisdictionsTable = pgTable(
  "jurisdictions",
  {
    id: serial("id").primaryKey(),
    // Stable, human-readable code. States use the 2-letter postal code
    // ("CO", "UT", "AZ", "NV"); counties use "<STATE>-<COUNTY>"
    // ("AZ-MARICOPA"). Used to match against jobs' recipient_state.
    code: varchar("code", { length: 32 }).notNull(),
    name: text("name").notNull(),
    level: jurisdictionLevelEnum("level").notNull().default("state"),
    // Self-reference for counties → their parent state.
    parentId: integer("parent_id").references(
      (): AnyPgColumn => jurisdictionsTable.id,
    ),
    regulatoryModel: regulatoryModelEnum("regulatory_model")
      .notNull()
      .default("unregulated"),
    // Are we live (accepting jobs / onboarding servers) here yet?
    isActive: boolean("is_active").notNull().default(false),
    launchDate: date("launch_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    codeUniq: uniqueIndex("jurisdictions_code_uniq").on(t.code),
    parentIdx: index("jurisdictions_parent_idx").on(t.parentId),
    activeIdx: index("jurisdictions_active_idx").on(t.isActive),
  }),
);

export const insertJurisdictionSchema = createInsertSchema(
  jurisdictionsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJurisdiction = z.infer<typeof insertJurisdictionSchema>;
export type Jurisdiction = typeof jurisdictionsTable.$inferSelect;
