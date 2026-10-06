/**
 * Email transport — thin wrapper used by the api-server for transactional
 * notifications (license expiry warnings, payout failure alerts, etc.).
 *
 * Two modes, picked at call time from env so callers never branch:
 *
 *   Stub mode (default — no `RESEND_API_KEY`):
 *     - `sendEmail` resolves with `{ delivered: false, transport: "stub" }`
 *       after handing the payload to the optional `logger`. No network.
 *     - This is the production-safe default until ops provisions a real
 *       transport. The dedup table on the caller side still records the
 *       send, so flipping to live mode later won't re-blast users.
 *
 *   Live mode (with `RESEND_API_KEY`):
 *     - POSTs to https://api.resend.com/emails with the payload. Resend was
 *       picked because it has a single HTTPS endpoint and no SDK, so we
 *       avoid pulling in another package + supply-chain risk.
 *     - `RESEND_FROM` overrides the default From address.
 *
 * Callers (the api-server) should not look at env vars themselves — they
 * call `sendEmail` and let this module decide stub vs. live.
 */

export interface SendEmailInput {
  /** Recipient address. Single string or array; multiple = one combined send. */
  to: string | string[];
  subject: string;
  /** Plain-text body. Always include — many clients render it as a fallback. */
  text: string;
  /** Optional HTML body. */
  html?: string;
  /** Optional From override; falls back to RESEND_FROM env or a sensible default. */
  from?: string;
  /** Optional Reply-To override. */
  replyTo?: string;
}

export interface SendEmailResult {
  /** True iff the message was actually accepted by an external provider. */
  delivered: boolean;
  /** Which path handled the send. */
  transport: "stub" | "resend";
  /** Provider message id when available. */
  id?: string;
}

export interface EmailLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * The default From address used when neither `input.from` nor `RESEND_FROM`
 * is set. Matches the support address the served-app dashboard already
 * tells servers to email for license renewals.
 */
const DEFAULT_FROM = "SERVED. <noreply@servedlegal.com>";

function isLive(): boolean {
  return Boolean(process.env["RESEND_API_KEY"]);
}

function normalizeTo(to: string | string[]): string[] {
  return Array.isArray(to) ? to : [to];
}

/**
 * Send a transactional email. Never throws on transport errors — callers
 * should not have a happy-path that depends on delivery succeeding (the
 * scheduled jobs that use this run on a daily cadence and tolerate the
 * occasional missed send).
 */
export async function sendEmail(
  input: SendEmailInput,
  logger?: EmailLogger,
): Promise<SendEmailResult> {
  const to = normalizeTo(input.to);
  const from = input.from ?? process.env["RESEND_FROM"] ?? DEFAULT_FROM;

  if (!isLive()) {
    logger?.info(
      {
        to,
        subject: input.subject,
        from,
        bodyPreview: input.text.slice(0, 200),
      },
      "email:stub send",
    );
    return { delivered: false, transport: "stub" };
  }

  const apiKey = process.env["RESEND_API_KEY"]!;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger?.error(
        { to, subject: input.subject, status: res.status, body },
        "email:resend non-2xx",
      );
      return { delivered: false, transport: "resend" };
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { delivered: true, transport: "resend", id: json.id };
  } catch (err) {
    logger?.error(
      { err, to, subject: input.subject },
      "email:resend request failed",
    );
    return { delivered: false, transport: "resend" };
  }
}
