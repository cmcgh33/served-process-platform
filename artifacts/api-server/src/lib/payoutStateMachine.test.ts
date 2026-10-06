// Integration tests for the payout state machine that protects servers
// from ever seeing "paid" before Stripe has confirmed the bank deposit.
//
// Three independent code paths can mutate a payout row's status:
//   1. processPayoutTransfer            — funds leave the platform
//   2. refreshPendingPayoutArrivalDate  — lazy /me/wallet refresh
//   3. handlePayoutEvent                — Stripe Connect webhook
//
// Each test inserts the minimum DB fixtures (server + job + payout),
// invokes the function under test with a hand-rolled fake Stripe client,
// and re-reads the payout row to assert the resulting state.
//
// Run with: pnpm --filter @workspace/api-server run test

import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import {
  db,
  payoutsTable,
  serversTable,
  jobsTable,
  type PayoutStatus,
} from "@workspace/db";
import {
  processPayoutTransfer,
  refreshPendingPayoutArrivalDate,
  type StripeClient,
} from "./marketplace";
import { handlePayoutEvent } from "../webhookHandlers";

// ---------- DB fixtures ----------

interface Fixture {
  serverId: number;
  jobId: number;
  serverUserId: string;
  payoutId: number;
  cleanup: () => Promise<void>;
}

async function createFixture(opts: {
  payoutStatus: PayoutStatus;
  amountCents?: number;
  stripeTransferId?: string | null;
  stripeAccountId?: string | null;
  stripePayoutId?: string | null;
  paidAt?: Date | null;
  arrivalDate?: Date | null;
}): Promise<Fixture> {
  const tag = randomUUID();
  const serverUserId = `test_${tag}`;
  const amountCents = opts.amountCents ?? 1500;

  const [server] = await db
    .insert(serversTable)
    .values({
      userId: serverUserId,
      name: "Test Server",
      email: `srv_${tag}@example.test`,
      status: "active",
      stripeAccountId: opts.stripeAccountId ?? null,
      payoutsEnabled: true,
    })
    .returning({ id: serversTable.id });

  const [job] = await db
    .insert(jobsTable)
    .values({
      platformRef: `test_${tag}`,
      documentType: "subpoena",
      recipientName: "Recipient",
      recipientAddress: "1 Main St",
      recipientCity: "Town",
      recipientState: "CA",
      recipientZip: "00000",
      serverId: server.id,
      grossCents: amountCents * 5,
      platformFeeCents: amountCents * 4,
      serverPayoutCents: amountCents,
    })
    .returning({ id: jobsTable.id });

  const [payout] = await db
    .insert(payoutsTable)
    .values({
      serverId: server.id,
      userId: serverUserId,
      jobId: job.id,
      amountCents,
      status: opts.payoutStatus,
      stripeTransferId: opts.stripeTransferId ?? null,
      stripeAccountId: opts.stripeAccountId ?? null,
      stripePayoutId: opts.stripePayoutId ?? null,
      paidAt: opts.paidAt ?? null,
      arrivalDate: opts.arrivalDate ?? null,
    })
    .returning({ id: payoutsTable.id });

  return {
    serverId: server.id,
    jobId: job.id,
    serverUserId,
    payoutId: payout.id,
    cleanup: async () => {
      await db.delete(payoutsTable).where(eq(payoutsTable.id, payout.id));
      await db.delete(jobsTable).where(eq(jobsTable.id, job.id));
      await db.delete(serversTable).where(eq(serversTable.id, server.id));
    },
  };
}

async function readPayout(id: number) {
  const [row] = await db
    .select()
    .from(payoutsTable)
    .where(eq(payoutsTable.id, id))
    .limit(1);
  return row;
}

// ---------- Stripe fakes ----------

/**
 * Build an awaitable + async-iterable list (Stripe's ApiListPromise shape)
 * from an in-memory items array. Code that does `await list` to read
 * `.data`, AND code that does `for await (const x of list)`, both work.
 */
function makeApiList<T>(items: T[]): unknown {
  const result = {
    data: items,
    has_more: false,
    object: "list" as const,
    then<TResult1, TResult2 = never>(
      onFulfilled?:
        | ((value: { data: T[] }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onRejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ) {
      return Promise.resolve({ data: items }).then(onFulfilled, onRejected);
    },
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next(): Promise<IteratorResult<T>> {
          if (i < items.length) return { value: items[i++], done: false };
          return { value: undefined as unknown as T, done: true };
        },
      };
    },
  };
  return result;
}

