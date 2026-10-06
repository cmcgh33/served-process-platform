// Backend tests for the attorney draft-job lifecycle introduced alongside
// the new "save draft → batch checkout → webhook publishes" flow.
//
// What this file covers (Task #72):
//   1. DELETE /jobs/:id — race protection. The handler uses an atomic
//      DELETE ... WHERE status='draft' so a concurrent webhook flipping a
//      draft into pending mid-request can't lose a posted job. We assert
//      that drafts delete (204), pending jobs refuse (409), other
//      attorneys' jobs are forbidden (403), and unknown ids 404.
//   2. POST /stripe/draft-jobs/checkout — ownership/state validation.
//      Every gate runs before Stripe is called: empty list (400), invalid
//      ids (400), foreign jobs (404), non-draft jobs (409), missing
//      grossCents snapshot (400). We never reach Stripe in these cases,
//      so tests don't need a Stripe stub.
//   3. handleDraftJobsCheckoutCompleted — webhook idempotency. The
//      handler is `UPDATE jobs SET status='pending' WHERE id IN (...) AND
//      status='draft'`, which is naturally idempotent. We verify the
//      first delivery flips drafts to pending, a second delivery is a
//      no-op, mixed batches only flip the still-draft rows, and
//      malformed metadata is logged-and-skipped without throwing.
//
// Run with: pnpm --filter @workspace/api-server run test

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";
import {
  db,
  jobsTable,
  usersTable,
  type UserRole,
} from "@workspace/db";
import jobsRouter from "../routes/jobs";
import stripeRouter from "../routes/stripe";
import { requireAuth } from "../middlewares/auth";
import { handleDraftJobsCheckoutCompleted } from "../webhookHandlers";

// ---------- Test app ------------------------------------------------------
//
// We mount the real `jobsRouter` and `stripeRouter` on a minimal express
// app. The real `requireAuth` middleware reads its identity from
// `getAuth(req)` (Clerk), which in turn reads `req.auth`. Our test
// middleware fakes `req.auth` from an `x-test-user` header so we can
// drive the routes from any user identity without spinning Clerk up.
// We also stub `req.log` so the route handlers' pino logging calls are
// no-ops in tests.

// Minimal pino-shaped logger so route handlers' `req.log.error(...)` calls
// don't crash. We don't care about the contents during tests.
function noopLogger(): unknown {
  const fn = () => undefined;
  return {
    info: fn,
    warn: fn,
    error: fn,
    debug: fn,
    trace: fn,
    fatal: fn,
    child() {
      return noopLogger();
    },
  };
}

function buildTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Cast through unknown — req.log is typed as a full pino Logger but
    // route code only uses .info/.warn/.error.
    (req as unknown as { log: unknown }).log = noopLogger();
    next();
  });
  // Fake Clerk: x-test-user → req.auth() returns a session-token auth
  // object with that userId. @clerk/express's getAuth(req) needs three
  // things to short-circuit a successful auth: `'auth' in req`, `req.auth`
  // is callable, and the returned object has `tokenType === 'session_token'`
  // (otherwise getAuthObjectForAcceptedToken downgrades it to signed-out).
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const userId = req.header("x-test-user") ?? null;
    (
      req as Request & {
        auth: () => { userId: string | null; tokenType: string };
      }
    ).auth = () => ({ userId, tokenType: "session_token" });
    next();
  });
  // The api-server mounts everything under /api in production. The route
  // paths inside our routers already include `/jobs/...` and
  // `/stripe/...`, so we mount routers at the root here.
  //
  // Production layering (see routes/index.ts):
  //   - stripeRouter is mounted BEFORE the global requireAuth (its
  //     individual routes apply requireAuth themselves where needed)
  //   - jobsRouter sits AFTER the global requireAuth
  // Mirror that here so authentication runs in the same order as in prod.
  app.use(stripeRouter);
  app.use(requireAuth);
  app.use(jobsRouter);
  return app;
}

let server: Server;
let baseUrl: string;

test.before(async () => {
  const app = buildTestApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  const { pool } = await import("@workspace/db");
  await pool.end();
});

// ---------- DB fixtures ---------------------------------------------------

interface UserFixture {
  userId: string;
  cleanup: () => Promise<void>;
}

async function createUser(role: UserRole): Promise<UserFixture> {
  const userId = `test_${randomUUID()}`;
  await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
    role,
  });
  return {
    userId,
    cleanup: async () => {
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    },
  };
}

interface JobFixture {
  id: number;
  cleanup: () => Promise<void>;
}

