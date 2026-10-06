// Unit + integration tests for the requester pickup-notification email.
//
// The unit tests exercise the pure renderer (no DB, no env, no network).
// The integration tests insert a real users + job fixture and call the
// `claimPickupAndNotifyRequester` helper that the POST /jobs/:id/pickup
// route uses, with `RESEND_API_KEY` set so the live email path runs and
// `globalThis.fetch` stubbed so we can count how many requests it tried
// to send. This is what proves the "exactly once per pickup" guarantee
// — the second invocation must NOT re-send.
//
// Run with: pnpm --filter @workspace/api-server run test

import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  jobsTable,
  usersTable,
} from "@workspace/db";
import {
  renderPickupEmail,
  renderPickupSms,
  claimPickupAndNotifyRequester,
} from "./pickupNotificationEmail";

// ---------- renderer (pure) ----------

test("renderPickupEmail: subject includes platformRef and SERVED prefix", () => {
  const r = renderPickupEmail({
    job: {
      id: 1,
      platformRef: "SERVED-2026-ABC123",
      recipientName: "John Smith",
      pickupContactName: "Paralegal Jane",
      pickupContactPhone: "555-0100",
      pickupAddress: "123 Main St",
      pickupCity: "Oakland",
      pickupState: "CA",
      pickupZip: "94607",
    },
    requesterFirstName: "Alice",
    jobUrl: "https://example.com/app/jobs/1",
  });
  assert.match(r.subject, /^\[SERVED\.\] Documents picked up — SERVED-2026-ABC123$/);
});

test("renderPickupEmail: text body contains job ref, recipient, contact, and tracking URL", () => {
  const r = renderPickupEmail({
    job: {
      id: 42,
      platformRef: "SERVED-2026-XYZ987",
      recipientName: "Defendant Doe",
      pickupContactName: "Paralegal Pat",
      pickupContactPhone: "415-555-0199",
      pickupAddress: "1 Market St",
      pickupCity: "San Francisco",
      pickupState: "CA",
      pickupZip: "94105",
    },
    requesterFirstName: "Bob",
    jobUrl: "https://example.com/app/jobs/42",
  });
  assert.match(r.text, /^Hi Bob,/);
  assert.match(r.text, /SERVED-2026-XYZ987/);
  assert.match(r.text, /Defendant Doe/);
  assert.match(r.text, /Paralegal Pat/);
  assert.match(r.text, /415-555-0199/);
  assert.match(r.text, /1 Market St San Francisco, CA 94105/);
  assert.match(r.text, /https:\/\/example\.com\/app\/jobs\/42/);
});

test("renderPickupEmail: html body links to the job detail URL", () => {
  const r = renderPickupEmail({
    job: {
      id: 7,
      platformRef: "SERVED-2026-LINK",
      recipientName: "Recipient",
      pickupContactName: "Contact",
      pickupContactPhone: "555-1234",
      pickupAddress: "1 A",
      pickupCity: "B",
      pickupState: "CA",
      pickupZip: "00000",
    },
    requesterFirstName: "Carol",
    jobUrl: "https://app.example.com/app/jobs/7",
  });
  assert.match(r.html, /href="https:\/\/app\.example\.com\/app\/jobs\/7"/);
  assert.match(r.html, /SERVED-2026-LINK/);
});

test("renderPickupEmail: falls back to 'there' when first name is missing", () => {
  const r = renderPickupEmail({
    job: {
      id: 1,
      platformRef: "SERVED-2026-NIL",
      recipientName: "R",
      pickupContactName: "C",
      pickupContactPhone: null,
      pickupAddress: null,
      pickupCity: null,
      pickupState: null,
      pickupZip: null,
    },
    requesterFirstName: null,
    jobUrl: "https://x/y",
  });
  assert.match(r.text, /^Hi there,/);
  // No phone parens, no pickup-location line.
  assert.doesNotMatch(r.text, /\(\)/);
  assert.doesNotMatch(r.text, /Pickup location:/);
});