interface FakeStripeOpts {
  /** Result of `transfers.create` (or an Error to throw). */
  transferCreateResult?: { id: string } | Error;
  /** Items returned for `balanceTransactions.list({source})` lookups. */
  bsBySource?: Array<{ available_on?: number; payout?: string | null }>;
  /** Items returned for `balanceTransactions.list({payout})` lookups. */
  bsByPayout?: Array<{ source: string | { id: string } | null }>;
  /** Result of `accounts.retrieve(...)`. */
  account?: { settings?: { payouts?: { schedule?: { delay_days?: number } } } };
  /** Result of `payouts.retrieve(...)`. */
  payoutRetrieve?: { arrival_date?: number; status?: string };
}

function fakeStripe(opts: FakeStripeOpts = {}): StripeClient {
  const fake = {
    transfers: {
      async create(_args: unknown, _options?: unknown) {
        const r = opts.transferCreateResult;
        if (r instanceof Error) throw r;
        return r ?? { id: "tr_default" };
      },
    },
    balanceTransactions: {
      list(
        params: { source?: string; payout?: string },
        _options?: unknown,
      ) {
        if (params.payout) {
          return makeApiList(opts.bsByPayout ?? []);
        }
        if (params.source) {
          return makeApiList(opts.bsBySource ?? []);
        }
        return makeApiList([]);
      },
    },
    accounts: {
      async retrieve(_id: string) {
        return opts.account ?? { settings: { payouts: { schedule: { delay_days: 2 } } } };
      },
    },
    payouts: {
      async retrieve(_id: string, _options?: unknown) {
        return opts.payoutRetrieve ?? { arrival_date: 0, status: "pending" };
      },
    },
  };
  return fake as unknown as StripeClient;
}

// ---------- processPayoutTransfer ----------

test("processPayoutTransfer: successful transfer parks row in_transit, never paid", async () => {
  const fx = await createFixture({ payoutStatus: "pending" });
  try {
    const futureAvailable = Math.floor(Date.now() / 1000) + 2 * 86400;
    const ok = await processPayoutTransfer({
      jobId: fx.jobId,
      serverUserId: fx.serverUserId,
      amountCents: 1500,
      destinationAccountId: "acct_test",
      stripe: fakeStripe({
        transferCreateResult: { id: "tr_success_1" },
        bsBySource: [{ available_on: futureAvailable }],
      }),
    });
    assert.equal(ok, true);

    const row = await readPayout(fx.payoutId);
    assert.equal(
      row.status,
      "in_transit",
      "successful transfer must park row in_transit, NOT paid",
    );
    assert.equal(row.paidAt, null, "paidAt must remain null until bank deposit clears");
    assert.equal(row.stripeTransferId, "tr_success_1");
    assert.equal(row.stripeAccountId, "acct_test");
    assert.equal(row.failureReason, null);
    assert.notEqual(row.arrivalDate, null);
  } finally {
    await fx.cleanup();
  }
});

test("processPayoutTransfer: Stripe failure marks row failed with reason, leaves paidAt null", async () => {
  const fx = await createFixture({ payoutStatus: "pending" });
  try {
    const err = Object.assign(new Error("Account has no external bank account"), {
      code: "balance_insufficient",
    });
    const ok = await processPayoutTransfer({
      jobId: fx.jobId,
      serverUserId: fx.serverUserId,
      amountCents: 1500,
      destinationAccountId: "acct_test",
      stripe: fakeStripe({ transferCreateResult: err }),
    });
    assert.equal(ok, false);

    const row = await readPayout(fx.payoutId);
    assert.equal(row.status, "failed");
    assert.equal(row.paidAt, null);
    assert.match(row.failureReason ?? "", /balance_insufficient/);
  } finally {
    await fx.cleanup();
  }
});

test("processPayoutTransfer: no-op when transfer already recorded", async () => {
  const fx = await createFixture({
    payoutStatus: "in_transit",
    stripeTransferId: "tr_already",
    stripeAccountId: "acct_test",
  });
  try {
    const ok = await processPayoutTransfer({
      jobId: fx.jobId,
      serverUserId: fx.serverUserId,
      amountCents: 1500,
      destinationAccountId: "acct_test",
      stripe: fakeStripe({
        transferCreateResult: new Error("must not be called"),
      }),
    });
    assert.equal(ok, false);
    const row = await readPayout(fx.payoutId);
    assert.equal(row.status, "in_transit");
    assert.equal(row.stripeTransferId, "tr_already");
    assert.equal(row.paidAt, null);
  } finally {
    await fx.cleanup();
  }
});

// ---------- refreshPendingPayoutArrivalDate ----------

