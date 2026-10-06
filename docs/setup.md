# Setup and review commands

## Requirements

Use a current supported Node release compatible with Vite 7; this review uses Node 24 and pnpm 11. The exported workspace removes non-Linux-x64 optional native packages through overrides, so Linux x64 is the supported review environment for this snapshot. Windows users can use WSL rather than assuming the unchanged native dependency configuration will work.

Install dependencies from the root using the committed lockfile:

```sh
pnpm install --frozen-lockfile
```

## Checks without live integration credentials

```sh
pnpm --filter @workspace/api-server run test:unit
pnpm run typecheck
pnpm --filter @workspace/served-app run build
```

For API bundle compilation without the exported build's database push:

```sh
cd artifacts/api-server
node build.mjs
```

Do not substitute `pnpm run build` for that command unless you intend to run the schema push against your configured disposable database.

The original `test` command includes database/storage-dependent tests. It is not expected to pass on a fresh checkout without those resources. The `test:unit` command runs the 45 checks verified during this review.

## Full development environment

1. Provision a disposable PostgreSQL database and configure `DATABASE_URL` in the process environment.
2. Configure a dedicated Clerk test instance and the matching frontend/backend keys.
3. Apply the schema to that disposable database deliberately using the database package's documented scripts.
4. Configure Replit Stripe connector and storage access if those workflows will be exercised.
5. Configure notification and background-check test providers only for the workflows under test.
6. Start the frontend with a chosen port, for example `PORT=5173 pnpm --filter @workspace/served-app run dev` in a Linux shell.
7. Start the API on a separate port and arrange a reverse proxy for `/api` and any Clerk proxy path. The exported Vite configuration does not supply a standalone API proxy.

The environment example lists variable names without credentials. It is a reference, not an automatic dotenv loader; provide variables through your shell or Replit environment settings.

Authenticated Playwright tests require a running test stack, a Clerk test session, and seeded job IDs. Their configuration lives in `artifacts/served-app/playwright.config.ts`. They are not a one-command public-demo smoke test.