async function createJob(opts: {
  requesterUserId: string | null;
  status?: string;
  grossCents?: number;
}): Promise<JobFixture> {
  const tag = randomUUID();
  const [row] = await db
    .insert(jobsTable)
    .values({
      requesterUserId: opts.requesterUserId,
      status: opts.status ?? "draft",
      documentType: "subpoena",
      recipientName: "Test Recipient",
      recipientAddress: "1 Main St",
      recipientCity: "Town",
      recipientState: "CA",
      recipientZip: "00000",
      platformRef: `test_${tag}`,
      grossCents: opts.grossCents ?? 7500,
      platformFeeCents: 1500,
      serverPayoutCents: 6000,
    })
    .returning({ id: jobsTable.id });
  return {
    id: row.id,
    cleanup: async () => {
      await db.delete(jobsTable).where(eq(jobsTable.id, row.id));
    },
  };
}

async function readJobStatus(id: number): Promise<string | null> {
  const [row] = await db
    .select({ status: jobsTable.status })
    .from(jobsTable)
    .where(eq(jobsTable.id, id));
  return row?.status ?? null;
}

// ---------- HTTP helpers --------------------------------------------------

async function apiFetch(
  method: string,
  path: string,
  opts: { userId?: string; body?: unknown } = {},
): Promise<{ status: number; json: any; text: string }> {
  const headers: Record<string, string> = {};
  if (opts.userId) headers["x-test-user"] = opts.userId;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

// =========================================================================
// 1) DELETE /jobs/:id race protection
// =========================================================================

test("DELETE /jobs/:id deletes a draft owned by the attorney (204)", async () => {
  const attorney = await createUser("attorney");
  const job = await createJob({
    requesterUserId: attorney.userId,
    status: "draft",
  });
  try {
    const res = await apiFetch("DELETE", `/jobs/${job.id}`, {
      userId: attorney.userId,
    });
    assert.equal(res.status, 204);
    assert.equal(
      await readJobStatus(job.id),
      null,
      "draft job row should be removed",
    );
  } finally {
    await job.cleanup();
    await attorney.cleanup();
  }
});

test("DELETE /jobs/:id refuses to delete a non-draft (409) — race protection", async () => {
  const attorney = await createUser("attorney");
  // Simulate the "webhook flipped draft→pending mid-request" scenario by
  // directly creating a pending row owned by the attorney. The handler's
  // single atomic `DELETE WHERE status='draft'` must not delete it.
  const job = await createJob({
    requesterUserId: attorney.userId,
    status: "pending",
  });
  try {
    const res = await apiFetch("DELETE", `/jobs/${job.id}`, {
      userId: attorney.userId,
    });
    assert.equal(
      res.status,
      409,
      "must refuse to delete a non-draft job, even if the caller owns it",
    );
    assert.equal(res.json?.status, "pending");
    assert.equal(
      await readJobStatus(job.id),
      "pending",
      "pending row must still exist after the 409",
    );
  } finally {
    await job.cleanup();
    await attorney.cleanup();
  }
});

test("DELETE /jobs/:id forbids deletion by a different attorney (403)", async () => {
  const owner = await createUser("attorney");
  const intruder = await createUser("attorney");
  const job = await createJob({
    requesterUserId: owner.userId,
    status: "draft",
  });
  try {
    const res = await apiFetch("DELETE", `/jobs/${job.id}`, {
      userId: intruder.userId,
    });
    assert.equal(res.status, 403);
    assert.equal(
      await readJobStatus(job.id),
      "draft",
      "intruder must not delete someone else's draft",
    );
  } finally {
    await job.cleanup();
    await owner.cleanup();
    await intruder.cleanup();
  }
});

test("DELETE /jobs/:id returns 404 for an unknown id", async () => {
  const attorney = await createUser("attorney");
  try {
    // Use an id that is extremely unlikely to exist.
    const res = await apiFetch("DELETE", `/jobs/2147483600`, {
      userId: attorney.userId,
    });
    assert.equal(res.status, 404);
  } finally {
    await attorney.cleanup();
  }
});

test("DELETE /jobs/:id rejects non-numeric ids (400)", async () => {
  const attorney = await createUser("attorney");
  try {
    const res = await apiFetch("DELETE", `/jobs/not-a-number`, {
      userId: attorney.userId,
    });
    assert.equal(res.status, 400);
  } finally {
    await attorney.cleanup();
  }
});

// =========================================================================
// 2) POST /stripe/draft-jobs/checkout — ownership / state validation
//
// All these requests fail validation BEFORE the handler reaches Stripe,
// so no Stripe client stub is needed.
// =========================================================================

test("draft-jobs/checkout: empty jobIds → 400", async () => {
  const attorney = await createUser("attorney");
  try {
    const res = await apiFetch("POST", "/stripe/draft-jobs/checkout", {
      userId: attorney.userId,
      body: { jobIds: [] },
    });
    assert.equal(res.status, 400);
    assert.match(res.json?.error ?? "", /non-empty/i);
  } finally {
    await attorney.cleanup();
  }
});

test("draft-jobs/checkout: missing jobIds → 400", async () => {
  const attorney = await createUser("attorney");
  try {
    const res = await apiFetch("POST", "/stripe/draft-jobs/checkout", {
      userId: attorney.userId,
      body: {},
    });
    assert.equal(res.status, 400);
  } finally {
    await attorney.cleanup();
  }
});

test("draft-jobs/checkout: invalid id in list → 400", async () => {
  const attorney = await createUser("attorney");
  try {
    const res = await apiFetch("POST", "/stripe/draft-jobs/checkout", {
      userId: attorney.userId,
      body: { jobIds: [1, "abc"] },
    });
    assert.equal(res.status, 400);
    assert.match(res.json?.error ?? "", /Invalid jobId/i);
  } finally {
    await attorney.cleanup();
  }
});

test("draft-jobs/checkout: more than 50 jobs → 400", async () => {
  const attorney = await createUser("attorney");
  try {
    const ids = Array.from({ length: 51 }, (_, i) => i + 1);
    const res = await apiFetch("POST", "/stripe/draft-jobs/checkout", {
      userId: attorney.userId,
      body: { jobIds: ids },
    });
    assert.equal(res.status, 400);
    assert.match(res.json?.error ?? "", /At most 50/i);
  } finally {
    await attorney.cleanup();
  }
});

test("draft-jobs/checkout: jobs not owned by caller → 404", async () => {
  const owner = await createUser("attorney");
  const intruder = await createUser("attorney");
  const job = await createJob({
    requesterUserId: owner.userId,
    status: "draft",
  });
  try {
    const res = await apiFetch("POST", "/stripe/draft-jobs/checkout", {
      userId: intruder.userId,
      body: { jobIds: [job.id] },
    });
    assert.equal(res.status, 404);
    assert.match(res.json?.error ?? "", /not yours/i);
    assert.equal(
      await readJobStatus(job.id),
      "draft",
      "owned job must remain draft when a stranger tries to check out",
    );
  } finally {
    await job.cleanup();
    await owner.cleanup();
    await intruder.cleanup();
  }
});

test("draft-jobs/checkout: refuses if any included job is not in draft (409)", async () => {
  const attorney = await createUser("attorney");
  const draft = await createJob({
    requesterUserId: attorney.userId,
    status: "draft",
  });
  const pending = await createJob({
    requesterUserId: attorney.userId,
    status: "pending",
  });
  try {
    const res = await apiFetch("POST", "/stripe/draft-jobs/checkout", {
      userId: attorney.userId,
      body: { jobIds: [draft.id, pending.id] },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json?.offendingJobId, pending.id);
    assert.equal(res.json?.status, "pending");
  } finally {
    await draft.cleanup();
    await pending.cleanup();
    await attorney.cleanup();
  }
});

test("draft-jobs/checkout: rejects when any draft is missing a snapshot price (400)", async () => {
  const attorney = await createUser("attorney");
  const priced = await createJob({
    requesterUserId: attorney.userId,
    status: "draft",
    grossCents: 5000,
  });
  const unpriced = await createJob({
    requesterUserId: attorney.userId,
    status: "draft",
    grossCents: 0,
  });
  try {
    const res = await apiFetch("POST", "/stripe/draft-jobs/checkout", {
      userId: attorney.userId,
      body: { jobIds: [priced.id, unpriced.id] },
    });
    assert.equal(res.status, 400);
    assert.equal(res.json?.offendingJobId, unpriced.id);
    assert.match(res.json?.error ?? "", /snapshot price/i);
  } finally {
    await priced.cleanup();
    await unpriced.cleanup();
    await attorney.cleanup();
  }
});

test("draft-jobs/checkout: non-attorney callers are rejected (403)", async () => {
  const requester = await createUser("requester");
  try {
    const res = await apiFetch("POST", "/stripe/draft-jobs/checkout", {
      userId: requester.userId,
      body: { jobIds: [1] },
    });
    assert.equal(res.status, 403);
  } finally {
    await requester.cleanup();
  }
});

test("draft-jobs/checkout: unauthenticated callers are rejected (401)", async () => {
  const res = await apiFetch("POST", "/stripe/draft-jobs/checkout", {
    body: { jobIds: [1] },
  });
  assert.equal(res.status, 401);
});

// =========================================================================
// 3) handleDraftJobsCheckoutCompleted — webhook idempotency
// =========================================================================

function fakeCheckoutSession(id: string): Stripe.Checkout.Session {
  return { id } as unknown as Stripe.Checkout.Session;
}

test("webhook: first delivery flips every listed draft to pending", async () => {
  const attorney = await createUser("attorney");
  const a = await createJob({
    requesterUserId: attorney.userId,
    status: "draft",
  });
  const b = await createJob({
    requesterUserId: attorney.userId,
    status: "draft",
  });
  try {
    await handleDraftJobsCheckoutCompleted(
      fakeCheckoutSession("cs_test_first"),
      `${a.id},${b.id}`,
      undefined,
    );
    assert.equal(await readJobStatus(a.id), "pending");
    assert.equal(await readJobStatus(b.id), "pending");
  } finally {
    await a.cleanup();
    await b.cleanup();
    await attorney.cleanup();
  }
});

test("webhook: re-delivery is a no-op (already-pending rows stay pending)", async () => {
  const attorney = await createUser("attorney");
  const a = await createJob({
    requesterUserId: attorney.userId,
    status: "draft",
  });
  try {
    // First delivery promotes draft → pending.
    await handleDraftJobsCheckoutCompleted(
      fakeCheckoutSession("cs_test_re_1"),
      String(a.id),
      undefined,
    );
    assert.equal(await readJobStatus(a.id), "pending");

    // Capture the post-first-delivery updatedAt so we can prove the
    // re-delivery didn't touch the row at all.
    const [beforeRow] = await db
      .select({ updatedAt: jobsTable.updatedAt })
      .from(jobsTable)
      .where(eq(jobsTable.id, a.id));

    // Second delivery (Stripe re-delivers the same event) must not
    // change anything — the WHERE filter requires status='draft'.
    await handleDraftJobsCheckoutCompleted(
      fakeCheckoutSession("cs_test_re_2"),
      String(a.id),
      undefined,
    );
    const [afterRow] = await db
      .select({ status: jobsTable.status, updatedAt: jobsTable.updatedAt })
      .from(jobsTable)
      .where(eq(jobsTable.id, a.id));
    assert.equal(afterRow.status, "pending");
    assert.equal(
      afterRow.updatedAt.getTime(),
      beforeRow.updatedAt.getTime(),
      "re-delivery must leave the row untouched (no UPDATE write)",
    );
  } finally {
    await a.cleanup();
    await attorney.cleanup();
  }
});

test("webhook: mixed batch only flips the still-draft rows", async () => {
  const attorney = await createUser("attorney");
  const stillDraft = await createJob({
    requesterUserId: attorney.userId,
    status: "draft",
  });
  const alreadyPending = await createJob({
    requesterUserId: attorney.userId,
    status: "pending",
  });
  const served = await createJob({
    requesterUserId: attorney.userId,
    status: "served",
  });
  try {
    await handleDraftJobsCheckoutCompleted(
      fakeCheckoutSession("cs_test_mixed"),
      `${stillDraft.id},${alreadyPending.id},${served.id}`,
      undefined,
    );
    const rows = await db
      .select({ id: jobsTable.id, status: jobsTable.status })
      .from(jobsTable)
      .where(
        inArray(jobsTable.id, [stillDraft.id, alreadyPending.id, served.id]),
      );
    const byId = new Map(rows.map((r) => [r.id, r.status]));
    assert.equal(byId.get(stillDraft.id), "pending");
    assert.equal(
      byId.get(alreadyPending.id),
      "pending",
      "already-pending row stays pending (not double-flipped)",
    );
    assert.equal(
      byId.get(served.id),
      "served",
      "served row is not regressed back to pending",
    );
  } finally {
    await stillDraft.cleanup();
    await alreadyPending.cleanup();
    await served.cleanup();
    await attorney.cleanup();
  }
});

test("webhook: empty/garbage jobIds metadata is a no-op (does not throw)", async () => {
  const attorney = await createUser("attorney");
  const job = await createJob({
    requesterUserId: attorney.userId,
    status: "draft",
  });
  try {
    // Empty CSV → handler logs a warning and returns.
    await handleDraftJobsCheckoutCompleted(
      fakeCheckoutSession("cs_test_empty"),
      "",
      undefined,
    );
    // Garbage CSV (no parseable ints) → same.
    await handleDraftJobsCheckoutCompleted(
      fakeCheckoutSession("cs_test_garbage"),
      "abc, , xyz",
      undefined,
    );
    assert.equal(
      await readJobStatus(job.id),
      "draft",
      "no rows touched when metadata has no valid ids",
    );
  } finally {
    await job.cleanup();
    await attorney.cleanup();
  }
});

test("webhook: ignores ids that don't exist (silently)", async () => {
  // The handler shouldn't throw on dangling ids; it just updates 0 rows.
  // We pass a high id unlikely to collide with any real row.
  await handleDraftJobsCheckoutCompleted(
    fakeCheckoutSession("cs_test_unknown_ids"),
    "2147483601,2147483602",
      undefined,
    );
  // No assertion needed beyond "did not throw" — but verify no row was
  // accidentally created:
  const rows = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(inArray(jobsTable.id, [2147483601, 2147483602]));
  assert.equal(rows.length, 0);
});
