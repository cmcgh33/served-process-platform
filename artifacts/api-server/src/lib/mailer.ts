import { logger } from "./logger";

/**
 * Transactional email helpers.
 *
 * The app does not yet have a mailer wired up — Clerk handles its own
 * invitation emails, but everything else (background-check results, payout
 * failures, license expiry, …) needs an outbound channel of our own.
 *
 * This module is intentionally a thin wrapper so the very first feature that
 * needs email (payout-failure notifications) can ship without committing the
 * codebase to a specific SDK. It speaks SendGrid's HTTP API directly via
 * `fetch` and resolves the API key in priority order:
 *
 *   1. `SENDGRID_API_KEY` env var — set explicitly, easy ops override, used
 *      by tests.
 *   2. The Replit SendGrid integration — when the platform's connectors
 *      proxy is reachable (`REPLIT_CONNECTORS_HOSTNAME` is set) and a
 *      SendGrid connection has been authorized, the key is fetched at
 *      runtime. Refreshed periodically so credential rotation in the
 *      Replit panel takes effect without a redeploy.
 *
 * If neither source yields a key we degrade to a structured log line so:
 *
 *   - Local dev / preview environments where no API key is configured don't
 *     crash; the email body is logged instead and the call returns `false`.
 *   - Production with either source set sends real mail.
 *   - Callers don't have to know the difference — `sendEmail` always returns
 *     a boolean and never throws.
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML body. Plain-text fallback (`text`) is always sent. */
  html?: string;
  /** Optional override for the From address. */
  from?: string;
}

/**
 * Default From address for all transactional mail.
 *
 * Configurable via `MAIL_FROM` so ops can flip to a verified sender domain
 * without a redeploy. Falls back to a recognisable `no-reply@servedapp.co`
 * address that matches the support copy used elsewhere in the app.
 */
function defaultFromAddress(): string {
  return process.env.MAIL_FROM?.trim() || "SERVED. <no-reply@servedapp.co>";
}

/**
 * Detailed outcome of a `sendEmailDetailed` call. The plain `sendEmail`
 * helper collapses this into a boolean so most callers can stay
 * fire-and-forget; admin tools (e.g. the "send test email" smoke-test
 * button) use the detailed shape so failures can be diagnosed without
 * tailing server logs.
 */
export interface SendEmailResult {
  /** True iff SendGrid accepted the message (HTTP 2xx). */
  delivered: boolean;
  /**
   * True if a SendGrid API key was resolved. False means we degraded to a
   * structured log line — useful for distinguishing "no credentials" from
   * "credentials present but rejected".
   */
  hadCredential: boolean;
  /** HTTP status returned by SendGrid, when we made a request. */
  status?: number;
  /**
   * Human-readable diagnostic. Populated for failure cases (no credential,
   * non-2xx response body, network error message). Truncated to 500 chars.
   */
  detail?: string;
  /** Resolved From address (after MAIL_FROM / explicit override). */
  from: string;
}

/**
 * Send a transactional email and return a structured result.
 *
 * Most callers want the simpler `sendEmail` boolean; this richer variant
 * exists for diagnostic surfaces (the admin "send test email" button)
 * that need to distinguish "no credential configured" from "SendGrid
 * rejected the request" and to display the underlying error body.
 *
 * Never throws — caught errors are surfaced via `delivered=false` and
 * `detail`.
 */
