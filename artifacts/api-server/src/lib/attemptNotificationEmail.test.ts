// Unit + integration tests for the requester service-attempt notification.
//
// Mirrors pickupNotificationEmail.test.ts:
//   - Pure renderer tests (no DB, no env, no network) cover both templates
//     (renderServedEmail for terminal personal/substitute outcomes,
//     renderAttemptLoggedEmail for non-terminal "unable" attempts).
//   - Integration tests insert a real users + jobs + service_attempts
//     fixture and call `claimAttemptAndNotifyRequester`, with
//     RESEND_API_KEY set so the live email path runs and globalThis.fetch
//     stubbed so we can count how many requests it tried to send. The
//     "exactly once per attempt" guarantee is the central contract of the
//     dedup-token model — these tests are what prove it.
//
// Run with: pnpm --filter @workspace/api-server run test

import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  jobsTable,
  serviceAttemptsTable,
  usersTable,
} from "@workspace/db";
import {
  renderServedEmail,
  renderAttemptLoggedEmail,
  claimAttemptAndNotifyRequester,
} from "./attemptNotificationEmail";

// ---------- renderServedEmail (pure) ----------

test("renderServedEmail: subject includes platformRef and SERVED prefix", () => {
  const r = renderServedEmail({
    job: {
      id: 1,
      platformRef: "SERVED-2026-DONE001",
      recipientName: "John Smith",
    },
    attempt: {
      outcome: "personal",
      attemptedAt: new Date("2026-05-01T15:00:00Z"),
    },
    requesterFirstName: "Alice",
    jobUrl: "https://example.com/app/jobs/1",
  });
  assert.match(r.subject, /^\[SERVED\.\] Service complete — SERVED-2026-DONE001$/);
});

test("renderServedEmail: text body covers recipient, time, link, and personal-service copy", () => {
  const ts = new Date("2026-05-01T15:00:00Z");
  const r = renderServedEmail({
    job: {
      id: 42,
      platformRef: "SERVED-2026-XYZ987",
      recipientName: "Defendant Doe",
    },
    attempt: { outcome: "personal", attemptedAt: ts },
    requesterFirstName: "Bob",
    jobUrl: "https://example.com/app/jobs/42",
  });
  assert.match(r.text, /^Hi Bob,/);
  assert.match(r.text, /SERVED-2026-XYZ987/);
  assert.match(r.text, /Defendant Doe/);
  assert.ok(r.text.includes(ts.toISOString()));
  assert.match(r.text, /personally served/);
  assert.match(r.text, /https:\/\/example\.com\/app\/jobs\/42/);
});

test("renderServedEmail: substitute outcome flips the method line", () => {
  const r = renderServedEmail({
    job: {
      id: 5,
      platformRef: "SERVED-2026-SUB",
      recipientName: "Recipient",
    },
    attempt: {
      outcome: "substitute",
      attemptedAt: new Date("2026-05-01T12:00:00Z"),
    },
    requesterFirstName: "Carol",
    jobUrl: "https://example.com/app/jobs/5",
  });
  assert.match(r.text, /substitute service/);
  assert.doesNotMatch(r.text, /personally served/);
  assert.match(r.html, /substitute service/);
});

test("renderServedEmail: html links to job page and escapes user input", () => {
  const r = renderServedEmail({
    job: {
      id: 7,
      platformRef: "SERVED-2026-ESC",
      recipientName: 'Evil <script>alert("x")</script>',
    },
    attempt: {
      outcome: "personal",
      attemptedAt: new Date("2026-05-01T00:00:00Z"),
    },
    requesterFirstName: "T&T",
    jobUrl: "https://app.example.com/app/jobs/7?a=1&b=2",
  });
  assert.match(r.html, /href="https:\/\/app\.example\.com\/app\/jobs\/7\?a=1&amp;b=2"/);
  assert.doesNotMatch(r.html, /<script>/);
  assert.match(r.html, /&lt;script&gt;/);
  assert.match(r.html, /T&amp;T/);
});

test("renderServedEmail: greeting falls back to 'there' when no first name", () => {
  const r = renderServedEmail({
    job: { id: 1, platformRef: "SERVED-2026-NIL", recipientName: "R" },
    attempt: {
      outcome: "personal",
      attemptedAt: new Date("2026-05-01T00:00:00Z"),
    },
    requesterFirstName: null,
    jobUrl: "https://x/y",
  });
  assert.match(r.text, /^Hi there,/);
  assert.match(r.html, /Hi there,/);
});

