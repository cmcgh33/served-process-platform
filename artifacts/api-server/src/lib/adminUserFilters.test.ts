// Integration test for the GET /admin/users role + license-expiry filter
// (Task #34). Uses the dev Postgres database directly — inserts users +
// servers with carefully-chosen license_expiry dates and asserts which
// rows survive the WHERE built by `buildAdminUsersWhere`.
//
// We only assert *inclusion/exclusion* of fixtures we created by their
// stable, randomly-generated user IDs so the test is robust against
// other rows already in the dev DB.
//
// Run with: pnpm --filter @workspace/api-server run test

import test from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  serversTable,
  usersTable,
} from "@workspace/db";
import {
  buildAdminUsersWhere,
  parseAdminUsersQuery,
} from "./adminUserFilters";

// Stable test prefix so cleanup is exact and we can ignore unrelated rows.
const PREFIX = `t34-${Date.now().toString(36)}`;
const id = (suffix: string) => `${PREFIX}-${suffix}`;

function dateOffsetIso(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD for the `date` column
}

async function seed() {
  await db.insert(usersTable).values([
    { id: id("server-soon"), email: `${id("server-soon")}@ex.com`, role: "server" },
    { id: id("server-far"), email: `${id("server-far")}@ex.com`, role: "server" },
    { id: id("server-expired"), email: `${id("server-expired")}@ex.com`, role: "server" },
    { id: id("server-today"), email: `${id("server-today")}@ex.com`, role: "server" },
    { id: id("server-no-license"), email: `${id("server-no-license")}@ex.com`, role: "server" },
    { id: id("attorney"), email: `${id("attorney")}@ex.com`, role: "attorney" },
    { id: id("requester"), email: `${id("requester")}@ex.com`, role: "requester" },
  ]);

  await db.insert(serversTable).values([
    {
      userId: id("server-soon"),
      name: "Soon",
      email: `${id("server-soon")}@ex.com`,
      licenseExpiry: dateOffsetIso(15), // within next 30
    },
    {
      userId: id("server-far"),
      name: "Far",
      email: `${id("server-far")}@ex.com`,
      licenseExpiry: dateOffsetIso(120), // beyond 30
    },
    {
      userId: id("server-expired"),
      name: "Expired",
      email: `${id("server-expired")}@ex.com`,
      licenseExpiry: dateOffsetIso(-45), // already lapsed
    },
    {
      userId: id("server-today"),
      name: "Today",
      email: `${id("server-today")}@ex.com`,
      licenseExpiry: dateOffsetIso(0), // boundary: today
    },
    {
      userId: id("server-no-license"),
      name: "NoLic",
      email: `${id("server-no-license")}@ex.com`,
      licenseExpiry: null,
    },
  ]);
}

async function cleanup() {
  const ids = [
    id("server-soon"),
    id("server-far"),
    id("server-expired"),
    id("server-today"),
    id("server-no-license"),
    id("attorney"),
    id("requester"),
  ];
  // Children first (FK-less here, but order kept for clarity).
  await db.delete(serversTable).where(inArray(serversTable.userId, ids));
  await db.delete(usersTable).where(inArray(usersTable.id, ids));
}

async function runQuery(rawParams: Record<string, unknown>): Promise<string[]> {
  const q = parseAdminUsersQuery(rawParams);
  const where = buildAdminUsersWhere(q);
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .leftJoin(serversTable, eq(serversTable.userId, usersTable.id))
    .where(where);
  // Restrict to our fixtures so unrelated dev-db rows don't contaminate
  // the assertion.
  return rows
    .map((r) => r.id)
    .filter((rid): rid is string => typeof rid === "string" && rid.startsWith(PREFIX));
}

test("admin users filter — role + expiringWithinDays end-to-end", async (t) => {
  await cleanup(); // belt-and-suspenders if a prior aborted run left data
  await seed();

  try {
  await t.test("role=server returns only server-role fixtures", async () => {
    const ids = await runQuery({ role: "server" });
    assert.deepEqual(
      new Set(ids),
      new Set([
        id("server-soon"),
        id("server-far"),
        id("server-expired"),
        id("server-today"),
        id("server-no-license"),
      ]),
    );
    assert.ok(!ids.includes(id("attorney")));
    assert.ok(!ids.includes(id("requester")));
  });

  await t.test("role=attorney excludes servers and requesters", async () => {
    const ids = await runQuery({ role: "attorney" });
    assert.deepEqual(ids, [id("attorney")]);
  });

  await t.test("role=requester excludes servers and attorneys", async () => {
    const ids = await runQuery({ role: "requester" });
    assert.deepEqual(ids, [id("requester")]);
  });

  await t.test(
    "role=server&expiringWithinDays=30 includes future-within-window and today, excludes future-beyond, excludes already-expired, excludes no-license",
    async () => {
      const ids = await runQuery({ role: "server", expiringWithinDays: 30 });
      const idSet = new Set(ids);
      // Included
      assert.ok(idSet.has(id("server-soon")), "license in 15 days must be included");
      assert.ok(idSet.has(id("server-today")), "license expiring today must be included (boundary)");
      // Excluded
      assert.ok(!idSet.has(id("server-far")), "license in 120 days must be excluded");
      assert.ok(
        !idSet.has(id("server-expired")),
        "already-expired license (-45d) must be excluded — chip means upcoming",
      );
      assert.ok(
        !idSet.has(id("server-no-license")),
        "server with NULL license_expiry must be excluded",
      );
    },
  );

  await t.test("expiringWithinDays without role=server is silently ignored", async () => {
    // role=attorney + expiringWithinDays=30 → expiry filter is dropped,
    // because non-server roles have no license_expiry to filter on.
    const ids = await runQuery({ role: "attorney", expiringWithinDays: 30 });
    assert.deepEqual(ids, [id("attorney")]);

    // No role + expiringWithinDays=30 → expiry filter is also dropped,
    // so all our fixtures (regardless of role/expiry) come back.
    const ids2 = await runQuery({ expiringWithinDays: 30 });
    assert.equal(ids2.length, 7, "all 7 test-prefixed fixtures should be returned");
  });

  await t.test("invalid role values are ignored (no SQL injection vector)", async () => {
    const q = parseAdminUsersQuery({ role: "admin'; DROP TABLE users; --" });
    assert.equal(q.role, null);
  });

  await t.test("expiringWithinDays is clamped to 0..365", async () => {
    assert.equal(
      parseAdminUsersQuery({ role: "server", expiringWithinDays: 9999 })
        .expiringWithinDays,
      365,
    );
    assert.equal(
      parseAdminUsersQuery({ role: "server", expiringWithinDays: -5 })
        .expiringWithinDays,
      null,
    );
    assert.equal(
      parseAdminUsersQuery({ role: "server", expiringWithinDays: "abc" })
        .expiringWithinDays,
      null,
    );
  });

  } finally {
    // Always clean up the fixtures, even if a subtest threw, so reruns
    // start from a clean slate and we don't leave stragglers in the dev DB.
    await cleanup();
  }
});
