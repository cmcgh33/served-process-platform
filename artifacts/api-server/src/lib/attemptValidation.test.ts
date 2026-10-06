// Unit tests for the substitute/unable validation enforced by
// POST /jobs/:id/attempts. Uses node:test (built into Node 20+) so we
// don't pull a new test runner dependency into the workspace.
//
// Run with: pnpm --filter @workspace/api-server run test

import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAttemptBody,
  describeStateSubstituteRules,
  UNABLE_REASONS,
} from "./attemptValidation";

const validUniversalSubstitute = {
  outcome: "substitute" as const,
  identityMethod: "verbal",
  substituteRecipientName: "Jane Doe",
  substituteOver18: true,
  substituteVerifiedResidence: true,
  // New Phase-2 required fields: recipient relationship + structured
  // physical description (age estimate + gender + one identifying detail).
  recipientRelationship: "spouse",
  recipientAgeEstimate: "40-50",
  recipientGender: "female",
  recipientHeight: "5'6\"",
};

test("personal outcome rejects missing identity evidence", () => {
  const result = validateAttemptBody({ outcome: "personal" });
  assert.equal(result.ok, false);
});

test("substitute outcome requires the full universal trio", () => {
  const valid = validateAttemptBody(validUniversalSubstitute);
  assert.equal(valid.ok, true);
});

