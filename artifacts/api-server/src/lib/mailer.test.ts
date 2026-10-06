// Unit tests for the mailer wrapper used by payout-failure notifications
// (and any future transactional email).
//
// Run with: pnpm --filter @workspace/api-server run test
//
// We avoid making any real network calls — when neither SENDGRID_API_KEY
// nor a Replit SendGrid connection is available (the default in dev/CI),
// the mailer logs and returns false, which is the behavior we exercise
// here. The HTTP path is covered by stubbing global `fetch` for the
// positive cases.

import test from "node:test";
import assert from "node:assert/strict";
import {
  sendEmail,
  sendPayoutFailedEmail,
  buildAppUrl,
  _resetSendgridConnectorCacheForTests,
} from "./mailer";

/**
 * Helper to scrub any ambient SendGrid configuration before a test and
 * restore it afterwards. Several tests need to assert "no credential"
 * behaviour, which is impossible if a real `SENDGRID_API_KEY` or the
 * Replit connectors proxy are configured in the runner environment.
 */
function withScrubbedSendgridEnv(): {
  restore: () => void;
} {
  const prev = {
    apiKey: process.env.SENDGRID_API_KEY,
    hostname: process.env.REPLIT_CONNECTORS_HOSTNAME,
    identity: process.env.REPL_IDENTITY,
    renewal: process.env.WEB_REPL_RENEWAL,
  };
  delete process.env.SENDGRID_API_KEY;
  delete process.env.REPLIT_CONNECTORS_HOSTNAME;
  delete process.env.REPL_IDENTITY;
  delete process.env.WEB_REPL_RENEWAL;
  _resetSendgridConnectorCacheForTests();
  return {
    restore: () => {
      if (prev.apiKey !== undefined) process.env.SENDGRID_API_KEY = prev.apiKey;
      if (prev.hostname !== undefined)
        process.env.REPLIT_CONNECTORS_HOSTNAME = prev.hostname;
      if (prev.identity !== undefined) process.env.REPL_IDENTITY = prev.identity;
      if (prev.renewal !== undefined)
        process.env.WEB_REPL_RENEWAL = prev.renewal;
      _resetSendgridConnectorCacheForTests();
    },
  };
}

test("sendEmail returns false and never throws when no credential is available", async () => {
  const env = withScrubbedSendgridEnv();
  try {
    const ok = await sendEmail({
      to: "server@example.com",
      subject: "test",
      text: "hello",
    });
    assert.equal(ok, false);
  } finally {
    env.restore();
  }
});

test("sendEmail swallows network errors and returns false", async () => {
  const previousKey = process.env.SENDGRID_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.SENDGRID_API_KEY = "SG.test";
  globalThis.fetch = async () => {
    throw new Error("connection refused");
  };
  try {
    const ok = await sendEmail({
      to: "server@example.com",
      subject: "test",
      text: "hello",
    });
    assert.equal(ok, false);
  } finally {
    if (previousKey !== undefined) process.env.SENDGRID_API_KEY = previousKey;
    else delete process.env.SENDGRID_API_KEY;
    globalThis.fetch = previousFetch;
  }
});

test("sendEmail posts a well-formed SendGrid payload on success", async () => {
  const previousKey = process.env.SENDGRID_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.SENDGRID_API_KEY = "SG.test";

  let captured: { url?: string; init?: RequestInit } = {};
  globalThis.fetch = async (url: string, init: RequestInit) => {
    captured = { url, init };
    return new Response("", { status: 202 });
  };
  try {
    const ok = await sendEmail({
      to: "server@example.com",
      subject: "Payout failed — $20.00 for SERVED-00001-2026",
      text: "Hi",
      html: "<p>Hi</p>",
      from: "SERVED. <no-reply@servedapp.co>",
    });
    assert.equal(ok, true);
    assert.equal(captured.url, "https://api.sendgrid.com/v3/mail/send");
    const body = JSON.parse(String(captured.init?.body));
    assert.equal(body.personalizations[0].to[0].email, "server@example.com");
    assert.equal(body.from.email, "no-reply@servedapp.co");
    assert.equal(body.from.name, "SERVED.");
    assert.equal(body.content[0].type, "text/plain");
    assert.equal(body.content[1].type, "text/html");
  } finally {
    if (previousKey !== undefined) process.env.SENDGRID_API_KEY = previousKey;
    else delete process.env.SENDGRID_API_KEY;
    globalThis.fetch = previousFetch;
  }
});

test("buildAppUrl joins relative paths against REPLIT_DOMAINS", () => {
  const previous = process.env.REPLIT_DOMAINS;
  process.env.REPLIT_DOMAINS = "served.example.com,other";
  try {
    assert.equal(
      buildAppUrl("/app/server/wallet"),
      "https://served.example.com/app/server/wallet",
    );
    // No leading slash → still produces a single slash separator.
    assert.equal(
      buildAppUrl("app/server/wallet"),
      "https://served.example.com/app/server/wallet",
    );
  } finally {
    if (previous !== undefined) process.env.REPLIT_DOMAINS = previous;
    else delete process.env.REPLIT_DOMAINS;
  }
});

