/**
 * Daily license-expiry notification job.
 *
 * The admin roster and the server's own dashboard already surface a 30-day
 * driver's-license expiry warning, but it relies on the server logging in
 * to see it. This job emails the server (and an admin digest) at T-30 / T-7
 * / T-0 days so a lapsed license can't slip through to a real assignment.
 *
 * Idempotency:
 *   - Per-(serverId, licenseExpiry, threshold) writes to
 *     `license_expiry_notifications`, guarded by a unique index.
 *   - We use ON CONFLICT DO NOTHING + RETURNING to claim the slot atomically;
 *     if the insert returns no row, another run already sent that email and
 *     we skip the network call.
 *   - Including `licenseExpiry` in the dedup key means a renewal naturally
 *     resets the cycle — no manual cleanup needed.
 *
 * Recipients:
 *   - Each at-threshold server gets a personal email at their `servers.email`.
 *   - The admin digest (anyone within 7 days of expiry, including expired)
 *     goes to `LICENSE_EXPIRY_DIGEST_TO`, falling back to comma-separated
 *     `ADMIN_NOTIFY_EMAILS`. Skipped silently if neither is set.
 *
 * Operationally safe to run more than once per day; safe to run by hand from
 * the admin endpoint at /api/admin/license-notifications/run.
 */
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import {
  db,
  serversTable,
  licenseExpiryNotificationsTable,
  type Server,
} from "@workspace/db";
import { sendEmail } from "@workspace/integrations-email";
import { logger } from "./logger";

/** Day buckets (in days-until-expiry) at which we notify the server. */
export const LICENSE_THRESHOLDS = [30, 7, 0] as const;
export type LicenseThreshold = (typeof LICENSE_THRESHOLDS)[number];

/** Days-until-expiry window included in the admin digest (negative = expired). */
const ADMIN_DIGEST_MAX_DAYS = 7;

export interface LicenseExpiryRunResult {
  /** Number of servers inspected in this run. */
  scanned: number;
  /** Per-threshold count of emails actually sent (after dedup). */
  serverEmailsSent: Record<LicenseThreshold, number>;
  /** Per-threshold count of emails skipped because they were already sent. */
  serverEmailsSkipped: Record<LicenseThreshold, number>;
  /** Number of servers included in the admin digest (0 means no digest sent). */
  adminDigestRows: number;
  /** True iff an admin digest email was actually attempted. */
  adminDigestSent: boolean;
}

/**
 * Compute calendar days from `today` (UTC midnight) to `licenseExpiry`
 * (date-only). Returns null if the input is null/empty.
 *
 * Exported for tests so callers can pin a deterministic "today".
 */
export function daysUntilExpiry(
  licenseExpiry: string | null | undefined,
  today: Date = new Date(),
): number | null {
  if (!licenseExpiry) return null;
  // licenseExpiry is a date-only string like "2026-05-15"; anchor at UTC
  // midnight so DST/timezone offsets don't cause off-by-one errors.
  const expiry = new Date(`${licenseExpiry}T00:00:00Z`).getTime();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  return Math.floor((expiry - todayUtc) / (1000 * 60 * 60 * 24));
}

/**
 * Pick the threshold bucket a given days-until-expiry value falls into, or
 * null if none. Buckets fire at exactly 30 / 7 / 0 days. We don't use
 * "<=" semantics because the dedup table is keyed per-threshold and
 * per-expiry, so each bucket fires once per renewal cycle.
 */
export function thresholdForDays(days: number): LicenseThreshold | null {
  for (const t of LICENSE_THRESHOLDS) {
    if (days === t) return t;
  }
  return null;
}

