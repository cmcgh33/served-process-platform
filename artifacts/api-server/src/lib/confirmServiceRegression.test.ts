// Regression test for Task #28: the duplicate POST /jobs/:id/confirm route
// has been retired. Any payload that previously worked against /confirm must
// keep working when sent to POST /jobs/:id/attempts with outcome='personal'.
//
// /confirm previously accepted: { gpsLat, gpsLng, notes?, photoUrl? }.
// The migrated client now sends the same fields plus outcome='personal'.
//
// Run with: pnpm --filter @workspace/api-server run test

import test from "node:test";
import assert from "node:assert/strict";
import { LogServiceAttemptBody } from "@workspace/api-zod";
import { validateAttemptBody } from "./attemptValidation";

test("a /confirm-style payload with identity evidence parses as a personal attempt", () => {
  const legacyConfirmPayload = {
    gpsLat: 40.7128,
    gpsLng: -74.006,
    notes: "Served at front door at 6:42pm",
    photoUrl: "server-photos/job-123/abc.jpg",
  };

  const migrated = { outcome: "personal" as const, identityMethod: "verbal", ...legacyConfirmPayload };
  const parsed = LogServiceAttemptBody.safeParse(migrated);
  assert.equal(parsed.success, true, "LogServiceAttemptBody must accept the migrated payload");

  const validation = validateAttemptBody(migrated);
  assert.equal(validation.ok, true, "validateAttemptBody must accept outcome=personal with identity and photo evidence");
});

test("a GPS-only legacy payload parses but fails the current evidence gate", () => {
  const minimal = { outcome: "personal" as const, gpsLat: 0, gpsLng: 0 };
  const parsed = LogServiceAttemptBody.safeParse(minimal);
  assert.equal(parsed.success, true);
  assert.equal(validateAttemptBody(minimal).ok, false);
});
