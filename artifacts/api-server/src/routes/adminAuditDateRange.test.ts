// Backend tests for the admin audit date-range filter (Task #83). The
// `/admin/audit` JSON endpoint and the `/admin/audit.csv` streaming export
// both accept `from` / `to` ISO date params that bound `created_at`. The
// UI date pickers emit YYYY-MM-DD strings, which the server widens so a
// "to" date is inclusive of everything that happened that day. Full ISO
// datetimes are also accepted for any future tooling that needs minute
// precision.
//
// What this file covers:
//   1. JSON endpoint honors `from` (>=) and `to` (< next-day-midnight when
//      date-only) bounds against `admin_audit_log.created_at`.
//   2. JSON endpoint composes the date filter with other filters
//      (e.g. action) so admins can narrow by both at once.
//   3. CSV endpoint applies the same date bounds and the resulting CSV
//      body contains exactly the in-range rows.
//   4. Invalid date strings are silently dropped (no 4xx, no crash) so a
//      half-typed date in the URL doesn't break the page.
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
import {
  db,
  adminAuditLogTable,
  usersTable,
  type UserRole,
} from "@workspace/db";
import adminRouter from "../routes/admin";

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
const previousAdminEnv = process.env.ADMIN_USER_IDS;

// Seed three audit rows at well-spaced timestamps. We tag them with a
// shared random suffix in `details.tag` so we can identify (and clean up)
// only the rows this test created without disturbing existing data in the
// shared dev database.
const TAG = `audit_range_${randomUUID()}`;
const ROW_DAY1 = new Date("2025-03-10T08:00:00Z"); // inside [03-10, 03-12]
const ROW_DAY2 = new Date("2025-03-11T15:00:00Z"); // inside [03-10, 03-12]
const ROW_DAY3 = new Date("2025-03-12T23:30:00Z"); // inside [03-10, 03-12] (late!)
const ROW_BEFORE = new Date("2025-03-09T12:00:00Z"); // outside (before)
const ROW_AFTER = new Date("2025-03-13T01:00:00Z"); // outside (after)

const seededIds: number[] = [];

test.before(async () => {
  process.env.ADMIN_USER_IDS = adminId;

  await db.insert(usersTable).values({
    id: adminId,
    email: adminEmail,
    role: "attorney" satisfies UserRole,
  });

  const seeded = await db
    .insert(adminAuditLogTable)
    .values([
      {
        actorUserId: adminId,
        action: "server.verify",
        details: { tag: TAG, slot: "before" },
        createdAt: ROW_BEFORE,
      },
      {
        actorUserId: adminId,
        action: "server.verify",
        details: { tag: TAG, slot: "day1" },
        createdAt: ROW_DAY1,
      },
      {
        actorUserId: adminId,
        action: "server.fail",
        details: { tag: TAG, slot: "day2" },
        createdAt: ROW_DAY2,
      },
      {
        actorUserId: adminId,
        action: "server.verify",
        details: { tag: TAG, slot: "day3" },
        createdAt: ROW_DAY3,
      },
      {
        actorUserId: adminId,
        action: "server.verify",
        details: { tag: TAG, slot: "after" },
        createdAt: ROW_AFTER,
      },
    ])
    .returning({ id: adminAuditLogTable.id });
  for (const r of seeded) seededIds.push(r.id);

  const app = buildTestApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  if (seededIds.length) {
    await db
      .delete(adminAuditLogTable)
      .where(inArray(adminAuditLogTable.id, seededIds));
  }
  await db.delete(usersTable).where(eq(usersTable.id, adminId));
  if (previousAdminEnv === undefined) {
    delete process.env.ADMIN_USER_IDS;
  } else {
    process.env.ADMIN_USER_IDS = previousAdminEnv;
  }
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  const { pool } = await import("@workspace/db");
  await pool.end();
});

interface AuditRow {
  id: number;
  details: Record<string, unknown> | null;
}

// Restrict result set to rows we seeded: the dev DB may contain unrelated
// audit rows from other tests or manual usage, but they all carry a
// different `details.tag`.
function ours(items: AuditRow[]): AuditRow[] {
  return items.filter((r) => r.details && (r.details as any).tag === TAG);
}

function slotsOf(items: AuditRow[]): string[] {
  return ours(items)
    .map((r) => String((r.details as any).slot))
    .sort();
}

// =========================================================================
// JSON endpoint: from / to bounds
// =========================================================================

