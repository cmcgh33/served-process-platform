// E2E coverage for Task #61 — full affidavit signing & PDF download flow.
//
// Drives the canvas-drawing UI on /app/jobs/:id/confirm with a real
// browser, submits the form, and asserts that:
//   - the API responds 201
//   - the job row flips to status='served' with proof_pdf_url populated
//     and payout_eligible_at set
//   - GET /api/storage/objects/<proofPdfUrl> returns a real PDF
//     (HTTP 200, content-type application/pdf, body starts with "%PDF-")
//
// Companion to the api-server integration test in
// `artifacts/api-server/src/lib/affidavitPipeline.test.ts` — that one
// covers the post-auth pipeline directly; this one covers the browser
// flow including the canvas signature capture.
//
// Required env (provisioned by the workspace test harness):
//   - CLERK_TEST_SESSION_TOKEN — Clerk session for the seeded server user
//   - E2E_AFFIDAVIT_JOB_ID     — id of an in-progress job assigned to that
//                                server, ready to be confirmed
//
// Optional:
//   - SERVED_E2E_BASE_URL      — defaults to http://localhost:80
//
// Skipped when those env vars are missing so `pnpm run test:e2e` is safe
// on a fresh checkout.

import { test, expect } from "@playwright/test";

const SESSION_TOKEN = process.env.CLERK_TEST_SESSION_TOKEN;
const JOB_ID = process.env.E2E_AFFIDAVIT_JOB_ID;
const BASE_URL = process.env.SERVED_E2E_BASE_URL ?? "http://localhost:80";

const skipReason =
  "Skipped: requires CLERK_TEST_SESSION_TOKEN + E2E_AFFIDAVIT_JOB_ID (provisioned by the workspace test harness).";

test.describe("Task #61 — confirm-service affidavit flow", () => {
  test.skip(!SESSION_TOKEN || !JOB_ID, skipReason);

  test("draws signature on canvas, confirms service, and downloads a real PDF", async ({
    page,
    request,
  }) => {
    // Auth the browser context first so wouter / react-query can hydrate.
    await page.context().addCookies([
      {
        name: "__session",
        value: SESSION_TOKEN!,
        url: BASE_URL,
      },
    ]);

    await page.goto(`/app/jobs/${JOB_ID}/confirm`);

    // The form's GPS fields are number inputs; geolocation is permission-
    // gated in headless browsers so we type values directly. The route
    // accepts any -90..90 / -180..180 pair.
    const latInput = page.getByLabel(/latitude/i);
    const lngInput = page.getByLabel(/longitude/i);
    await latInput.fill("40.7128");
    await lngInput.fill("-74.006");

    // Typed printed name powers the "/s/ <name>" line in the affidavit.
    await page.getByTestId("input-signature-typed-name").fill("Pat M. Server");

    // Draw on the signature canvas. We need to dispatch real mouse events
    // because the page handler uses onMouseDown/Move/Up. A few short
    // segments are enough for the `hasSig` flag to flip on AND for the
    // canvas.toBlob() to produce non-empty PNG bytes.
    const canvas = page.getByTestId("canvas-signature");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("signature canvas not laid out");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx - 80, cy);
    await page.mouse.down();
    for (let i = -80; i <= 80; i += 8) {
      await page.mouse.move(cx + i, cy + Math.sin(i / 20) * 12);
    }
    await page.mouse.up();

    // Wait for the POST /api/jobs/:id/attempts to complete (201).
    const [attemptRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/jobs/${JOB_ID}/attempts`) &&
          r.request().method() === "POST",
      ),
      page.getByTestId("button-confirm-service").click(),
    ]);
    expect(attemptRes.status()).toBe(201);

    // Affidavit generation runs post-commit on the server. Poll until the
    // job row reflects the final state. Timeout matches Playwright's
    // expect timeout in playwright.config.ts (10s).
    let job: {
      status: string;
      proofPdfUrl: string | null;
      payoutEligibleAt: string | null;
    } | null = null;

    const apiCtx = await request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Cookie: `__session=${SESSION_TOKEN}` },
    });

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const r = await apiCtx.get(`/api/jobs/${JOB_ID}`);
      if (r.ok()) {
        const candidate = (await r.json()) as typeof job;
        if (
          candidate &&
          candidate.status === "served" &&
          candidate.proofPdfUrl &&
          candidate.payoutEligibleAt
        ) {
          job = candidate;
          break;
        }
      }
      await new Promise((res) => setTimeout(res, 250));
    }

    expect(job, "job should reach served + affidavit-generated state").not.toBeNull();
    expect(job!.status).toBe("served");
    expect(job!.proofPdfUrl).toMatch(/^\/objects\/uploads\//);
    expect(job!.payoutEligibleAt).not.toBeNull();

    // The path stored on jobs.proof_pdf_url is `/objects/uploads/<uuid>`;
    // the storage route is mounted at /api/storage/objects/* so we strip
    // the `/objects/` prefix.
    const pdfPath = job!.proofPdfUrl!.replace(/^\/objects\//, "");
    const pdfRes = await apiCtx.get(`/api/storage/objects/${pdfPath}`);
    expect(pdfRes.status()).toBe(200);
    expect(pdfRes.headers()["content-type"]).toBe("application/pdf");
    const body = await pdfRes.body();
    expect(body.length).toBeGreaterThan(0);
    expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
