/**
 * "Documents picked up" requester notification.
 *
 * The server-side milestone POST /api/jobs/:id/pickup flips
 * `jobs.picked_up_at` from null → now() and is the first lifecycle event
 * the requester wants real-time visibility into (the served-app shows it on
 * the job detail page, but a passive requester won't see that until they
 * log in). This module renders + dispatches the email and exposes the
 * "claim then notify" helper the route uses to keep the send exactly once.
 *
 * Idempotency model (matches the license-expiry job):
 *   - The atomic guard is the SQL update itself: we update the job row
 *     `WHERE picked_up_at IS NULL` and only consider the slot claimed if
 *     RETURNING gave us a row. A concurrent second POST (or a retry from
 *     a flaky proxy) sees 0 rows updated and skips the email entirely.
 *   - Email send failures do NOT roll back the claim. Mirroring
 *     licenseExpiryEmails.ts, the dedup token (here: `picked_up_at`) is
 *     retained so a broken provider can't re-trigger the send on the next
 *     attempt — that matches user expectation ("I already saw this update
 *     in the app, stop emailing me") and keeps the route simple.
 *
 * Transport is `@workspace/integrations-email`, which is stub-mode by
 * default and Resend-backed when RESEND_API_KEY is present (see that
 * package's docstring). Callers don't need to branch on env.
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  jobsTable,
  usersTable,
  type Job,
  type User,
} from "@workspace/db";
import { sendEmail, type SendEmailResult } from "@workspace/integrations-email";
import { sendSms, type SendSmsResult } from "@workspace/integrations-sms";
import { logger as defaultLogger } from "./logger";
import { buildAppUrl } from "./mailer";

export interface PickupEmailRenderInput {
  /** The job row, post-update (so `pickedUpAt` is set). */
  job: Pick<
    Job,
    | "id"
    | "platformRef"
    | "recipientName"
    | "pickupContactName"
    | "pickupContactPhone"
    | "pickupAddress"
    | "pickupCity"
    | "pickupState"
    | "pickupZip"
  >;
  /** Greeting name; falls back to "there". */
  requesterFirstName: string | null | undefined;
  /** Absolute URL into the served-app job detail page. */
  jobUrl: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Pickup SMS body, derived from the same fields as the email but trimmed
 * for the 160-char single-segment sweet spot. Pure: no DB/network/env.
 *
 * Output is one short sentence + the tracking URL, e.g.:
 *   "[SERVED.] Documents picked up for SERVED-2026-ABC123 (recipient: John Smith). Track: https://servedapp.co/app/jobs/1"
 *
 * If the assembled body would exceed Twilio's single-segment ceiling we
 * still send it (Twilio happily concatenates segments) — we just keep the
 * common case cheap.
 */
