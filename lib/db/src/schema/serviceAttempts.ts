import { pgTable, serial, text, integer, timestamp, doublePrecision, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";
import { serversTable } from "./servers";

export const SERVICE_ATTEMPT_OUTCOMES = [
  "personal",
  "substitute",
  "mail",
  "posting",
  "publication",
  "non_est",
  "unable",
] as const;

export type ServiceAttemptOutcome = (typeof SERVICE_ATTEMPT_OUTCOMES)[number];

export const UNABLE_REASONS = [
  "no_answer",
  "refused",
  "wrong_address",
  "gated",
  "other",
] as const;

export type UnableReason = (typeof UNABLE_REASONS)[number];

export const serviceAttemptsTable = pgTable("service_attempts", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id, { onDelete: "cascade" }),
  serverId: integer("server_id").notNull().references(() => serversTable.id),
  outcome: text("outcome").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  gpsLat: doublePrecision("gps_lat").notNull(),
  gpsLng: doublePrecision("gps_lng").notNull(),
  // Provenance of the GPS fix (browser geolocation API). Captured at
  // attempt time so the affidavit can disclose how the coordinates were
  // obtained ("gps", "gps_assisted", "network"). Heuristic-derived from
  // pos.coords.accuracy by the client.
  gpsProvider: text("gps_provider"),
  // How the server confirmed the recipient's identity at the door:
  //   verbal       — recipient stated their name
  //   photo_match  — server compared the recipient's face/ID to a photo
  //   known        — server already knew the recipient by sight
  //   other        — free-text fallback, captured in identityOtherText
  identityMethod: text("identity_method"),
  identityOtherText: text("identity_other_text"),
  notes: text("notes"),
  photoUrl: text("photo_url"),
  substituteRecipientName: text("substitute_recipient_name"),
  substituteOver18: boolean("substitute_over_18"),
  substituteVerifiedResidence: boolean("substitute_verified_residence"),
  substituteRecipientAge: integer("substitute_recipient_age"),
  substituteIsCoResident: boolean("substitute_is_co_resident"),
  acknowledgeMailFollowup: boolean("acknowledge_mail_followup"),
  // Nevada Proof of Service fields. The mark-served stepped flow captures
  // the address where service occurred (which may differ from the job's
  // recipientAddress for a substitute or posting), a free-text method
  // narrative, plus per-outcome details (substitute description / co-residency,
  // mail follow-up date and address, posting location). All optional so
  // legacy attempts keep rendering.
  serviceAddress: text("service_address"),
  serviceCity: text("service_city"),
  serviceState: text("service_state"),
  serviceZip: text("service_zip"),
  methodNarrative: text("method_narrative"),
  recipientRelationship: text("recipient_relationship"),
  recipientDescription: text("recipient_description"),
  // Structured physical-description fields for the substitute recipient.
  // Nevada Proof-of-Service forms (and most real-world commercial PoS
  // affidavits) capture estimated age + gender + height + weight + any
  // identifying features so the served person can be identified later.
  // All optional — legacy attempts and non-substitute outcomes leave
  // them null, and the affidavit renderer falls back to the free-text
  // recipientDescription when these aren't populated.
  recipientAgeEstimate: text("recipient_age_estimate"),
  recipientGender: text("recipient_gender"),
  recipientHeight: text("recipient_height"),
  recipientWeight: text("recipient_weight"),
  recipientIdentifyingFeatures: text("recipient_identifying_features"),
  mailingDate: timestamp("mailing_date", { withTimezone: true }),
  mailingAddress: text("mailing_address"),
  // Phase 2 — mailing follow-up lifecycle. `mailingDate`/`mailingAddress`
  // above record the server's *commitment* to mail (captured at the moment
  // they marked the job served). The columns below record the actual
  // completion of that mailing, captured later via
  // POST /jobs/:id/confirm-mailing. Splitting commitment from completion
  // lets attorneys see "Mailing pending" vs "Mailed on YYYY-MM-DD" and
  // gives ops a queryable backlog of outstanding follow-ups.
  // `mailingCompletedAt` is the single idempotency token: once set, the
  // confirm endpoint returns 409.
  mailingCompletedAt: timestamp("mailing_completed_at", { withTimezone: true }),
  mailingProofPhotoUrl: text("mailing_proof_photo_url"),
  mailingConfirmedByUserId: text("mailing_confirmed_by_user_id"),
  postingLocationDescription: text("posting_location_description"),
  // Server's confirmation that a court order authorizing service by
  // posting (NRCP 4(g)) is on file. Required true on the request when
  // outcome=posting; persisted alongside the attempt as an audit trail.
  postingHasCourtOrder: boolean("posting_has_court_order"),
  // Service-by-Publication fields (NRS 14.040). Captured when outcome=publication.
  // The server attests to the court order authorizing publication, the
  // newspaper of general circulation, county of publication, and the
  // first/last publication dates (typically once a week for 4 consecutive
  // weeks). The newspaper publisher's separate Affidavit of Publication
  // is filed alongside this affidavit by the attorney.
  publicationOrderRef: text("publication_order_ref"),
  publicationNewspaper: text("publication_newspaper"),
  publicationCounty: text("publication_county"),
  publicationFirstDate: timestamp("publication_first_date", { withTimezone: true }),
  publicationLastDate: timestamp("publication_last_date", { withTimezone: true }),
  publicationHasCourtOrder: boolean("publication_has_court_order"),
  // Non-est diligent-search summary. Captured when outcome=non_est. The
  // attempts history (≥3 ideally) supplies the granular evidence; this
  // free-text field summarises the diligent-search conclusion ("Subject
  // appears to have moved; mail returned; neighbor confirms vacancy.").
  nonEstSummary: text("non_est_summary"),
  unableReason: text("unable_reason"),
  // Stamped when we dispatch the requester notification email for this
  // attempt (terminal "served" outcome OR a non-terminal "attempt logged"
  // update). Used as the atomic dedup token by claimAttemptAndNotifyRequester
  // so a replay of the same attempt id can never double-send. Mirrors the
  // pickedUpAt-as-claim-token pattern in pickupNotificationEmail.ts.
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  jobIdx: index("service_attempts_job_idx").on(t.jobId),
  jobAttemptedIdx: index("service_attempts_job_attempted_idx").on(t.jobId, t.attemptedAt),
}));

export const insertServiceAttemptSchema = createInsertSchema(serviceAttemptsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertServiceAttempt = z.infer<typeof insertServiceAttemptSchema>;
export type ServiceAttempt = typeof serviceAttemptsTable.$inferSelect;