test("refreshPendingPayoutArrivalDate: promotes in_transit -> paid only when Stripe says paid", async () => {
  const fx = await createFixture({
    payoutStatus: "in_transit",
    stripeTransferId: "tr_refresh_1",
    stripeAccountId: "acct_test",
    stripePayoutId: "po_test_1",
  });
  try {
    const arrival = Math.floor(Date.now() / 1000);
    const result = await refreshPendingPayoutArrivalDate(
      fakeStripe({ payoutRetrieve: { arrival_date: arrival, status: "paid" } }),
      {
        id: fx.payoutId,
        status: "in_transit",
        stripeTransferId: "tr_refresh_1",
        stripeAccountId: "acct_test",
        stripePayoutId: "po_test_1",
        arrivalDate: null,
      },
    );
    assert.equal(result.status, "paid");
    assert.notEqual(result.paidAt, null);

    const row = await readPayout(fx.payoutId);
    assert.equal(row.status, "paid");
    assert.notEqual(row.paidAt, null);
  } finally {
    await fx.cleanup();
  }
});

test("refreshPendingPayoutArrivalDate: leaves in_transit alone when Stripe payout still pending", async () => {
  const fx = await createFixture({
    payoutStatus: "in_transit",
    stripeTransferId: "tr_refresh_2",
    stripeAccountId: "acct_test",
    stripePayoutId: "po_test_2",
  });
  try {
    const arrival = Math.floor(Date.now() / 1000) + 86400;
    const result = await refreshPendingPayoutArrivalDate(
      fakeStripe({
        payoutRetrieve: { arrival_date: arrival, status: "pending" },
      }),
      {
        id: fx.payoutId,
        status: "in_transit",
        stripeTransferId: "tr_refresh_2",
        stripeAccountId: "acct_test",
        stripePayoutId: "po_test_2",
        arrivalDate: null,
      },
    );
    assert.equal(result.status, null, "must NOT promote to paid while Stripe says pending");
    assert.equal(result.paidAt, null);

    const row = await readPayout(fx.payoutId);
    assert.equal(row.status, "in_transit", "DB row must stay in_transit");
    assert.equal(row.paidAt, null);
    // Arrival date should have been refreshed even though status didn't move.
    assert.notEqual(row.arrivalDate, null);
  } finally {
    await fx.cleanup();
  }
});

test("refreshPendingPayoutArrivalDate: never downgrades an already-paid row", async () => {
  const originalPaidAt = new Date("2026-01-15T12:00:00Z");
  const fx = await createFixture({
    payoutStatus: "paid",
    stripeTransferId: "tr_refresh_3",
    stripeAccountId: "acct_test",
    stripePayoutId: "po_test_3",
    paidAt: originalPaidAt,
    arrivalDate: originalPaidAt,
  });
  try {
    // Even if Stripe inexplicably reports the payout back to "pending",
    // we must not downgrade or rewrite paidAt.
    const result = await refreshPendingPayoutArrivalDate(
      fakeStripe({
        payoutRetrieve: {
          arrival_date: Math.floor(originalPaidAt.getTime() / 1000),
          status: "pending",
        },
      }),
      {
        id: fx.payoutId,
        status: "paid",
        stripeTransferId: "tr_refresh_3",
        stripeAccountId: "acct_test",
        stripePayoutId: "po_test_3",
        arrivalDate: originalPaidAt,
      },
    );
    assert.equal(result.status, null);
    assert.equal(result.paidAt, null);

    const row = await readPayout(fx.payoutId);
    assert.equal(row.status, "paid");
    assert.equal(
      row.paidAt?.getTime(),
      originalPaidAt.getTime(),
      "paidAt timestamp must not be rewritten",
    );
  } finally {
    await fx.cleanup();
  }
});

test("refreshPendingPayoutArrivalDate: never resurrects a failed row", async () => {
  const fx = await createFixture({
    payoutStatus: "failed",
    stripeTransferId: "tr_refresh_4",
    stripeAccountId: "acct_test",
    stripePayoutId: "po_test_4",
  });
  try {
    const arrival = Math.floor(Date.now() / 1000);
    const result = await refreshPendingPayoutArrivalDate(
      fakeStripe({ payoutRetrieve: { arrival_date: arrival, status: "paid" } }),
      {
        id: fx.payoutId,
        status: "failed",
        stripeTransferId: "tr_refresh_4",
        stripeAccountId: "acct_test",
        stripePayoutId: "po_test_4",
        arrivalDate: null,
      },
    );
    assert.equal(result.status, null, "failed rows must never be promoted to paid");

    const row = await readPayout(fx.payoutId);
    assert.equal(row.status, "failed");
    assert.equal(row.paidAt, null);
  } finally {
    await fx.cleanup();
  }
});

// ---------- handlePayoutEvent ----------

function makePayoutPaidEvent(args: {
  connectedAccountId: string;
  payoutId: string;
  arrivalSeconds: number;
  status?: string;
  type?: "payout.paid" | "payout.updated" | "payout.created";
}): Stripe.PayoutPaidEvent {
  const evt = {
    id: `evt_${randomUUID()}`,
    type: args.type ?? "payout.paid",
    account: args.connectedAccountId,
    data: {
      object: {
        id: args.payoutId,
        arrival_date: args.arrivalSeconds,
        status: args.status ?? "paid",
      },
    },
  };
  return evt as unknown as Stripe.PayoutPaidEvent;
}

