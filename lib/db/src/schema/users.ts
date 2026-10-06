import { boolean, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const userRoles = ["requester", "attorney", "server"] as const;
export type UserRole = (typeof userRoles)[number];

export const attorneyPlans = ["solo", "firm", "firm_pro", "enterprise"] as const;
export type AttorneyPlan = (typeof attorneyPlans)[number];

export const usersTable = pgTable("users", {
  id: varchar("id", { length: 64 }).primaryKey(),
  email: text("email"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  role: text("role", { enum: userRoles }),
  plan: text("plan", { enum: attorneyPlans }).notNull().default("firm"),
  /**
   * Mobile phone number for SMS notifications, in E.164 format
   * (e.g. "+14155551234"). Nullable because requester accounts created
   * before SMS shipped won't have one on file; the pickup notifier
   * silently falls back to email-only when this is missing.
   */
  phone: text("phone"),
  /**
   * Per-account SMS kill switch. When true, the SMS leg of any
   * notification is suppressed even if `phone` is present and the
   * `SMS_NOTIFICATIONS_ENABLED` env flag is on. Email is unaffected.
   * Defaults to false so existing users with phone numbers receive SMS
   * once ops flips the env flag, matching the original "email and/or
   * SMS" promise without forcing an opt-in dance.
   */
  smsOptOut: boolean("sms_opt_out").notNull().default(false),
  /**
   * Attorney "Firm Profile" — the law firm's mailing address + a default
   * pickup contact. Captured once on the Settings page and used to
   * autofill pickup fields on every new pickup/either job so attorneys
   * don't have to retype them. All nullable; only attorneys are expected
   * to populate these but the columns live on `users` because every
   * account is one row regardless of role.
   */
  firmName: text("firm_name"),
  firmAddress: text("firm_address"),
  firmAddress2: text("firm_address2"),
  firmCity: text("firm_city"),
  firmState: text("firm_state"),
  firmZip: text("firm_zip"),
  firmPhone: text("firm_phone"),
  firmContactName: text("firm_contact_name"),
  /**
   * State bar number + issuing state. Optional but encouraged at
   * onboarding time so the firm appears verified to recipients and
   * shows up correctly on affidavit captions.
   */
  barNumber: text("bar_number"),
  barState: text("bar_state"),
  /**
   * Stamped the moment an attorney saves the onboarding form. When
   * null, the attorney dashboard redirects to /app/attorney/onboarding
   * before rendering. Clearing this would re-prompt onboarding (admin
   * only — no UI exposes it).
   */
  attorneyOnboardedAt: timestamp("attorney_onboarded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
