// E2E coverage for Task #22 — service attempt outcomes + substitute
// service compliance. Validates the three new outcomes (personal,
// substitute, unable), API rejection of incomplete substitute payloads,
// and AttemptHistory rendering.
//
// These tests require:
//   - The served-app + api-server workflows running locally
//   - A Postgres DB the test can seed via `process.env.DATABASE_URL`
//   - A Clerk test session (CLERK_TEST_SESSION_TOKEN) for the seeded
//     server user — provisioned by the workspace test harness
//
// CI runs these via the workspace test harness which provisions the
// Clerk test session and seeds the DB. They are skipped by default
// when those env vars are missing so `pnpm run test:e2e` is safe to run
// without that setup.
//
// The same scenarios are also exercised by the agent's `runTest`
// harness, which drives a real browser end-to-end with screenshots —
// see `.local/state/workflow-logs/*` and the task notes for run logs.

import { test, expect, type APIRequestContext } from "@playwright/test";

const SESSION_TOKEN = process.env.CLERK_TEST_SESSION_TOKEN;
const SUB_JOB_ID = process.env.E2E_SUB_JOB_ID;
const UNA_JOB_ID = process.env.E2E_UNA_JOB_ID;
const PER_JOB_ID = process.env.E2E_PER_JOB_ID;

const skipReason =
  "Skipped: requires CLERK_TEST_SESSION_TOKEN and seeded E2E_*_JOB_ID env vars (provisioned by the workspace test harness).";

test.describe("Task #22 — service attempt outcomes", () => {
  test.skip(!SESSION_TOKEN || !SUB_JOB_ID || !UNA_JOB_ID || !PER_JOB_ID, skipReason);

  async function withAuth(request: APIRequestContext) {
    return request.newContext({
      extraHTTPHeaders: { Cookie: `__session=${SESSION_TOKEN}` },
    });
  }

  test("rejects substitute attempt missing the required trio (no name)", async ({ request }) => {
    const ctx = await withAuth(request);
    const res = await ctx.post(`/api/jobs/${UNA_JOB_ID}/attempts`, {
      data: {
        outcome: "substitute",
        gpsLat: 37.7749,
        gpsLng: -122.4194,
        substituteOver18: true,
        substituteVerifiedResidence: true,
        // substituteRecipientName intentionally omitted
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Substitute service requires/i);
  });

  test("rejects substitute attempt with over18=false", async ({ request }) => {
    const ctx = await withAuth(request);
    const res = await ctx.post(`/api/jobs/${UNA_JOB_ID}/attempts`, {
      data: {
        outcome: "substitute",
        gpsLat: 37.7749,
        gpsLng: -122.4194,
        substituteRecipientName: "Jane Doe",
        substituteOver18: false,
        substituteVerifiedResidence: true,
      },
    });
    expect(res.status()).toBe(400);
  });

  test("rejects unable attempt without a reason", async ({ request }) => {
    const ctx = await withAuth(request);
    const res = await ctx.post(`/api/jobs/${UNA_JOB_ID}/attempts`, {
      data: { outcome: "unable", gpsLat: 37.7749, gpsLng: -122.4194 },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Unable to serve requires a reason/i);
  });

  test("rejects unable attempt with an unknown reason", async ({ request }) => {
    const ctx = await withAuth(request);
    const res = await ctx.post(`/api/jobs/${UNA_JOB_ID}/attempts`, {
      data: {
        outcome: "unable",
        gpsLat: 37.7749,
        gpsLng: -122.4194,
        unableReason: "ate_the_papers",
      },
    });
    expect(res.status()).toBe(400);
  });

  test("accepts a valid substitute attempt and renders it in AttemptHistory", async ({ request, page }) => {
    const ctx = await withAuth(request);
    const res = await ctx.post(`/api/jobs/${SUB_JOB_ID}/attempts`, {
      data: {
        outcome: "substitute",
        gpsLat: 37.7749,
        gpsLng: -122.4194,
        substituteRecipientName: "Jane Doe (sister)",
        substituteOver18: true,
        substituteVerifiedResidence: true,
      },
    });
    expect(res.status()).toBe(201);

    await page.context().addCookies([
      {
        name: "__session",
        value: SESSION_TOKEN!,
        url: process.env.SERVED_E2E_BASE_URL ?? "http://localhost:80",
      },
    ]);
    await page.goto(`/app/server/proof/${SUB_JOB_ID}`);
    const history = page.getByTestId("attempt-history");
    await expect(history).toContainText("Substitute service");
    await expect(history).toContainText("Jane Doe (sister)");
    await expect(history).toContainText(/over 18/i);
    await expect(history).toContainText(/residence verified/i);
  });

  test("accepts a valid unable attempt with a documented reason", async ({ request, page }) => {
    const ctx = await withAuth(request);
    const res = await ctx.post(`/api/jobs/${UNA_JOB_ID}/attempts`, {
      data: {
        outcome: "unable",
        gpsLat: 37.7749,
        gpsLng: -122.4194,
        unableReason: "refused",
      },
    });
    expect(res.status()).toBe(201);

    await page.context().addCookies([
      {
        name: "__session",
        value: SESSION_TOKEN!,
        url: process.env.SERVED_E2E_BASE_URL ?? "http://localhost:80",
      },
    ]);
    await page.goto(`/app/server/proof/${UNA_JOB_ID}`);
    const history = page.getByTestId("attempt-history");
    await expect(history).toContainText("Unable to serve");
    await expect(history).toContainText(/refused/i);
  });

  test("accepts a valid personal-service attempt and marks the job served", async ({ request }) => {
    const ctx = await withAuth(request);
    const res = await ctx.post(`/api/jobs/${PER_JOB_ID}/attempts`, {
      data: { outcome: "personal", gpsLat: 37.7749, gpsLng: -122.4194 },
    });
    expect(res.status()).toBe(201);

    const jobRes = await ctx.get(`/api/jobs/${PER_JOB_ID}`);
    expect(jobRes.ok()).toBeTruthy();
    const job = await jobRes.json();
    expect(job.status).toBe("served");
  });
});
