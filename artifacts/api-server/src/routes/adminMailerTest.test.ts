// Backend tests for the admin "send test email" smoke-test endpoint
// (Task #77). The endpoint POSTs to /admin/mailer/test, gated by the
// same ADMIN_USER_IDS allowlist as the rest of the admin namespace, and
// returns a structured `SendEmailResult` so the dashboard UI can surface
// delivery success/failure inline.
//
// What this file covers:
//   1. Auth gating — non-admin → 404 (admin namespace stays invisible),
//      unauthenticated → 401.
//   2. Defaults — when no `to` is supplied, the endpoint resolves the
//      caller's email from the users table.
//   3. Validation — obviously-malformed addresses are rejected with 400.
//   4. Result shape — the response surfaces `delivered`, `hadCredential`,
//      `from`, optional `status`/`detail`, mirroring what `sendEmail`
//      logs internally so ops can debug from the UI alone.
//
// Side effects: the real `sendEmail` resolves a SendGrid key from
// SENDGRID_API_KEY or the Replit connectors proxy. We unset both so the
// "no credential — logged only" path runs and the test never hits the
// real SendGrid API.
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
  usersTable,
  type UserRole,
} from "@workspace/db";
import adminRouter from "../routes/admin";

// Match the noopLogger shape used in draftJobsLifecycle.test.ts so the
// pino-typed `req.log.info(...)` calls inside the route handler don't
// crash. We don't care about contents during tests.
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
  // object. See draftJobsLifecycle.test.ts for the rationale on
  // tokenType: "session_token".
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const userId = req.header("x-test-user") ?? null;
    (
      req as Request & {
        auth: () => { userId: string | null; tokenType: string };
      }
    ).auth = () => ({ userId, tokenType: "session_token" });
    next();
  });
  app.use(adminRouter);
  return app;
}

let server: Server;
let baseUrl: string;
const adminId = `test_admin_${randomUUID()}`;
const adminEmail = `${adminId}@example.test`;
const nonAdminId = `test_nonadmin_${randomUUID()}`;
const previousAdminEnv = process.env.ADMIN_USER_IDS;
const previousSendgridEnv = process.env.SENDGRID_API_KEY;
const previousConnectorEnv = process.env.REPLIT_CONNECTORS_HOSTNAME;

test.before(async () => {
  // Force the "no credential" code path so we never touch the real
  // SendGrid API. The endpoint should still return 200 with
  // delivered:false / hadCredential:false in this scenario — that's
  // exactly what an op would see in dev/preview without SendGrid wired.
  process.env.ADMIN_USER_IDS = adminId;
  delete process.env.SENDGRID_API_KEY;
  delete process.env.REPLIT_CONNECTORS_HOSTNAME;

  // Seed the admin user so the default-recipient (caller's email) path
  // has something to look up.
  await db.insert(usersTable).values({
    id: adminId,
    email: adminEmail,
    role: "attorney" satisfies UserRole,
  });

  const app = buildTestApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  await db.delete(usersTable).where(eq(usersTable.id, adminId));
  if (previousAdminEnv === undefined) {
    delete process.env.ADMIN_USER_IDS;
  } else {
    process.env.ADMIN_USER_IDS = previousAdminEnv;
  }
  if (previousSendgridEnv !== undefined) {
    process.env.SENDGRID_API_KEY = previousSendgridEnv;
  }
  if (previousConnectorEnv !== undefined) {
    process.env.REPLIT_CONNECTORS_HOSTNAME = previousConnectorEnv;
  }
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  const { pool } = await import("@workspace/db");
  await pool.end();
});

async function apiFetch(
  method: string,
  path: string,
  opts: { userId?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
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
  return { status: res.status, json };
}

// =========================================================================
// Auth gating
// =========================================================================

test("POST /admin/mailer/test → 401 when unauthenticated", async () => {
  const res = await apiFetch("POST", "/admin/mailer/test", {
    body: { to: "anyone@example.com" },
  });
  assert.equal(res.status, 401);
});

test("POST /admin/mailer/test → 404 for non-admin (admin surface invisible)", async () => {
  const res = await apiFetch("POST", "/admin/mailer/test", {
    userId: nonAdminId,
    body: { to: "anyone@example.com" },
  });
  // requireAdmin() returns 404 (not 403) by design so the existence of
  // /admin/* is invisible to regular users.
  assert.equal(res.status, 404);
});

// =========================================================================
// Happy path: explicit recipient, no credential → logged-only
// =========================================================================

test("POST /admin/mailer/test → 200 with delivered:false/hadCredential:false when no key configured", async () => {
  const res = await apiFetch("POST", "/admin/mailer/test", {
    userId: adminId,
    body: { to: "ops@example.com", subject: "ping" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.to, "ops@example.com");
  assert.equal(res.json.subject, "ping");
  assert.equal(res.json.delivered, false);
  assert.equal(res.json.hadCredential, false);
  assert.ok(
    typeof res.json.from === "string" && res.json.from.length > 0,
    "from should be the resolved MAIL_FROM / default address",
  );
  assert.ok(
    typeof res.json.detail === "string" &&
      res.json.detail.includes("No SendGrid credential"),
    "detail should explain the no-credential path so ops know what to fix",
  );
  assert.ok(
    typeof res.json.sentAt === "string" && res.json.sentAt.includes("T"),
    "sentAt should be an ISO timestamp",
  );
});

// =========================================================================
// Default recipient: falls back to caller's email
// =========================================================================

test("POST /admin/mailer/test → defaults `to` to the calling admin's email", async () => {
  const res = await apiFetch("POST", "/admin/mailer/test", {
    userId: adminId,
    body: {},
  });
  assert.equal(res.status, 200);
  assert.equal(
    res.json.to,
    adminEmail,
    "Should fall back to usersTable.email for the calling admin",
  );
});

// =========================================================================
// Input validation
// =========================================================================

test("POST /admin/mailer/test → 400 for malformed recipient", async () => {
  const res = await apiFetch("POST", "/admin/mailer/test", {
    userId: adminId,
    body: { to: "not-an-email" },
  });
  assert.equal(res.status, 400);
  assert.ok(
    typeof res.json.error === "string" &&
      res.json.error.toLowerCase().includes("invalid recipient"),
  );
});

test("POST /admin/mailer/test → 200 with custom subject/body honored", async () => {
  const res = await apiFetch("POST", "/admin/mailer/test", {
    userId: adminId,
    body: {
      to: "ops@example.com",
      subject: "Custom subject",
      body: "Custom body line.",
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.subject, "Custom subject");
  // Body content isn't echoed in the response (it's already been sent /
  // logged), but we at least assert no crash and the basic shape.
  assert.equal(res.json.delivered, false);
  assert.equal(res.json.hadCredential, false);
});