export async function sendEmailDetailed(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const { to, subject, text, html } = input;
  const from = input.from ?? defaultFromAddress();

  const apiKey = await resolveSendgridApiKey();
  if (!apiKey) {
    // No mailer configured. Log the would-be message at info so ops can
    // still see what *would* have been sent (and so e2e tests can assert
    // wiring without a live SendGrid account). Returning `delivered:false`
    // with `hadCredential:false` lets callers distinguish "delivered"
    // from "logged-only".
    logger.info(
      {
        mail: { to, from, subject, textPreview: text.slice(0, 200) },
      },
      "No SendGrid credential available — email logged but not delivered",
    );
    return {
      delivered: false,
      hadCredential: false,
      from,
      detail:
        "No SendGrid credential available (set SENDGRID_API_KEY or connect the SendGrid integration). The email body was logged instead.",
    };
  }

  const fromParsed = parseFromAddress(from);
  const body = {
    personalizations: [{ to: [{ email: to }] }],
    from: fromParsed,
    subject,
    content: [
      { type: "text/plain", value: text },
      ...(html ? [{ type: "text/html", value: html }] : []),
    ],
  };

  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      logger.error(
        { to, subject, status: res.status, detail: detail.slice(0, 500) },
        "SendGrid rejected message",
      );
      return {
        delivered: false,
        hadCredential: true,
        status: res.status,
        from,
        detail: detail.slice(0, 500) || `HTTP ${res.status}`,
      };
    }
    logger.info({ to, subject }, "Email sent via SendGrid");
    return {
      delivered: true,
      hadCredential: true,
      status: res.status,
      from,
    };
  } catch (err) {
    logger.error({ err, to, subject }, "SendGrid request failed");
    const message = err instanceof Error ? err.message : String(err);
    return {
      delivered: false,
      hadCredential: true,
      from,
      detail: message.slice(0, 500),
    };
  }
}

/**
 * Send a transactional email.
 *
 * Returns `true` if the message was accepted by SendGrid (HTTP 2xx),
 * `false` otherwise (no API key configured, network error, non-2xx
 * response, …). Never throws — callers should fire-and-forget. For a
 * structured diagnostic result (used by the admin smoke-test surface),
 * call `sendEmailDetailed` instead.
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const result = await sendEmailDetailed(input);
  return result.delivered;
}

/**
 * Resolve the SendGrid API key.
 *
 * Priority order:
 *   1. `SENDGRID_API_KEY` env var (explicit override; what tests use).
 *   2. Replit SendGrid integration via the connectors proxy.
 *
 * Returns `null` when neither source yields a key. Never throws —
 * connector errors are logged and treated as "no credential".
 */
async function resolveSendgridApiKey(): Promise<string | null> {
  const fromEnv = process.env.SENDGRID_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  return getSendgridKeyFromConnector();
}

/**
 * SendGrid API key resolution from the Replit connectors proxy.
 *
 * IMPORTANT: per the Replit SendGrid blueprint, the credential the proxy
 * returns can rotate / expire — so we MUST fetch a fresh value on every
 * send instead of caching it. A previous version of this file cached the
 * key for 5 minutes and produced a confusing 401 from SendGrid:
 *   {"errors":[{"message":"The provided authorization grant is invalid,
 *    expired, or revoked"}]}
 * once the cached key fell behind the proxy's rotation.
 *
 * The `inFlight` promise still dedupes concurrent reads so a burst of
 * sends (e.g. the admin license-expiry digest fanning out to multiple
 * admins) doesn't fire N parallel proxy round-trips.
 */
let connectorKeyInFlight: Promise<string | null> | null = null;

/** Test-only: clear any in-flight connector lookup. */
export function _resetSendgridConnectorCacheForTests(): void {
  connectorKeyInFlight = null;
}

async function getSendgridKeyFromConnector(): Promise<string | null> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME?.trim();
  if (!hostname) return null;

  if (connectorKeyInFlight) return connectorKeyInFlight;

  connectorKeyInFlight = (async () => {
    try {
      const xReplitToken = process.env.REPL_IDENTITY
        ? `repl ${process.env.REPL_IDENTITY}`
        : process.env.WEB_REPL_RENEWAL
          ? `depl ${process.env.WEB_REPL_RENEWAL}`
          : null;
      if (!xReplitToken) {
        logger.debug(
          "REPLIT_CONNECTORS_HOSTNAME set but no REPL_IDENTITY / WEB_REPL_RENEWAL — skipping SendGrid connector lookup",
        );
        return null;
      }

      const url = `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=sendgrid`;
      // Header name must be the canonical hyphenated form; the underscore
      // variant is not a valid HTTP header name in most parsers and the
      // Replit connectors proxy explicitly expects `X-Replit-Token`.
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-Replit-Token": xReplitToken,
        },
      });
      if (!res.ok) {
        logger.warn(
          { status: res.status },
          "Replit connectors proxy returned non-2xx for SendGrid lookup",
        );
        return null;
      }
      const data = (await res.json()) as {
        items?: Array<{
          settings?: Record<string, unknown>;
        }>;
      };
      const settings = data.items?.[0]?.settings ?? {};
      // The Replit SendGrid connector exposes the key under `api_key`
      // historically, but we accept `access_token` too in case the
      // connector schema evolves.
      const candidate =
        (typeof settings.api_key === "string" && settings.api_key) ||
        (typeof settings.access_token === "string" &&
          settings.access_token) ||
        null;
      const key = candidate?.trim() || null;
      if (!key) {
        logger.debug(
          "Replit SendGrid connection present but no api_key/access_token in settings",
        );
        return null;
      }
      return key;
    } catch (err) {
      logger.warn({ err }, "Failed to fetch SendGrid key from Replit connector");
      return null;
    } finally {
      connectorKeyInFlight = null;
    }
  })();

  return connectorKeyInFlight;
}

