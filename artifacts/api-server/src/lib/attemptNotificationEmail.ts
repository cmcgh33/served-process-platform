/**
 * Requester notifications for service-attempt lifecycle events.
 *
 * The pickup email body explicitly tells the requester:
 *   "We'll email you again when the recipient has been served (or when an
 *    attempt is logged)."
 *
 * This module makes good on that promise. POST /api/jobs/:id/attempts records
 * one of:
 *   - personal | substitute  → terminal (`markJobServed` flips status to
 *                              "served"). Send the "service complete" email.
 *   - unable                 → non-terminal. Send the "we logged an attempt"
 *                              email so the requester sees movement without
 *                              having to log in.
 *
 * Idempotency model (mirrors pickupNotificationEmail.ts):
 *   - The atomic guard is a SQL UPDATE of `service_attempts.notified_at`
 *     gated on `notified_at IS NULL`. Only the call that wins the update
 *     RETURNING dispatches the email; concurrent or replayed calls see 0
 *     rows updated and exit silently.
 *   - Email send failures do NOT roll back the claim. Same reasoning as
 *     pickup: at-most-once is the right semantic for a user-facing alert
 *     ("don't blast me if the provider had a hiccup"), and the dedup
 *     stamp protects against the next replay re-firing the send.
 *
 * Transport is `@workspace/integrations-email` — stub-mode by default,
 * Resend-backed when RESEND_API_KEY is set. Same pattern the pickup helper
 * uses, so callers don't branch on env.
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  jobsTable,
  serviceAttemptsTable,
  usersTable,
  type Job,
  type ServiceAttempt,
  type User,
} from "@workspace/db";
import { sendEmail, type SendEmailResult } from "@workspace/integrations-email";
import { logger as defaultLogger } from "./logger";
import { buildAppUrl } from "./mailer";

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
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
 * Human-friendly label for the `unableReason` enum so the email body reads
 * like a sentence. Falls back to the raw value for forward-compatibility
 * if the schema adds a new reason before this map is updated.
 */
const UNABLE_REASON_COPY: Record<string, string> = {
  no_answer: "No one answered the door.",
  refused: "The recipient refused service.",
  wrong_address: "The address turned out to be wrong.",
  gated: "Access was blocked (gated entry / locked building).",
  other: "See the server's notes below.",
};

export interface ServedEmailRenderInput {
  job: Pick<Job, "id" | "platformRef" | "recipientName">;
  attempt: Pick<ServiceAttempt, "outcome" | "attemptedAt">;
  requesterFirstName: string | null | undefined;
  jobUrl: string;
}

/**
 * Build the "service complete" email a requester gets the moment a server
 * confirms they handed over the documents. Pure: no DB, no env, no network.
 *
 * `text` is the source of truth; `html` mirrors it line-for-line so plain-
 * text-only mail clients see the same content + same CTA.
 */
export function renderServedEmail(input: ServedEmailRenderInput): RenderedEmail {
  const { job, attempt, requesterFirstName, jobUrl } = input;
  const greeting = requesterFirstName?.trim() || "there";
  const isSubstitute = attempt.outcome === "substitute";
  const methodLine = isSubstitute
    ? "The documents were left with someone of suitable age and discretion at the address (substitute service)."
    : "The recipient was personally served.";
  const servedAt = attempt.attemptedAt
    ? attempt.attemptedAt.toISOString()
    : new Date().toISOString();

  const subject = `[SERVED.] Service complete — ${job.platformRef}`;
  const text = [
    `Hi ${greeting},`,
    "",
    `Good news — your case ${job.platformRef} has been served.`,
    "",
    `Recipient: ${job.recipientName}`,
    `Time: ${servedAt}`,
    methodLine,
    "",
    `Affidavit & details: ${jobUrl}`,
    "",
    "The signed affidavit will be available on the case page shortly.",
    "",
    "— SERVED.",
  ].join("\n");

  const html = `
    <p>Hi ${escapeHtml(greeting)},</p>
    <p>Good news — your case <strong>${escapeHtml(job.platformRef)}</strong> has been served.</p>
    <p><strong>Recipient:</strong> ${escapeHtml(job.recipientName)}<br />
       <strong>Time:</strong> ${escapeHtml(servedAt)}<br />
       ${escapeHtml(methodLine)}</p>
    <p><a href="${escapeHtml(jobUrl)}">Open the case page on SERVED.</a></p>
    <p>The signed affidavit will be available on the case page shortly.</p>
    <p>— SERVED.</p>
  `.trim();

  return { subject, text, html };
}