test("GET /admin/audit ?from=&to= filters by date range (date-only inclusive)", async () => {
  const res = await fetch(
    `${baseUrl}/admin/audit?from=2025-03-10&to=2025-03-12&limit=500`,
    { headers: { "x-test-user": adminId } },
  );
  assert.equal(res.status, 200);
  const json = (await res.json()) as { items: AuditRow[] };
  // The "to" date should be inclusive of the entire 12th — including
  // the 23:30 row — because the server widens date-only `to` to the
  // next-day-midnight exclusive bound.
  assert.deepEqual(slotsOf(json.items), ["day1", "day2", "day3"]);
});

test("GET /admin/audit ?from= alone excludes earlier rows", async () => {
  const res = await fetch(
    `${baseUrl}/admin/audit?from=2025-03-11&limit=500`,
    { headers: { "x-test-user": adminId } },
  );
  assert.equal(res.status, 200);
  const json = (await res.json()) as { items: AuditRow[] };
  assert.deepEqual(slotsOf(json.items), ["after", "day2", "day3"]);
});

test("GET /admin/audit ?to= alone excludes later rows", async () => {
  const res = await fetch(
    `${baseUrl}/admin/audit?to=2025-03-11&limit=500`,
    { headers: { "x-test-user": adminId } },
  );
  assert.equal(res.status, 200);
  const json = (await res.json()) as { items: AuditRow[] };
  // ?to=2025-03-11 means "through end of 03-11" (next-day exclusive),
  // so day1 + day2 are in, day3 (03-12) is out.
  assert.deepEqual(slotsOf(json.items), ["before", "day1", "day2"]);
});

test("GET /admin/audit composes date filter with action filter", async () => {
  const res = await fetch(
    `${baseUrl}/admin/audit?from=2025-03-10&to=2025-03-12&action=server.fail&limit=500`,
    { headers: { "x-test-user": adminId } },
  );
  assert.equal(res.status, 200);
  const json = (await res.json()) as { items: AuditRow[] };
  // Only the day2 row is action=server.fail in the date window.
  assert.deepEqual(slotsOf(json.items), ["day2"]);
});

test("GET /admin/audit ignores invalid date params (no 4xx, no crash)", async () => {
  const res = await fetch(
    `${baseUrl}/admin/audit?from=not-a-date&to=2025-13-99&limit=500`,
    { headers: { "x-test-user": adminId } },
  );
  assert.equal(res.status, 200);
  const json = (await res.json()) as { items: AuditRow[] };
  // With both filters silently dropped, all five seeded rows come back.
  assert.deepEqual(slotsOf(json.items), [
    "after",
    "before",
    "day1",
    "day2",
    "day3",
  ]);
});

test("GET /admin/audit accepts full ISO datetimes for minute-precision bounds", async () => {
  // From 03-11T12:00:00Z (after day1's 08:00) through 03-12T23:00:00Z
  // (before day3's 23:30) should leave only day2 in range.
  const res = await fetch(
    `${baseUrl}/admin/audit?from=2025-03-11T12:00:00Z&to=2025-03-12T23:00:00Z&limit=500`,
    { headers: { "x-test-user": adminId } },
  );
  assert.equal(res.status, 200);
  const json = (await res.json()) as { items: AuditRow[] };
  assert.deepEqual(slotsOf(json.items), ["day2"]);
});

// =========================================================================
// CSV endpoint: same date filter applies to the streaming export
// =========================================================================

test("GET /admin/audit.csv ?from=&to= streams only in-range rows", async () => {
  const res = await fetch(
    `${baseUrl}/admin/audit.csv?from=2025-03-10&to=2025-03-12`,
    { headers: { "x-test-user": adminId } },
  );
  assert.equal(res.status, 200);
  const ct = res.headers.get("content-type") ?? "";
  assert.ok(ct.includes("text/csv"), `expected text/csv, got ${ct}`);
  const body = await res.text();

  // Header row always present.
  const lines = body.split(/\r\n/).filter((l) => l.length > 0);
  assert.ok(lines[0]?.startsWith("timestamp,"), "CSV header row missing");

  // Walk our seeded rows and confirm only day1/day2/day3 appear in the
  // body. We grep on `tag=TAG` text — but the CSV stores `details` as a
  // JSON-stringified blob, so a substring match on the tag value is the
  // cleanest cross-row check.
  const dayMatches = lines.filter((l) => l.includes(TAG));
  assert.equal(
    dayMatches.length,
    3,
    `expected 3 in-range rows in CSV, got ${dayMatches.length}: ${dayMatches.join("\n")}`,
  );
  for (const slot of ["day1", "day2", "day3"]) {
    assert.ok(
      dayMatches.some((l) => l.includes(slot)),
      `expected slot ${slot} in CSV body`,
    );
  }
  for (const slot of ["before", "after"]) {
    assert.ok(
      !dayMatches.some((l) => l.includes(slot)),
      `did not expect slot ${slot} in CSV body`,
    );
  }
});
