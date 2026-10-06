import {
  pgTable,
  serial,
  integer,
  timestamp,
  date,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Audit log + dedup guard for license-expiry email notifications.
 *
 * The scheduled job in `artifacts/api-server/src/lib/licenseExpiryEmails.ts`
 * walks every `servers` row and sends a templated email at the T-30/T-7/T-0
 * thresholds. To prevent duplicates when the job runs more than once per day
 * (boot + interval) we dedupe on `(serverId, licenseExpiry, threshold)`.
 *
 * Including `licenseExpiry` in the unique key (rather than just serverId +
 * threshold) means a renewed license — which moves `servers.license_expiry`
 * to a future date — naturally resets the notification cycle without any
 * manual cleanup.
 */
export const licenseExpiryNotificationsTable = pgTable(
  "license_expiry_notifications",
  {
    id: serial("id").primaryKey(),
    serverId: integer("server_id").notNull(),
    /** Snapshot of `servers.license_expiry` at send time. */
    licenseExpiry: date("license_expiry").notNull(),
    /** Days-until-expiry bucket: 30, 7, or 0. */
    threshold: integer("threshold").notNull(),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqGuard: uniqueIndex("license_expiry_notifications_guard_idx").on(
      t.serverId,
      t.licenseExpiry,
      t.threshold,
    ),
  }),
);

export type LicenseExpiryNotification =
  typeof licenseExpiryNotificationsTable.$inferSelect;
