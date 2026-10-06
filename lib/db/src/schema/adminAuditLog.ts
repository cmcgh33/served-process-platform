import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/**
 * Persistent record of admin actions taken from `/app/admin/...`.
 *
 * Every destructive or trust-changing action in `routes/admin.ts` writes
 * one row here on success. The pino structured logs remain (they're useful
 * for live debugging) but are ephemeral and not surfaceable in the UI; this
 * table is the durable trail that owners can review for compliance once
 * there is more than one admin.
 *
 * Shape choices:
 *   - `actorUserId` is the Clerk user id of the admin who performed the
 *     action (req.userId). Stored as text rather than a FK because Clerk
 *     ids are not in a local table for all admin paths.
 *   - `targetServerId` / `targetUserId` are nullable; most admin actions
 *     touch one or the other. We store both so future filters work
 *     uniformly (server-roster filter vs user-search filter) without a
 *     polymorphic join.
 *   - `action` is a free-form string keyed by the route that wrote it (see
 *     `ADMIN_AUDIT_ACTIONS` for the closed list used today).
 *   - `details` is a small JSON blob with action-specific fields
 *     (e.g. {from,to} for status changes, {reason} for fail, {invitationId}
 *     for invites). Keep it small — this is for after-the-fact review, not
 *     analytics.
 */
export const ADMIN_AUDIT_ACTIONS = [
  "server.create",
  "server.invite",
  "server.resend_invite",
  "server.revoke_invite",
  "server.status_change",
  "server.verify",
  "server.fail",
  "server.delete_account",
  "server.recover_stuck_account",
  "server.edit_profile",
  "job.assign",
  "job.cancel",
  "user.email",
  "payout.retry",
  "payout.dismiss",
  "maintenance.purge_test_data",
  "demo.invite_send",
  "demo.invite_revoke",
] as const;
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

export const adminAuditLogTable = pgTable(
  "admin_audit_log",
  {
    id: serial("id").primaryKey(),
    actorUserId: varchar("actor_user_id", { length: 64 }).notNull(),
    action: text("action").notNull(),
    targetServerId: integer("target_server_id"),
    targetUserId: varchar("target_user_id", { length: 64 }),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index("admin_audit_actor_idx").on(t.actorUserId),
    targetServerIdx: index("admin_audit_target_server_idx").on(t.targetServerId),
    targetUserIdx: index("admin_audit_target_user_idx").on(t.targetUserId),
    createdIdx: index("admin_audit_created_idx").on(t.createdAt),
  }),
);

export type AdminAuditLog = typeof adminAuditLogTable.$inferSelect;
export type InsertAdminAuditLog = typeof adminAuditLogTable.$inferInsert;