/**
 * Parse "Name <addr@host>" or bare "addr@host" into the SendGrid
 * `{ email, name? }` shape. Falls back to using the input as the email
 * with no name if it doesn't match the angle-bracket form.
 */
function parseFromAddress(raw: string): { email: string; name?: string } {
  const match = raw.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (match) {
    const name = match[1]?.trim();
    const email = match[2]!.trim();
    return name ? { email, name } : { email };
  }
  return { email: raw.trim() };
}

/**
 * Build an absolute URL into the served-app for inclusion in email bodies.
 * Falls back to the published Replit domain in dev, and to a sensible
 * production URL when neither override is set.
 */
export function buildAppUrl(path: string): string {
  const explicit = process.env.SERVED_APP_URL?.replace(/\/+$/, "");
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  const base =
    explicit ||
    (replitDomain ? `https://${replitDomain}` : "https://servedapp.co");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** Format a USD cent amount as `$12.34`. */
function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export interface PayoutFailedEmailInput {
  to: string;
  /** Display name for the greeting; falls back to "there". */
  serverName?: string | null;
  /** Cents that didn't move. */
  amountCents: number;
  /** Human-readable job reference (e.g. `SERVED-00001-2026`). */
  jobReference: string;
  /** Persisted `payouts.failure_reason` from the catch block. */
  failureReason: string | null;
}

/**
 * Compose and send the "your payout couldn't be transferred" email.
 *
 * Mirrors the wallet UI's failure card so the server sees the same
 * explanation and the same CTAs (open Stripe Express dashboard, contact
 * support) without having to refresh the page.
 */
export async function sendPayoutFailedEmail(
  input: PayoutFailedEmailInput,
): Promise<boolean> {
  const greetingName = input.serverName?.trim() || "there";
  const amount = formatUsd(input.amountCents);
  const reason =
    input.failureReason?.trim() ||
    "No reason was returned by Stripe. Open your dashboard or contact support to investigate.";
  const walletUrl = buildAppUrl("/app/server/wallet");
  const stripeDashboardUrl = "https://dashboard.stripe.com/express";
  // Mirror the support contact used by the wallet's failure CTA so a
  // server clicking "Contact support" in the email lands in the same
  // mailbox as the wallet UI's `mailto:` link.
  const supportEmail = "support@served.legal";
  const supportMailto = `mailto:${supportEmail}?subject=Payout%20transfer%20failed`;

  const subject = `Payout failed — ${amount} for ${input.jobReference}`;

  const text = [
    `Hi ${greetingName},`,
    "",
    `Stripe couldn't transfer your ${amount} payout for job ${input.jobReference}.`,
    "",
    `Reason: ${reason}`,
    "",
    "What to do next:",
    `  • Open your Stripe Express dashboard to check your bank/payout status: ${stripeDashboardUrl}`,
    `  • View this payout in your wallet: ${walletUrl}`,
    `  • Contact ${supportEmail} if you need help.`,
    "",
    "We'll automatically retry once the underlying issue is resolved.",
    "",
    "— SERVED.",
  ].join("\n");

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
  <p>Hi ${escapeHtml(greetingName)},</p>
  <p>Stripe couldn't transfer your <strong>${escapeHtml(amount)}</strong> payout for job
     <strong>${escapeHtml(input.jobReference)}</strong>.</p>
  <p style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;color:#991b1b;">
    <strong>Reason:</strong> ${escapeHtml(reason)}
  </p>
  <p>What to do next:</p>
  <ul>
    <li><a href="${escapeHtml(stripeDashboardUrl)}">Open your Stripe Express dashboard</a> to check bank / payout status.</li>
    <li><a href="${escapeHtml(walletUrl)}">View this payout in your wallet</a>.</li>
    <li><a href="${escapeHtml(supportMailto)}">Contact support</a> if you need help.</li>
  </ul>
  <p style="color:#555;font-size:13px;">We'll automatically retry once the underlying issue is resolved.</p>
  <p style="color:#555;font-size:13px;">— SERVED.</p>
</body></html>`;

  return sendEmail({ to: input.to, subject, text, html });
}

export interface ServerInviteEmailInput {
  to: string;
  /** Display name for the greeting; falls back to "there". */
  serverName?: string | null;
  /** The Clerk-issued accept-invitation URL. */
  inviteUrl: string;
  /**
   * When true, mention that they've been pre-verified and can start
   * accepting jobs as soon as they finish setting up their account.
   */
  preVerified?: boolean;
}

/**
 * Compose and send the SERVED.-branded "you've been invited as a process
 * server" email. Used in place of Clerk's default invitation email so the
 * sender domain, branding, and copy match the rest of the platform.
 *
 * The body links to the Clerk-issued invitation URL — clicking it lets the
 * recipient set a password and lands them in the role chooser.
 */
export async function sendServerInviteEmail(
  input: ServerInviteEmailInput,
): Promise<boolean> {
  const greetingName = input.serverName?.trim() || "there";
  const subject = "You're invited to join SERVED. as a process server";
  const verifiedLine = input.preVerified
    ? "Your license has already been verified by our team — once you finish setting up your account you'll be able to accept jobs right away."
    : "Once you finish setting up your account you'll be guided through credential verification before your first job.";
  // No native mobile app yet — SERVED. runs entirely in the browser. Tell
  // the recipient explicitly so they don't go hunting in the App Store.
  const mobileTipText =
    "SERVED. runs in your browser — no app to install. After you set your password, open it on your phone in Safari or Chrome and you can take your first job from there.";
  const mobileTipHtml =
    "SERVED. runs in your browser — no app to install. After you set your password, open it on your phone in Safari or Chrome and you can take your first job from there.";

  const text = [
    `Hi ${greetingName},`,
    "",
    "You've been invited to join SERVED. as a process server.",
    "",
    verifiedLine,
    "",
    `Accept your invitation and set your password here: ${input.inviteUrl}`,
    "",
    mobileTipText,
    "",
    "If you weren't expecting this email, you can safely ignore it.",
    "",
    "— SERVED.",
  ].join("\n");

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5; max-width: 560px; margin: 0 auto;">
  <p style="font-size: 18px; font-weight: 600; letter-spacing: 0.04em; color: #111;">SERVED.</p>
  <p>Hi ${escapeHtml(greetingName)},</p>
  <p>You've been invited to join <strong>SERVED.</strong> as a process server.</p>
  <p>${escapeHtml(verifiedLine)}</p>
  <p style="margin: 28px 0;">
    <a href="${escapeHtml(input.inviteUrl)}"
       style="display:inline-block;background:#facc15;color:#111;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;">
      Accept invitation
    </a>
  </p>
  <p style="color:#555;font-size:13px;">
    Or paste this link into your browser:<br>
    <a href="${escapeHtml(input.inviteUrl)}" style="word-break:break-all;color:#555;">${escapeHtml(input.inviteUrl)}</a>
  </p>
  <p style="background:#fef9c3;border:1px solid #facc15;border-radius:8px;padding:12px;color:#713f12;font-size:14px;">
    ${escapeHtml(mobileTipHtml)}
  </p>
  <p style="color:#555;font-size:13px;">If you weren't expecting this email, you can safely ignore it.</p>
  <p style="color:#555;font-size:13px;">— SERVED.</p>
</body></html>`;

  return sendEmail({ to: input.to, subject, text, html });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