test("sendPayoutFailedEmail formats subject and body with reason + CTAs", async () => {
  const previousKey = process.env.SENDGRID_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.SENDGRID_API_KEY = "SG.test";

  let body: any = null;
  globalThis.fetch = async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return new Response("", { status: 202 });
  };
  try {
    const ok = await sendPayoutFailedEmail({
      to: "server@example.com",
      serverName: "Jane Doe",
      amountCents: 2000,
      jobReference: "SERVED-00042-2026",
      failureReason: "balance_insufficient: Try again later.",
    });
    assert.equal(ok, true);
    assert.equal(
      body.subject,
      "Payout failed — $20.00 for SERVED-00042-2026",
    );
    const text = body.content[0].value as string;
    const html = body.content[1].value as string;
    assert.match(text, /Hi Jane Doe/);
    assert.match(text, /\$20\.00/);
    assert.match(text, /SERVED-00042-2026/);
    assert.match(text, /balance_insufficient: Try again later\./);
    assert.match(text, /\/app\/server\/wallet/);
    assert.match(text, /dashboard\.stripe\.com\/express/);
    assert.match(text, /support@served\.legal/);
    assert.match(html, /Stripe Express dashboard/);
    assert.match(html, /\/app\/server\/wallet/);
  } finally {
    if (previousKey !== undefined) process.env.SENDGRID_API_KEY = previousKey;
    else delete process.env.SENDGRID_API_KEY;
    globalThis.fetch = previousFetch;
  }
});

test("sendPayoutFailedEmail falls back to a generic reason when none provided", async () => {
  const previousKey = process.env.SENDGRID_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.SENDGRID_API_KEY = "SG.test";

  let body: any = null;
  globalThis.fetch = async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return new Response("", { status: 202 });
  };
  try {
    await sendPayoutFailedEmail({
      to: "server@example.com",
      serverName: null,
      amountCents: 1234,
      jobReference: "SERVED-00099-2026",
      failureReason: null,
    });
    const text = body.content[0].value as string;
    assert.match(text, /Hi there/);
    assert.match(text, /\$12\.34/);
    assert.match(text, /No reason was returned by Stripe/);
  } finally {
    if (previousKey !== undefined) process.env.SENDGRID_API_KEY = previousKey;
    else delete process.env.SENDGRID_API_KEY;
    globalThis.fetch = previousFetch;
  }
});

test("sendEmail fetches the API key from the Replit SendGrid connector when env var is unset", async () => {
  const env = withScrubbedSendgridEnv();
  const previousFetch = globalThis.fetch;
  process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors.replit.test";
  process.env.REPL_IDENTITY = "test-identity-token";

  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  globalThis.fetch = async (url: string, init: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    if (url.startsWith("https://connectors.replit.test/")) {
      // Mimic the connectors proxy response shape.
      return new Response(
        JSON.stringify({
          items: [{ settings: { api_key: "SG.from-connector" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url === "https://api.sendgrid.com/v3/mail/send") {
      // Make sure the SendGrid request used the key the connector returned.
      assert.equal(headers.Authorization, "Bearer SG.from-connector");
      return new Response("", { status: 202 });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const ok = await sendEmail({
      to: "server@example.com",
      subject: "test",
      text: "hello",
    });
    assert.equal(ok, true);

    // Connector lookup should have happened first, with the right header.
    const connectorCall = calls.find((c) =>
      c.url.startsWith("https://connectors.replit.test/"),
    );
    assert.ok(connectorCall, "expected a connector lookup");
    assert.equal(
      connectorCall!.headers["X-Replit-Token"],
      "repl test-identity-token",
    );
    assert.match(connectorCall!.url, /connector_names=sendgrid/);

    // Per the Replit SendGrid blueprint, the proxy-issued credential can
    // rotate / expire, so we explicitly do NOT cache it across sends — a
    // second send must round-trip the connectors proxy for a fresh key.
    const beforeSecond = calls.length;
    await sendEmail({
      to: "server2@example.com",
      subject: "test2",
      text: "hello again",
    });
    const newConnectorCalls = calls
      .slice(beforeSecond)
      .filter((c) => c.url.startsWith("https://connectors.replit.test/"));
    assert.equal(
      newConnectorCalls.length,
      1,
      "connector key must be re-fetched on every send (no caching)",
    );
  } finally {
    globalThis.fetch = previousFetch;
    env.restore();
  }
});

test("sendEmail prefers SENDGRID_API_KEY over the Replit connector when both are set", async () => {
  const env = withScrubbedSendgridEnv();
  const previousFetch = globalThis.fetch;
  process.env.SENDGRID_API_KEY = "SG.env-wins";
  process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors.replit.test";
  process.env.REPL_IDENTITY = "test-identity-token";

  let connectorCalled = false;
  let sendAuthHeader: string | undefined;
  globalThis.fetch = async (url: string, init: RequestInit) => {
    if (url.startsWith("https://connectors.replit.test/")) {
      connectorCalled = true;
      return new Response(
        JSON.stringify({
          items: [{ settings: { api_key: "SG.from-connector" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    sendAuthHeader = (init?.headers as Record<string, string>)?.Authorization;
    return new Response("", { status: 202 });
  };

  try {
    const ok = await sendEmail({
      to: "server@example.com",
      subject: "test",
      text: "hello",
    });
    assert.equal(ok, true);
    assert.equal(connectorCalled, false, "env var should short-circuit the connector lookup");
    assert.equal(sendAuthHeader, "Bearer SG.env-wins");
  } finally {
    globalThis.fetch = previousFetch;
    env.restore();
  }
});

test("sendEmail returns false when the connector proxy is misconfigured", async () => {
  const env = withScrubbedSendgridEnv();
  const previousFetch = globalThis.fetch;
  process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors.replit.test";
  process.env.REPL_IDENTITY = "test-identity-token";

  globalThis.fetch = async (url: string) => {
    if (url.startsWith("https://connectors.replit.test/")) {
      // Connection exists but settings are empty (no api_key set yet).
      return new Response(JSON.stringify({ items: [{ settings: {} }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("SendGrid HTTP API should not be called without a key");
  };

  try {
    const ok = await sendEmail({
      to: "server@example.com",
      subject: "test",
      text: "hello",
    });
    assert.equal(ok, false);
  } finally {
    globalThis.fetch = previousFetch;
    env.restore();
  }
});