// ---------- renderAttemptLoggedEmail (pure) ----------

test("renderAttemptLoggedEmail: subject includes platformRef", () => {
  const r = renderAttemptLoggedEmail({
    job: {
      id: 1,
      platformRef: "SERVED-2026-ATTEMPT01",
      recipientName: "John Smith",
    },
    attempt: {
      outcome: "unable",
      attemptedAt: new Date("2026-05-01T18:00:00Z"),
      unableReason: "no_answer",
      notes: null,
    },
    requesterFirstName: "Alice",
    jobUrl: "https://example.com/app/jobs/1",
  });
  assert.match(r.subject, /^\[SERVED\.\] Service attempt logged — SERVED-2026-ATTEMPT01$/);
});

test("renderAttemptLoggedEmail: maps known unable reasons to friendly copy", () => {
  const r = renderAttemptLoggedEmail({
    job: {
      id: 1,
      platformRef: "SERVED-2026-NOANS",
      recipientName: "John Smith",
    },
    attempt: {
      outcome: "unable",
      attemptedAt: new Date("2026-05-01T18:00:00Z"),
      unableReason: "no_answer",
      notes: null,
    },
    requesterFirstName: "Alice",
    jobUrl: "https://example.com/app/jobs/1",
  });
  assert.match(r.text, /No one answered the door/);
});

