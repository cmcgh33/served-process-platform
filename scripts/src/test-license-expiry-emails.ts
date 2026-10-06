/**
 * Integration smoke test for the license-expiry notifier.
 *
 * Run: pnpm --filter @workspace/scripts run test-license-expiry-emails
 *
 * What it does (against the live dev DB; uses isolated test rows):
 *   1. Inserts three throwaway server rows whose license_expiry sits at
 *      today+30, today+7, and today+0 (the threshold buckets).
 *   2. Calls runLicenseExpiryNotifications() and asserts that exactly the
 *      expected per-threshold sends were attempted.
 *   3. Calls it again and asserts every send was deduped.
 *   4. Verifies daysUntilExpiry/thresholdForDays edge cases.
 *   5. Cleans up the inserted rows + dedup ledger.
 *
 * Intentionally does NOT exercise the live Resend transport — sendEmail
 * stays in stub mode unless RESEND_API_KEY is set, so the assertions count
 * the *attempts* recorded by the dedup table, which is the deliverable
 * dedup contract anyway.
 */
import { eq, inArray } from "drizzle-orm";
import {
  db,
  serversTable,
  licenseExpiryNotificationsTable,
  pool,
} from "@workspace/db";
import {
  runLicenseExpiryNotifications,
  daysUntilExpiry,
  thresholdForDays,
} from "../../artifacts/api-server/src/lib/licenseExpiryEmails";

const TAG = `test-license-expiry-${Date.now()}`;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    throw new Error(msg);
  }
  console.log(`✓ ${msg}`);
}

