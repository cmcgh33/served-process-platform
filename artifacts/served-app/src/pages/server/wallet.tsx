import { useState } from "react";
import { Link } from "wouter";
import {
  Zap,
  Clock,
  Award,
  CheckCircle2,
  Info,
  ExternalLink,
  AlertCircle,
  Loader2,
  Banknote,
  ArrowRight,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useGetMyWallet,
  useGetPricing,
  useGetServerStatus,
  useStartConnectOnboarding,
  useGetConnectDashboardLogin,
  useTriggerInstantPayout,
  getGetMyWalletQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatCentsUsd, splitFee, PLATFORM_FEE_BPS } from "@workspace/pricing";
import { redirectTopLevel } from "@/lib/external-redirect";

const PAYOUT_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  paid: { label: "paid", className: "bg-emerald-100 text-emerald-700" },
  in_transit: { label: "in transit", className: "bg-sky-100 text-sky-700" },
  pending: { label: "pending", className: "bg-amber-100 text-amber-700" },
  failed: { label: "failed", className: "bg-red-100 text-red-700" },
};

export default function ServerWallet() {
  const { data: wallet, isLoading } = useGetMyWallet();
  const { data: pricing } = useGetPricing();
  const { data: serverStatus } = useGetServerStatus();
  const onboard = useStartConnectOnboarding();
  const dashLogin = useGetConnectDashboardLogin();
  const instantPayout = useTriggerInstantPayout();
  const queryClient = useQueryClient();
  const [onboardingPending, setOnboardingPending] = useState(false);
  const [dashPending, setDashPending] = useState(false);
  const [payNowPending, setPayNowPending] = useState(false);
  const [payNowSuccess, setPayNowSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const paidCents = wallet?.paidCents ?? 0;
  const pendingCents = wallet?.pendingCents ?? 0;
  const failedCents = wallet?.failedCents ?? 0;
  const payoutsEnabled = wallet?.payoutsEnabled ?? false;
  const hasStripeAccount = wallet?.hasStripeAccount ?? false;
  const connectAvailableCents = wallet?.connectAvailableCents ?? 0;
  const payoutSchedule = wallet?.payoutSchedule ?? null;
  const isVerified = serverStatus?.credentialing.status === "verified";
  const recentPayouts = wallet?.recentPayouts ?? [];
  const nextPayoutArrivalDate = wallet?.nextPayoutArrivalDate ?? null;
  const lifetimeJobsCompleted = wallet?.lifetimeJobsCompleted ?? 0;
  const lifetimeEarningsCents = wallet?.lifetimeEarningsCents ?? 0;
  const nextPayoutLabel = nextPayoutArrivalDate
    ? new Date(nextPayoutArrivalDate).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;

  // Pretty-print the active Stripe payout schedule. Defaults to the
  // weekly/Friday cadence we set on every new Connect account.
  const scheduleLabel = (() => {
    if (!payoutsEnabled) return null;
    const interval = payoutSchedule?.interval ?? "weekly";
    if (interval === "weekly") {
      const anchor = payoutSchedule?.weeklyAnchor ?? "friday";
      const pretty = anchor.charAt(0).toUpperCase() + anchor.slice(1) + "s";
      return `Auto-payout: Weekly (${pretty})`;
    }
    if (interval === "daily") return "Auto-payout: Daily";
    if (interval === "monthly") return "Auto-payout: Monthly";
    if (interval === "manual") return "Auto-payout: Off (manual only)";
    return `Auto-payout: ${interval}`;
  })();

  // Compute the next scheduled auto-payout date deterministically from
  // the Stripe schedule. We prefer this over wallet.nextPayoutArrivalDate
  // (which is the arrival ETA of an in-flight payout, not the cadence) so
  // servers always see when their next batch will run.
  const nextScheduledLabel = (() => {
    if (!payoutsEnabled) return null;
    const interval = payoutSchedule?.interval ?? "weekly";
    const now = new Date();
    let target: Date | null = null;
    if (interval === "weekly") {
      const anchorMap: Record<string, number> = {
        sunday: 0,
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
      };
      const anchor = payoutSchedule?.weeklyAnchor ?? "friday";
      const targetDow = anchorMap[anchor.toLowerCase()] ?? 5;
      const todayDow = now.getDay();
      let delta = (targetDow - todayDow + 7) % 7;
      if (delta === 0) delta = 7; // today's batch is already cut — show next week
      target = new Date(now);
      target.setDate(target.getDate() + delta);
    } else if (interval === "monthly") {
      const anchorDay = payoutSchedule?.monthlyAnchor ?? 1;
      target = new Date(now.getFullYear(), now.getMonth(), anchorDay);
      if (target <= now) target.setMonth(target.getMonth() + 1);
    } else if (interval === "daily") {
      target = new Date(now);
      target.setDate(target.getDate() + 1);
    }
    if (!target) return null;
    return target.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  })();

  const serverSharePct = Math.round((10000 - PLATFORM_FEE_BPS) / 100);
  const publicPrices = pricing?.servePricesCents?.public;
  const breakdownRows = publicPrices
    ? [
        {
          label: `Standard Serve (${formatCentsUsd(publicPrices.standard)})`,
          you: formatCentsUsd(splitFee(publicPrices.standard).serverCents),
          rate: `${serverSharePct}%`,
        },
        {
          label: `Rush Serve (${formatCentsUsd(publicPrices.rush)})`,
          you: formatCentsUsd(splitFee(publicPrices.rush).serverCents),
          rate: `${serverSharePct}%`,
        },
        {
          label: `Licensed / Same-Day (${formatCentsUsd(publicPrices.licensed)})`,
          you: formatCentsUsd(splitFee(publicPrices.licensed).serverCents),
          rate: `${serverSharePct}%`,
        },
      ]
    : [];

  async function handleOnboard() {
    setError(null);
    setOnboardingPending(true);
    try {
      const res = await onboard.mutateAsync();
      if (res?.url) redirectTopLevel(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start onboarding.");
    } finally {
      setOnboardingPending(false);
    }
  }

  async function handlePayNow() {
    setError(null);
    setPayNowSuccess(null);
    setPayNowPending(true);
    try {
      const res = await instantPayout.mutateAsync();
      const dollars = (res.amountCents / 100).toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
      });
      const arrival = res.arrivalDate
        ? ` Arrives ${new Date(res.arrivalDate).toLocaleDateString()}.`
        : "";
      setPayNowSuccess(`Payout of ${dollars} sent to your bank.${arrival}`);
      // Refresh wallet so available balance + recent payouts update.
      void queryClient.invalidateQueries({ queryKey: getGetMyWalletQueryKey() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not start payout.";
      setError(msg);
    } finally {
      setPayNowPending(false);
    }
  }

  async function handleOpenDashboard() {
    setError(null);
    setDashPending(true);
    try {
      const res = await dashLogin.mutateAsync();
      // Top-level navigation in the same tab — `window.open(_blank)` is
      // popup-blocked here because the async fetch breaks the user-gesture
      // chain. Stripe Express login links are short-lived so the user can
      // click "back" to return to SERVED. when they're done. This mirrors
      // the working `handleOnboard` flow above (and the dashboard page).
      if (res?.url) redirectTopLevel(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open Stripe dashboard.");
    } finally {
      setDashPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold mb-2"
          style={
            payoutsEnabled
              ? {
                  backgroundColor: "rgba(34,197,94,0.1)",
                  color: "#15803d",
                  border: "1px solid rgba(34,197,94,0.3)",
                }
              : {
                  backgroundColor: "rgba(245,158,11,0.1)",
                  color: "#b45309",
                  border: "1px solid rgba(245,158,11,0.3)",
                }
          }
        >
          {payoutsEnabled ? "PAYOUTS ENABLED" : "BANK NOT CONNECTED"}
        </div>
        <h1 className="text-xl font-bold text-gray-900">Earnings Wallet</h1>
        <p className="text-sm text-gray-500 mt-0.5">Real-time view of your SERVED. earnings and payouts.</p>
      </div>

      {/* Verification gate (informational only) */}
      {!isVerified && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-amber-900 text-sm">Get verified to unlock the job feed</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Once your $24.99 background check clears, you can start accepting jobs and earning here.
            </p>
          </div>
          <Link
            href="/app/server/credentialing"
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors flex-shrink-0"
          >
            Get Verified <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Balance card */}
      <div className="rounded-2xl p-6 bg-brand-navy">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>
              Pending Payouts
            </p>
            <div className="text-5xl font-black text-white tracking-tight" data-testid="text-pending-balance">
              {formatCentsUsd(pendingCents)}
            </div>
            {payoutsEnabled && scheduleLabel ? (
              <p
                className="text-xs font-bold mt-2 inline-flex items-center gap-1.5"
                style={{ color: "#fbbf24" }}
                data-testid="text-payout-schedule"
              >
                <Clock className="w-3.5 h-3.5" />
                {scheduleLabel}
                {nextScheduledLabel ? (
                  <span
                    className="font-normal"
                    style={{ color: "rgba(255,255,255,0.7)" }}
                    data-testid="text-next-scheduled-payout"
                  >
                    · Next: {nextScheduledLabel}
                  </span>
                ) : null}
              </p>
            ) : null}
            {payoutsEnabled && connectAvailableCents > 0 ? (
              <p
                className="text-xs mt-1"
                style={{ color: "rgba(255,255,255,0.65)" }}
                data-testid="text-connect-available"
              >
                {formatCentsUsd(connectAvailableCents)} available to pay out now
              </p>
            ) : null}
            {failedCents > 0 ? (
              <p
                className="text-xs font-bold mt-2 flex items-center gap-1.5"
                style={{ color: "#fca5a5" }}
                data-testid="text-failed-callout"
              >
                <AlertCircle className="w-3.5 h-3.5" />
                {formatCentsUsd(failedCents)} failed to transfer — see history
                below.
              </p>
            ) : null}
            <p className="text-xs mt-2" style={{ color: "rgba(255,255,255,0.4)" }}>
              {payoutsEnabled
                ? "Auto-pays out weekly. Hit Pay Now for an off-schedule payout (~2 business days to your bank)."
                : "Connect your bank below to release pending payouts."}
            </p>
          </div>
          {payoutsEnabled ? (
            <div className="flex flex-col items-end gap-2 mt-1">
              <button
                onClick={handlePayNow}
                disabled={payNowPending || connectAvailableCents <= 0}
                data-testid="button-pay-now"
                title={
                  connectAvailableCents <= 0
                    ? "No funds are available to pay out yet. Stripe holds new transfers for ~2 business days."
                    : undefined
                }
                className="flex items-center gap-2 px-5 py-3 bg-amber-400 hover:bg-amber-500 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed text-black font-bold text-sm rounded-xl transition-colors"
              >
                {payNowPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4" />
                )}
                Pay Now
                {connectAvailableCents > 0 ? (
                  <span className="text-xs opacity-70">
                    ({formatCentsUsd(connectAvailableCents)})
                  </span>
                ) : null}
              </button>
              <button
                onClick={handleOpenDashboard}
                disabled={dashPending}
                data-testid="button-open-stripe-dashboard"
                className="flex items-center gap-1.5 text-xs font-bold text-white/70 hover:text-white"
              >
                {dashPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <ExternalLink className="w-3 h-3" />
                )}
                Stripe Dashboard
              </button>
            </div>
          ) : (
            <button
              onClick={handleOnboard}
              disabled={onboardingPending}
              data-testid="button-connect-bank"
              className="flex items-center gap-2 px-5 py-3 bg-amber-400 hover:bg-amber-500 disabled:bg-gray-200 disabled:text-gray-400 text-black font-bold text-sm rounded-xl transition-colors mt-1"
            >
              {onboardingPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Banknote className="w-4 h-4" />
              )}
              {hasStripeAccount ? "Finish Onboarding" : "Connect Bank"}
            </button>
          )}
        </div>
        <div
          className={cn(
            "grid gap-4 pt-4",
            // On phones the four/three stat tiles are too wide to fit
            // side-by-side; collapse to a 2-up layout and only spread
            // back out at sm+ so the original desktop look is preserved.
            failedCents > 0
              ? "grid-cols-2 sm:grid-cols-4"
              : "grid-cols-2 sm:grid-cols-3",
          )}
          style={{ borderTopColor: "rgba(255,255,255,0.1)", borderTopWidth: 1 }}
        >
          {[
            { label: "Total Paid Out", value: formatCentsUsd(paidCents), testId: "text-total-paid", emphasis: false },
            { label: "Pending", value: formatCentsUsd(pendingCents), testId: "text-pending", emphasis: false },
            ...(failedCents > 0
              ? [{
                  label: "Failed (Action needed)",
                  value: formatCentsUsd(failedCents),
                  testId: "text-failed",
                  emphasis: true,
                }]
              : []),
            { label: "Server Share", value: `${serverSharePct}%`, testId: "text-server-share", emphasis: false },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-xs" style={{ color: s.emphasis ? "#fca5a5" : "rgba(255,255,255,0.4)" }}>
                {s.label}
              </p>
              <p
                className={cn("text-lg font-black mt-0.5", s.emphasis ? "text-red-300" : "text-white")}
                data-testid={s.testId}
              >
                {s.value}
              </p>
            </div>
          ))}
        </div>
        {payNowSuccess ? (
          <p
            className="text-xs font-bold mt-3 text-emerald-300 inline-flex items-center gap-1.5"
            data-testid="text-pay-now-success"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {payNowSuccess}
          </p>
        ) : null}
        {error ? (
          <p className="text-xs text-red-300 mt-3" data-testid="text-wallet-error">
            {error}
          </p>
        ) : null}
      </div>

      {/* Career Pipeline */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-500" />
            <h2 className="text-sm font-bold text-gray-900">Career Pipeline</h2>
          </div>
          <Link
            href="/app/server/jobs/completed"
            data-testid="link-view-all-completed-jobs"
            className="text-xs font-bold text-sky-600 hover:text-sky-700 inline-flex items-center gap-1"
          >
            View all <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div
            data-testid="stat-lifetime-jobs-completed"
            className="rounded-xl bg-gradient-to-br from-amber-50 to-amber-100/40 border border-amber-200 p-5"
          >
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
              Jobs completed
            </p>
            <p className="text-4xl font-black text-gray-900 mt-1 tabular-nums">
              {isLoading ? "—" : (lifetimeJobsCompleted ?? 0).toLocaleString()}
            </p>
            <p className="text-[11px] text-amber-700 mt-1">Lifetime served on SERVED.</p>
          </div>
          <div
            data-testid="stat-lifetime-earnings"
            className="rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/40 border border-emerald-200 p-5"
          >
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
              Total earned
            </p>
            <p className="text-4xl font-black text-gray-900 mt-1 tabular-nums">
              {isLoading ? "—" : formatCentsUsd(lifetimeEarningsCents ?? 0)}
            </p>
            <p className="text-[11px] text-emerald-700 mt-1">Across every served job</p>
          </div>
        </div>
        <div className="flex items-start gap-2 p-3 mt-4 bg-gray-50 rounded-xl text-xs text-gray-600">
          <Info className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5" />
          <p>
            Every completed job on SERVED. is automatically documented as verified experience toward your
            Nevada PILB license application. Licensed servers earn $96–$120/job.
          </p>
        </div>
      </div>

      {/* Payout History */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-bold text-gray-900">Payout History</h2>
          </div>
          <span className="text-xs text-gray-400">{recentPayouts.length} transfers</span>
        </div>
        <div className="divide-y divide-gray-50">
          {isLoading ? (
            <div className="px-6 py-8 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading payouts…
            </div>
          ) : recentPayouts.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <Zap className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">
                {isVerified && payoutsEnabled
                  ? "No payouts yet. Complete a job to see your first transfer here."
                  : "No payouts yet — finish onboarding above to start earning."}
              </p>
            </div>
          ) : (
            recentPayouts.map((p) => {
              const badge = PAYOUT_STATUS_BADGE[p.status] ?? {
                label: p.status,
                className: "bg-gray-100 text-gray-700",
              };
              // Prefer the Stripe-derived arrival date when known. For paid
              // rows we show "Arrived <date>"; for unpaid rows we show the
              // ETA ("Arrives <date>"). Falls back to paidAt/createdAt for
              // legacy rows that predate the arrival_date column.
              let dateLabel: string;
              if (p.arrivalDate) {
                const formatted = new Date(p.arrivalDate).toLocaleDateString();
                dateLabel =
                  p.status === "paid"
                    ? `Arrived ${formatted}`
                    : `Arrives ${formatted}`;
              } else if (p.paidAt) {
                dateLabel = `Paid ${new Date(p.paidAt).toLocaleDateString()}`;
              } else {
                dateLabel = `Created ${new Date(p.createdAt).toLocaleDateString()}`;
              }
              const isFailed = p.status === "failed";
              return (
                <div key={p.id} data-testid={`row-payout-${p.id}`}>
                  <div className="flex items-center gap-4 px-6 py-3.5">
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                      p.status === "paid" ? "bg-emerald-50" : isFailed ? "bg-red-50" : "bg-amber-50",
                    )}>
                      {p.status === "paid" ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : isFailed ? (
                        <AlertCircle className="w-4 h-4 text-red-500" />
                      ) : (
                        <Clock className="w-4 h-4 text-amber-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900">{formatCentsUsd(p.amountCents)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Job #{p.jobId} · {dateLabel}
                      </p>
                    </div>
                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide", badge.className)}>
                      {badge.label}
                    </span>
                  </div>
                  {isFailed ? (
                    <div
                      className="mx-6 mb-3 -mt-1 rounded-lg border border-red-200 bg-red-50 p-3"
                      data-testid={`failure-detail-${p.id}`}
                    >
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-red-800">
                            Stripe couldn't transfer this payout
                          </p>
                          <p
                            className="text-xs text-red-700 mt-0.5 break-words"
                            data-testid={`failure-reason-${p.id}`}
                          >
                            {p.failureReason ??
                              "No reason recorded. Open your Stripe dashboard or contact support to investigate."}
                          </p>
                          <div className="flex flex-wrap items-center gap-3 mt-2">
                            {payoutsEnabled ? (
                              <button
                                onClick={handleOpenDashboard}
                                disabled={dashPending}
                                data-testid={`button-failed-open-dashboard-${p.id}`}
                                className="inline-flex items-center gap-1.5 text-xs font-bold text-red-800 hover:text-red-900 underline underline-offset-2 disabled:opacity-50"
                              >
                                {dashPending ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <ExternalLink className="w-3 h-3" />
                                )}
                                Open Stripe Dashboard
                              </button>
                            ) : (
                              <button
                                onClick={handleOnboard}
                                disabled={onboardingPending}
                                data-testid={`button-failed-finish-onboarding-${p.id}`}
                                className="inline-flex items-center gap-1.5 text-xs font-bold text-red-800 hover:text-red-900 underline underline-offset-2 disabled:opacity-50"
                              >
                                {onboardingPending ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Banknote className="w-3 h-3" />
                                )}
                                {hasStripeAccount ? "Finish Onboarding" : "Connect Bank"}
                              </button>
                            )}
                            <a
                              href="mailto:support@served.legal?subject=Payout%20transfer%20failed"
                              data-testid={`link-failed-contact-support-${p.id}`}
                              className="inline-flex items-center gap-1.5 text-xs font-bold text-red-800 hover:text-red-900 underline underline-offset-2"
                            >
                              Contact support
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Earnings breakdown */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="text-sm font-bold text-gray-900 mb-4">Earnings Breakdown (per job tier)</h2>
        <div className="space-y-3">
          {breakdownRows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0"
            >
              <span className="text-xs text-gray-600">{row.label}</span>
              <div className="flex items-center gap-4 text-right">
                <span className="text-xs font-bold text-emerald-600">{row.you}</span>
                <span className="text-[10px] text-gray-400 w-8">{row.rate}</span>
              </div>
            </div>
          ))}
          {breakdownRows.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">Loading pricing…</p>
          ) : null}
        </div>
        <p className="text-xs text-gray-400 mt-3">
          SERVED. absorbs payment processing fees during Year 1. You receive {serverSharePct}% of gross job
          value with no deductions.
        </p>
      </div>
    </div>
  );
}
