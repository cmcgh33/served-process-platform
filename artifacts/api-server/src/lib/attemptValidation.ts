// Pure validation helpers for POST /jobs/:id/attempts. Kept outside the
// route handler so they can be unit-tested without spinning up the
// express app, the DB, or Clerk.
//
// These mirror — and are the source of truth for — the substitute/unable
// rules enforced by the API. The route handler delegates to
// `validateAttemptBody` and treats `{ ok: false, error }` as a 400 response.
//
// State-specific substitute rules
// --------------------------------
// In addition to the universal substitute trio (recipient name, over-18,
// residence verified), three real-world states layer on extra requirements
// that real process-server affidavits must reflect:
//
//   • CA — CCP § 415.20: a copy must also be mailed to the recipient
//     within 10 days of the substitute service. We require the server to
//     acknowledge the mail follow-up at attempt time.
//   • FL — F.S. § 48.031(1)(a): the substitute must be a co-resident at
//     least 15 years old. We accept `substituteRecipientAge >= 15` (or the
//     legacy over-18 checkbox) plus an explicit co-residency confirmation.
//   • NY — CPLR § 308(2): "deliver and mail" — substitute service to a
//     person of suitable age and discretion at the dwelling/place of
//     business, plus a mailed copy. We require the mail-followup
//     acknowledgement, same as CA.
//   • NV — NRCP 4.2(b): substituted service must include mailing a copy
//     of the documents to the same address. Unlike CA/NY, this is not
//     opt-in — every Nevada substitute service must record the mailing
//     date and address, otherwise the affidavit is facially defective.

export const UNABLE_REASONS = [
  "no_answer",
  "refused",
  "wrong_address",
  "gated",
  "other",
] as const;

export type UnableReason = (typeof UNABLE_REASONS)[number];

export type AttemptOutcome =
  | "personal"
  | "substitute"
  | "mail"
  | "posting"
  | "publication"
  | "non_est"
  | "unable";

export interface AttemptBodyInput {
  outcome: AttemptOutcome;
  substituteRecipientName?: string | null;
  substituteOver18?: boolean | null;
  substituteVerifiedResidence?: boolean | null;
  substituteRecipientAge?: number | null;
  substituteIsCoResident?: boolean | null;
  acknowledgeMailFollowup?: boolean | null;
  unableReason?: string | null;
  // Nevada-style branches.
  mailingDate?: string | Date | null;
  mailingAddress?: string | null;
  postingLocationDescription?: string | null;
  postingHasCourtOrder?: boolean | null;
  // Publication / non-est branches (Nevada NRS 14.040 publication; non-est
  // = "subject cannot be found" return after diligent search).
  publicationOrderRef?: string | null;
  publicationNewspaper?: string | null;
  publicationCounty?: string | null;
  publicationFirstDate?: string | Date | null;
  publicationLastDate?: string | Date | null;
  publicationHasCourtOrder?: boolean | null;
  nonEstSummary?: string | null;
  // Substitute-recipient identification fields. Required (per the rules
  // below) on every substitute outcome so the resulting affidavit can
  // describe who actually accepted the documents — courts routinely
  // reject substitute affidavits that omit this.
  recipientRelationship?: string | null;
  recipientAgeEstimate?: string | null;
  recipientGender?: string | null;
  recipientHeight?: string | null;
  recipientWeight?: string | null;
  recipientIdentifyingFeatures?: string | null;
  // Identity confirmation + internal-tracking photo. Required on every
  // completing personal/substitute attempt so the API can't be bypassed
  // by direct callers or future client regressions. The photo is stored
  // on the job + attempt rows but is intentionally NOT rendered onto
  // the affidavit PDF.
  identityMethod?: string | null;
  identityOtherText?: string | null;
  photoUrl?: string | null;
}

const IDENTITY_METHODS = new Set([
  "verbal",
  "photo_match",
  "known",
  "other",
]);

export type AttemptValidationResult =
  | { ok: true }
  | { ok: false; error: string };

// State whose two-letter code maps to a documented set of extra rules.
// Anything not listed falls back to the universal trio only.
const MAIL_FOLLOWUP_STATES = new Set(["CA", "NY"]);
const FLORIDA = "FL";
const FL_MIN_AGE = 15;

/**
 * Normalises whatever the job stores in `recipientState` to an uppercase
 * two-letter code. We accept "ca", "Ca", "California", etc. so the caller
 * doesn't have to pre-process job rows.
 */
function normaliseState(state: string | null | undefined): string | null {
  if (!state) return null;
  const trimmed = state.trim();
  if (!trimmed) return null;
  if (trimmed.length === 2) return trimmed.toUpperCase();
  // Alias map for the states we actually enforce. Critically, "Nevada"
  // must map to NV — the previous slice(0,2) fallback turned it into
  // "NE" and silently bypassed the NRCP 4.2(b)/(c) mailing rules. Any
  // other long-form name returns null and we just use the universal
  // trio.
  const lower = trimmed.toLowerCase();
  if (lower === "california") return "CA";
  if (lower === "florida") return FLORIDA;
  if (lower === "new york") return "NY";
  if (lower === "nevada") return "NV";
  return null;
}