test("renderPickupEmail: escapes HTML in user-supplied fields", () => {
  const r = renderPickupEmail({
    job: {
      id: 1,
      platformRef: "SERVED-2026-ESC",
      recipientName: 'Evil <script>alert("x")</script>',
      pickupContactName: "C",
      pickupContactPhone: null,
      pickupAddress: null,
      pickupCity: null,
      pickupState: null,
      pickupZip: null,
    },
    requesterFirstName: "T&T",
    jobUrl: "https://x/y?a=1&b=2",
  });
  assert.doesNotMatch(r.html, /<script>/);
  assert.match(r.html, /&lt;script&gt;/);
  assert.match(r.html, /T&amp;T/);
  assert.match(r.html, /a=1&amp;b=2/);
});

// ---------- integration: idempotent send ----------

interface PickupFixture {
  jobId: number;
  requesterUserId: string;
  cleanup: () => Promise<void>;
}

async function createPickupFixture(opts?: {
  pickedUpAt?: Date | null;
  requesterEmail?: string | null;
  requesterPhone?: string | null;
  requesterSmsOptOut?: boolean;
}): Promise<PickupFixture> {
  const tag = randomUUID();
  const requesterUserId = `test_req_${tag}`;
  await db.insert(usersTable).values({
    id: requesterUserId,
    email: opts?.requesterEmail === undefined
      ? `requester_${tag}@example.test`
      : opts.requesterEmail,
    firstName: "Test",
    lastName: "Requester",
    role: "requester",
    phone: opts?.requesterPhone ?? null,
    smsOptOut: opts?.requesterSmsOptOut ?? false,
  });

  const [job] = await db
    .insert(jobsTable)
    .values({
      requesterUserId,
      platformRef: `SERVED-TEST-${tag.slice(0, 8).toUpperCase()}`,
      documentType: "subpoena",
      recipientName: "Pickup Recipient",
      recipientAddress: "100 Test Way",
      recipientCity: "Testville",
      recipientState: "CA",
      recipientZip: "99999",
      documentHandling: "pickup",
      pickupAddress: "200 Pickup Blvd",
      pickupCity: "Oakland",
      pickupState: "CA",
      pickupZip: "94612",
      pickupContactName: "Para Legal",
      pickupContactPhone: "555-1212",
      status: "in_progress",
      pickedUpAt: opts?.pickedUpAt ?? null,
    })
    .returning({ id: jobsTable.id });

  return {
    jobId: job.id,
    requesterUserId,
    cleanup: async () => {
      await db.delete(jobsTable).where(eq(jobsTable.id, job.id));
      await db.delete(usersTable).where(eq(usersTable.id, requesterUserId));
    },
  };
}

interface StubbedTransports {
  /** All recorded outbound HTTP calls. URL determines email vs sms. */
  calls: Array<{ url: string; body: unknown }>;
  /** Resend (email) subset of `calls` for assertion ergonomics. */
  emailCalls: Array<{ url: string; body: unknown }>;
  /** Twilio (sms) subset of `calls` for assertion ergonomics. The SMS body
   *  is x-www-form-urlencoded, so we expose it as a parsed key/value map. */
  smsCalls: Array<{ url: string; body: Record<string, string> }>;
  restore: () => void;
}

/**
 * Install a fetch stub that intercepts BOTH Resend and Twilio requests so
 * we can assert "exactly once" across the email and SMS legs in a single
 * call to the helper. Forces live mode for both transports by setting the
 * env vars they branch on. The SMS feature flag is also flipped on (and
 * restored) so the SMS leg is actually attempted by the helper — see the
 * `smsFeatureEnabled()` short-circuit in the production module.
 *
 * `restore()` undoes everything (env + fetch) so test order doesn't matter.
 */
