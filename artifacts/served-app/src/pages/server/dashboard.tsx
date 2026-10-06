import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDashboardSummary,
  useGetRecentJobs,
  useGetServerStatus,
  useGetMyWallet,
  useStartConnectOnboarding,
  useRefreshConnectStatus,
  getGetServerStatusQueryKey,
  getGetMyWalletQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import {
  TrendingUp,
  CheckCircle2,
  Clock,
  Wallet,
  MapPin,
  FileText,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Navigation,
  AlertTriangle,
  Zap,
  Users,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Banknote,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { redirectTopLevel } from "@/lib/external-redirect";
import { MarkServedModal } from "@/components/server/mark-served-modal";
import { LogAttemptModal } from "@/components/server/log-attempt-modal";
import { GetDocumentsModal } from "@/components/server/get-documents-modal";
import { getNavigateTarget } from "@/lib/navigate-target";

const STATUS_COLORS: Record<string, string> = {
  served: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  in_progress: "bg-sky-100 text-sky-700",
  assigned: "bg-violet-100 text-violet-700",
  failed: "bg-red-100 text-red-700",
  accepted: "bg-teal-100 text-teal-700",
};
const STATUS_LABEL: Record<string, string> = {
  served: "Served", pending: "Pending", in_progress: "In Progress",
  assigned: "Assigned", failed: "Failed", accepted: "Accepted",
};

function jobTitle(docType: string | null | undefined, name: string) {
  if (!docType) return `Serve Documents — ${name}`;
  const lower = docType.toLowerCase();
  if (lower.includes("civil")) return `Civil Litigation — ${name} Case`;
  if (lower.includes("subpoena")) return "Subpoena Service";
  if (lower.includes("eviction")) return "Serve Eviction Notice";
  if (lower.includes("summons") || lower.includes("family")) return "Serve Family Court Documents";
  if (lower.includes("divorce")) return "Divorce Petition Service";
  return `Serve ${docType}`;
}
// Show the server their PAYOUT (80% of gross per the marketplace pricing
// module), not the customer-facing gross. Reads the immutable snapshot
// stored on the job at post-time. Old code guessed by document type and
// was wrong for every tier the customer didn't pick.
function jobPrice(payoutCents: number | null | undefined): string | null {
  if (typeof payoutCents !== "number" || payoutCents <= 0) return null;
  const dollars = payoutCents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars}`
    : `$${dollars.toFixed(2)}`;
}
function jobType(docType: string | null | undefined) {
  if (!docType) return "Legal";
  const lower = docType.toLowerCase();
  if (lower.includes("civil")) return "Civil Litigation";
  if (lower.includes("subpoena")) return "Subpoena";
  if (lower.includes("eviction")) return "Eviction";
  if (lower.includes("family") || lower.includes("summons") || lower.includes("divorce")) return "Family Court";
  return docType;
}

interface DashboardJob {
  id: number;
  status: string;
  recipientName: string;
  recipientAddress?: string | null;
  recipientCity?: string | null;
  recipientState?: string | null;
  recipientZip?: string | null;
  documentType?: string | null;
  caseNumber?: string | null;
  documentHandling?: string | null;
  pickupAddress?: string | null;
  pickupCity?: string | null;
  pickupState?: string | null;
  pickupZip?: string | null;
  pickupContactName?: string | null;
  pickupContactPhone?: string | null;
  attemptCount?: number | null;
  serverPayoutCents?: number | null;
}

function JobCard({ job }: { job: DashboardJob }) {
  const [open, setOpen] = useState(false);
  const [markServedOpen, setMarkServedOpen] = useState(false);
  const [logAttemptOpen, setLogAttemptOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const status = job.status;
  const colorClass = STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600";
  const label = STATUS_LABEL[status] ?? status;
  const title = jobTitle(job.documentType, job.recipientName);
  const location = [job.recipientCity, job.recipientState].filter(Boolean).join(", ") || "Las Vegas, NV";
  const isInProgress = status === "in_progress";
  const isAssigned = status === "assigned";
  const isEnRoute = status === "en_route";
  // The server has the job (accepted/assigned/working it) — they need
  // the requester's uploaded documents to actually serve. Keep this
  // predicate identical to the one in job-feed.tsx so both surfaces
  // expose document access for the same set of statuses.
  const canViewDocuments = isAssigned || isInProgress || isEnRoute;
  const isPickup = job.documentHandling === "pickup";
  const attemptCount = job.attemptCount ?? 0;
  const showAttempts = (isInProgress || isEnRoute) && attemptCount > 0;
  const navTarget = getNavigateTarget({
    documentHandling: job.documentHandling,
    pickupAddress: job.pickupAddress,
    pickupCity: job.pickupCity,
    pickupState: job.pickupState,
    pickupZip: job.pickupZip,
    recipientAddress: job.recipientAddress ?? "",
    recipientCity: job.recipientCity ?? "",
    recipientState: job.recipientState ?? "",
    recipientZip: job.recipientZip ?? "",
  });

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Stack title + action buttons vertically on phones — at 390px
            wide the three action buttons (Navigate / Served / Log
            Attempt) eat the entire row and squeeze the title to zero
            width. Desktop layout (sm+) keeps the original side-by-side
            arrangement. */}
        <div className="flex flex-col sm:flex-row sm:items-center px-5 py-4 gap-3">
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900 text-sm">{title}</span>
              <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", colorClass)}>{label}</span>
              {isPickup && (
                <span
                  data-testid={`badge-pickup-${job.id}`}
                  className="flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"
                >
                  <Package className="w-3 h-3" />Pickup required
                </span>
              )}
            </div>
            {showAttempts && (
              <div className="flex items-center gap-1 text-xs font-medium text-amber-600">
                <AlertTriangle className="w-3 h-3" />{attemptCount}/3 {attemptCount === 1 ? "Attempt" : "Attempts"}
              </div>
            )}
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <MapPin className="w-3 h-3" /><span>{location}</span>
              <span className="mx-1">·</span><span>{jobType(job.documentType)}</span>
              {jobPrice(job.serverPayoutCents) && (
                <>
                  <span className="mx-1">·</span><span className="font-medium">{jobPrice(job.serverPayoutCents)}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:flex-shrink-0">
            {status === "served" && (
              <Link href={`/app/server/proof/${job.id}`} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
                <CircleCheck className="w-3.5 h-3.5" />Proof
              </Link>
            )}
            {canViewDocuments && (
              <>
                <button
                  type="button"
                  onClick={() => setDocsOpen(true)}
                  data-testid={`button-get-documents-${job.id}`}
                  title="View and download the documents to be served"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-300 bg-sky-50 text-sky-700 text-xs font-bold hover:bg-sky-100 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />Get Docs
                </button>
                <a
                  href={navTarget.url}
                  target="_blank"
                  rel="noreferrer"
                  data-testid={`button-navigate-${job.id}`}
                  title={navTarget.kind === "pickup" ? "Navigate to pickup first" : "Navigate to recipient"}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-500 text-black text-xs font-bold transition-colors"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  {navTarget.kind === "pickup" ? "Navigate · Pickup" : "Navigate"}
                </a>
                <button onClick={() => setMarkServedOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-bold hover:bg-emerald-50 transition-colors">
                  <CircleCheck className="w-3.5 h-3.5" />Served
                </button>
                <button onClick={() => setLogAttemptOpen(true)} data-testid={`button-log-attempt-${job.id}`} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 text-xs font-bold hover:bg-amber-50 transition-colors">
                  <AlertTriangle className="w-3.5 h-3.5" />Log Attempt
                </button>
              </>
            )}
            <button onClick={() => setOpen(v => !v)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
              {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
            </button>
          </div>
        </div>
        {open && (
          <div className="border-t border-gray-100 px-5 py-4 bg-gray-50">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-xs text-gray-500 mb-0.5">Recipient</p><p className="font-medium text-gray-800">{job.recipientName}</p></div>
              {job.caseNumber && <div><p className="text-xs text-gray-500 mb-0.5">Case #</p><p className="font-mono text-xs font-medium text-gray-800">{job.caseNumber}</p></div>}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {canViewDocuments && (
                <button
                  type="button"
                  onClick={() => setDocsOpen(true)}
                  data-testid={`button-view-documents-${job.id}`}
                  className="text-xs font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-1"
                >
                  <FileText className="w-3 h-3" />View Documents
                </button>
              )}
              {status === "served" && (
                <Link
                  href={`/app/server/proof/${job.id}`}
                  className="text-xs font-medium text-amber-600 hover:text-amber-700 flex items-center gap-1"
                >
                  View Proof of Service <ArrowRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
      {markServedOpen && (
        <MarkServedModal
          job={{
            id: job.id,
            recipientName: job.recipientName,
            documentType: job.documentType,
            recipientAddress: job.recipientAddress,
            recipientCity: job.recipientCity,
            recipientState: job.recipientState,
            recipientZip: job.recipientZip,
          }}
          onClose={() => setMarkServedOpen(false)}
        />
      )}
      {logAttemptOpen && (
        <LogAttemptModal
          job={{
            id: job.id,
            recipientName: job.recipientName,
            documentType: job.documentType,
            recipientState: job.recipientState,
          }}
          onClose={() => setLogAttemptOpen(false)}
        />
      )}
      {docsOpen && (
        <GetDocumentsModal
          job={{
            id: job.id,
            documentType: job.documentType,
            documentHandling: job.documentHandling ?? null,
            pickupAddress: job.pickupAddress ?? null,
            pickupCity: job.pickupCity ?? null,
            pickupState: job.pickupState ?? null,
            pickupZip: job.pickupZip ?? null,
          }}
          onClose={() => setDocsOpen(false)}
        />
      )}
    </>
  );
}

function ConnectOnboardButton({ payoutsEnabled, hasStripeAccount }: { payoutsEnabled: boolean; hasStripeAccount: boolean }) {
  const onboard = useStartConnectOnboarding();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    setPending(true);
    setError(null);
    try {
      const res = await onboard.mutateAsync();
      if (res?.url) redirectTopLevel(res.url);
      else setError("Stripe did not return an onboarding link. Please try again.");
    } catch (err) {
      // Surface the actual server/Stripe error so silent failures
      // (e.g. "You can only create new accounts if you've signed up
      // for Connect") are visible to the user instead of looking like
      // the button is broken.
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "Could not start bank onboarding. Please try again.";
      setError(msg);
    } finally {
      setPending(false);
    }
  }

  if (payoutsEnabled) return null;
  return (
    <div className="flex flex-col items-stretch gap-2">
      <button
        onClick={handle}
        disabled={pending}
        data-testid="button-connect-onboard"
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-500 disabled:bg-gray-200 text-black font-bold text-sm transition-colors"
      >
        {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
        {hasStripeAccount ? "Finish bank onboarding" : "Connect bank account"}
      </button>
      {error && (
        <p
          role="alert"
          data-testid="text-connect-onboard-error"
          className="text-xs text-red-600 max-w-sm"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * When Stripe finishes (or aborts) hosted onboarding it bounces the user
 * back to /app/server/dashboard with `?connect=return` (success) or
 * `?connect=refresh` (link expired mid-flow). Without this hook the
 * dashboard renders with the stale DB value of `payouts_enabled` until
 * the async `account.updated` webhook lands — the user sees "Stripe
 * still needs more information" even though they just completed it.
 *
 * Detect the param, POST /api/stripe/connect/refresh to pull the live
 * Stripe state, invalidate the queries that drive the payout banner,
 * then strip the param from the URL so a refresh doesn't re-trigger.
 */
function useConnectReturnRefresh(): void {
  const queryClient = useQueryClient();
  const refresh = useRefreshConnectStatus();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connect = params.get("connect");
    if (connect !== "return" && connect !== "refresh") return;

    let cancelled = false;
    void (async () => {
      try {
        await refresh.mutateAsync();
      } catch {
        // Non-fatal — user can hit the wallet's manual refresh CTA.
      } finally {
        if (cancelled) return;
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetServerStatusQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetMyWalletQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
        ]);
        // Strip ?connect=… so a page reload doesn't re-trigger the refresh
        // and so we never show the "stale" banner again on this view.
        params.delete("connect");
        const next =
          window.location.pathname +
          (params.toString() ? `?${params.toString()}` : "") +
          window.location.hash;
        window.history.replaceState(null, "", next);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount — re-running on `refresh` identity churn would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export default function ServerDashboard() {
  const { user } = useUser();
  useConnectReturnRefresh();
  const { data: summary } = useGetDashboardSummary();
  const { data: recentJobs } = useGetRecentJobs({ limit: 5 });
  const { data: serverStatus } = useGetServerStatus();
  const { data: wallet } = useGetMyWallet();
  const firstName = user?.firstName?.trim() || "there";
  const availableCount = recentJobs?.filter((j) => j.status === "pending").length ?? 0;
  const walletDollars = (wallet?.paidCents ?? 0) / 100;
  const walletLabel = walletDollars >= 1
    ? `$${walletDollars.toFixed(0)}`
    : `$${walletDollars.toFixed(2)}`;

  const credStatus = serverStatus?.credentialing.status ?? null;
  const isVerified = credStatus === "verified";
  const credPending = credStatus === "pending";
  const credFailed = credStatus === "failed";
  const payoutsEnabled = serverStatus?.payouts.payoutsEnabled ?? false;
  const hasStripeAccount = serverStatus?.payouts.hasStripeAccount ?? false;
  const accountStatus = serverStatus?.serverStatus ?? "active";
  const isBlocked =
    accountStatus === "suspended" ||
    accountStatus === "inactive" ||
    accountStatus === "pending";
  const licenseExpiry = serverStatus?.licenseExpiry ?? null;
  const licenseDays = licenseExpiry
    ? Math.floor(
        (new Date(licenseExpiry + "T00:00:00Z").getTime() - Date.now()) /
          (1000 * 60 * 60 * 24),
      )
    : null;
  const showLicenseWarning =
    licenseDays !== null && licenseDays <= 30 && licenseDays >= 0;
  const licenseExpired = licenseDays !== null && licenseDays < 0;

  const totalJobs = summary?.totalJobs ?? 0;
  const completed = summary?.servedCount ?? 0;

  const statCards = [
    { value: String(totalJobs), label: "Total\nJobs", icon: <TrendingUp className="w-5 h-5 text-blue-500" />, bg: "bg-blue-50", href: "/app/server/job-feed" },
    { value: String(completed), label: "Completed", icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />, bg: "bg-emerald-50", href: "/app/server/job-feed" },
    { value: String(availableCount), label: "Available", icon: <Clock className="w-5 h-5 text-amber-500" />, bg: "bg-amber-50", href: "/app/server/job-feed" },
    { value: walletLabel, label: "Earnings\nWallet", icon: <Wallet className="w-5 h-5 text-violet-500" />, bg: "bg-violet-50", href: "/app/server/wallet" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Server Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Welcome back, {firstName} — your jobs and earnings at a glance.</p>
        </div>
        <Link href="/app/server/job-feed" className="flex items-center gap-2 px-4 py-2.5 bg-amber-400 hover:bg-amber-500 text-black font-semibold text-sm rounded-lg transition-colors shadow-sm">
          <Zap className="w-4 h-4" />Job Feed
        </Link>
      </div>

      {/* Account-status block (admin-controlled) */}
      {isBlocked && (
        <div
          data-testid="banner-server-blocked"
          className={cn(
            "rounded-2xl border p-5 flex items-start gap-4",
            accountStatus === "suspended"
              ? "bg-amber-50 border-amber-200"
              : accountStatus === "inactive"
              ? "bg-gray-100 border-gray-300"
              : "bg-blue-50 border-blue-200",
          )}
        >
          <div
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
              accountStatus === "suspended"
                ? "bg-amber-100"
                : accountStatus === "inactive"
                ? "bg-gray-200"
                : "bg-blue-100",
            )}
          >
            <ShieldAlert
              className={cn(
                "w-5 h-5",
                accountStatus === "suspended"
                  ? "text-amber-600"
                  : accountStatus === "inactive"
                  ? "text-gray-600"
                  : "text-blue-600",
              )}
            />
          </div>
          <div className="flex-1">
            <p className="font-bold text-sm text-gray-900">
              {accountStatus === "suspended"
                ? "Your account is suspended"
                : accountStatus === "inactive"
                ? "Your account is inactive"
                : "Your account is pending review"}
            </p>
            <p className="text-xs text-gray-700 mt-0.5">
              {accountStatus === "suspended"
                ? "You can't accept new jobs while suspended. Please contact support@servedlegal.com to resolve this."
                : accountStatus === "inactive"
                ? "This account has been deactivated. Email support@servedlegal.com if this was a mistake."
                : "An admin will activate your account shortly. You'll see the job feed unlock automatically."}
            </p>
          </div>
        </div>
      )}

      {(showLicenseWarning || licenseExpired) && (
        <div
          data-testid="banner-license-expiry"
          className={cn(
            "rounded-2xl border p-4 flex items-start gap-3",
            licenseExpired
              ? "bg-red-50 border-red-200"
              : "bg-amber-50 border-amber-200",
          )}
        >
          <ShieldAlert
            className={cn(
              "w-5 h-5 mt-0.5",
              licenseExpired ? "text-red-600" : "text-amber-600",
            )}
          />
          <div className="text-xs flex-1">
            <p
              className={cn(
                "font-bold",
                licenseExpired ? "text-red-900" : "text-amber-900",
              )}
            >
              {licenseExpired
                ? "Your driver's license is expired"
                : `Your driver's license expires in ${licenseDays} day${licenseDays === 1 ? "" : "s"}`}
            </p>
            <p
              className={cn(
                "mt-0.5",
                licenseExpired ? "text-red-700" : "text-amber-700",
              )}
            >
              Email a photo of your renewed license to support@servedlegal.com
              to keep your account active.
            </p>
          </div>
        </div>
      )}

      {/* Onboarding gates */}
      {!isBlocked && !isVerified && (
        <div className={cn(
          "rounded-2xl border p-5 flex items-start gap-4",
          credFailed ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200",
        )}>
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
            credFailed ? "bg-red-100" : "bg-amber-100",
          )}>
            {credFailed ? (
              <ShieldAlert className="w-5 h-5 text-red-600" />
            ) : credPending ? (
              <Clock className="w-5 h-5 text-amber-600" />
            ) : (
              <ShieldCheck className="w-5 h-5 text-amber-600" />
            )}
          </div>
          <div className="flex-1">
            <p className={cn("font-bold text-sm", credFailed ? "text-red-900" : "text-amber-900")}>
              {credFailed
                ? "Background check did not pass"
                : credPending
                ? "Background check in progress"
                : "Get verified to start earning"}
            </p>
            <p className={cn("text-xs mt-0.5", credFailed ? "text-red-700" : "text-amber-700")}>
              {credFailed
                ? "Contact support@servedlegal.com for next steps."
                : credPending
                ? "Most reports clear within 24 hours. We'll email you when you're cleared."
                : "Pay the one-time $24.99 background check to unlock the job feed."}
            </p>
          </div>
          {!credPending && !credFailed && (
            <Link
              href="/app/server/credentialing"
              data-testid="link-credentialing"
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors flex-shrink-0"
            >
              Get Verified <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      )}

      {!isBlocked && isVerified && !payoutsEnabled && (
        <div className="bg-sky-50 border border-sky-200 rounded-2xl p-5 flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center flex-shrink-0">
            <Banknote className="w-5 h-5 text-sky-600" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-sm text-sky-900">
              {hasStripeAccount ? "Finish your bank onboarding" : "Connect your bank to get paid"}
            </p>
            <p className="text-xs text-sky-700 mt-0.5">
              {hasStripeAccount
                ? "Stripe still needs a few more details before payouts can be released."
                : "Set up a Stripe Express payout account so we can transfer your 80% share automatically."}
            </p>
          </div>
          <ConnectOnboardButton payoutsEnabled={payoutsEnabled} hasStripeAccount={hasStripeAccount} />
        </div>
      )}

      {isVerified && payoutsEnabled && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <p className="text-xs text-emerald-800 font-semibold flex-1">
            Verified server · payouts enabled. You earn 80% of every completed job, transferred to your bank within ~2 business days.
          </p>
        </div>
      )}

      {/* Earnings banner */}
      <div className="rounded-2xl p-5 flex items-center gap-4 bg-brand-navy">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "rgba(245,158,11,0.15)" }}>
          <Wallet className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1">
          <div className="text-2xl font-black text-white">
            ${((wallet?.paidCents ?? 0) / 100).toFixed(2)}
          </div>
          <div className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>
            {(wallet?.paidCents ?? 0) > 0
              ? `Paid out · ${(wallet?.pendingCents ?? 0) > 0 ? `$${((wallet?.pendingCents ?? 0) / 100).toFixed(2)} pending` : "all caught up"}`
              : (wallet?.pendingCents ?? 0) > 0
                ? `$${((wallet?.pendingCents ?? 0) / 100).toFixed(2)} pending payout`
                : "Earnings will appear here once you complete a job"}
          </div>
        </div>
        <Link href="/app/server/wallet" className="flex items-center gap-2 px-4 py-2 rounded-lg border border-amber-400 text-amber-400 text-sm font-bold hover:bg-amber-400 hover:text-black transition-colors">
          <Wallet className="w-4 h-4" />Wallet
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((card) => (
          <Link key={card.label} href={card.href} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4 hover:shadow-md transition-shadow group">
            <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0", card.bg)}>{card.icon}</div>
            <div className="min-w-0">
              <div className="text-2xl font-black text-gray-900 leading-none">{card.value}</div>
              <div className="text-xs text-gray-500 mt-0.5 leading-tight whitespace-pre-line">{card.label}</div>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-300 ml-auto group-hover:text-gray-500 transition-colors" />
          </Link>
        ))}
      </div>

      {/* Job feed CTA */}
      <div className="rounded-2xl p-5 flex items-center gap-4 bg-brand-navy">
        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "rgba(255,255,255,0.1)" }}>
          <Users className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1">
          <p className="text-white font-bold text-sm">{summary?.activeServers ?? 0} Verified Process Servers Available</p>
          <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>Stay active to get priority job alerts</p>
        </div>
        <Link href="/app/server/job-feed" className="flex items-center gap-1.5 px-4 py-2 bg-white text-black font-semibold text-sm rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0">
          View Feed <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {/* My Jobs */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-gray-900">My Jobs</h2>
          <Link href="/app/server/job-feed" className="text-sm font-medium text-amber-600 hover:text-amber-700 flex items-center gap-1">
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="space-y-2">
          {recentJobs && recentJobs.length > 0 ? (
            recentJobs.map(job => (
              <JobCard key={job.id} job={{ id: job.id, status: job.status, recipientName: job.recipientName, documentType: job.documentType, recipientCity: job.recipientCity, recipientState: job.recipientState, caseNumber: job.caseNumber, serverPayoutCents: job.serverPayoutCents }} />
            ))
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
              No jobs yet. Check the job feed.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