function adminDigestRecipients(): string[] {
  const explicit = process.env["LICENSE_EXPIRY_DIGEST_TO"];
  if (explicit && explicit.trim().length > 0) {
    return explicit.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const fallback = process.env["ADMIN_NOTIFY_EMAILS"];
  if (fallback && fallback.trim().length > 0) {
    return fallback.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function renderServerEmail(
  server: Pick<Server, "name">,
  threshold: LicenseThreshold,
  licenseExpiry: string,
): { subject: string; text: string; html: string } {
  // threshold is 30 | 7 | 0; both non-zero buckets are plural so no
  // singular-day branch is needed.
  const headline =
    threshold === 0
      ? "Your driver's license expires today"
      : `Your driver's license expires in ${threshold} days`;
  const urgency =
    threshold === 0
      ? "Your account will be paused for new assignments until we have a renewed license on file."
      : threshold === 7
        ? "Please renew and send us a copy this week so your account stays active."
        : "Heads up — please plan to renew before the expiration date.";
  const subject = `[SERVED.] ${headline} (${licenseExpiry})`;
  const text = [
    `Hi ${server.name.split(" ")[0] || "there"},`,
    "",
    `${headline} (${licenseExpiry}).`,
    "",
    urgency,
    "",
    "Email a photo of your renewed license to support@servedlegal.com to keep your account active.",
    "",
    "— SERVED. Operations",
  ].join("\n");
  const html = `
    <p>Hi ${escapeHtml(server.name.split(" ")[0] || "there")},</p>
    <p><strong>${escapeHtml(headline)}</strong> (${escapeHtml(licenseExpiry)}).</p>
    <p>${escapeHtml(urgency)}</p>
    <p>Email a photo of your renewed license to
      <a href="mailto:support@servedlegal.com">support@servedlegal.com</a>
      to keep your account active.</p>
    <p>— SERVED. Operations</p>
  `.trim();
  return { subject, text, html };
}

function renderAdminDigest(
  rows: Array<{ server: Server; days: number }>,
): { subject: string; text: string; html: string } {
  const expiredCount = rows.filter((r) => r.days < 0).length;
  const todayCount = rows.filter((r) => r.days === 0).length;
  const soonCount = rows.filter((r) => r.days > 0).length;
  const subject = `[SERVED.] License expiry digest — ${rows.length} server${rows.length === 1 ? "" : "s"} need attention`;
  const lines: string[] = [
    `${rows.length} server${rows.length === 1 ? "" : "s"} ${rows.length === 1 ? "is" : "are"} within ${ADMIN_DIGEST_MAX_DAYS} days of license expiry`,
    `(expired: ${expiredCount}, today: ${todayCount}, upcoming: ${soonCount}).`,
    "",
  ];
  for (const { server, days } of rows) {
    const status =
      days < 0
        ? `EXPIRED ${Math.abs(days)}d ago`
        : days === 0
          ? "expires TODAY"
          : `expires in ${days}d`;
    lines.push(
      `- #${server.id} ${server.name} <${server.email}> — ${status} (${server.licenseExpiry})`,
    );
  }
  const text = lines.join("\n");
  const htmlRows = rows
    .map(({ server, days }) => {
      const status =
        days < 0
          ? `<strong style="color:#b91c1c">EXPIRED ${Math.abs(days)}d ago</strong>`
          : days === 0
            ? `<strong style="color:#b91c1c">expires TODAY</strong>`
            : `expires in ${days}d`;
      return `<li>#${server.id} ${escapeHtml(server.name)} &lt;${escapeHtml(server.email)}&gt; — ${status} (${escapeHtml(server.licenseExpiry ?? "")})</li>`;
    })
    .join("");
  const html = `
    <p>${rows.length} server${rows.length === 1 ? "" : "s"} ${rows.length === 1 ? "is" : "are"} within ${ADMIN_DIGEST_MAX_DAYS} days of license expiry
    (expired: ${expiredCount}, today: ${todayCount}, upcoming: ${soonCount}).</p>
    <ul>${htmlRows}</ul>
  `.trim();
  return { subject, text, html };
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
 * Atomically claim the (serverId, licenseExpiry, threshold) dedup slot.
 * Returns true iff this run owns the slot and should send.
 */
async function claimDedupSlot(
  serverId: number,
  licenseExpiry: string,
  threshold: LicenseThreshold,
): Promise<boolean> {
  const inserted = await db
    .insert(licenseExpiryNotificationsTable)
    .values({ serverId, licenseExpiry, threshold })
    .onConflictDoNothing({
      target: [
        licenseExpiryNotificationsTable.serverId,
        licenseExpiryNotificationsTable.licenseExpiry,
        licenseExpiryNotificationsTable.threshold,
      ],
    })
    .returning({ id: licenseExpiryNotificationsTable.id });
  return inserted.length > 0;
}

/**
 * Walk every server with a license_expiry on file, send the per-threshold
 * email (deduped), and send the admin digest. Tolerant of partial failure:
 * a thrown send still counts as "claimed" so we don't hammer a broken
 * provider on every interval tick.
 */
export async function runLicenseExpiryNotifications(
  now: Date = new Date(),
): Promise<LicenseExpiryRunResult> {
  const servers = await db
    .select()
    .from(serversTable)
    .where(
      and(
        isNotNull(serversTable.licenseExpiry),
        // Don't pester deactivated accounts.
        ne(serversTable.status, "inactive"),
      ),
    );

  const result: LicenseExpiryRunResult = {
    scanned: servers.length,
    serverEmailsSent: { 30: 0, 7: 0, 0: 0 },
    serverEmailsSkipped: { 30: 0, 7: 0, 0: 0 },
    adminDigestRows: 0,
    adminDigestSent: false,
  };

  const adminDigestRows: Array<{ server: Server; days: number }> = [];

  for (const server of servers) {
    const expiry = server.licenseExpiry;
    if (!expiry) continue;
    const days = daysUntilExpiry(expiry, now);
    if (days === null) continue;

    if (days <= ADMIN_DIGEST_MAX_DAYS) {
      adminDigestRows.push({ server, days });
    }

    const threshold = thresholdForDays(days);
    if (threshold === null) continue;

    const claimed = await claimDedupSlot(server.id, expiry, threshold);
    if (!claimed) {
      result.serverEmailsSkipped[threshold] += 1;
      continue;
    }

    const { subject, text, html } = renderServerEmail(server, threshold, expiry);
    try {
      await sendEmail(
        {
          to: server.email,
          subject,
          text,
          html,
          replyTo: "support@servedlegal.com",
        },
        logger,
      );
      result.serverEmailsSent[threshold] += 1;
    } catch (err) {
      // sendEmail itself doesn't throw, but defend against future regressions.
      logger.error(
        { err, serverId: server.id, threshold },
        "license-expiry: send failed (claim retained)",
      );
    }
  }

  result.adminDigestRows = adminDigestRows.length;
  if (adminDigestRows.length > 0) {
    const recipients = adminDigestRecipients();
    if (recipients.length === 0) {
      logger.info(
        { rows: adminDigestRows.length },
        "license-expiry: admin digest skipped (no LICENSE_EXPIRY_DIGEST_TO / ADMIN_NOTIFY_EMAILS)",
      );
    } else {
      adminDigestRows.sort((a, b) => a.days - b.days);
      const { subject, text, html } = renderAdminDigest(adminDigestRows);
      try {
        await sendEmail(
          { to: recipients, subject, text, html },
          logger,
        );
        result.adminDigestSent = true;
      } catch (err) {
        logger.error(
          { err, rows: adminDigestRows.length },
          "license-expiry: admin digest send failed",
        );
      }
    }
  }

  logger.info(result, "license-expiry: run complete");
  return result;
}

/**
 * Re-export of the underlying tables for tests / admin endpoints that want
 * to inspect what's been sent.
 */
export { licenseExpiryNotificationsTable, serversTable };
// Keep `inArray` and `eq` available to callers (e.g. test cleanup) without
// re-importing from drizzle-orm.
export { inArray, eq };