export function renderPickupSms(input: PickupEmailRenderInput): string {
  const { job, jobUrl } = input;
  return `[SERVED.] Documents picked up for ${job.platformRef} (recipient: ${job.recipientName}). Track: ${jobUrl}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the requester-facing pickup email. Pure: no DB, no env reads, no
 * network, so it's trivially unit-testable.
 *
 * The `text` body is the source of truth; the `html` body mirrors it in
 * the same order so plain-text-only mail clients see the same information
 * (and the same CTA target).
 */
export function renderPickupEmail(input: PickupEmailRenderInput): RenderedEmail {
  const { job, requesterFirstName, jobUrl } = input;
  const greeting = requesterFirstName?.trim() || "there";
  // Some pickup-contact fields are nullable in the DB even on a pickup job
  // (legacy rows pre-validation). Treat them as optional in the copy.
  const contact = job.pickupContactName?.trim() || "your contact";
  const phone = job.pickupContactPhone?.trim();
  const addressParts = [
    job.pickupAddress?.trim(),
    [job.pickupCity?.trim(), job.pickupState?.trim()].filter(Boolean).join(", "),
    job.pickupZip?.trim(),
  ].filter((p) => p && p.length > 0);
  const addressLine = addressParts.join(" ");

  const subject = `[SERVED.] Documents picked up — ${job.platformRef}`;
  const textLines: string[] = [
    `Hi ${greeting},`,
    "",
    `Your process server has picked up the documents for ${job.platformRef} (recipient: ${job.recipientName}).`,
    "",
    `Pickup contact: ${contact}${phone ? ` (${phone})` : ""}`,
  ];
  if (addressLine) {
    textLines.push(`Pickup location: ${addressLine}`);
  }
  textLines.push(
    "",
    `Track progress: ${jobUrl}`,
    "",
    "We'll email you again when the recipient has been served (or when an attempt is logged).",
    "",
    "— SERVED.",
  );
  const text = textLines.join("\n");

  const phoneHtml = phone ? ` (${escapeHtml(phone)})` : "";
  const addressHtml = addressLine
    ? `<p><strong>Pickup location:</strong> ${escapeHtml(addressLine)}</p>`
    : "";
  const html = `
    <p>Hi ${escapeHtml(greeting)},</p>
    <p>Your process server has picked up the documents for
      <strong>${escapeHtml(job.platformRef)}</strong>
      (recipient: ${escapeHtml(job.recipientName)}).</p>
    <p><strong>Pickup contact:</strong> ${escapeHtml(contact)}${phoneHtml}</p>
    ${addressHtml}
    <p><a href="${escapeHtml(jobUrl)}">Track progress on SERVED.</a></p>
    <p>We'll email you again when the recipient has been served (or when an
      attempt is logged).</p>
    <p>— SERVED.</p>
  `.trim();

  return { subject, text, html };
}

export interface PickupNotificationLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface ClaimPickupResult {
  /**
   * True iff this call won the atomic update race and stamped pickedUpAt.
   * False means another caller (or a previous request) already did, and
   * no email/SMS was attempted on this call.
   */
  claimed: boolean;
  /** The current job row (post-update if claimed, pre-existing otherwise). */
  job: Job;
  /** Email send result; undefined when `claimed` is false. */
  emailResult?: SendEmailResult;
  /**
   * True iff we skipped the email because no requester address was on file.
   * Distinguishes "we tried & it stubbed/failed" from "nobody to email".
   */
  emailSkippedNoRecipient?: boolean;
  /** SMS send result; undefined when `claimed` is false or SMS wasn't attempted. */
  smsResult?: SendSmsResult;
  /**
   * Reason the SMS leg was skipped on this call. Distinguishes the various
   * "no SMS sent" outcomes for log analysis and tests:
   *   - `"feature_disabled"`: env flag SMS_NOTIFICATIONS_ENABLED is off
   *     (default; ops hasn't turned the channel on globally yet).
   *   - `"opted_out"`: the requester has `users.sms_opt_out = true`.
   *   - `"no_phone"`: the requester has no phone number on file.
   *   - undefined: SMS was attempted (see `smsResult`).
   */
  smsSkippedReason?: "feature_disabled" | "opted_out" | "no_phone";
}

/**
 * Read the SMS feature flag at call time so a stub-mode test can flip it
 * mid-run without re-importing the module. The default (unset/"") is
 * "off" — ops must explicitly opt the channel in by setting
 * `SMS_NOTIFICATIONS_ENABLED=true|1` so we can ship the code path
 * without lighting up SMS for every existing requester at deploy time.
 */
function smsFeatureEnabled(): boolean {
  const raw = process.env["SMS_NOTIFICATIONS_ENABLED"]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Atomically stamp `picked_up_at` on the job (if not already set) and, on
 * a successful claim, send the requester pickup notification.
 *
 * Pre-existing validation (caller is the assigned server, job is a pickup
 * job, status isn't terminal, etc.) is the route's responsibility — this
 * function does NOT re-check those, so it's safe to wire from any caller
 * that has already authorized the pickup.
 *
 * Returns enough information for the route to:
 *   - 200 with the updated job when claimed,
 *   - 200 with the existing (already-picked-up) job when not.
 *
 * Throws only on unexpected DB errors. Email failures are swallowed by
 * the underlying transport (sendEmail itself never throws).
 */
export async function claimPickupAndNotifyRequester(args: {
  jobId: number;
  /**
   * Status to write alongside `picked_up_at` when we claim the slot.
   * The route picks this based on the prior status (pending|assigned →
   * in_progress; otherwise leave as-is). We accept it as a parameter so
   * this helper doesn't need to re-derive the state machine.
   */
  nextStatus: string;
  log?: PickupNotificationLogger;
}): Promise<ClaimPickupResult> {
  const log = args.log ?? defaultLogger;
  const now = new Date();

  // Atomic claim: only update if not already picked up. If the WHERE
  // clause matches no row (already picked up, or job was just deleted),
  // RETURNING gives [] and we know not to email.
  const [updated] = await db
    .update(jobsTable)
    .set({
      pickedUpAt: now,
      status: args.nextStatus,
      updatedAt: now,
    })
    .where(
      and(eq(jobsTable.id, args.jobId), isNull(jobsTable.pickedUpAt)),
    )
    .returning();

  if (!updated) {
    // Either already picked up, or the row vanished. Re-read and return.
    const [existing] = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, args.jobId));
    if (!existing) {
      // Caller already validated existence; if it disappears between
      // their SELECT and our UPDATE, surface as "not claimed" so the
      // route can 404 on its own.
      throw new Error(`pickup_notify: job ${args.jobId} not found`);
    }
    return { claimed: false, job: existing };
  }

  // Look up the requester for the To: address. We do this AFTER claiming
  // so a missing/never-onboarded requester can never block the pickup
  // event from being recorded.
  let requester: User | null = null;
  if (updated.requesterUserId) {
    const [row] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, updated.requesterUserId));
    requester = row ?? null;
  }

  // Email leg ----------------------------------------------------------
  // The email leg and the SMS leg are independent: a requester with only a
  // phone on file still gets the SMS, and one with only an email still
  // gets the email. Idempotency is provided by the SQL claim above (we
  // only reach this code when our UPDATE won the race), so it covers
  // both legs together — there's no separate per-channel dedup table.
  const recipient = requester?.email?.trim();
  const jobUrl = buildAppUrl(`/app/jobs/${updated.id}`);
  const rendered = renderPickupEmail({
    job: updated,
    requesterFirstName: requester?.firstName ?? null,
    jobUrl,
  });

  let emailResult: SendEmailResult | undefined;
  let emailSkippedNoRecipient: boolean | undefined;
  if (!recipient) {
    log.warn(
      {
        jobId: updated.id,
        platformRef: updated.platformRef,
        requesterUserId: updated.requesterUserId,
      },
      "pickup-notify: no requester email on file, skipping email send",
    );
    emailSkippedNoRecipient = true;
  } else {
    emailResult = await sendEmail(
      {
        to: recipient,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        replyTo: "support@servedlegal.com",
      },
      log,
    );
    log.info(
      {
        jobId: updated.id,
        platformRef: updated.platformRef,
        delivered: emailResult.delivered,
        transport: emailResult.transport,
      },
      "pickup-notify: requester email dispatched",
    );
  }

  // SMS leg ------------------------------------------------------------
  // Three short-circuit reasons before we ever build a Twilio request:
  //   1) global env flag is off (default until ops turns it on),
  //   2) the requester opted out of SMS in their account,
  //   3) we don't have a phone number for them.
  // Each is reported via `smsSkippedReason` so dashboards can tell the
  // cases apart without parsing log strings.
  let smsResult: SendSmsResult | undefined;
  let smsSkippedReason: ClaimPickupResult["smsSkippedReason"];
  if (!smsFeatureEnabled()) {
    smsSkippedReason = "feature_disabled";
  } else if (requester?.smsOptOut) {
    smsSkippedReason = "opted_out";
  } else {
    const phone = requester?.phone?.trim();
    if (!phone) {
      smsSkippedReason = "no_phone";
    } else {
      const body = renderPickupSms({
        job: updated,
        requesterFirstName: requester?.firstName ?? null,
        jobUrl,
      });
      smsResult = await sendSms({ to: phone, body }, log);
      log.info(
        {
          jobId: updated.id,
          platformRef: updated.platformRef,
          delivered: smsResult.delivered,
          transport: smsResult.transport,
        },
        "pickup-notify: requester sms dispatched",
      );
    }
  }
  if (smsSkippedReason) {
    log.info(
      {
        jobId: updated.id,
        platformRef: updated.platformRef,
        reason: smsSkippedReason,
      },
      "pickup-notify: sms leg skipped",
    );
  }

  return {
    claimed: true,
    job: updated,
    emailResult,
    emailSkippedNoRecipient,
    smsResult,
    smsSkippedReason,
  };
}