test("substitute outcome rejects missing recipient name", () => {
  const result = validateAttemptBody({
    outcome: "substitute",
    identityMethod: "verbal",
    substituteOver18: true,
    substituteVerifiedResidence: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /name of the person served/);
});

test("substitute outcome rejects empty/whitespace recipient name", () => {
  const result = validateAttemptBody({
    outcome: "substitute",
    identityMethod: "verbal",
    substituteRecipientName: "   ",
    substituteOver18: true,
    substituteVerifiedResidence: true,
  });
  assert.equal(result.ok, false);
});

test("substitute outcome rejects missing over-18 confirmation", () => {
  const result = validateAttemptBody({
    ...validUniversalSubstitute,
    substituteOver18: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /at least 18 years old/);
});

test("substitute outcome rejects missing residence confirmation", () => {
  const result = validateAttemptBody({
    outcome: "substitute",
    identityMethod: "verbal",
    substituteRecipientName: "Jane Doe",
    substituteOver18: true,
    substituteVerifiedResidence: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /lives at the address/);
});

test("unable outcome requires a reason", () => {
  const result = validateAttemptBody({ outcome: "unable" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Unable to serve requires a reason/);
});

test("unable outcome rejects an unknown reason", () => {
  const result = validateAttemptBody({
    outcome: "unable",
    unableReason: "ate_the_papers",
  });
  assert.equal(result.ok, false);
});

test("unable outcome accepts every documented reason", () => {
  for (const reason of UNABLE_REASONS) {
    const result = validateAttemptBody({ outcome: "unable", unableReason: reason });
    assert.equal(result.ok, true, `expected '${reason}' to be accepted`);
  }
});

// ---------- State-specific substitute rules ----------

test("CA substitute requires the mail-followup acknowledgement", () => {
  const without = validateAttemptBody(validUniversalSubstitute, "CA");
  assert.equal(without.ok, false);
  if (!without.ok) assert.match(without.error, /California/);
  if (!without.ok) assert.match(without.error, /mail/i);

  // The mail-followup commitment now also requires a date + address
  // so the affidavit's manner-of-service block can attest to both.
  const withAck = validateAttemptBody(
    {
      ...validUniversalSubstitute,
      acknowledgeMailFollowup: true,
      mailingDate: "2026-05-01T12:00:00Z",
      mailingAddress: "123 Main St, Reno NV",
    },
    "CA",
  );
  assert.equal(withAck.ok, true);
});

test("CA still requires the universal trio (over-18 etc.)", () => {
  const result = validateAttemptBody(
    {
      ...validUniversalSubstitute,
      substituteOver18: false,
      acknowledgeMailFollowup: true,
    },
    "California",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /at least 18/);
});

test("NY substitute requires the mail-followup acknowledgement", () => {
  const without = validateAttemptBody(validUniversalSubstitute, "NY");
  assert.equal(without.ok, false);
  if (!without.ok) assert.match(without.error, /New York/);

  const withAck = validateAttemptBody(
    {
      ...validUniversalSubstitute,
      acknowledgeMailFollowup: true,
      mailingDate: "2026-05-01T12:00:00Z",
      mailingAddress: "123 Main St, Brooklyn NY",
    },
    "NY",
  );
  assert.equal(withAck.ok, true);
});

test("substitute mail-followup requires both a date and an address", () => {
  // Date missing
  const noDate = validateAttemptBody(
    {
      ...validUniversalSubstitute,
      acknowledgeMailFollowup: true,
      mailingAddress: "123 Main St",
    },
    "CA",
  );
  assert.equal(noDate.ok, false);
  if (!noDate.ok) assert.match(noDate.error, /date/i);

  // Address missing
  const noAddr = validateAttemptBody(
    {
      ...validUniversalSubstitute,
      acknowledgeMailFollowup: true,
      mailingDate: "2026-05-01T12:00:00Z",
    },
    "CA",
  );
  assert.equal(noAddr.ok, false);
  if (!noAddr.ok) assert.match(noAddr.error, /address/i);
});

// ---------- Nevada-specific outcomes (substitute / mail / posting) ----------

test("NV substitute requires mailing date + address regardless of acknowledgement", () => {
  // Even without acknowledgeMailFollowup being set, NV substitute (NRCP
  // 4.2(b)) must include a mailed copy. The server enforces this by
  // jurisdiction so direct API callers can't bypass the UI commitment
  // checkbox and produce a defective Nevada affidavit.
  const noMail = validateAttemptBody(validUniversalSubstitute, "NV");
  assert.equal(noMail.ok, false);
  if (!noMail.ok) assert.match(noMail.error, /Nevada/);
  if (!noMail.ok) assert.match(noMail.error, /mail/i);

  // Date missing only.
  const noDate = validateAttemptBody(
    {
      ...validUniversalSubstitute,
      mailingAddress: "987 Sahara Ave, Las Vegas NV",
    },
    "NV",
  );
  assert.equal(noDate.ok, false);
  if (!noDate.ok) assert.match(noDate.error, /date/i);

  // Address missing only.
  const noAddr = validateAttemptBody(
    {
      ...validUniversalSubstitute,
      mailingDate: "2026-05-01T12:00:00Z",
    },
    "NV",
  );
  assert.equal(noAddr.ok, false);
  if (!noAddr.ok) assert.match(noAddr.error, /address/i);

  // Both present, no acknowledgement checkbox → still accepted.
  const ok = validateAttemptBody(
    {
      ...validUniversalSubstitute,
      mailingDate: "2026-05-01T12:00:00Z",
      mailingAddress: "987 Sahara Ave, Las Vegas NV",
    },
    "NV",
  );
  assert.equal(ok.ok, true);
});

test("posting outcome requires a court-order confirmation", () => {
  // Description present but no court-order box → reject.
  const noOrder = validateAttemptBody({
    outcome: "posting",
    postingLocationDescription: "Affixed at front door, eye level",
  });
  assert.equal(noOrder.ok, false);
  if (!noOrder.ok) assert.match(noOrder.error, /court order/i);

  // Description + box → accept.
  const withOrder = validateAttemptBody({
    outcome: "posting",
    postingLocationDescription: "Affixed at front door, eye level",
    postingHasCourtOrder: true,
  });
  assert.equal(withOrder.ok, true);
});

test("posting outcome rejects a missing location description", () => {
  const result = validateAttemptBody({
    outcome: "posting",
    postingHasCourtOrder: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /where the documents were posted/i);
});

test("mail outcome requires both date and address", () => {
  const noDate = validateAttemptBody({
    outcome: "mail",
    mailingAddress: "123 Main St",
  });
  assert.equal(noDate.ok, false);

  const noAddr = validateAttemptBody({
    outcome: "mail",
    mailingDate: "2026-05-01T12:00:00Z",
  });
  assert.equal(noAddr.ok, false);

  const ok = validateAttemptBody({
    outcome: "mail",
    mailingDate: "2026-05-01T12:00:00Z",
    mailingAddress: "123 Main St, Reno NV",
  });
  assert.equal(ok.ok, true);
});

test("FL substitute requires co-residency", () => {
  const without = validateAttemptBody(
    { ...validUniversalSubstitute, substituteRecipientAge: 30 },
    "FL",
  );
  assert.equal(without.ok, false);
  if (!without.ok) assert.match(without.error, /Florida/);
  if (!without.ok) assert.match(without.error, /co-resident/);
});

test("FL substitute accepts age 15+ in lieu of over-18", () => {
  const result = validateAttemptBody(
    {
      ...validUniversalSubstitute,
      substituteOver18: false,
      substituteRecipientAge: 16,
      substituteIsCoResident: true,
    },
    "FL",
  );
  assert.equal(result.ok, true);
});

test("FL substitute rejects age below 15", () => {
  const result = validateAttemptBody(
    {
      ...validUniversalSubstitute,
      substituteOver18: false,
      substituteRecipientAge: 12,
      substituteIsCoResident: true,
    },
    "Florida",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /at least 15 years old/);
});

// ---------- New Phase-2: relationship + structured description ----------

test("substitute outcome rejects missing recipient relationship", () => {
  const result = validateAttemptBody({
    ...validUniversalSubstitute,
    recipientRelationship: undefined,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /relationship to the named defendant/i);
});

test("substitute outcome rejects whitespace-only recipient relationship", () => {
  const result = validateAttemptBody({
    ...validUniversalSubstitute,
    recipientRelationship: "   ",
  });
  assert.equal(result.ok, false);
});

test("substitute outcome rejects missing recipient age estimate", () => {
  const result = validateAttemptBody({
    ...validUniversalSubstitute,
    recipientAgeEstimate: undefined,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /estimated age/i);
});

test("substitute outcome rejects missing recipient gender", () => {
  const result = validateAttemptBody({
    ...validUniversalSubstitute,
    recipientGender: undefined,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /gender/i);
});

test("substitute outcome rejects when no identifying physical detail is recorded", () => {
  const result = validateAttemptBody({
    ...validUniversalSubstitute,
    recipientHeight: undefined,
    recipientWeight: undefined,
    recipientIdentifyingFeatures: undefined,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /identifying physical detail/i);
});

test("substitute outcome accepts weight alone as the identifying detail", () => {
  const result = validateAttemptBody({
    ...validUniversalSubstitute,
    recipientHeight: undefined,
    recipientWeight: "180 lb",
  });
  assert.equal(result.ok, true);
});

test("substitute outcome accepts identifying features alone", () => {
  const result = validateAttemptBody({
    ...validUniversalSubstitute,
    recipientHeight: undefined,
    recipientIdentifyingFeatures: "tattoo on left forearm",
  });
  assert.equal(result.ok, true);
});

test("FL substitute accepts over-18 alone for the age check", () => {
  const result = validateAttemptBody(
    {
      ...validUniversalSubstitute,
      substituteIsCoResident: true,
    },
    "FL",
  );
  assert.equal(result.ok, true);
});

test("State with no special rules just enforces the universal trio", () => {
  const result = validateAttemptBody(validUniversalSubstitute, "TX");
  assert.equal(result.ok, true);
});

test("Missing/blank state falls back to universal trio", () => {
  assert.equal(validateAttemptBody(validUniversalSubstitute, null).ok, true);
  assert.equal(validateAttemptBody(validUniversalSubstitute, undefined).ok, true);
  assert.equal(validateAttemptBody(validUniversalSubstitute, "").ok, true);
});

test("State name normalisation handles long-form and case", () => {
  // CA long form should still trigger the mail follow-up requirement.
  const res = validateAttemptBody(validUniversalSubstitute, "california");
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /California/);
});

test("describeStateSubstituteRules returns CA/FL/NY/NV summaries", () => {
  assert.match(describeStateSubstituteRules("CA") ?? "", /California/);
  assert.match(describeStateSubstituteRules("FL") ?? "", /Florida/);
  assert.match(describeStateSubstituteRules("NY") ?? "", /New York/);
  assert.match(describeStateSubstituteRules("NV") ?? "", /Nevada/);
  assert.equal(describeStateSubstituteRules("TX"), null);
  assert.equal(describeStateSubstituteRules(null), null);
});

// Current identity-evidence gate: exercise missing and accepted evidence directly.
test("personal completion requires both identity confirmation and a photo", () => {
  assert.equal(validateAttemptBody({ outcome: "personal", identityMethod: "verbal" }).ok, false);
  assert.equal(validateAttemptBody({ outcome: "personal", photoUrl: "scene.jpg" }).ok, false);
  assert.equal(validateAttemptBody({ outcome: "personal", identityMethod: "verbal", photoUrl: "scene.jpg" }).ok, true);
});
test("substitute completion rejects missing identity confirmation", () => {
  assert.equal(validateAttemptBody({ ...validUniversalSubstitute, identityMethod: undefined }).ok, false);
});