export interface AttemptLoggedEmailRenderInput {
  job: Pick<Job, "id" | "platformRef" | "recipientName">;
  attempt: Pick<ServiceAttempt, "outcome" | "attemptedAt" | "unableReason" | "notes">;
  requesterFirstName: string | null | undefined;
  jobUrl: string;
}

/**
 * Build the "service attempt logged" email — sent for non-terminal attempts
 * (outcome = "unable") so the requester sees forward motion on their case.
 * Pure: no DB, no env, no network.
 */
export function renderAttemptLoggedEmail(
  input: AttemptLoggedEmailRenderInput,
): RenderedEmail {
  const { job, attempt, requesterFirstName, jobUrl } = input;
  const greeting = requesterFirstName?.trim() || "there";
  const attemptedAt = attempt.attemptedAt
    ? attempt.attemptedAt.toISOString()
    : new Date().toISOString();
  const reasonLine = attempt.unableReason
    ? UNABLE_REASON_COPY[attempt.unableReason] ?? attempt.unableReason
    : "The server was unable to complete service this attempt.";
  const notes = attempt.notes?.trim();

  const subject = `[SERVED.] Service attempt logged — ${job.platformRef}`;
  const textLines = [
    `Hi ${greeting},`,
    "",
    `Your process server logged a service attempt for ${job.platformRef} (recipient: ${job.recipientName}).`,
    "",
    `Time: ${attemptedAt}`,
    `Outcome: ${reasonLine}`,
  ];
  if (notes) {
    textLines.push("", `Server's notes: ${notes}`);
  }
  textLines.push(
    "",
    `View attempt history: ${jobUrl}`,
    "",
    "Your server will continue with the next attempt. We'll email you again when service is completed.",
    "",
    "— SERVED.",
  );

  const notesHtml = notes
    ? `<p><strong>Server's notes:</strong> ${escapeHtml(notes)}</p>`
    : "";
  const html = `
    <p>Hi ${escapeHtml(greeting)},</p>
    <p>Your process server logged a service attempt for
      <strong>${escapeHtml(job.platformRef)}</strong>
      (recipient: ${escapeHtml(job.recipientName)}).</p>
    <p><strong>Time:</strong> ${escapeHtml(attemptedAt)}<br />
       <strong>Outcome:</strong> ${escapeHtml(reasonLine)}</p>
    ${notesHtml}
    <p><a href="${escapeHtml(jobUrl)}">View attempt history on SERVED.</a></p>
    <p>Your server will continue with the next attempt. We'll email you again when service is completed.</p>
    <p>— SERVED.</p>
  `.trim();

  return { subject, text: textLines.join("\n"), html };
}

export interface AttemptNotificationLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface ClaimAttemptResult {
  /**
   * True iff this call won the atomic update race and stamped notifiedAt.
   * False means another caller (or a previous request) already did, and
   * no email was attempted on this call.
   */
  claimed: boolean;
  /** The current attempt row (post-update if claimed, pre-existing otherwise). */
  attempt: ServiceAttempt | null;
  /** Email send result; undefined when `claimed` is false. */
  emailResult?: SendEmailResult;
  /**
   * True iff we skipped the email because no requester address was on file.
   * Distinguishes "we tried & it stubbed/failed" from "nobody to email".
   */
  emailSkippedNoRecipient?: boolean;
  /**
   * True iff we picked the "served" template (terminal outcome). False for
   * the "attempt logged" template (non-terminal). Surfaced so callers can
   * log/observe which path actually fired.
   */
  servedEmail?: boolean;
}

