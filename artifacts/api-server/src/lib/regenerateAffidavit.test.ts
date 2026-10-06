// Integration test for the admin "regenerate affidavit" recovery tool
// (Task #76). The confirm-service route generates the affidavit PDF
// post-commit, so a transient PDF/storage failure leaves the served-flip
// durable but the job row's `proof_pdf_url` null. The documented recovery
// path is `POST /admin/jobs/:id/regenerate-affidavit` (see
// `lib/affidavit.ts` header comment) — this file pins down the contract
// so a regression there can never silently strand a served job again.
//
// What we cover:
//   1. A served job with `proof_pdf_url IS NULL` (the post-commit
//      generation failure scenario) can be healed via the admin endpoint:
//      200 + { proofPdfUrl }, the DB row is populated, and the bytes at
//      that path are a real PDF (start with "%PDF-").
//   2. The endpoint is safe to retry: calling it a second time produces a
//      DIFFERENT object path (idempotent on intent, not on storage key —
//      see the comment above `generateAndStoreAffidavit`'s "prior blob
//      intentionally orphaned" note), the DB row is overwritten cleanly,
//      and BOTH blobs are still downloadable as real PDFs.
//
// Why HTTP-route shaped (and not just a direct `generateAndStoreAffidavit`
// call): the recovery tool is the admin endpoint. We want to assert that
// `requireAuth` + `requireAdmin` + the route handler all wire up correctly,
// not just the underlying library function (which `affidavitPipeline.test.ts`
// already covers from the confirm-service side). We mount the real
// `adminRouter` on a minimal express app and fake Clerk auth via an
// `x-test-user` header — same pattern as `routes/draftJobsLifecycle.test.ts`.
//
// Skipped automatically if DATABASE_URL / PRIVATE_OBJECT_DIR /
// PUBLIC_OBJECT_SEARCH_PATHS aren't set so `pnpm --filter @workspace/api-server
// run test` is safe to run on a fresh checkout without provisioning a
// database + bucket — mirroring `affidavitPipeline.test.ts`.
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
import { eq } from "drizzle-orm";
import {
  db,
  jobsTable,
  serversTable,
  serverCredentialsTable,
  usersTable,
} from "@workspace/db";
import adminRouter from "../routes/admin";
import { requireAuth } from "../middlewares/auth";
import {
  uploadBufferToObjectStorage,
  downloadObjectBytes,
} from "./uploadServerObject";

const skip =
  !process.env.DATABASE_URL ||
  !process.env.PRIVATE_OBJECT_DIR ||
  !process.env.PUBLIC_OBJECT_SEARCH_PATHS;

const skipReason =
  "Skipped: requires DATABASE_URL + PRIVATE_OBJECT_DIR + PUBLIC_OBJECT_SEARCH_PATHS (Replit object storage).";

// 1×1 transparent PNG — small, valid, and good enough to round-trip through
// object storage so the PDF generator's `signatureImagePng` code path is
// exercised end-to-end (not just the typed-name fallback).
const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
  "base64",
);

// ---------- Test app ------------------------------------------------------
//
// Minimal pino-shaped logger so admin route handlers' `req.log.*` calls
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
    (req as unknown as { log: unknown }).log = noopLogger();
    next();
  });
  // Fake Clerk: x-test-user → req.auth() returns a session-token auth
  // object with that userId. See routes/draftJobsLifecycle.test.ts for the
  // full reasoning behind shape + tokenType requirements.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const userId = req.header("x-test-user") ?? null;
    (
      req as Request & {
        auth: () => { userId: string | null; tokenType: string };
      }
    ).auth = () => ({ userId, tokenType: "session_token" });
    next();
  });
  app.use(requireAuth);
  app.use(adminRouter);
  return app;
}

let server: Server | null = null;
let baseUrl = "";

test.before(async () => {
  if (skip) return;
  const app = buildTestApp();
  server = createServer(app);
  await new Promise<void>((resolve) =>
    server!.listen(0, "127.0.0.1", resolve),
  );
  const addr = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) =>
    server!.close((err) => (err ? reject(err) : resolve())),
  );
});

// ---------- DB fixtures ---------------------------------------------------

interface Fixture {
  adminUserId: string;
  serverUserId: string;
  serverId: number;
  jobId: number;
  signatureImageUrl: string;
  cleanup: () => Promise<void>;
}

/**
 * Seed a job already in the `served` state with `proof_pdf_url = null` —
 * exactly the row shape left behind when the confirm-service post-commit
 * affidavit generation fails (transient storage error, malformed signature,
 * etc.). The admin regenerate endpoint is the documented recovery path for
 * this state.
 */