function withStubbedTransports(opts?: {
  /**
   * When false, force `SMS_NOTIFICATIONS_ENABLED=false` so the SMS leg is
   * deterministically skipped regardless of what the runner's outer env
   * happened to set. (We explicitly assign rather than `delete` so the
   * `smsFeatureEnabled()` predicate sees the off value, not whatever may
   * be inherited.) Default true.
   */
  enableSms?: boolean;
}): StubbedTransports {
  const enableSms = opts?.enableSms !== false;
  const previousResendKey = process.env.RESEND_API_KEY;
  const previousTwilioSid = process.env.TWILIO_ACCOUNT_SID;
  const previousTwilioToken = process.env.TWILIO_AUTH_TOKEN;
  const previousTwilioFrom = process.env.TWILIO_FROM;
  const previousSmsFlag = process.env.SMS_NOTIFICATIONS_ENABLED;
  const previousFetch = globalThis.fetch;

  process.env.RESEND_API_KEY = "re_test_key";
  process.env.TWILIO_ACCOUNT_SID = "ACtest_sid";
  process.env.TWILIO_AUTH_TOKEN = "test_token";
  process.env.TWILIO_FROM = "+15550000000";
  process.env.SMS_NOTIFICATIONS_ENABLED = enableSms ? "true" : "false";

  const calls: Array<{ url: string; body: unknown }> = [];
  const emailCalls: Array<{ url: string; body: unknown }> = [];
  const smsCalls: Array<{ url: string; body: Record<string, string> }> = [];

  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://api.resend.com")) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(String(init.body));
      } catch {
        parsed = init.body;
      }
      calls.push({ url: u, body: parsed });
      emailCalls.push({ url: u, body: parsed });
      return new Response(JSON.stringify({ id: `msg_${calls.length}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.startsWith("https://api.twilio.com")) {
      // Twilio is form-encoded; turn it into a flat record so tests can
      // assert on `body.To`, `body.Body` etc. without re-parsing.
      const params = new URLSearchParams(String(init.body));
      const flat: Record<string, string> = {};
      for (const [k, v] of params.entries()) flat[k] = v;
      calls.push({ url: u, body: flat });
      smsCalls.push({ url: u, body: flat });
      return new Response(JSON.stringify({ sid: `SM_test_${calls.length}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch in stub: ${u}`);
  }) as unknown as typeof globalThis.fetch;

  return {
    calls,
    emailCalls,
    smsCalls,
    restore: () => {
      globalThis.fetch = previousFetch;
      const restore = (k: string, v: string | undefined) => {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      };
      restore("RESEND_API_KEY", previousResendKey);
      restore("TWILIO_ACCOUNT_SID", previousTwilioSid);
      restore("TWILIO_AUTH_TOKEN", previousTwilioToken);
      restore("TWILIO_FROM", previousTwilioFrom);
      restore("SMS_NOTIFICATIONS_ENABLED", previousSmsFlag);
    },
  };
}

/** Back-compat alias used by the existing email-only tests. */
function withStubbedResend(): {
  calls: Array<{ url: string; body: unknown }>;
  restore: () => void;
} {
  const stub = withStubbedTransports({ enableSms: false });
  return { calls: stub.emailCalls, restore: stub.restore };
}

test("claimPickupAndNotifyRequester: stamps pickedUpAt and sends one email", async () => {
  const fx = await createPickupFixture();
  const stub = withStubbedResend();
  try {
    const result = await claimPickupAndNotifyRequester({
      jobId: fx.jobId,
      nextStatus: "in_progress",
    });
    assert.equal(result.claimed, true);
    assert.notEqual(result.job.pickedUpAt, null);
    assert.equal(result.emailResult?.delivered, true);
    assert.equal(result.emailResult?.transport, "resend");

    assert.equal(stub.calls.length, 1, "exactly one Resend POST");
    const body = stub.calls[0]!.body as {
      to: string[];
      subject: string;
      text: string;
      html: string;
    };
    assert.deepEqual(body.to, [`requester_${fx.requesterUserId.replace(/^test_req_/, "")}@example.test`]);
    assert.match(body.subject, /Documents picked up/);
    // Text body must include the platformRef so the requester can correlate
    // the email back to their case.
    assert.ok(body.text.includes("SERVED-TEST-"));
  } finally {
    stub.restore();
    await fx.cleanup();
  }
});

test("claimPickupAndNotifyRequester: second call does NOT re-send (idempotent)", async () => {
  const fx = await createPickupFixture();
  const stub = withStubbedResend();
  try {
    const first = await claimPickupAndNotifyRequester({
      jobId: fx.jobId,
      nextStatus: "in_progress",
    });
    assert.equal(first.claimed, true);
    assert.equal(stub.calls.length, 1);

    const second = await claimPickupAndNotifyRequester({
      jobId: fx.jobId,
      nextStatus: "in_progress",
    });
    assert.equal(second.claimed, false, "second call must not re-claim the slot");
    assert.equal(second.emailResult, undefined, "no email sent on second call");
    // Job row still reflects the original pickedUpAt (the second call did
    // NOT overwrite it).
    assert.equal(
      second.job.pickedUpAt?.getTime(),
      first.job.pickedUpAt?.getTime(),
      "pickedUpAt must be preserved across redundant calls",
    );

    assert.equal(stub.calls.length, 1, "still exactly one email after two pickup calls");
  } finally {
    stub.restore();
    await fx.cleanup();
  }
});

test("claimPickupAndNotifyRequester: pre-existing pickedUpAt is treated as already-claimed", async () => {
  const earlier = new Date(Date.now() - 60_000);
  const fx = await createPickupFixture({ pickedUpAt: earlier });
  const stub = withStubbedResend();
  try {
    const result = await claimPickupAndNotifyRequester({
      jobId: fx.jobId,
      nextStatus: "in_progress",
    });
    assert.equal(result.claimed, false);
    assert.equal(result.emailResult, undefined);
    // pickedUpAt unchanged.
    assert.equal(result.job.pickedUpAt?.getTime(), earlier.getTime());
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
    await fx.cleanup();
  }
});

test("claimPickupAndNotifyRequester: stamps pickup but skips send when requester has no email", async () => {
  const fx = await createPickupFixture({ requesterEmail: null });
  const stub = withStubbedResend();
  try {
    const result = await claimPickupAndNotifyRequester({
      jobId: fx.jobId,
      nextStatus: "in_progress",
    });
    assert.equal(result.claimed, true);
    assert.equal(result.emailSkippedNoRecipient, true);
    assert.equal(result.emailResult, undefined);
    assert.equal(stub.calls.length, 0, "no network call when there's nobody to email");
  } finally {
    stub.restore();
    await fx.cleanup();
  }
});

// ---------- renderer (SMS) ----------

test("renderPickupSms: includes SERVED prefix, platformRef, recipient, and tracking URL", () => {
  const body = renderPickupSms({
    job: {
      id: 1,
      platformRef: "SERVED-2026-SMS1",
      recipientName: "John Smith",
      pickupContactName: "Para",
      pickupContactPhone: "555-0100",
      pickupAddress: "1 Main St",
      pickupCity: "Oakland",
      pickupState: "CA",
      pickupZip: "94607",
    },
    requesterFirstName: "Alice",
    jobUrl: "https://servedapp.co/app/jobs/1",
  });
  assert.match(body, /^\[SERVED\.\] Documents picked up for SERVED-2026-SMS1/);
  assert.match(body, /John Smith/);
  assert.match(body, /https:\/\/servedapp\.co\/app\/jobs\/1/);
});

// ---------- integration: SMS leg ----------

test("claimPickupAndNotifyRequester: sends one email AND one SMS when phone is present and flag enabled", async () => {
  const fx = await createPickupFixture({ requesterPhone: "+14155550101" });
  const stub = withStubbedTransports();
  try {
    const result = await claimPickupAndNotifyRequester({
      jobId: fx.jobId,
      nextStatus: "in_progress",
    });
    assert.equal(result.claimed, true);
    assert.equal(result.emailResult?.delivered, true);
    assert.equal(result.smsResult?.delivered, true);
    assert.equal(result.smsResult?.transport, "twilio");
    assert.equal(result.smsSkippedReason, undefined);

    assert.equal(stub.emailCalls.length, 1, "exactly one Resend POST");
    assert.equal(stub.smsCalls.length, 1, "exactly one Twilio POST");
    const sms = stub.smsCalls[0]!.body;
    assert.equal(sms.To, "+14155550101");
    assert.equal(sms.From, "+15550000000");
    assert.match(sms.Body, /Documents picked up/);
    assert.match(sms.Body, /SERVED-TEST-/);
  } finally {
    stub.restore();
    await fx.cleanup();
  }
});

test("claimPickupAndNotifyRequester: idempotent across email+sms — second call sends neither", async () => {
  const fx = await createPickupFixture({ requesterPhone: "+14155550102" });
  const stub = withStubbedTransports();
  try {
    const first = await claimPickupAndNotifyRequester({
      jobId: fx.jobId,
      nextStatus: "in_progress",
    });
    assert.equal(first.claimed, true);
    assert.equal(stub.emailCalls.length, 1);
    assert.equal(stub.smsCalls.length, 1);

    const second = await claimPickupAndNotifyRequester({
      jobId: fx.jobId,
      nextStatus: "in_progress",
    });
    assert.equal(second.claimed, false);
    assert.equal(second.emailResult, undefined);
    assert.equal(second.smsResult, undefined);
    assert.equal(
      stub.emailCalls.length,
      1,
      "still exactly one Resend POST after redundant pickup",
    );
    assert.equal(
      stub.smsCalls.length,
      1,
      "still exactly one Twilio POST after redundant pickup",
    );
  } finally {
    stub.restore();
    await fx.cleanup();
  }
});

test("claimPickupAndNotifyRequester: skips SMS when feature flag is off, still sends email", async () => {
  const fx = await createPickupFixture({ requesterPhone: "+14155550103" });
  const stub = withStubbedTransports({ enableSms: false });
  try {
    const result = await claimPickupAndNotifyRequester({
      jobId: fx.jobId,
      nextStatus: "in_progress",
    });
    assert.equal(result.claimed, true);
    assert.equal(result.emailResult?.delivered, true);
    assert.equal(result.smsSkippedReason, "feature_disabled");
    assert.equal(result.smsResult, undefined);
    assert.equal(stub.smsCalls.length, 0, "no Twilio call when feature flag is off");
    assert.equal(stub.emailCalls.length, 1);
  } finally {
    stub.restore();
    await fx.cleanup();
  }
});

test("claimPickupAndNotifyRequester: skips SMS when requester opted out, still sends email", async () => {
  const fx = await createPickupFixture({
    requesterPhone: "+14155550104",
    requesterSmsOptOut: true,
  });
  const stub = withStubbedTransports();
  try {
    const result = await claimPickupAndNotifyRequester({
      jobId: fx.jobId,
      nextStatus: "in_progress",
    });
    assert.equal(result.claimed, true);
    assert.equal(result.emailResult?.delivered, true);
    assert.equal(result.smsSkippedReason, "opted_out");
    assert.equal(result.smsResult, undefined);
    assert.equal(stub.smsCalls.length, 0, "no Twilio call when user opted out");
    assert.equal(stub.emailCalls.length, 1);
  } finally {
    stub.restore();
    await fx.cleanup();
  }
});

test("claimPickupAndNotifyRequester: skips SMS when no phone number on file", async () => {
  const fx = await createPickupFixture(); // no requesterPhone
  const stub = withStubbedTransports();
  try {
    const result = await claimPickupAndNotifyRequester({
      jobId: fx.jobId,
      nextStatus: "in_progress",
    });
    assert.equal(result.claimed, true);
    assert.equal(result.emailResult?.delivered, true);
    assert.equal(result.smsSkippedReason, "no_phone");
    assert.equal(result.smsResult, undefined);
    assert.equal(stub.smsCalls.length, 0);
    assert.equal(stub.emailCalls.length, 1);
  } finally {
    stub.restore();
    await fx.cleanup();
  }
});

test("claimPickupAndNotifyRequester: SMS-only delivery when requester has phone but no email", async () => {
  const fx = await createPickupFixture({
    requesterEmail: null,
    requesterPhone: "+14155550105",
  });
  const stub = withStubbedTransports();
  try {
    const result = await claimPickupAndNotifyRequester({
      jobId: fx.jobId,
      nextStatus: "in_progress",
    });
    assert.equal(result.claimed, true);
    assert.equal(result.emailSkippedNoRecipient, true);
    assert.equal(result.emailResult, undefined);
    assert.equal(result.smsResult?.delivered, true);
    assert.equal(stub.emailCalls.length, 0, "no Resend call without email");
    assert.equal(stub.smsCalls.length, 1, "still send SMS via Twilio");
  } finally {
    stub.restore();
    await fx.cleanup();
  }
});