test("handlePayoutEvent: payout.paid promotes matching in_transit transfers to paid", async () => {
  const transferId = `tr_evt_${randomUUID().slice(0, 8)}`;
  const fx = await createFixture({
    payoutStatus: "in_transit",
    stripeTransferId: transferId,
    stripeAccountId: "acct_evt",
  });
  try {
    const arrivalSeconds = Math.floor(Date.now() / 1000);
    await handlePayoutEvent(
      makePayoutPaidEvent({
        connectedAccountId: "acct_evt",
        payoutId: "po_evt_1",
        arrivalSeconds,
      }),
      fakeStripe({ bsByPayout: [{ source: transferId }] }),
    );

    const row = await readPayout(fx.payoutId);
    assert.equal(row.status, "paid");
    assert.equal(
      row.paidAt?.getTime(),
      arrivalSeconds * 1000,
      "paidAt should be stamped from the event's arrival_date",
    );
    assert.equal(row.stripePayoutId, "po_evt_1");
  } finally {
    await fx.cleanup();
  }
});

test("handlePayoutEvent: re-delivery preserves the original paidAt timestamp", async () => {
  const transferId = `tr_evt_${randomUUID().slice(0, 8)}`;
  const originalPaidAt = new Date("2026-02-10T09:00:00Z");
  const fx = await createFixture({
    payoutStatus: "paid",
    stripeTransferId: transferId,
    stripeAccountId: "acct_evt",
    stripePayoutId: "po_evt_2",
    paidAt: originalPaidAt,
    arrivalDate: originalPaidAt,
  });
  try {
    // Stripe re-delivers the same payout.paid event later, with a newer
    // arrival_date. The existing paidAt must not be overwritten.
    const laterArrivalSeconds =
      Math.floor(originalPaidAt.getTime() / 1000) + 7 * 86400;
    await handlePayoutEvent(
      makePayoutPaidEvent({
        connectedAccountId: "acct_evt",
        payoutId: "po_evt_2",
        arrivalSeconds: laterArrivalSeconds,
      }),
      fakeStripe({ bsByPayout: [{ source: transferId }] }),
    );

    const row = await readPayout(fx.payoutId);
    assert.equal(row.status, "paid");
    assert.equal(
      row.paidAt?.getTime(),
      originalPaidAt.getTime(),
      "re-delivery must NOT rewrite the original paidAt",
    );
  } finally {
    await fx.cleanup();
  }
});

test("handlePayoutEvent: payout.paid leaves a failed row terminal", async () => {
  const transferId = `tr_evt_${randomUUID().slice(0, 8)}`;
  const fx = await createFixture({
    payoutStatus: "failed",
    stripeTransferId: transferId,
    stripeAccountId: "acct_evt",
  });
  try {
    const arrivalSeconds = Math.floor(Date.now() / 1000);
    await handlePayoutEvent(
      makePayoutPaidEvent({
        connectedAccountId: "acct_evt",
        payoutId: "po_evt_3",
        arrivalSeconds,
      }),
      fakeStripe({ bsByPayout: [{ source: transferId }] }),
    );

    const row = await readPayout(fx.payoutId);
    assert.equal(row.status, "failed", "failed rows must stay failed");
    assert.equal(row.paidAt, null);
  } finally {
    await fx.cleanup();
  }
});

test("handlePayoutEvent: non-paid event (payout.updated still pending) does NOT promote", async () => {
  const transferId = `tr_evt_${randomUUID().slice(0, 8)}`;
  const fx = await createFixture({
    payoutStatus: "in_transit",
    stripeTransferId: transferId,
    stripeAccountId: "acct_evt",
  });
  try {
    const arrivalSeconds = Math.floor(Date.now() / 1000) + 86400;
    await handlePayoutEvent(
      makePayoutPaidEvent({
        connectedAccountId: "acct_evt",
        payoutId: "po_evt_4",
        arrivalSeconds,
        type: "payout.updated",
        status: "pending",
      }),
      fakeStripe({ bsByPayout: [{ source: transferId }] }),
    );

    const row = await readPayout(fx.payoutId);
    assert.equal(row.status, "in_transit", "must not promote on a still-pending update");
    assert.equal(row.paidAt, null);
    // But it should record the discovered payout id + arrival_date.
    assert.equal(row.stripePayoutId, "po_evt_4");
    assert.equal(row.arrivalDate?.getTime(), arrivalSeconds * 1000);
  } finally {
    await fx.cleanup();
  }
});

// Close the pg pool after all tests so the test runner can exit cleanly.
test.after(async () => {
  const { pool } = await import("@workspace/db");
  await pool.end();
});
