import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Soft-gated invitations to the public attorney-demo video.
 *
 * Carla (admin) sends a short SendGrid email from `info@servedapp.co` with a
 * tokenised link like `${ORIGIN}/demo/watch/<token>`. The recipient lands on
 * a public page, types the email the invite was addressed to (case-insensitive
 * match), and the iframe to `/attorney-demo/` reveals.
 *
 * Soft-gate, not auth: the goal is to discourage casual link-sharing and
 * collect a confirmation signal we can show in the admin UI ("opened on
 * 5/12, 9:14 PM"). It is NOT a security boundary — anyone with the token
 * can guess the email; that's an acceptable tradeoff for a public marketing
 * asset.
 *
 * Lifecycle:
 *   - Row created on POST /api/admin/demo/invites with `expires_at = now+30d`.
 *   - `viewed_at` stamps on the FIRST successful confirmation (idempotent —
 *     repeat confirmations don't update it).
 *   - `revoked_at` lets an admin disable a leaked link without deleting the
 *     row (so the audit trail survives).
 */
export const demoInvitesTable = pgTable(
  "demo_invites",
  {
    id: serial("id").primaryKey(),
    /**
     * URL-safe random token (64 hex chars). Unique because the URL embeds
     * it directly; a collision would silently let recipient B confirm with
     * recipient A's email.
     */
    token: varchar("token", { length: 128 }).notNull(),
    recipientEmail: text("recipient_email").notNull(),
    recipientName: text("recipient_name"),
    /** Clerk userId of the admin who pressed "Send". */
    sentByUserId: varchar("sent_by_user_id", { length: 64 }).notNull(),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    viewedAt: timestamp("viewed_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => ({
    tokenUniq: uniqueIndex("demo_invites_token_uniq").on(t.token),
    sentByIdx: index("demo_invites_sent_by_idx").on(t.sentByUserId),
    sentAtIdx: index("demo_invites_sent_at_idx").on(t.sentAt),
  }),
);

export type DemoInvite = typeof demoInvitesTable.$inferSelect;
export type InsertDemoInvite = typeof demoInvitesTable.$inferInsert;
