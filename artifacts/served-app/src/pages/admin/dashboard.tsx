import { useState } from "react";
import { Link } from "wouter";
import {
  TrendingUp,
  Users,
  Briefcase,
  ShieldCheck,
  DollarSign,
  Wallet,
  ArrowRight,
  Mail,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Trash2,
} from "lucide-react";
import {
  useAdminOverview,
  useAdminPurgeTestData,
  useAdminSendTestEmail,
  useAdminFailedPayouts,
  useAdminRetryPayout,
  useAdminDismissFailedPayout,
  type AdminFailedPayoutRow,
} from "@/lib/admin";

function StatCard({
  label,
  value,
  icon,
  bg,
  href,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  bg: string;
  href?: string;
}) {
  const inner = (
    <div className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow transition-shadow">
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${bg}`}>
          {icon}
        </div>
        {href && <ArrowRight className="w-4 h-4 text-gray-300" />}
      </div>
      <div className="mt-3 text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5 whitespace-pre-line">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Admin smoke-test card for the SendGrid mailer. POSTs to
 * `/api/admin/mailer/test`, which calls the same `sendEmail` code path
 * production uses. A successful response means the API key resolved,
 * the sender domain is verified, and `MAIL_FROM` is correct.
 *
 * Recipient defaults to the calling admin's email (resolved server-side)
 * so the safest default is "send it to me". Result is rendered inline
 * with an actionable failure detail when SendGrid rejects the message
 * or no credential is configured (logged-only fallback).
 */
function MailerTestCard() {
  const [recipient, setRecipient] = useState("");
  const send = useAdminSendTestEmail();
  const result = send.data;
  const error = send.error;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = recipient.trim();
    send.mutate(trimmed.length > 0 ? { to: trimmed } : {});
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Mail className="w-4 h-4 text-amber-500" />
            Mailer smoke test
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Sends a test message through the same SendGrid path the app uses.
            Leave blank to send to your own email.
          </p>
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="mt-4 flex flex-col sm:flex-row gap-2"
      >
        <input
          type="email"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="recipient@example.com (optional)"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          disabled={send.isPending}
        />
        <button
          type="submit"
          disabled={send.isPending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 transition-colors"
        >
          {send.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Sending…
            </>
          ) : (
            <>
              <Mail className="w-4 h-4" />
              Send test email
            </>
          )}
        </button>
      </form>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>Request failed: {String(error.message ?? error)}</div>
        </div>
      )}

      {result && !error && (
        <div
          className={`mt-3 rounded-lg border p-3 text-sm ${
            result.delivered
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-amber-50 border-amber-200 text-amber-800"
          }`}
        >
          <div className="flex items-start gap-2">
            {result.delivered ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" />
            )}
            <div className="space-y-1">
              <div className="font-semibold">
                {result.delivered
                  ? `Delivered to ${result.to}`
                  : result.hadCredential
                    ? `SendGrid rejected the message`
                    : `No SendGrid credential configured`}
              </div>
              <div className="text-xs opacity-80">
                From: {result.from}
                {result.status != null && <> · HTTP {result.status}</>}
              </div>
              {result.detail && (
                <div className="text-xs mt-1 font-mono whitespace-pre-wrap break-all">
                  {result.detail}
                </div>
              )}
              {result.delivered && (
                <div className="text-xs opacity-80">
                  Check the inbox of <strong>{result.to}</strong> to confirm
                  end-to-end delivery (including sender-domain reputation).
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const { data, isLoading, error } = useAdminOverview();

  const usersByRole = new Map(
    (data?.usersByRole ?? []).map((r) => [r.role, r.count]),
  );
  const jobsByStatus = new Map(
    (data?.jobsByStatus ?? []).map((r) => [r.status, r.count]),
  );
  const totalJobs = (data?.jobsByStatus ?? []).reduce(
    (sum, r) => sum + r.count,
    0,
  );
  const totalUsers = (data?.usersByRole ?? []).reduce(
    (sum, r) => sum + r.count,
    0,
  );
  const payoutsPaid =
    (data?.payouts ?? []).find((p) => p.status === "paid")?.totalCents ?? 0;
  const payoutsPending = (data?.payouts ?? [])
    .filter((p) => p.status !== "paid" && p.status !== "failed")
    .reduce((s, p) => s + p.totalCents, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Overview</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Real-time snapshot of the SERVED. marketplace.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          Failed to load overview: {String(error)}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label={"Total\nUsers"}
          value={isLoading ? "—" : String(totalUsers)}
          icon={<Users className="w-5 h-5 text-blue-500" />}
          bg="bg-blue-50"
          href="/app/admin/users"
        />
        <StatCard
          label={"Total\nJobs"}
          value={isLoading ? "—" : String(totalJobs)}
          icon={<Briefcase className="w-5 h-5 text-violet-500" />}
          bg="bg-violet-50"
          href="/app/admin/jobs"
        />
        <StatCard
          label={"Active\nServers"}
          value={isLoading ? "—" : String(usersByRole.get("server") ?? 0)}
          icon={<ShieldCheck className="w-5 h-5 text-emerald-500" />}
          bg="bg-emerald-50"
          href="/app/admin/servers"
        />
        <StatCard
          label={"Active\nSubscriptions"}
          value={isLoading ? "—" : String(data?.activeSubscriptions ?? 0)}
          icon={<TrendingUp className="w-5 h-5 text-amber-500" />}
          bg="bg-amber-50"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Jobs by status</h2>
            <Link
              href="/app/admin/jobs"
              className="text-xs font-semibold text-amber-600 hover:text-amber-700"
            >
              View all →
            </Link>
          </div>
          {isLoading ? (
            <div className="text-sm text-gray-400">Loading…</div>
          ) : jobsByStatus.size === 0 ? (
            <div className="text-sm text-gray-400 py-6 text-center">
              No jobs yet — they'll appear here as requesters post them.
            </div>
          ) : (
            <div className="space-y-2">
              {Array.from(jobsByStatus.entries()).map(([status, count]) => (
                <div
                  key={status}
                  className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5"
                >
                  <span className="text-sm font-medium text-gray-700 capitalize">
                    {status.replace(/_/g, " ")}
                  </span>
                  <span className="text-sm font-bold text-gray-900">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">Money</h2>
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-0.5">
                <DollarSign className="w-3.5 h-3.5" /> Gross revenue
              </div>
              <div className="text-xl font-bold text-gray-900">
                {isLoading ? "—" : dollars(data?.revenue.grossCents ?? 0)}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-0.5">
                <DollarSign className="w-3.5 h-3.5" /> Platform fees earned
              </div>
              <div className="text-xl font-bold text-emerald-600">
                {isLoading ? "—" : dollars(data?.revenue.platformFeeCents ?? 0)}
              </div>
            </div>
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-gray-500">
                  <Wallet className="w-3.5 h-3.5" /> Paid out
                </span>
                <span className="font-semibold text-gray-900">
                  {isLoading ? "—" : dollars(payoutsPaid)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-gray-500">
                  <Wallet className="w-3.5 h-3.5" /> In transit
                </span>
                <span className="font-semibold text-amber-600">
                  {isLoading ? "—" : dollars(payoutsPending)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-3">Quick actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Link
            href="/app/admin/servers"
            className="flex items-center gap-3 rounded-lg border border-gray-200 hover:border-amber-400 hover:bg-amber-50/40 p-4 transition-colors"
          >
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <div>
              <div className="text-sm font-semibold text-gray-900">
                Add a server
              </div>
              <div className="text-xs text-gray-500">
                Manually onboard + auto-verify
              </div>
            </div>
          </Link>
          <Link
            href="/app/admin/jobs"
            className="flex items-center gap-3 rounded-lg border border-gray-200 hover:border-amber-400 hover:bg-amber-50/40 p-4 transition-colors"
          >
            <Briefcase className="w-5 h-5 text-violet-500" />
            <div>
              <div className="text-sm font-semibold text-gray-900">
                Assign a job
              </div>
              <div className="text-xs text-gray-500">
                Route pending jobs to a server
              </div>
            </div>
          </Link>
          <Link
            href="/app/admin/users"
            className="flex items-center gap-3 rounded-lg border border-gray-200 hover:border-amber-400 hover:bg-amber-50/40 p-4 transition-colors"
          >
            <Users className="w-5 h-5 text-blue-500" />
            <div>
              <div className="text-sm font-semibold text-gray-900">
                Find a user
              </div>
              <div className="text-xs text-gray-500">
                Look up by name or email
              </div>
            </div>
          </Link>
        </div>
      </div>

      <FailedPayoutsCard />

      <MailerTestCard />

      <PurgeTestDataCard />
    </div>
  );
}

/**
 * Failed-payout console.
 *
 * Lists every payout currently in `failed` state (typically because the
 * platform Stripe balance was insufficient at transfer time — see Stripe
 * Dashboard → Settings → Payouts; the platform schedule must be Manual,
 * otherwise customer funds are swept to the bank before we can route the
 * server's cut). The "Retry" button calls processPayoutTransfer again;
 * the underlying helper is idempotency-keyed on jobId so a double-click
 * cannot double-pay.
 */
function FailedPayoutsCard() {
  const { data, isLoading, error } = useAdminFailedPayouts();
  const retry = useAdminRetryPayout();
  const dismiss = useAdminDismissFailedPayout();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<{
    payoutId: number;
    ok: boolean;
    message: string;
  } | null>(null);

  const rows = data?.payouts ?? [];

  async function onRetry(row: AdminFailedPayoutRow) {
    setPendingId(row.id);
    setLastResult(null);
    try {
      const res = await retry.mutateAsync(row.id);
      setLastResult({
        payoutId: row.id,
        ok: res.ok,
        message: res.ok
          ? `Transferred — payout #${row.id} is now ${res.payout?.status ?? "in_transit"}.`
          : res.payout?.failureReason ??
            "Transfer didn't complete. Check the row's failure reason and try again.",
      });
    } catch (err) {
      setLastResult({
        payoutId: row.id,
        ok: false,
        message: err instanceof Error ? err.message : "Retry failed",
      });
    } finally {
      setPendingId(null);
    }
  }

  async function onDismiss(row: AdminFailedPayoutRow) {
    const confirmed = window.confirm(
      `Dismiss this failed payout?\n\n` +
        `• Deletes payout #${row.id} ($${(row.amountCents / 100).toFixed(2)} to ${row.serverName ?? "server"})\n` +
        `• Marks job #${row.jobId} as cancelled (if it's currently 'served')\n\n` +
        `Use this only for test rows you don't want on the books. Real money is NOT moved either way. This cannot be undone.`,
    );
    if (!confirmed) return;
    setPendingId(row.id);
    setLastResult(null);
    try {
      const res = await dismiss.mutateAsync(row.id);
      setLastResult({
        payoutId: row.id,
        ok: true,
        message: res.jobCancelled
          ? `Removed payout #${row.id} and cancelled job #${row.jobId}.`
          : `Removed payout #${row.id}. Job #${row.jobId} was left as-is (not in 'served' state).`,
      });
    } catch (err) {
      setLastResult({
        payoutId: row.id,
        ok: false,
        message: err instanceof Error ? err.message : "Dismiss failed",
      });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Failed payouts
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Re-run the Stripe transfer for any payout stuck in{" "}
            <code className="text-[10px] bg-gray-100 px-1 rounded">failed</code>.
            Safe to click multiple times — idempotent at Stripe.
          </p>
        </div>
        {!isLoading && (
          <span className="text-xs text-gray-500 shrink-0">
            {rows.length} {rows.length === 1 ? "row" : "rows"}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-400 flex items-center gap-2 py-3">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="text-sm text-red-600 py-3">
          Couldn't load failed payouts: {(error as Error).message}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-500 py-3 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          No failed payouts. Everything is paid out or in transit.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="text-left font-medium px-5 py-2">Job</th>
                <th className="text-left font-medium px-2 py-2">Server</th>
                <th className="text-right font-medium px-2 py-2">Amount</th>
                <th className="text-left font-medium px-2 py-2">Reason</th>
                <th className="text-right font-medium px-5 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const blockedReason = !r.stripeAccountId
                  ? "No Stripe account on file"
                  : !r.payoutsEnabled
                    ? "Connect onboarding incomplete"
                    : null;
                const isPending = pendingId === r.id;
                return (
                  <tr
                    key={r.id}
                    className="border-b border-gray-50 align-top"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/app/admin/jobs?focus=${r.jobId}`}
                        className="font-medium text-gray-900 hover:text-amber-600"
                      >
                        #{r.jobId}
                      </Link>
                      <div className="text-[10px] text-gray-400">
                        payout #{r.id}
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <div className="text-gray-900">
                        {r.serverName ?? "—"}
                      </div>
                      {r.serverEmail && (
                        <div className="text-[10px] text-gray-400">
                          {r.serverEmail}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-3 text-right font-semibold text-gray-900 tabular-nums">
                      {dollars(r.amountCents)}
                    </td>
                    <td className="px-2 py-3 text-xs text-gray-600 max-w-md">
                      {r.failureReason ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-2 justify-end">
                        {blockedReason ? (
                          <span
                            className="text-[11px] text-gray-400"
                            title={blockedReason}
                          >
                            {blockedReason}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onRetry(r)}
                            disabled={isPending}
                            className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium px-3 py-1.5 transition-colors"
                          >
                            {isPending && retry.isPending ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Retrying…
                              </>
                            ) : (
                              <>
                                <Wallet className="w-3 h-3" />
                                Retry
                              </>
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDismiss(r)}
                          disabled={isPending}
                          title="Delete this failed payout row and cancel the job. For test cleanup only — does not move any real money."
                          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 hover:border-red-400 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-600 text-xs font-medium px-3 py-1.5 transition-colors"
                        >
                          {isPending && dismiss.isPending ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Dismissing…
                            </>
                          ) : (
                            <>
                              <Trash2 className="w-3 h-3" />
                              Dismiss
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {lastResult && (
        <div
          className={`mt-3 text-xs rounded-md px-3 py-2 ${
            lastResult.ok
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          <span className="font-medium">
            Payout #{lastResult.payoutId}:
          </span>{" "}
          {lastResult.message}
        </div>
      )}
    </div>
  );
}

/**
 * One-shot factory reset for the operational tables. Intended for use
 * right after launch when the production DB still has demo / pre-launch
 * test rows that should be wiped before the first real customer touches
 * the system. Wipes jobs, servers, clients and their FK children;
 * preserves users, app_settings, server credentials, and audit log.
 *
 * Defensive UX: the destructive button is hidden behind a typed
 * "PURGE" confirmation so it cannot fire from a stray click.
 */
function PurgeTestDataCard() {
  const [confirmText, setConfirmText] = useState("");
  const purge = useAdminPurgeTestData();
  const result = purge.data;
  const error = purge.error;
  const armed = confirmText.trim().toUpperCase() === "PURGE";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!armed || purge.isPending) return;
    purge.mutate();
    setConfirmText("");
  }

  return (
    <div className="bg-white rounded-xl border border-red-200 p-5">
      <div className="flex items-start gap-3">
        <Trash2 className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <h2 className="font-semibold text-gray-900">
            Purge demo / test data
          </h2>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            Permanently deletes <strong>all jobs, all servers, and all
            clients</strong> (plus their documents, payments, payouts, and
            related records). Preserves user accounts, app settings,
            server credentials, and the audit log. Use only as a one-time
            factory reset before the first real customer.
          </p>
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="mt-4 flex flex-col sm:flex-row gap-2"
      >
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder='Type "PURGE" to enable'
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-400"
          disabled={purge.isPending}
        />
        <button
          type="submit"
          disabled={!armed || purge.isPending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 transition-colors"
        >
          {purge.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Purging…
            </>
          ) : (
            <>
              <Trash2 className="w-4 h-4" />
              Purge data
            </>
          )}
        </button>
      </form>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>Request failed: {String(error.message ?? error)}</div>
        </div>
      )}

      {result && !error && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600" />
            <div className="space-y-1">
              <div className="font-semibold">Purge complete.</div>
              <div className="text-xs opacity-80">
                Deleted {result.counts.jobs} jobs, {result.counts.servers}{" "}
                servers, {result.counts.clients} clients,{" "}
                {result.counts.documents} documents,{" "}
                {result.counts.payments} payments,{" "}
                {result.counts.payouts} payouts,{" "}
                {result.counts.uploadReservations} upload reservations,{" "}
                {result.counts.licenseExpiryNotifications} license-expiry
                notifications.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