test("renderAttemptLoggedEmail: includes notes paragraph when notes present, omits otherwise", () => {
  const withNotes = renderAttemptLoggedEmail({
    job: { id: 1, platformRef: "P", recipientName: "R" },
    attempt: {
      outcome: "unable",
      attemptedAt: new Date("2026-05-01T18:00:00Z"),
      unableReason: "other",
      notes: "Lights on but no answer at 7pm",
    },
    requesterFirstName: "Alice",
    jobUrl: "https://x/y",
  });
  assert.match(withNotes.text, /Server's notes: Lights on but no answer at 7pm/);
  assert.match(withNotes.html, /Lights on but no answer at 7pm/);

  const noNotes = renderAttemptLoggedEmail({
    job: { id: 1, platformRef: "P", recipientName: "R" },
    attempt: {
      outcome: "unable",
      attemptedAt: new Date("2026-05-01T18:00:00Z"),
      unableReason: "no_answer",
      notes: null,
    },
    requesterFirstName: "Alice",
    jobUrl: "https://x/y",
  });
  assert.doesNotMatch(noNotes.text, /Server's notes:/);
});

test("renderAttemptLoggedEmail: html escapes user-supplied notes", () => {
  const r = renderAttemptLoggedEmail({
    job: {
      id: 1,
      platformRef: "P",
      recipientName: 'Evil <script>alert("x")</script>',
    },
    attempt: {
      outcome: "unable",
      attemptedAt: new Date("2026-05-01T18:00:00Z"),
      unableReason: "other",
      notes: '<img src=x onerror="boom()">',
    },
    requesterFirstName: "T&T",
    jobUrl: "https://x/y?a=1&b=2",
  });
  assert.doesNotMatch(r.html, /<script>/);
  assert.doesNotMatch(r.html, /<img /);
  assert.match(r.html, /&lt;script&gt;/);
  assert.match(r.html, /&lt;img /);
  assert.match(r.html, /T&amp;T/);
});

test("renderAttemptLoggedEmail: unknown unableReason falls back to raw value", () => {
  const r = renderAttemptLoggedEmail({
    job: { id: 1, platformRef: "P", recipientName: "R" },
    attempt: {
      outcome: "unable",
      attemptedAt: new Date("2026-05-01T18:00:00Z"),
      // Forward-compat: schema may add new reasons before the copy map is
      // updated. Should NOT throw; should NOT show a blank line.
      unableReason: "new_reason_from_future_schema",
      notes: null,
    },
    requesterFirstName: "Alice",
    jobUrl: "https://x/y",
  });
  assert.match(r.text, /Outcome: new_reason_from_future_schema/);
});

// ---------- integration: idempotent send ----------

interface AttemptFixture {
  jobId: number;
  attemptId: number;
  requesterUserId: string;
  cleanup: () => Promise<void>;
}

async function createAttemptFixture(opts?: {
  outcome?: "personal" | "substitute" | "unable";
  unableReason?: string | null;
  notes?: string | null;
  notifiedAt?: Date | null;
  requesterEmail?: string | null;
}): Promise<AttemptFixture> {
  const tag = randomUUID();
  const requesterUserId = `test_attempt_req_${tag}`;
  await db.insert(usersTable).values({
    id: requesterUserId,
    email:
      opts?.requesterEmail === undefined
        ? `attempt_requester_${tag}@example.test`
        : opts.requesterEmail,
    firstName: "Test",
    lastName: "Requester",
    role: "requester",
  });

  const [job] = await db
    .insert(jobsTable)
    .values({
      requesterUserId,
      platformRef: `SERVED-TEST-${tag.slice(0, 8).toUpperCase()}`,
      documentType: "subpoena",
      recipientName: "Defendant Doe",
      recipientAddress: "100 Test Way",
      recipientCity: "Testville",
      recipientState: "CA",
      recipientZip: "99999",
      status: "in_progress",
    })
    .returning({ id: jobsTable.id });

  // Need a server row to satisfy the FK on service_attempts.server_id.
  // Reuse a "server" row using the requester user id is not allowed (different
  // role). For simplicity, create a stub server seeded with its own user.
  const serverUserId = `test_attempt_srv_${tag}`;
  await db.insert(usersTable).values({
    id: serverUserId,
    email: `attempt_server_${tag}@example.test`,
    firstName: "Pat",
    lastName: "Server",
    role: "server",
  });
  const { serversTable } = await import("@workspace/db");
  const [server] = await db
    .insert(serversTable)
    .values({
      userId: serverUserId,
      name: "Pat Server",
      email: `attempt_server_${tag}@example.test`,
      status: "active",
      payoutsEnabled: false,
    })
    .returning({ id: serversTable.id });

  const outcome = opts?.outcome ?? "unable";
  const [attempt] = await db
    .insert(serviceAttemptsTable)
    .values({
      jobId: job.id,
      serverId: server.id,
      outcome,
      attemptedAt: new Date(),
      gpsLat: 40.7128,
      gpsLng: -74.006,
      notes: opts?.notes ?? null,
      unableReason:
        outcome === "unable"
          ? opts?.unableReason === undefined
            ? "no_answer"
            : opts.unableReason
          : null,
      notifiedAt: opts?.notifiedAt ?? null,
    })
    .returning({ id: serviceAttemptsTable.id });

  return {
    jobId: job.id,
    attemptId: attempt.id,
    requesterUserId,
    cleanup: async () => {
      await db
        .delete(serviceAttemptsTable)
        .where(eq(serviceAttemptsTable.id, attempt.id));
      await db.delete(jobsTable).where(eq(jobsTable.id, job.id));
      await db.delete(serversTable).where(eq(serversTable.id, server.id));
      await db.delete(usersTable).where(eq(usersTable.id, requesterUserId));
      await db.delete(usersTable).where(eq(usersTable.id, serverUserId));
    },
  };
}

/**
 * Install a fetch stub that counts Resend requests and force live mode by
 * setting RESEND_API_KEY. Returns a teardown that restores both.
 */
function withStubbedResend(): {
  calls: Array<{ url: string; body: unknown }>;
  restore: () => void;
} {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "re_test_key";
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(String(init.body));
    } catch {
      parsed = init.body;
    }
    calls.push({ url: String(url), body: parsed });
    return new Response(JSON.stringify({ id: `msg_${calls.length}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = previousFetch;
      if (previousKey !== undefined) process.env.RESEND_API_KEY = previousKey;
      else delete process.env.RESEND_API_KEY;
    },
  };
}

test("claimAttemptAndNotifyRequester: 'unable' outcome stamps notifiedAt and sends one email", async () => {
  const fx = await createAttemptFixture({ outcome: "unable", unableReason: "no_answer" });
  const stub = withStubbedResend();
  try {
    const result = await claimAttemptAndNotifyRequester({ attemptId: fx.attemptId });
    assert.equal(result.claimed, true);
    assert.notEqual(result.attempt?.notifiedAt, null);
    assert.equal(result.servedEmail, false);
    assert.equal(result.emailResult?.delivered, true);
    assert.equal(result.emailResult?.transport, "resend");
    assert.equal(stub.calls.length, 1, "exactly one Resend POST");
    const body = stub.calls[0]!.body as { subject: string; text: string };
    assert.match(body.subject, /Service attempt logged/);
    assert.match(body.text, /No one answered the door/);
  } finally {
    stub.restore();
    await fx.cleanup();
  }
});

test("claimAttemptAndNotifyRequester: 'personal' outcome sends the served template", async () => {
  const fx = await createAttemptFixture({ outcome: "personal" });
  const stub = withStubbedResend();
  try {
    const result = await claimAttemptAndNotifyRequester({ attemptId: fx.attemptId });
    assert.equal(result.claimed, true);
    assert.equal(result.servedEmail, true);
    assert.equal(stub.calls.length, 1);
    const body = stub.calls[0]!.body as { subject: string; text: string };
    assert.match(body.subject, /Service complete/);
    assert.match(body.text, /personally served/);
  } finally {
    stub.restore();
    await fx.cleanup();
  }
});

test("claimAttemptAndNotifyRequester: 'substitute' outcome sends the served template with substitute copy", async () => {
  const fx = await createAttemptFixture({ outcome: "substitute" });
  const stub = withStubbedResend();
  try {
    const result = await claimAttemptAndNotifyRequester({ attemptId: fx.attemptId });
    assert.equal(result.claimed, true);
    assert.equal(result.servedEmail, true);
    assert.equal(stub.calls.length, 1);
    const body = stub.calls[0]!.body as { subject: string; text: string };
    assert.match(body.subject, /Service complete/);
    assert.match(body.text, /substitute service/);
  } finally {
    stub.restore();
    await fx.cleanup();
  }
});

test("claimAttemptAndNotifyRequester: second call for the same attempt does NOT re-send (idempotent)", async () => {
  const fx = await createAttemptFixture({ outcome: "unable" });
  const stub = withStubbedResend();
  try {
    const first = await claimAttemptAndNotifyRequester({ attemptId: fx.attemptId });
    assert.equal(first.claimed, true);
    assert.equal(stub.calls.length, 1);

    const second = await claimAttemptAndNotifyRequester({ attemptId: fx.attemptId });
    assert.equal(second.claimed, false, "second call must not re-claim the slot");
    assert.equal(second.emailResult, undefined, "no email sent on second call");
    assert.equal(
      second.attempt?.notifiedAt?.getTime(),
      first.attempt?.notifiedAt?.getTime(),
      "notifiedAt must be preserved across redundant calls",
    );
    assert.equal(stub.calls.length, 1, "still exactly one email after two calls");
  } finally {
    stub.restore();
    await fx.cleanup();
  }
});

test("claimAttemptAndNotifyRequester: pre-existing notifiedAt is treated as already-claimed", async () => {
  const earlier = new Date(Date.now() - 60_000);
  const fx = await createAttemptFixture({
    outcome: "unable",
    notifiedAt: earlier,
  });
  const stub = withStubbedResend();
  try {
    const result = await claimAttemptAndNotifyRequester({ attemptId: fx.attemptId });
    assert.equal(result.claimed, false);
    assert.equal(result.emailResult, undefined);
    assert.equal(result.attempt?.notifiedAt?.getTime(), earlier.getTime());
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
    await fx.cleanup();
  }
});

test("claimAttemptAndNotifyRequester: stamps notifiedAt but skips send when requester has no email", async () => {
  const fx = await createAttemptFixture({
    outcome: "unable",
    requesterEmail: null,
  });
  const stub = withStubbedResend();
  try {
    const result = await claimAttemptAndNotifyRequester({ attemptId: fx.attemptId });
    assert.equal(result.claimed, true);
    assert.equal(result.emailSkippedNoRecipient, true);
    assert.equal(result.emailResult, undefined);
    assert.equal(stub.calls.length, 0, "no network call when there's nobody to email");
  } finally {
    stub.restore();
    await fx.cleanup();
  }
});

test("claimAttemptAndNotifyRequester: missing attempt id returns claimed=false without throwing", async () => {
  const stub = withStubbedResend();
  try {
    const result = await claimAttemptAndNotifyRequester({ attemptId: -1 });
    assert.equal(result.claimed, false);
    assert.equal(result.attempt, null);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});
