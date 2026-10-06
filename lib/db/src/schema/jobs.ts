import { pgTable, serial, text, integer, boolean, timestamp, doublePrecision, varchar, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { serversTable } from "./servers";

export const jobsTable = pgTable("jobs", {
  id: serial("id").primaryKey(),
  requesterUserId: varchar("requester_user_id", { length: 64 }),
  status: text("status").notNull().default("pending"),
  documentType: text("document_type").notNull(),
  recipientName: text("recipient_name").notNull(),
  recipientAddress: text("recipient_address").notNull(),
  recipientCity: text("recipient_city").notNull(),
  recipientState: text("recipient_state").notNull(),
  recipientZip: text("recipient_zip").notNull(),
  caseNumber: text("case_number"),
  // Department / division number on the case caption (e.g. "Dept. 14").
  // Optional — Nevada caption blocks render it as "Dept. No.: ___" when
  // present, blank when absent. Captured on the post-job form.
  deptNumber: text("dept_number"),
  matterName: text("matter_name"),
  // Requester contact snapshot — captured at job creation so the affidavit
  // and timeline always show the person/firm on record at the moment of
  // filing, even if the underlying Clerk user later edits their profile.
  // Name + email are required at publish-time (validated in routes/jobs.ts);
  // phone is optional. All three are nullable so legacy rows keep working.
  requesterName: text("requester_name"),
  requesterEmail: text("requester_email"),
  requesterPhone: text("requester_phone"),
  // Nevada-affidavit case caption fields. Optional + additive so legacy
  // jobs created before this column existed keep rendering. The on-disk
  // affidavit prefers these when present and falls back to recipientName
  // for the respondent line if respondent is null.
  courtName: text("court_name"),
  petitioner: text("petitioner"),
  respondent: text("respondent"),
  notes: text("notes"),
  documentHandling: text("document_handling", { enum: ["prints", "pickup", "either"] })
    .notNull()
    .default("prints"),
  pickupAddress: text("pickup_address"),
  pickupCity: text("pickup_city"),
  pickupState: text("pickup_state"),
  pickupZip: text("pickup_zip"),
  pickupContactName: text("pickup_contact_name"),
  pickupContactPhone: text("pickup_contact_phone"),
  clientId: integer("client_id").references(() => clientsTable.id),
  serverId: integer("server_id").references(() => serversTable.id),
  // When a server first claimed (or was assigned to) the job. Cleared on
  // release so a re-pickup re-stamps with the new acceptor's claim time.
  assignedAt: timestamp("assigned_at"),
  pickedUpAt: timestamp("picked_up_at"),
  servedAt: timestamp("served_at"),
  enRouteAt: timestamp("en_route_at"),
  releaseReason: text("release_reason"),
  releasedAt: timestamp("released_at"),
  gpsLat: doublePrecision("gps_lat"),
  gpsLng: doublePrecision("gps_lng"),
  proofPhotoUrl: text("proof_photo_url"),
  // Generated affidavit PDF — written post-confirm and served via
  // /api/storage/objects/* (ACL gates to requester / assigned server / admin).
  proofPdfUrl: text("proof_pdf_url"),
  // Generated "Notice of Service by Mail" PDF — Nevada substitute service
  // requires the server to also mail a follow-up copy to the named party
  // (NRCP 4.2). When the affidavit pipeline detects a substitute outcome
  // with `acknowledgeMailFollowup=true`, it generates a separate court-
  // fileable notice the server can hand the post office (or photograph
  // as proof of mailing) and persists the object path here. Cross-
  // referenced from the affidavit body via the deterministic notice ref
  // (`<platformRef>-NSM`). Null for jobs that don't require a follow-up
  // mailing (personal service, mail/posting outcomes, or substitute
  // attempts with no mailing commitment).
  noticeOfMailPdfUrl: text("notice_of_mail_pdf_url"),
  // Captured at confirm time. Typed name is the server's printed name on the
  // affidavit; signature image url is the canvas-drawn signature blob.
  signatureTypedName: text("signature_typed_name"),
  signatureImageUrl: text("signature_image_url"),
  // When set, the job is eligible for payout. Stamped inside the same txn
  // that flips status -> 'served' so the payout batch processor can scope
  // strictly by `payout_eligible_at IS NOT NULL AND payout_eligible_at <= NOW()`.
  payoutEligibleAt: timestamp("payout_eligible_at"),
  platformRef: text("platform_ref").notNull(),
  serviceType: text("service_type").notNull().default("standard"),
  grossCents: integer("gross_cents").notNull().default(0),
  platformFeeCents: integer("platform_fee_cents").notNull().default(0),
  serverPayoutCents: integer("server_payout_cents").notNull().default(0),
  pricingTier: text("pricing_tier").notNull().default("public"),
  // True iff any of the documents being served is a Nevada-PILB-restricted
  // type (subpoena variants, summons, complaint, etc.). Stamped at job-create
  // time + on the Stripe draft→pending flip so the marketplace feed and the
  // /jobs/:id/accept gate can run an O(1) check instead of cracking the
  // child documents-served rows on every read. Defaults to false so legacy
  // jobs and "Other"/non-licensed types stay open to all servers.
  requiresLicensedServer: boolean("requires_licensed_server").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  requesterIdx: index("jobs_requester_idx").on(t.requesterUserId),
  serverIdx: index("jobs_server_idx").on(t.serverId),
  statusIdx: index("jobs_status_idx").on(t.status),
}));

export const insertJobSchema = createInsertSchema(jobsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  platformRef: true,
  status: true,
  servedAt: true,
  pickedUpAt: true,
  gpsLat: true,
  gpsLng: true,
  requesterUserId: true,
});
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;
