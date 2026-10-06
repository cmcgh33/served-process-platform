import { defineConfig } from "@playwright/test";

// Playwright config for the SERVED. served-app e2e suite.
//
// The full UI flow tests live in `tests/e2e/` and require a Clerk test
// session, a running API server, and a seeded Postgres database. They are
// designed to run against a local dev stack started by the workspace
// workflows; CI runs them via the test harness.
//
// To run locally:
//   pnpm --filter @workspace/served-app exec playwright install --with-deps
//   pnpm --filter @workspace/served-app run test:e2e
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.SERVED_E2E_BASE_URL ?? "http://localhost:80",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