async function seedServedJobWithoutAffidavit(): Promise<Fixture> {
  const tag = randomUUID();
  const adminUserId = `test_admin_${tag}`;
  const serverUserId = `test_server_${tag}`;

  // Add the test admin to the env-driven allowlist so requireAdmin() lets
  // their requests through. getAdminUserIds() reads ADMIN_USER_IDS at call
  // time, so we can append per-test without a process restart.
  const existing = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  process.env.ADMIN_USER_IDS = [...existing, adminUserId].join(",");

  await db
    .insert(usersTable)
    .values([
      {
        id: adminUserId,
        email: `${adminUserId}@example.test`,
        // The role column is a separate concern from the env allowlist; the
        // admin endpoints gate purely on isAdminUser(env). Pick `attorney`
        // (any non-server role works) so loadRoleFromDb succeeds.
        role: "attorney",
      },
      {
        id: serverUserId,
        email: `${serverUserId}@example.test`,
        role: "server",
      },
    ])
    .onConflictDoNothing();

  const [server] = await db
    .insert(serversTable)
    .values({
      userId: serverUserId,
      name: "Pat M. Server",
      email: `${serverUserId}@example.test`,
      status: "active",
      payoutsEnabled: false,
      licenseNumber: "LIC-12345",
      licenseState: "NY",
    })
    .returning({ id: serversTable.id });

  // Mirror what `assertServerCanAccept` requires for a complete server row.
  // The regenerate endpoint doesn't check this itself, but generating an
  // affidavit reads the server row for the licenseNumber/State strings, so
  // we want a realistic shape.
  await db.insert(serverCredentialsTable).values({
    userId: serverUserId,
    status: "verified",
    verifiedAt: new Date(),
  });

  // Upload a real signature PNG so generateAndStoreAffidavit's
  // downloadObjectBytes path returns a non-null buffer and PDFKit is asked
  // to embed it (the more interesting code path).
  const signatureImageUrl = await uploadBufferToObjectStorage(
    ONE_PX_PNG,
    "image/png",
  );

  const [job] = await db
    .insert(jobsTable)
    .values({
      requesterUserId: `test_requester_${tag}`,
      platformRef: `SERVED-REGEN-${tag.slice(0, 8).toUpperCase()}`,
      documentType: "subpoena",
      recipientName: "Jane Doe",
      recipientAddress: "1 Test St",
      recipientCity: "Brooklyn",
      recipientState: "NY",
      recipientZip: "11201",
      caseNumber: `REGEN-${tag.slice(0, 6)}`,
      matterName: "Doe v. Roe",
      // The whole point: served durably, but the affidavit blob is missing.
      status: "served",
      servedAt: new Date(),
      signatureTypedName: "Pat M. Server",
      signatureImageUrl,
      proofPdfUrl: null,
      serverId: server.id,
      grossCents: 10000,
      platformFeeCents: 2000,
      serverPayoutCents: 8000,
    })
    .returning({ id: jobsTable.id });

  return {
    adminUserId,
    serverUserId,
    serverId: server.id,
    jobId: job.id,
    signatureImageUrl,
    cleanup: async () => {
      await db.delete(jobsTable).where(eq(jobsTable.id, job.id));
      await db
        .delete(serverCredentialsTable)
        .where(eq(serverCredentialsTable.userId, serverUserId));
      await db.delete(serversTable).where(eq(serversTable.id, server.id));
      await db.delete(usersTable).where(eq(usersTable.id, serverUserId));
      await db.delete(usersTable).where(eq(usersTable.id, adminUserId));
      // Pull the test admin back out of the env allowlist so it doesn't
      // leak into other tests sharing this process.
      const remaining = (process.env.ADMIN_USER_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((id) => id && id !== adminUserId);
      process.env.ADMIN_USER_IDS = remaining.join(",");
    },
  };
}

// ---------- HTTP helper ---------------------------------------------------

async function adminPost(
  path: string,
  opts: { userId?: string } = {},
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {};
  if (opts.userId) headers["x-test-user"] = opts.userId;
  const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

// ---------- Tests ---------------------------------------------------------

test(
  "POST /admin/jobs/:id/regenerate-affidavit heals a served job with a missing proof_pdf_url",
  { skip: skip ? skipReason : false },
  async () => {
    const fx = await seedServedJobWithoutAffidavit();
    try {
      // Sanity: the row really starts with no affidavit blob.
      const [before] = await db
        .select({ proofPdfUrl: jobsTable.proofPdfUrl })
        .from(jobsTable)
        .where(eq(jobsTable.id, fx.jobId))
        .limit(1);
      assert.equal(
        before.proofPdfUrl,
        null,
        "precondition: seeded served job must have proof_pdf_url = NULL",
      );

      const res = await adminPost(
        `/admin/jobs/${fx.jobId}/regenerate-affidavit`,
        { userId: fx.adminUserId },
      );
      assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
      assert.equal(res.json?.jobId, fx.jobId);
      assert.ok(
        typeof res.json?.proofPdfUrl === "string" && res.json.proofPdfUrl.length > 0,
        "response body must include a non-empty proofPdfUrl string",
      );
      assert.match(
        res.json.proofPdfUrl,
        /^\/objects\/uploads\//,
        "proofPdfUrl must be a normalized object path",
      );

      // DB-side: row is populated with the same path.
      const [after] = await db
        .select({ proofPdfUrl: jobsTable.proofPdfUrl })
        .from(jobsTable)
        .where(eq(jobsTable.id, fx.jobId))
        .limit(1);
      assert.equal(after.proofPdfUrl, res.json.proofPdfUrl);

      // The bytes at that path are a real PDF.
      const pdfBytes = await downloadObjectBytes(after.proofPdfUrl!);
      assert.ok(
        pdfBytes && pdfBytes.length > 0,
        "regenerated affidavit bytes must be downloadable",
      );
      const head = pdfBytes!.subarray(0, 5).toString("latin1");
      assert.equal(
        head,
        "%PDF-",
        `expected %PDF- prefix, got ${JSON.stringify(head)}`,
      );
    } finally {
      await fx.cleanup();
    }
  },
);

test(
  "POST /admin/jobs/:id/regenerate-affidavit is safe to retry: produces a fresh path and overwrites cleanly",
  { skip: skip ? skipReason : false },
  async () => {
    const fx = await seedServedJobWithoutAffidavit();
    try {
      // First regeneration — heals the missing-blob state.
      const first = await adminPost(
        `/admin/jobs/${fx.jobId}/regenerate-affidavit`,
        { userId: fx.adminUserId },
      );
      assert.equal(first.status, 200);
      const firstPath: string = first.json.proofPdfUrl;
      assert.ok(firstPath, "first regeneration must return a proofPdfUrl");

      // Second regeneration — the documented recovery tool must be safe to
      // re-run (the prior blob is intentionally orphaned in storage; see
      // the header comment above generateAndStoreAffidavit).
      const second = await adminPost(
        `/admin/jobs/${fx.jobId}/regenerate-affidavit`,
        { userId: fx.adminUserId },
      );
      assert.equal(
        second.status,
        200,
        `retry must succeed; got ${second.status}: ${JSON.stringify(second.json)}`,
      );
      const secondPath: string = second.json.proofPdfUrl;
      assert.ok(secondPath, "second regeneration must return a proofPdfUrl");

      // A retry must NOT reuse the old object path — every call writes a
      // brand-new blob (uploadBufferToObjectStorage allocates a new uuid).
      // Pinning this guarantees a corrupt or partially-written first blob
      // can't continue to mask a successful retry.
      assert.notEqual(
        secondPath,
        firstPath,
        "retry must allocate a fresh object path (no in-place overwrite)",
      );

      // DB row points at the NEW blob (the WHERE-less UPDATE in
      // generateAndStoreAffidavit overwrites cleanly).
      const [row] = await db
        .select({ proofPdfUrl: jobsTable.proofPdfUrl })
        .from(jobsTable)
        .where(eq(jobsTable.id, fx.jobId))
        .limit(1);
      assert.equal(
        row.proofPdfUrl,
        secondPath,
        "DB must be updated to the latest blob path on retry",
      );

      // Both blobs remain downloadable + are real PDFs. (We deliberately
      // don't delete the orphaned first blob — verifying it's still there
      // documents the orphan-on-retry behaviour callers depend on.)
      for (const [label, path] of [
        ["first", firstPath],
        ["second (current)", secondPath],
      ] as const) {
        const bytes = await downloadObjectBytes(path);
        assert.ok(
          bytes && bytes.length > 0,
          `${label} affidavit bytes must be downloadable`,
        );
        const head = bytes!.subarray(0, 5).toString("latin1");
        assert.equal(
          head,
          "%PDF-",
          `${label} affidavit must start with %PDF-, got ${JSON.stringify(head)}`,
        );
      }
    } finally {
      await fx.cleanup();
    }
  },
);