/**
 * Atomically claim the per-attempt notification slot and dispatch the
 * appropriate requester email.
 *
 * Caller responsibilities (NOT re-checked here, by design — same contract
 * as claimPickupAndNotifyRequester):
 *   - The attempt has already been inserted (we look it up by id).
 *   - The route already authorised the actor that produced the attempt.
 *
 * Picks the email template from the attempt's outcome:
 *   - personal | substitute → renderServedEmail (terminal: service complete).
 *   - unable                → renderAttemptLoggedEmail (non-terminal update).
 *
 * Throws only on unexpected DB errors. Email transport failures are
 * swallowed by sendEmail itself.
 */
export async function claimAttemptAndNotifyRequester(args: {
  attemptId: number;
  log?: AttemptNotificationLogger;
}): Promise<ClaimAttemptResult> {
  const log = args.log ?? defaultLogger;
  const now = new Date();

  // Atomic claim: only update if we haven't already notified for this
  // attempt id. RETURNING gives us the post-update row only when we won
  // the race. Concurrent / replayed callers see [] and exit.
  const [updatedAttempt] = await db
    .update(serviceAttemptsTable)
    .set({ notifiedAt: now })
    .where(
      and(
        eq(serviceAttemptsTable.id, args.attemptId),
        isNull(serviceAttemptsTable.notifiedAt),
      ),
    )
    .returning();

  if (!updatedAttempt) {
    // Either already notified, or the row vanished. Re-read to give the
    // caller back the current state for logging.
    const [existing] = await db
      .select()
      .from(serviceAttemptsTable)
      .where(eq(serviceAttemptsTable.id, args.attemptId));
    return { claimed: false, attempt: existing ?? null };
  }

  // Look up the parent job + requester. We do this AFTER claiming so a
  // missing job/requester can never block the dedup stamp from being
  // recorded — same reasoning as pickup.
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, updatedAttempt.jobId));
  if (!job) {
    log.warn(
      { attemptId: args.attemptId, jobId: updatedAttempt.jobId },
      "attempt-notify: parent job missing, skipping send",
    );
    return { claimed: true, attempt: updatedAttempt };
  }

  let requester: User | null = null;
  if (job.requesterUserId) {
    const [row] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, job.requesterUserId));
    requester = row ?? null;
  }

  const recipient = requester?.email?.trim();
  if (!recipient) {
    log.warn(
      {
        attemptId: updatedAttempt.id,
        jobId: job.id,
        platformRef: job.platformRef,
        requesterUserId: job.requesterUserId,
      },
      "attempt-notify: no requester email on file, skipping send",
    );
    return {
      claimed: true,
      attempt: updatedAttempt,
      emailSkippedNoRecipient: true,
    };
  }

  const isTerminal =
    updatedAttempt.outcome === "personal" ||
    updatedAttempt.outcome === "substitute";
  const jobUrl = buildAppUrl(`/app/jobs/${job.id}`);
  const rendered = isTerminal
    ? renderServedEmail({
        job,
        attempt: updatedAttempt,
        requesterFirstName: requester?.firstName ?? null,
        jobUrl,
      })
    : renderAttemptLoggedEmail({
        job,
        attempt: updatedAttempt,
        requesterFirstName: requester?.firstName ?? null,
        jobUrl,
      });
  const emailResult = await sendEmail(
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
      attemptId: updatedAttempt.id,
      jobId: job.id,
      platformRef: job.platformRef,
      outcome: updatedAttempt.outcome,
      servedEmail: isTerminal,
      delivered: emailResult.delivered,
      transport: emailResult.transport,
    },
    "attempt-notify: requester email dispatched",
  );

  return {
    claimed: true,
    attempt: updatedAttempt,
    emailResult,
    servedEmail: isTerminal,
  };
}
