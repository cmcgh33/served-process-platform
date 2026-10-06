/**
 * Certn integration — background-check provider for SERVED. process servers.
 *
 * The platform pays Certn out-of-band for each background check; what we
 * model here is just the asynchronous lifecycle:
 *
 *   submitCheck() ─► Certn API ─► (eventually) ─► Certn webhook ─► our DB
 *
 * Stub mode (no `CERTN_API_KEY` env var):
 *   - `submitCheck` short-circuits and returns a fake `checkId`. No network.
 *   - `verifyWebhookSignature` returns `false` (we never expect a real
 *     webhook in stub mode; the manual-verify admin endpoint is the path).
 *   - This is the default until a real Certn account is provisioned.
 *
 * Live mode (with `CERTN_API_KEY` + `CERTN_WEBHOOK_SECRET`):
 *   - `submitCheck` POSTs the applicant to Certn and returns the real id.
 *   - Webhooks are signature-verified via `CERTN_WEBHOOK_SECRET`.
 *
 * Callers (the api-server) should never look at env vars directly — they
 * call this module's pure functions and let it decide stub vs. live.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// ── Public types ─────────────────────────────────────────────────────────────

export interface ApplicantInput {
  /** Stable id we send to Certn; comes back on every webhook. */
  applicantRef: string;
  firstName: string;
  lastName: string;
  email: string;
  /** ISO date YYYY-MM-DD. Required for live mode; ignored in stub. */
  dob?: string;
  /** Last 4 of SSN. Required for live mode; ignored in stub. */
  ssnLast4?: string;
}

export interface SubmitCheckResult {
  /**
   * The Certn-side identifier for this background check. In stub mode this
   * is a fake `stub_<random>` string so callers can persist *something* for
   * the audit trail.
   */
  checkId: string;
  /** True iff we actually called Certn (i.e. the env was configured). */
  live: boolean;
}

/** Normalized result of a Certn webhook. */
export type CertnWebhookOutcome =
  | { kind: "verified"; checkId: string; applicantRef: string }
  | {
      kind: "failed";
      checkId: string;
      applicantRef: string;
      reason: string;
    }
  | { kind: "ignored"; reason: string };

// ── Env-driven config (read lazily so tests can stub process.env) ────────────

function getApiKey(): string | null {
  const key = process.env.CERTN_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

function getWebhookSecret(): string | null {
  const s = process.env.CERTN_WEBHOOK_SECRET?.trim();
  return s && s.length > 0 ? s : null;
}

function getApiBase(): string {
  return (
    process.env.CERTN_API_BASE?.trim() ||
    "https://api.certn.co/api/v2"
  );
}

export function isCertnLiveMode(): boolean {
  return getApiKey() !== null;
}

// ── Submit a background check ────────────────────────────────────────────────

/**
 * Submit an applicant for a background check. In stub mode, returns a fake
 * checkId immediately and performs no network IO. In live mode, POSTs to
 * Certn's applicant endpoint and returns the real id.
 *
 * Throws on live-mode network or schema failure so the caller can roll back
 * the txn that owns this side-effect.
 */
export async function submitCheck(
  input: ApplicantInput,
): Promise<SubmitCheckResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    // Stub mode — manufacture an id derived from the applicantRef so repeat
    // calls for the same user are stable.
    const checkId = `stub_${input.applicantRef}`;
    return { checkId, live: false };
  }

  // Live mode — minimal payload mirroring the Certn "applicants" API.
  const body = {
    request: {
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
      ...(input.dob ? { date_of_birth: input.dob } : {}),
      ...(input.ssnLast4 ? { ssn_last_4: input.ssnLast4 } : {}),
      reference: input.applicantRef,
    },
  };

  const res = await fetch(`${getApiBase()}/applications/`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Certn submitCheck failed (${res.status}): ${text.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as unknown;
  const parsed = z
    .object({ id: z.string().min(1) })
    .safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Certn submitCheck response missing id: ${JSON.stringify(json).slice(0, 500)}`,
    );
  }
  return { checkId: parsed.data.id, live: true };
}

// ── Webhook signature verification ───────────────────────────────────────────

/**
 * Verify a Certn webhook's HMAC-SHA256 signature header against the raw body
 * buffer. Returns `false` in stub mode (no secret configured) so an attacker
 * cannot poke the live webhook URL while we're still in dev.
 *
 * Header format we expect: hex-encoded HMAC-SHA256 of the raw body using
 * `CERTN_WEBHOOK_SECRET`. The exact header name varies — callers pass it in.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  const secret = getWebhookSecret();
  if (!secret) return false;
  if (!signatureHeader) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  // Compare in constant time — both must be the same length to use
  // timingSafeEqual without an extra branch leaking length info.
  const sigBuf = Buffer.from(signatureHeader, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length) return false;
  try {
    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

// ── Webhook payload parsing ─────────────────────────────────────────────────

/**
 * Coerce a parsed Certn webhook payload into a normalized outcome our code
 * can act on. Unknown event types collapse to `ignored`.
 *
 * Certn's event shape is conservative: we look at `report.id`,
 * `report.status` and `report.applicant.reference`. Anything else is logged
 * but not acted on.
 */
const CertnEventSchema = z.object({
  type: z.string().optional(),
  data: z
    .object({
      id: z.string().optional(),
      status: z.string().optional(),
      reference: z.string().optional(),
      reason: z.string().optional(),
      report: z
        .object({
          id: z.string().optional(),
          status: z.string().optional(),
          reason: z.string().optional(),
          applicant: z
            .object({ reference: z.string().optional() })
            .optional(),
        })
        .optional(),
    })
    .passthrough()
    .optional(),
});

export function parseCertnEvent(payload: unknown): CertnWebhookOutcome {
  const parsed = CertnEventSchema.safeParse(payload);
  if (!parsed.success) {
    return { kind: "ignored", reason: "Invalid Certn event shape" };
  }
  const d = parsed.data.data ?? {};
  const checkId = d.report?.id ?? d.id;
  const applicantRef = d.report?.applicant?.reference ?? d.reference;
  const status = (d.report?.status ?? d.status ?? "").toLowerCase();
  const reason = d.report?.reason ?? d.reason ?? "Background check failed";

  if (!checkId || !applicantRef) {
    return { kind: "ignored", reason: "Missing checkId / applicantRef" };
  }

  // Certn reports use a small set of terminal statuses; map them to ours.
  if (
    status === "completed" ||
    status === "approved" ||
    status === "clear" ||
    status === "verified"
  ) {
    return { kind: "verified", checkId, applicantRef };
  }
  if (
    status === "failed" ||
    status === "rejected" ||
    status === "denied" ||
    status === "consider"
  ) {
    return { kind: "failed", checkId, applicantRef, reason };
  }
  return { kind: "ignored", reason: `Non-terminal status: ${status}` };
}
