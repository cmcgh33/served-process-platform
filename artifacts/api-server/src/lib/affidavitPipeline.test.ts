// Integration test for the affidavit signing + PDF download pipeline
// (Task #61). Seeds a server user + an in-progress job, drives the same
// `markJobServed` + `generateAndStoreAffidavit` pipeline that the
// `POST /api/jobs/:id/attempts` route runs when a server confirms service,
// and asserts the durable side-effects:
//
//   - jobs.status === 'served'
//   - jobs.payout_eligible_at IS NOT NULL  (payout batch picks the row up)
//   - jobs.proof_pdf_url IS NOT NULL       (affidavit was generated)
//   - the bytes at proof_pdf_url are a real PDF (start with "%PDF-")
//   - downloading via ObjectStorageService surfaces application/pdf
//
// Why a direct-pipeline test (not an HTTP route test): the route layer is
// gated by Clerk session auth and a CSRF/cookies handshake that's expensive
// to stand up in a unit-test process. The two functions exercised here are
// the entire post-auth body of `POST /jobs/:id/attempts` for the
// outcome=personal/substitute branches — they ARE what the route runs. A
// browser-driven Playwright test (tests/e2e/confirm-affidavit.spec.ts in the
// served-app) covers the auth + UI canvas-drawing path against the same DB
// state-machine.
//
// Skipped automatically if DATABASE_URL / PRIVATE_OBJECT_DIR aren't set so
// `pnpm --filter @workspace/api-server run test` is safe to run on a fresh
// checkout without provisioning a database + bucket.
//
// Run with: pnpm --filter @workspace/api-server run test

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
// pdf-parse's package entry point runs a debug block (reads a sample PDF off
// disk) when imported as `pdf-parse`. Importing the inner module bypasses
// that side effect — the recommended workaround for using pdf-parse as a
// library rather than a CLI. The shipped @types only describe the package
// root, so we narrow the inner module's signature inline.
// @ts-expect-error -- no published types for the inner module path
import pdfParseInner from "pdf-parse/lib/pdf-parse.js";
const pdfParse = pdfParseInner as (
  data: Buffer,
) => Promise<{ numpages: number; text: string }>;
import {
  db,
  jobsTable,
  serversTable,
  serverCredentialsTable,
  serviceAttemptsTable,
  payoutsTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";
import { generateAndStoreAffidavit } from "./affidavit";
import {
  uploadBufferToObjectStorage,
  downloadObjectBytes,
} from "./uploadServerObject";
import { ObjectStorageService } from "./objectStorage";
import { markJobServed } from "../routes/jobs";

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

interface Fixture {
  userId: string;
  serverId: number;
  jobId: number;
  signatureImageUrl: string;
  cleanup: () => Promise<void>;
}

async function seed(): Promise<Fixture> {
  const tag = randomUUID();
  const userId = `test_affidavit_${tag}`;

  await db
    .insert(usersTable)
    .values({
      id: userId,
      email: `${tag}@example.test`,
      role: "server",
    })
    .onConflictDoNothing();

  const [server] = await db
    .insert(serversTable)
    .values({
      userId,
      name: "Pat M. Server",
      email: `${tag}@example.test`,
      status: "active",
      // No stripeAccountId on purpose — markJobServed's post-commit Stripe
      // transfer is gated on `server?.stripeAccountId && server.payoutsEnabled`.
      // Leaving these unset keeps the test fully self-contained (no Stripe
      // API roundtrip), while the payouts table still gets a `pending` row
      // enqueued so we can assert the eligibility plumbing.
      payoutsEnabled: false,
      licenseNumber: "LIC-12345",
      licenseState: "NY",
    })
    .returning({ id: serversTable.id });

  // assertServerCanAccept demands a `verified` credential row before it'll
  // let the server flip a job to served. Mirror that here.
  await db.insert(serverCredentialsTable).values({
    userId,
    status: "verified",
    verifiedAt: new Date(),
  });

  // ...but assertServerCanAccept ALSO requires stripeAccountId+payoutsEnabled.
  // For the test we want to bypass the no_payouts gate so we can exercise
  // the affidavit pipeline. Update the server with a synthetic Stripe
  // account id, but keep payoutsEnabled false so markJobServed will hit
  // the "skip Stripe transfer" branch (logged as a warning).
  //
  // Wait — assertServerCanAccept requires BOTH. To fully avoid Stripe
  // we'd need both true (which would attempt a transfer). Easier: set
  // both true; markJobServed catches Stripe errors inside
  // processPayoutTransfer, so a failing transfer just marks the payout
  // row as `failed` and the served-flip itself still commits. That's the
  // exact production behaviour we want covered.
  await db
    .update(serversTable)
    .set({ stripeAccountId: `acct_test_${tag.slice(0, 8)}`, payoutsEnabled: true })
    .where(eq(serversTable.id, server.id));

  // Upload a real signature PNG so generateAndStoreAffidavit's
  // downloadObjectBytes path returns a non-null buffer and PDFKit is asked
  // to embed it.
  const signatureImageUrl = await uploadBufferToObjectStorage(
    ONE_PX_PNG,
    "image/png",
  );

  const [job] = await db
    .insert(jobsTable)
    .values({
      requesterUserId: `test_requester_${tag}`,
      platformRef: `SERVED-TEST-${tag.slice(0, 8).toUpperCase()}`,
      documentType: "subpoena",
      recipientName: "Jane Doe",
      recipientAddress: "1 Test St",
      recipientCity: "Brooklyn",
      recipientState: "NY",
      recipientZip: "11201",
      caseNumber: `TEST-${tag.slice(0, 6)}`,
      matterName: "Doe v. Roe",
      status: "in_progress",
      serverId: server.id,
      // Pricing snapshot is required by enqueuePayoutForServedJob's guard:
      // it throws on grossCents <= 0 / serverPayoutCents <= 0.
      grossCents: 10000,
      platformFeeCents: 2000,
      serverPayoutCents: 8000,
    })
    .returning({ id: jobsTable.id });

  return {
    userId,
    serverId: server.id,
    jobId: job.id,
    signatureImageUrl,
    cleanup: async () => {
      // Clean child rows first to satisfy FK constraints.
      await db.delete(serviceAttemptsTable).where(eq(serviceAttemptsTable.jobId, job.id));
      await db.delete(payoutsTable).where(eq(payoutsTable.jobId, job.id));
      await db.delete(jobsTable).where(eq(jobsTable.id, job.id));
      await db.delete(serverCredentialsTable).where(eq(serverCredentialsTable.userId, userId));
      await db.delete(serversTable).where(eq(serversTable.id, server.id));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    },
  };
}

test(
  "confirm-service pipeline: marks job served, populates proof_pdf_url, fetches a real PDF",
  { skip: skip ? skipReason : false },
  async () => {
    const fx = await seed();
    try {
      // ---- Drive the same code path as POST /api/jobs/:id/attempts ----
      // Use an explicit attemptedAt 2 hours in the past so we can verify
      // it propagates end-to-end (job.servedAt + service_attempts.attemptedAt)
      // instead of the markJobServed helper hard-stamping `now`.
      const explicitAttemptedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const result = await markJobServed({
        jobId: fx.jobId,
        serverUserId: fx.userId,
        myServerId: fx.serverId,
        outcome: "personal",
        attemptedAt: explicitAttemptedAt,
        gpsLat: 40.7128,
        gpsLng: -74.006,
        notes: "Served at front door",
        signatureTypedName: "Pat M. Server",
        signatureImageUrl: fx.signatureImageUrl,
        log: logger,
      });
      assert.equal(result.ok, true, `markJobServed failed: ${(result as { error?: string }).error ?? ""}`);

      // The route generates the affidavit PDF post-commit. Mirror that here.
      const aff = await generateAndStoreAffidavit(fx.jobId, logger);
      assert.equal(aff.ok, true, `generateAndStoreAffidavit failed: ${aff.error ?? ""}`);
      assert.ok(aff.proofPdfUrl, "affidavit returned no proofPdfUrl");

      // ---- DB state assertions ----
      const [row] = await db
        .select()
        .from(jobsTable)
        .where(eq(jobsTable.id, fx.jobId))
        .limit(1);
      assert.equal(row.status, "served", "job status should be served");
      assert.notEqual(row.payoutEligibleAt, null, "payout_eligible_at should be set");
      assert.ok(row.proofPdfUrl, "proof_pdf_url should be populated");
      assert.match(
        row.proofPdfUrl ?? "",
        /^\/objects\/uploads\//,
        "proof_pdf_url should be a normalized object path",
      );
      assert.equal(row.signatureTypedName, "Pat M. Server");
      assert.equal(row.signatureImageUrl, fx.signatureImageUrl);

      const attempts = await db
        .select()
        .from(serviceAttemptsTable)
        .where(eq(serviceAttemptsTable.jobId, fx.jobId));
      assert.equal(attempts.length, 1, "exactly one service_attempts row should be inserted");
      assert.equal(attempts[0].outcome, "personal");

      // The explicit attemptedAt we passed in should propagate to BOTH
      // the attempt row and jobs.servedAt — confirming the affidavit
      // reflects the actual moment of service, not the confirmation time.
      assert.equal(
        attempts[0].attemptedAt.getTime(),
        explicitAttemptedAt.getTime(),
        "service_attempts.attemptedAt should mirror the explicit input",
      );
      assert.equal(
        row.servedAt!.getTime(),
        explicitAttemptedAt.getTime(),
        "jobs.servedAt should mirror the explicit attemptedAt input",
      );

      // ---- PDF integrity: bytes look like a real PDF ----
      const pdfBytes = await downloadObjectBytes(row.proofPdfUrl!);
      assert.ok(pdfBytes && pdfBytes.length > 0, "PDF bytes should be downloadable");
      const head = pdfBytes!.subarray(0, 5).toString("latin1");
      assert.equal(head, "%PDF-", `expected %PDF- prefix, got ${JSON.stringify(head)}`);

      // ---- PDF body: at least one page and non-trivially sized ----
      // Catches regressions where the renderer silently emits an empty/blank
      // single-page PDF (header + EOF only) — the prefix check above would
      // still pass for those.
      assert.ok(
        pdfBytes!.length > 2048,
        `PDF should be > 2 KB, got ${pdfBytes!.length} bytes`,
      );

      // ---- PDF content: parse and assert the rendered text actually carries
      // this job's case details. Without this, a renderer regression that
      // swapped in stale data, dropped the recipient block, or skipped the
      // signature stamp would still pass the bytes-look-like-a-pdf check.
      const parsed = await pdfParse(pdfBytes!);
      assert.ok(parsed.numpages >= 1, `PDF should have >= 1 page, got ${parsed.numpages}`);
      const pdfText = parsed.text;

      // Look up the seeded job row so the expected strings come from the same
      // source of truth the renderer used (avoids drift if seed values change).
      const expectedPlatformRef = row.platformRef;
      const expectedCaseNumber = row.caseNumber!;
      const expectedRecipient = row.recipientName;
      const expectedAddress = row.recipientAddress!;
      const expectedCity = row.recipientCity!;
      const expectedState = row.recipientState!;
      const expectedZip = row.recipientZip!;
      const expectedLat = (40.7128).toFixed(6); // matches the GPS we passed in
      const expectedLng = (-74.006).toFixed(6);
      const expectedSigner = "Pat M. Server";

      const expectations: Array<[string, string]> = [
        ["recipient name", expectedRecipient],
        ["recipient address line 1", expectedAddress],
        ["recipient city", expectedCity],
        ["recipient state", expectedState],
        ["recipient ZIP", expectedZip],
        ["platform reference", expectedPlatformRef],
        ["case number", expectedCaseNumber],
        ["printed signer name", expectedSigner],
        // Validate the PDFKit `Latitude:  ` / `Longitude: ` blocks render the
        // GPS to 6 decimals. Asserting on the formatted string (not just the
        // raw number) catches a regression where toFixed(6) is dropped or the
        // wrong attempt's coords leak in.
        ["latitude (6 decimals)", expectedLat],
        ["longitude (6 decimals)", expectedLng],
        // Nevada-format affidavit landmarks — guards against any regression
        // that swaps the layout back to the legacy generic template.
        ["NV venue header", "STATE OF NEVADA"],
        ["affidavit title", "AFFIDAVIT OF SERVICE"],
        ["NV declaration heading", "DECLARATION (NRS 53.045)"],
        [
          "locked NRS 53.045 declaration text",
          "I declare under penalty of perjury under the law of the State of Nevada that the foregoing is true and correct.",
        ],
      ];

      for (const [label, needle] of expectations) {
        assert.ok(
          pdfText.includes(needle),
          `PDF text missing ${label} (${JSON.stringify(needle)}). Extracted text was: ${JSON.stringify(pdfText.slice(0, 1500))}`,
        );
      }

      // Belt-and-suspenders: the signature appears twice in the rendered PDF
      // (the "/s/ ..." line and the "Printed name: ..." line). If either is
      // dropped we want to know — both lines are part of the legal artifact.
      assert.ok(
        pdfText.includes(`/s/ ${expectedSigner}`),
        `PDF text missing signature line "/s/ ${expectedSigner}"`,
      );
      assert.ok(
        pdfText.includes(`Printed name: ${expectedSigner}`),
        `PDF text missing "Printed name: ${expectedSigner}"`,
      );

      // ---- Storage layer surfaces application/pdf to /api/storage/objects/* ----
      // Mirrors what `GET /api/storage/objects/<...>` would stream back to the
      // browser when a requester clicks "Download affidavit". We don't run
      // through the HTTP route here (that requires Clerk auth wiring) but we
      // exercise the same ObjectStorageService.downloadObject() call that
      // route uses, so the content-type contract is tested.
      const storage = new ObjectStorageService();
      const file = await storage.getObjectEntityFile(row.proofPdfUrl!);
      const response = await storage.downloadObject(file);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/pdf");
    } finally {
      await fx.cleanup();
    }
  },
);