function isoDateOffset(days: number, base: Date): string {
  const d = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  // -----------------------------------------------------------------------
  // Pure-function checks — no DB required.
  // -----------------------------------------------------------------------
  const today = new Date(Date.UTC(2026, 4, 1));
  assert(daysUntilExpiry(null, today) === null, "daysUntilExpiry(null) is null");
  assert(daysUntilExpiry("", today) === null, "daysUntilExpiry('') is null");
  assert(
    daysUntilExpiry("2026-05-01", today) === 0,
    "daysUntilExpiry today === 0",
  );
  assert(
    daysUntilExpiry("2026-05-31", today) === 30,
    "daysUntilExpiry +30d === 30",
  );
  assert(
    daysUntilExpiry("2026-04-30", today) === -1,
    "daysUntilExpiry -1d === -1",
  );
  assert(thresholdForDays(30) === 30, "threshold 30 → 30");
  assert(thresholdForDays(7) === 7, "threshold 7 → 7");
  assert(thresholdForDays(0) === 0, "threshold 0 → 0");
  assert(thresholdForDays(8) === null, "threshold 8 → null");
  assert(thresholdForDays(15) === null, "threshold 15 → null");
  assert(thresholdForDays(-1) === null, "threshold -1 → null");

  // -----------------------------------------------------------------------
  // DB-backed run — insert five test servers, run, assert, run, assert dedup.
  // -----------------------------------------------------------------------
  const now = new Date();
  // Use an explicit array (NOT a numeric-keyed object) — JS reorders numeric
  // object keys ascending which would scramble the index → label mapping.
  const fixtures = [
    { label: "t30", offset: 30 },
    { label: "t7", offset: 7 },
    { label: "today", offset: 0 },
    { label: "safe", offset: 60 }, // outside any bucket, should NOT be emailed
    { label: "expired", offset: -3 }, // expired, in admin digest only
  ];
  const ID_BY_LABEL: Record<string, number> = {};
  const tagEmail = (label: string) => `${TAG}+${label}@example.invalid`;
  const insertedIds: number[] = [];
  for (const { label, offset } of fixtures) {
    const [row] = await db
      .insert(serversTable)
      .values({
        userId: null,
        name: `Test Server ${label}`,
        email: tagEmail(label),
        licenseNumber: "TEST",
        licenseState: "CA",
        licenseExpiry: isoDateOffset(offset, now),
        status: "active",
      })
      .returning({ id: serversTable.id });
    insertedIds.push(row.id);
    ID_BY_LABEL[label] = row.id;
  }
  console.log(`Inserted test server ids: ${insertedIds.join(", ")}`);

  try {
    // First run.
    const r1 = await runLicenseExpiryNotifications(now);
    assert(
      r1.serverEmailsSent[30] >= 1,
      `first run: 30-day bucket sent ≥1 (got ${r1.serverEmailsSent[30]})`,
    );
    assert(
      r1.serverEmailsSent[7] >= 1,
      `first run: 7-day bucket sent ≥1 (got ${r1.serverEmailsSent[7]})`,
    );
    assert(
      r1.serverEmailsSent[0] >= 1,
      `first run: 0-day bucket sent ≥1 (got ${r1.serverEmailsSent[0]})`,
    );
    assert(
      r1.adminDigestRows >= 3,
      `first run: admin digest includes 7d+today+expired (≥3 rows; got ${r1.adminDigestRows})`,
    );

    // Verify dedup ledger has 3 rows for our test servers (one per bucketed expiry).
    const ledger1 = await db
      .select()
      .from(licenseExpiryNotificationsTable)
      .where(inArray(licenseExpiryNotificationsTable.serverId, insertedIds));
    assert(
      ledger1.length === 3,
      `ledger has 3 rows after first run (got ${ledger1.length})`,
    );

    // Second run — should dedup all three.
    const r2 = await runLicenseExpiryNotifications(now);
    const ourSent2 =
      r2.serverEmailsSent[30] + r2.serverEmailsSent[7] + r2.serverEmailsSent[0];
    // Note: counts are global; we can only assert that NEW skips include ≥3.
    const ourSkipped2 =
      r2.serverEmailsSkipped[30] +
      r2.serverEmailsSkipped[7] +
      r2.serverEmailsSkipped[0];
    assert(
      ourSkipped2 >= 3,
      `second run: at least 3 skipped (deduped) — got ${ourSkipped2}`,
    );
    void ourSent2;

    const ledger2 = await db
      .select()
      .from(licenseExpiryNotificationsTable)
      .where(inArray(licenseExpiryNotificationsTable.serverId, insertedIds));
    assert(
      ledger2.length === 3,
      `ledger still has 3 rows after second run (got ${ledger2.length})`,
    );

    // Renewal-resets-cycle: bump the 0-day server's expiry forward by 90 days,
    // then again to a date that hits the 30-day bucket. We use +90 first
    // to escape the bucket, then move it back to +30 so the new tuple key
    // (serverId, today+30, 30) is fresh.
    const renewedServerId = ID_BY_LABEL["today"];
    const renewedExpiry = isoDateOffset(30, now);
    await db
      .update(serversTable)
      .set({ licenseExpiry: renewedExpiry })
      .where(eq(serversTable.id, renewedServerId));

    const r3 = await runLicenseExpiryNotifications(now);
    // The renewed server now has expiry 30d out → 30-day bucket should fire.
    const ledger3 = await db
      .select()
      .from(licenseExpiryNotificationsTable)
      .where(inArray(licenseExpiryNotificationsTable.serverId, insertedIds));
    const renewedRows = ledger3.filter(
      (r) => r.serverId === renewedServerId,
    );
    assert(
      renewedRows.length === 2,
      `renewed server has 2 ledger rows (old 0-day + new 30-day; got ${renewedRows.length})`,
    );
    assert(
      renewedRows.some(
        (r) => r.licenseExpiry === renewedExpiry && r.threshold === 30,
      ),
      "renewed server got a fresh 30-day notification",
    );
    void r3;

    // Inactive servers should not be emailed even if they hit a bucket.
    const inactiveLabel = `inactive-${Date.now()}`;
    const [inactiveRow] = await db
      .insert(serversTable)
      .values({
        userId: null,
        name: "Test Inactive",
        email: `${TAG}+${inactiveLabel}@example.invalid`,
        licenseNumber: "TEST",
        licenseState: "CA",
        licenseExpiry: isoDateOffset(7, now),
        status: "inactive",
      })
      .returning({ id: serversTable.id });
    insertedIds.push(inactiveRow.id);

    await runLicenseExpiryNotifications(now);
    const inactiveLedger = await db
      .select()
      .from(licenseExpiryNotificationsTable)
      .where(eq(licenseExpiryNotificationsTable.serverId, inactiveRow.id));
    assert(
      inactiveLedger.length === 0,
      `inactive server was not emailed (got ${inactiveLedger.length} ledger rows)`,
    );

    console.log("\nAll license-expiry tests passed.");
  } finally {
    // Cleanup — order matters: ledger rows first (FK-free, but tidy), then
    // server rows.
    if (insertedIds.length > 0) {
      await db
        .delete(licenseExpiryNotificationsTable)
        .where(
          inArray(licenseExpiryNotificationsTable.serverId, insertedIds),
        );
      await db
        .delete(serversTable)
        .where(inArray(serversTable.id, insertedIds));
      console.log(`Cleaned up ${insertedIds.length} test server rows.`);
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
