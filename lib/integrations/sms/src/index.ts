/**
 * SMS transport — thin wrapper used by the api-server for transactional
 * notifications that should reach a requester on their phone (pickup
 * milestone, future serve/attempt updates, etc.).
 *
 * Two modes, picked at call time from env so callers never branch:
 *
 *   Stub mode (default — no `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`):
 *     - `sendSms` resolves with `{ delivered: false, transport: "stub" }`
 *       after handing the payload to the optional `logger`. No network.
 *     - This is the production-safe default until ops provisions a real
 *       Twilio sub-account. The dedup table on the caller side still
 *       records the send, so flipping to live mode later won't re-blast
 *       people for older milestones.
 *
 *   Live mode (with `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`):
 *     - POSTs `application/x-www-form-urlencoded` to
 *       https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json with
 *       Basic auth (sid:token). Twilio was picked because it has a single
 *       HTTPS endpoint and a stable v2010 form-encoded API, so we avoid
 *       pulling in another SDK + supply-chain risk (mirroring the email
 *       transport's choice of Resend for the same reason).
 *     - `TWILIO_FROM` is the From phone number (E.164, e.g. "+15551234567")
 *       and is required when live. Alternatively `TWILIO_MESSAGING_SERVICE_SID`
 *       can be set to use a Messaging Service (recommended for production
 *       so Twilio handles sender pool / opt-out compliance), and takes
 *       precedence when both are set.
 *
 * Callers (the api-server) should not look at env vars themselves — they
 * call `sendSms` and let this module decide stub vs. live.
 *
 * Note on opt-out: this transport does NOT itself enforce per-recipient
 * opt-out; that's the caller's responsibility (the pickup notifier checks
 * `users.sms_opt_out` before invoking us). Twilio's own STOP/HELP keyword
 * handling still applies in live mode for compliance.
 */

export interface SendSmsInput {
  /**
   * Recipient phone number in E.164 format (e.g. "+14155551234").
   * Callers are responsible for normalization — we pass the string through
   * to Twilio unchanged so it returns a clear error if formatting is off.
   */
  to: string;
  /**
   * Message body. SMS is hard-capped at 1600 chars by Twilio and segments
   * at ~160 chars each; callers should keep bodies short. We do not
   * truncate here — silent truncation would be worse than a clear Twilio
   * error.
   */
  body: string;
  /**
   * Optional From override (E.164). Falls back to `TWILIO_FROM` env, and
   * is ignored entirely when `TWILIO_MESSAGING_SERVICE_SID` is set (the
   * messaging service picks the sender).
   */
  from?: string;
}

export interface SendSmsResult {
  /** True iff the message was actually accepted by an external provider. */
  delivered: boolean;
  /** Which path handled the send. */
  transport: "stub" | "twilio";
  /** Provider message id (Twilio "SID") when available. */
  id?: string;
}

export interface SmsLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

function isLive(): boolean {
  return Boolean(
    process.env["TWILIO_ACCOUNT_SID"] && process.env["TWILIO_AUTH_TOKEN"],
  );
}

/**
 * Send a transactional SMS. Never throws on transport errors — callers
 * should not have a happy-path that depends on delivery succeeding (the
 * pickup notifier still records the milestone in the DB whether or not
 * the SMS goes out, mirroring the email path).
 */
export async function sendSms(
  input: SendSmsInput,
  logger?: SmsLogger,
): Promise<SendSmsResult> {
  const to = input.to;
  const messagingServiceSid =
    process.env["TWILIO_MESSAGING_SERVICE_SID"]?.trim() || null;
  const from = messagingServiceSid
    ? null
    : (input.from ?? process.env["TWILIO_FROM"] ?? null);

  if (!isLive()) {
    logger?.info(
      {
        to,
        from,
        messagingServiceSid,
        bodyPreview: input.body.slice(0, 200),
      },
      "sms:stub send",
    );
    return { delivered: false, transport: "stub" };
  }

  const accountSid = process.env["TWILIO_ACCOUNT_SID"]!;
  const authToken = process.env["TWILIO_AUTH_TOKEN"]!;

  if (!messagingServiceSid && !from) {
    // Live mode but no sender configured — log loudly and fail soft so
    // the caller's idempotency claim is still preserved (a flipped flag
    // shouldn't cause a retry storm of "no sender" errors).
    logger?.error(
      { to },
      "sms:twilio missing TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID; cannot send",
    );
    return { delivered: false, transport: "twilio" };
  }

  const params = new URLSearchParams();
  params.set("To", to);
  params.set("Body", input.body);
  if (messagingServiceSid) {
    params.set("MessagingServiceSid", messagingServiceSid);
  } else if (from) {
    params.set("From", from);
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
    accountSid,
  )}/Messages.json`;
  const basic = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger?.error(
        { to, status: res.status, body: body.slice(0, 500) },
        "sms:twilio non-2xx",
      );
      return { delivered: false, transport: "twilio" };
    }
    const json = (await res.json().catch(() => ({}))) as { sid?: string };
    return { delivered: true, transport: "twilio", id: json.sid };
  } catch (err) {
    logger?.error({ err, to }, "sms:twilio request failed");
    return { delivered: false, transport: "twilio" };
  }
}