/**
 * Pure helper that returns the per-state requirement summary surfaced in
 * the Log Attempt modal so the UI and the API agree on the wording.
 */
export function describeStateSubstituteRules(
  state: string | null | undefined,
): string | null {
  const code = normaliseState(state);
  if (code === "CA") {
    return "California (CCP §415.20): the substitute must be 18+, and a copy of the documents must be mailed to the recipient within 10 days. Confirm the mail follow-up below.";
  }
  if (code === FLORIDA) {
    return "Florida (F.S. §48.031): the substitute must be a co-resident at least 15 years old. Record the recipient's age and confirm they live at this address.";
  }
  if (code === "NY") {
    return "New York (CPLR §308(2)): the substitute must be of suitable age and discretion (18+) at the dwelling or workplace, and a copy must also be mailed. Confirm the mail follow-up below.";
  }
  if (code === "NV") {
    return "Nevada (NRCP 4.2(b)): the substitute must be of suitable age and discretion (18+) at the recipient's dwelling, and a copy of the documents must also be mailed to that address. Record the mailing date and address below.";
  }
  return null;
}

export function validateAttemptBody(
  body: AttemptBodyInput,
  state?: string | null,
): AttemptValidationResult {
  // Identity confirmation is mandatory on every completing personal or
  // substitute attempt — courts routinely reject affidavits that don't
  // explain how the recipient was identified, and we want platform
  // records to capture this even though the photo+method aren't
  // rendered onto the PDF itself.
  if (body.outcome === "personal" || body.outcome === "substitute") {
    const method = body.identityMethod?.trim();
    if (!method || !IDENTITY_METHODS.has(method)) {
      return {
        ok: false,
        error:
          "Identity confirmation is required (verbal, photo_match, known, or other).",
      };
    }
    if (method === "other") {
      const detail = body.identityOtherText?.trim();
      if (!detail || detail.length < 2) {
        return {
          ok: false,
          error:
            "Identity confirmation 'other' requires a brief description of how identity was verified.",
        };
      }
    }
  }
  // Personal service additionally requires an internal-tracking photo so
  // the platform always has scene evidence on file. Substitute service
  // keeps the photo optional.
  if (body.outcome === "personal") {
    const photo = body.photoUrl?.trim();
    if (!photo) {
      return {
        ok: false,
        error:
          "Personal service requires a photo of the recipient or service scene for internal records.",
      };
    }
  }

  if (body.outcome === "substitute") {
    const name = body.substituteRecipientName?.trim();
    const code = normaliseState(state);

    // Universal trio first — but in Florida the over-18 piece is replaced
    // by the explicit age check below, so only require it elsewhere.
    if (!name) {
      return {
        ok: false,
        error:
          "Substitute service requires the name of the person served.",
      };
    }
    if (body.substituteVerifiedResidence !== true) {
      return {
        ok: false,
        error:
          "Substitute service requires confirmation that the recipient lives at the address.",
      };
    }

    // Substitute affidavits must record the recipient's relationship to
    // the named defendant (spouse, co-resident, employee, etc.) so the
    // court can verify the person was a "person of suitable age and
    // discretion" in fact, not just by checkbox.
    const relationship = body.recipientRelationship?.trim();
    if (!relationship) {
      return {
        ok: false,
        error:
          "Substitute service requires the recipient's relationship to the named defendant (e.g. spouse, co-resident, manager).",
      };
    }

    // Structured physical description — at minimum age estimate +
    // gender + one identifying detail (height, weight, or other
    // identifying features). Without this trio the affidavit cannot
    // describe the person served well enough to defend the service if
    // contested.
    const ageEstimate = body.recipientAgeEstimate?.trim();
    const gender = body.recipientGender?.trim();
    const height = body.recipientHeight?.trim();
    const weight = body.recipientWeight?.trim();
    const features = body.recipientIdentifyingFeatures?.trim();
    if (!ageEstimate) {
      return {
        ok: false,
        error:
          "Substitute service requires an estimated age for the recipient.",
      };
    }
    if (!gender) {
      return {
        ok: false,
        error:
          "Substitute service requires a gender description for the recipient.",
      };
    }
    if (!height && !weight && !features) {
      return {
        ok: false,
        error:
          "Substitute service requires at least one identifying physical detail for the recipient (height, weight, or other identifying features).",
      };
    }

    if (code === FLORIDA) {
      const age = body.substituteRecipientAge;
      const ageOk =
        (typeof age === "number" && age >= FL_MIN_AGE) ||
        body.substituteOver18 === true;
      if (!ageOk) {
        return {
          ok: false,
          error:
            "Florida substitute service requires the recipient to be a resident at least 15 years old. Record their age before submitting.",
        };
      }
      if (body.substituteIsCoResident !== true) {
        return {
          ok: false,
          error:
            "Florida substitute service requires the person served to be a co-resident at the address. Confirm co-residency before submitting.",
        };
      }
    } else {
      // Non-FL states keep the over-18 requirement.
      if (body.substituteOver18 !== true) {
        return {
          ok: false,
          error:
            "Substitute service requires confirmation that the person served is at least 18 years old.",
        };
      }
    }

    if (code && MAIL_FOLLOWUP_STATES.has(code)) {
      if (body.acknowledgeMailFollowup !== true) {
        const stateName = code === "CA" ? "California" : "New York";
        const detail =
          code === "CA"
            ? "a copy of the documents must be mailed to the recipient within 10 days (CCP §415.20)"
            : "a copy of the documents must also be mailed to the recipient (CPLR §308)";
        return {
          ok: false,
          error: `${stateName} substitute service requires ${detail}. Confirm you will mail the follow-up copy before submitting.`,
        };
      }
    }

    // Nevada substitute service (NRCP 4.2(b)) must always include a
    // follow-up mailing — there is no "no mailing required" branch.
    // Require the mailing date and address regardless of whether the UI
    // surfaced the acknowledgement checkbox, so older clients,
    // integrations, and direct API callers can't bypass the rule and
    // produce a facially-defective Nevada affidavit.
    if (code === "NV") {
      if (!body.mailingDate) {
        return {
          ok: false,
          error:
            "Nevada substitute service (NRCP 4.2(b)) requires the date the copy of the documents was (or will be) mailed.",
        };
      }
      const mailingAddr = body.mailingAddress?.trim();
      if (!mailingAddr) {
        return {
          ok: false,
          error:
            "Nevada substitute service (NRCP 4.2(b)) requires the address the copy of the documents was (or will be) mailed to.",
        };
      }
    }

    // When the server commits to a follow-up mailing for a substitute
    // service (e.g. CA/NY), the mailing date and address are part of
    // the affidavit's "manner of service" block — without them the
    // mailing can't be attested to. Enforce both whenever the commitment
    // box is checked, regardless of state. (NV is already covered above.)
    if (body.acknowledgeMailFollowup === true) {
      if (!body.mailingDate) {
        return {
          ok: false,
          error:
            "Substitute service with a mail follow-up requires the date the copy was (or will be) mailed.",
        };
      }
      const mailingAddr = body.mailingAddress?.trim();
      if (!mailingAddr) {
        return {
          ok: false,
          error:
            "Substitute service with a mail follow-up requires the address the copy was (or will be) mailed to.",
        };
      }
    }
  }

  if (body.outcome === "mail") {
    const addr = body.mailingAddress?.trim();
    if (!addr) {
      return {
        ok: false,
        error:
          "Service by mail requires a mailing address.",
      };
    }
    if (!body.mailingDate) {
      return {
        ok: false,
        error:
          "Service by mail requires the date the documents were deposited.",
      };
    }
  }

  if (body.outcome === "posting") {
    const desc = body.postingLocationDescription?.trim();
    if (!desc) {
      return {
        ok: false,
        error:
          "Service by posting requires a description of where the documents were posted.",
      };
    }
    // Nevada (NRCP 4(g)) only authorises service by posting when a court
    // order to that effect is on file. Confirming the existence of the
    // order is what makes the affidavit-of-posting facially valid, so
    // gate the outcome on the explicit attestation.
    if (body.postingHasCourtOrder !== true) {
      return {
        ok: false,
        error:
          "Service by posting requires confirmation that a court order authorising posting (NRCP 4(g)) is on file.",
      };
    }
  }

  if (body.outcome === "publication") {
    const orderRef = body.publicationOrderRef?.trim();
    const newspaper = body.publicationNewspaper?.trim();
    if (!orderRef) {
      return {
        ok: false,
        error:
          "Service by publication requires a reference to the court order authorising publication (NRS 14.040).",
      };
    }
    if (!newspaper) {
      return {
        ok: false,
        error:
          "Service by publication requires the name of the newspaper of general circulation in which the summons was published.",
      };
    }
    if (!body.publicationFirstDate) {
      return {
        ok: false,
        error:
          "Service by publication requires the date of the first publication.",
      };
    }
    if (!body.publicationLastDate) {
      return {
        ok: false,
        error:
          "Service by publication requires the date of the final publication.",
      };
    }
    if (body.publicationHasCourtOrder !== true) {
      return {
        ok: false,
        error:
          "Service by publication requires confirmation that a court order authorising publication (NRS 14.040) is on file.",
      };
    }
  }

  if (body.outcome === "non_est") {
    const summary = body.nonEstSummary?.trim();
    if (!summary || summary.length < 10) {
      return {
        ok: false,
        error:
          "Return of non-est requires a diligent-search summary (≥10 characters) describing why the subject could not be located.",
      };
    }
  }

  if (body.outcome === "unable") {
    const reason = body.unableReason ?? undefined;
    if (!reason || !UNABLE_REASONS.includes(reason as UnableReason)) {
      return {
        ok: false,
        error:
          "Unable to serve requires a reason (no_answer, refused, wrong_address, gated, or other).",
      };
    }
  }

  return { ok: true };
}
