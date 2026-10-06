import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  varchar,
  uniqueIndex,
  pgEnum,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Server account lifecycle. Replaces the old `verified_at`/`active` boolean
 * pair with a single source of truth that the admin console drives.
 *   - pending   — invited or background check not yet cleared.
 *   - active    — cleared and allowed to accept jobs.
 *   - suspended — temporarily blocked (admin action); can be reactivated.
 *   - inactive  — permanently off-platform (admin action); soft delete.
 */
export const serverStatusEnum = pgEnum("server_status", [
  "pending",
  "active",
  "suspended",
  "inactive",
]);
export const SERVER_STATUSES = ["pending", "active", "suspended", "inactive"] as const;
export type ServerStatus = (typeof SERVER_STATUSES)[number];

/**
 * Self-declared server classification (see `serversTable.serverType`). Kept as
 * a shared const so other tables — e.g. `jurisdiction_requirements`'
 * `appliesToServerType` scope — validate against the same domain instead of
 * accepting free-form strings that silently drift.
 */
export const SERVER_TYPES = ["licensed_nv", "registered", "private", "sheriff"] as const;
export type ServerTypeValue = (typeof SERVER_TYPES)[number];

export const serversTable = pgTable("servers", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 64 }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  serverTier: text("server_tier").notNull().default("basic"),
  // Self-declared server classification, surfaced in the affidavit's
  // server attestation block. One of:
  //   licensed_nv  — Nevada PILB licensed process server
  //   registered   — Registered process server (other state)
  //   private      — Private process server (no formal registration)
  //   sheriff      — Sheriff / constable / marshal
  // Optional; null for servers who haven't filled it in yet.
  serverType: text("server_type"),
  // Driver's license — captured at admin creation so ops have something to
  // verify against the background check report. State is stored as a 2-letter
  // postal code; expiry is a calendar date (no time component).
  licenseNumber: text("license_number"),
  licenseState: varchar("license_state", { length: 2 }),
  licenseExpiry: date("license_expiry"),
  serviceArea: text("service_area"),
  // Nevada Proof of Service / affidavit fields. Captured on the
  // server's credentialing page and rendered into the affidavit's
  // server attestation block. `isLicensedNvServer` is the server's
  // self-attestation that they hold a Nevada PILB Process Server work
  // card; `licenseCounty` is the Nevada county of registration; and
  // `businessAddress` is the address the affidavit lists for the
  // server's place of business.
  businessAddress: text("business_address"),
  isLicensedNvServer: boolean("is_licensed_nv_server").notNull().default(false),
  licenseCounty: text("license_county"),
  // Profile headshot. Object-storage path (e.g. `/objects/...`) uploaded by the
  // server on their credentialing page via the presigned-PUT flow. Optional —
  // null until the server adds one; shown in the admin server detail view.
  photoUrl: text("photo_url"),
  // Account lifecycle. See `serverStatusEnum` above.
  status: serverStatusEnum("status").notNull().default("pending"),
  // Legacy boolean. Kept in sync with `status === 'active'` for older callers
  // (e.g. dashboard counts) but new code should branch on `status` directly.
  active: boolean("active").notNull().default(true),
  jobsCompleted: integer("jobs_completed").notNull().default(0),
  // Stripe Connect Express — populated as the server completes onboarding.
  // payoutsEnabled is the canonical "can we transfer to this account" flag,
  // mirrored from `account.charges_enabled && account.payouts_enabled` after
  // each Connect refresh.
  stripeAccountId: text("stripe_account_id"),
  payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
  // Mirrored from server_credentials.verified_at for fast joins on the
  // roster page; the source of truth remains server_credentials.
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Soft-delete marker. When the server (or an admin) deletes the account
  // we KEEP this row + all FK-attached history (service_attempts, payouts,
  // jobs, location pings, release events) so attorneys can still pull the
  // chain of custody for any past job. We just:
  //   - wipe the login (Clerk user + server_credentials + users row)
  //   - null out `userId` (since the users row is gone)
  //   - flip `status='inactive'` and `active=false` so existing
  //     marketplace/eligibility gates exclude them automatically
  //   - stamp `deletedAt` + `deletedReason` so the admin roster can show
  //     a "Deleted" badge and ops can audit who/why.
  deletedAt: timestamp("deleted_at"),
  deletedReason: text("deleted_reason"),
}, (t) => ({
  userIdx: uniqueIndex("servers_user_idx").on(t.userId),
}));

export const insertServerSchema = createInsertSchema(serversTable).omit({ id: true, createdAt: true, jobsCompleted: true, userId: true });
export type InsertServer = z.infer<typeof insertServerSchema>;
export type Server = typeof serversTable.$inferSelect;
