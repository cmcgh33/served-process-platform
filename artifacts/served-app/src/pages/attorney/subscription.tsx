import { useState } from "react";
import {
  Scale,
  CheckCircle2,
  CreditCard,
  Zap,
  Building2,
  FileText,
  BarChart3,
  ArrowRight,
  Phone,
  Users,
  Shield,
  Star,
  Loader2,
  HardDrive,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { redirectTopLevel } from "@/lib/external-redirect";
import {
  useGetPricing,
  useGetMySubscription,
  useCreateProServeCheckout,
  useCreatePortalSession,
  useGetDashboardSummary,
  useGetDocumentUsage,
} from "@workspace/api-client-react";
import { formatCentsUsd, type ProServeTier } from "@workspace/pricing";

// Plan feature/marketing copy is static here. All prices come from the
// pricing API so the UI cannot drift from what Stripe will charge.

interface PlanDefinition {
  id: string;
  name: string;
  popular: boolean;
  enterprise: boolean;
  cta: string;
  features: string[];
}

const PLAN_DEFS: PlanDefinition[] = [
  {
    id: "solo",
    name: "Solo",
    popular: false,
    enterprise: false,
    cta: "Start Solo",
    features: [
      "Discounted per-serve rates",
      "5 GB cloud document storage included",
      "Case number + matter tracking",
      "Affidavit auto-generation",
      "Email proof of service",
      "Standard & rush jobs",
    ],
  },
  {
    id: "firm",
    name: "Firm",
    popular: true,
    enterprise: false,
    cta: "Start Firm",
    features: [
      "Better per-serve rates",
      "25 GB cloud document storage included",
      "Bulk job posting",
      "Case search by client / case number",
      "Priority server matching",
      "Licensed-tier job access",
      "Billing dashboard + invoice export",
      "Dedicated support",
    ],
  },
  {
    id: "firm_pro",
    name: "Firm Pro",
    popular: false,
    enterprise: false,
    cta: "Start Firm Pro",
    features: [
      "Best per-serve rates",
      "100 GB cloud document storage included",
      "All Firm features",
      "Same-day rush access",
      "Multi-user firm accounts",
      "API access for case management integrations",
      "Custom reporting",
      "Account manager assigned",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    popular: false,
    enterprise: true,
    cta: "Contact Sales",
    features: [
      "Volume-based per-serve rate (negotiated)",
      "Custom cloud storage allocation",
      "All Firm Pro features",
      "SLA guarantee",
      "Dedicated API + webhook support",
      "Custom onboarding + training",
      "White-label affidavit templates",
    ],
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

const TIER_LABELS: Record<string, string> = {
  solo: "Solo",
  firm: "Firm",
  firm_pro: "Firm Pro",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

interface UsageCardProps {
  tier: string;
  renewsAt: Date | null;
  servesThisMonth: number;
  // null when the pricing API is still loading or returns an unknown tier;
  // rendered as "—" so a misconfigured tier never advertises free serves.
  standardRateCents: number | null;
  storageUsedBytes: number;
  // -1 means unlimited.
  storageQuotaBytes: number;
  onManageBilling: () => void;
  isOpeningPortal: boolean;
}

function UsageCard(props: UsageCardProps) {
  const renewsLabel = props.renewsAt
    ? props.renewsAt.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  const isUnlimitedStorage = props.storageQuotaBytes < 0;
  const storagePct = isUnlimitedStorage
    ? 0
    : props.storageQuotaBytes > 0
      ? Math.min(100, Math.round((props.storageUsedBytes / props.storageQuotaBytes) * 100))
      : 0;
  const storageBarColor =
    storagePct >= 90 ? "bg-red-400" : storagePct >= 70 ? "bg-amber-400" : "bg-sky-400";

  return (
    <div className="bg-white rounded-2xl border border-sky-300 shadow-sm p-6">
      {/* Header row */}
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center flex-shrink-0">
            <Scale className="w-5 h-5 text-sky-500" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">
              ProServe {TIER_LABELS[props.tier] ?? props.tier}
            </p>
            <p className="text-xs text-gray-500">
              Billing renews {renewsLabel}
            </p>
          </div>
        </div>
        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
          Active
        </span>
      </div>

      {/* Stats — informational only. No allowance/cap on serves; storage is bundled with the plan. */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-gray-50 rounded-xl p-4 text-center">
          <div className="text-2xl font-black text-gray-900">{props.servesThisMonth}</div>
          <div className="text-xs text-gray-500 mt-0.5">Serves This Month</div>
        </div>
        <div className="bg-gray-50 rounded-xl p-4 text-center">
          <div className="text-2xl font-black text-sky-600">
            {props.standardRateCents != null
              ? formatCentsUsd(props.standardRateCents)
              : "—"}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">Per Standard Serve</div>
        </div>
        <div className="bg-gray-50 rounded-xl p-4 text-center">
          <div className="text-2xl font-black text-gray-900">
            {isUnlimitedStorage
              ? "∞"
              : `${formatBytes(props.storageUsedBytes)}`}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {isUnlimitedStorage
              ? "Storage (unlimited)"
              : `of ${formatBytes(props.storageQuotaBytes)}`}
          </div>
        </div>
      </div>

      {/* Storage usage bar — only thing in this card with a real quota now. */}
      {!isUnlimitedStorage && (
        <div className="mb-5">
          <div className="flex justify-between text-xs text-gray-500 mb-1.5">
            <span className="flex items-center gap-1.5">
              <HardDrive className="w-3 h-3" />
              Cloud storage — included with plan
            </span>
            <span className={cn("font-semibold", storagePct >= 90 ? "text-red-500" : storagePct >= 70 ? "text-amber-500" : "text-gray-500")}>
              {storagePct}%
            </span>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", storageBarColor)} style={{ width: `${storagePct}%` }} />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={props.onManageBilling}
          disabled={props.isOpeningPortal}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {props.isOpeningPortal ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CreditCard className="w-4 h-4" />
          )}
          Manage Billing
        </button>
        <button
          type="button"
          onClick={props.onManageBilling}
          disabled={props.isOpeningPortal}
          className="flex items-center gap-2 px-4 py-2 border border-gray-200 bg-white text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <FileText className="w-4 h-4" />
          Download Invoice
        </button>
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">How ProServe Works</p>
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 flex items-start gap-3">
          <div className="w-7 h-7 rounded-full bg-sky-100 text-sky-600 text-xs font-black flex items-center justify-center flex-shrink-0">1</div>
          <div>
            <p className="text-sm font-bold text-gray-800">Pick a tier</p>
            <p className="text-xs text-gray-500 mt-0.5">A flat monthly fee unlocks discounted per-serve rates and bundled cloud storage. No serve cap, no overage math.</p>
          </div>
        </div>
        <div className="hidden sm:block w-px bg-gray-100" />
        <div className="flex-1 flex items-start gap-3">
          <div className="w-7 h-7 rounded-full bg-sky-100 text-sky-600 text-xs font-black flex items-center justify-center flex-shrink-0">2</div>
          <div>
            <p className="text-sm font-bold text-gray-800">Pay per serve at your tier rate</p>
            <p className="text-xs text-gray-500 mt-0.5">Every serve bills at your tier's discounted rate. Higher tiers = lower per-serve rates. Switch tiers anytime as your volume grows.</p>
          </div>
        </div>
        <div className="hidden sm:block w-px bg-gray-100" />
        <div className="flex-1 flex items-start gap-3">
          <div className="w-7 h-7 rounded-full bg-sky-100 text-sky-600 text-xs font-black flex items-center justify-center flex-shrink-0">3</div>
          <div>
            <p className="text-sm font-bold text-gray-800">High-volume? Talk to sales</p>
            <p className="text-xs text-gray-500 mt-0.5">Enterprise unlocks negotiated volume rates plus custom storage, SLA, and API support — no fixed serve cap.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function RateCell({
  label,
  cents,
  publicCents,
  className,
}: {
  label: string;
  cents: number | null;
  publicCents: number | null;
  className?: string;
}) {
  const showSavings =
    cents != null && publicCents != null && cents < publicCents;
  return (
    <div className={className}>
      <p className="text-base font-black text-sky-600 leading-tight">
        {cents != null ? formatCentsUsd(cents) : "—"}
      </p>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5 font-semibold">
        {label}
      </p>
      {/* Reserve the third row so cell heights stay aligned across the grid. */}
      <p className="text-[10px] text-gray-500 mt-0.5">
        {showSavings ? (
          <>
            <span className="line-through">{formatCentsUsd(publicCents!)}</span>{" "}
            <span className="text-gray-400">public</span>
          </>
        ) : (
          <span className="invisible">—</span>
        )}
      </p>
    </div>
  );
}

interface ServeRates {
  standardCents: number | null;
  rushCents: number | null;
  licensedCents: number | null;
  publicStandardCents: number | null;
  publicRushCents: number | null;
  publicLicensedCents: number | null;
}

interface PlanCardProps {
  plan: PlanDefinition;
  priceLabel: string;
  periodLabel: string;
  rates: ServeRates;
  isCurrent: boolean;
  onSubscribe: () => void;
  isLoading: boolean;
  isAnyLoading: boolean;
}

function PlanCard({
  plan,
  priceLabel,
  periodLabel,
  rates,
  isCurrent,
  onSubscribe,
  isLoading,
  isAnyLoading,
}: PlanCardProps) {
  const isPopular = plan.popular;
  const isEnterprise = plan.enterprise;

  return (
    <div
      className={cn(
        "bg-white rounded-2xl border p-6 relative flex flex-col transition-shadow",
        isCurrent
          ? "border-sky-400 shadow-lg"
          : isPopular
          ? "border-sky-200"
          : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
      )}
    >
      {/* Badges */}
      <div className="flex items-center gap-2 mb-4 min-h-[24px]">
        {isPopular && !isCurrent && (
          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 border border-sky-200 flex items-center gap-1">
            <Star className="w-2.5 h-2.5" /> Most Popular
          </span>
        )}
        {isCurrent && (
          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-sky-500 text-white flex items-center gap-1">
            <CheckCircle2 className="w-2.5 h-2.5" /> Current Plan
          </span>
        )}
      </div>

      {/* Plan name & price */}
      <div className="mb-5">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">{plan.name}</p>
        <div className="flex items-end gap-1">
          <span className="text-3xl font-black text-gray-900">{priceLabel}</span>
          {periodLabel && <span className="text-sm text-gray-500 mb-1">{periodLabel}</span>}
        </div>

        {/* Per-serve rate grid — the core value prop on the new model. Each
            tier shows its discounted standard / rush / licensed rate, with
            the public reference rate in strikethrough underneath so the
            savings are visually obvious. Enterprise shows a "volume rates"
            badge instead since rates are negotiated. */}
        {!isEnterprise ? (
          <div className="grid grid-cols-3 divide-x divide-gray-100 mt-3 text-center">
            <RateCell label="Standard" cents={rates.standardCents} publicCents={rates.publicStandardCents} className="pr-2" />
            <RateCell label="Rush" cents={rates.rushCents} publicCents={rates.publicRushCents} className="px-2" />
            <RateCell label="Licensed" cents={rates.licensedCents} publicCents={rates.publicLicensedCents} className="pl-2" />
          </div>
        ) : (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">Volume Rates</span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">Negotiated</span>
          </div>
        )}
      </div>

      {/* Features */}
      <ul className="space-y-2 flex-1 mb-6">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-xs text-gray-600">
            <CheckCircle2 className={cn("w-3.5 h-3.5 flex-shrink-0 mt-0.5", isCurrent ? "text-sky-500" : "text-emerald-500")} />
            {f}
          </li>
        ))}
      </ul>

      {/* CTA */}
      {isEnterprise ? (
        <a
          href="mailto:sales@served.app?subject=Enterprise%20ProServe%20inquiry"
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <Phone className="w-4 h-4" />
          {plan.cta}
        </a>
      ) : isCurrent ? (
        <button
          type="button"
          disabled
          className="w-full py-3 rounded-xl bg-sky-500 text-white text-sm font-semibold cursor-default opacity-90"
        >
          {plan.cta}
        </button>
      ) : (
        <button
          type="button"
          onClick={onSubscribe}
          disabled={isAnyLoading}
          className="w-full py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Redirecting…
            </>
          ) : (
            <>
              {plan.cta}
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

function SavingsExample({
  firmProMonthlyCents,
  firmProStandardCents,
  publicStandardCents,
}: {
  firmProMonthlyCents: number | null;
  firmProStandardCents: number | null;
  publicStandardCents: number | null;
}) {
  const sampleServes = 50;

  const ready =
    firmProMonthlyCents != null &&
    firmProStandardCents != null &&
    publicStandardCents != null;

  const subscriberCost = ready
    ? firmProMonthlyCents! + sampleServes * firmProStandardCents!
    : null;
  const publicCost = ready ? sampleServes * publicStandardCents! : null;
  const savings =
    subscriberCost != null && publicCost != null
      ? Math.max(0, publicCost - subscriberCost)
      : null;

  return (
    <div className="bg-gray-900 rounded-2xl p-6 text-white">
      <div className="flex items-start gap-4">
        <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
          <BarChart3 className="w-4 h-4 text-sky-400" />
        </div>
        <div>
          <p className="text-sm font-bold">Savings Example</p>
          {ready ? (
            <p className="text-xs text-gray-400 mt-1 leading-relaxed max-w-prose">
              A Firm Pro subscriber ({formatCentsUsd(firmProMonthlyCents!)}/mo) running{" "}
              {sampleServes} standard serves in a month pays{" "}
              {formatCentsUsd(firmProMonthlyCents!)} +{" "}
              {sampleServes} × {formatCentsUsd(firmProStandardCents!)} ={" "}
              <span className="text-white font-bold">
                {formatCentsUsd(subscriberCost!)}
              </span>
              . Same {sampleServes} serves at public rates would cost{" "}
              {sampleServes} × {formatCentsUsd(publicStandardCents!)} ={" "}
              <span className="text-white font-bold">
                {formatCentsUsd(publicCost!)}
              </span>
              . That's{" "}
              <span className="text-emerald-400 font-bold">
                {formatCentsUsd(savings!)} saved this month
              </span>
              {" "}— and there's no serve cap, so the savings keep scaling. Past a few hundred serves a month, talk to sales about Enterprise volume rates.
            </p>
          ) : (
            <p className="text-xs text-gray-400 mt-1">Loading example…</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AttorneySubscription() {
  const { data: pricing } = useGetPricing();
  const { data: mySub, refetch: refetchSub } = useGetMySubscription();
  const { data: dashboard } = useGetDashboardSummary();
  const { data: storage } = useGetDocumentUsage();
  const checkout = useCreateProServeCheckout();
  const portal = useCreatePortalSession();
  const [pendingTier, setPendingTier] = useState<string | null>(null);

  // Only "active" subs put the user on discounted per-serve rates.
  // canceled / incomplete fall back to public rates. ("trialing" is normalized
  // to "active" server-side before persisting.)
  const isActive = mySub?.status === "active";
  const currentTier: string | null = isActive ? mySub?.tier ?? null : null;

  const subscribe = (tier: string) => {
    setPendingTier(tier);
    checkout.mutate(
      { data: { tier: tier as "solo" | "firm" | "firm_pro" } },
      {
        onSuccess: (resp) => {
          const r = resp as { mode?: string; url?: string | null };
          if (r.mode === "checkout" && r.url) {
            redirectTopLevel(r.url);
            return;
          }
          // Plan was switched in place — refresh local state.
          void refetchSub();
          setPendingTier(null);
        },
        onError: () => setPendingTier(null),
      },
    );
  };

  const openPortal = () => {
    portal.mutate(undefined, {
      onSuccess: (resp) => {
        const r = resp as { url?: string };
        if (r.url) redirectTopLevel(r.url);
      },
    });
  };

  const renewsAt =
    isActive && mySub?.currentPeriodEnd
      ? new Date(mySub.currentPeriodEnd)
      : null;

  // Standard per-serve rate for the active tier. Returns null (rendered as
  // "—") on unknown tier or before the pricing API has loaded, so we never
  // falsely advertise $0.00.
  const standardRateCents: number | null = (() => {
    if (!currentTier || !pricing?.servePricesCents) return null;
    const tierRates = pricing.servePricesCents[currentTier as ProServeTier];
    return tierRates?.standard ?? null;
  })();

  const publicRates = pricing?.servePricesCents?.public;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">ProServe Subscription Plans</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          A flat monthly fee unlocks discounted per-serve rates and bundled cloud storage for affidavits and case files. No serve cap, no overage — just better unit economics as you scale.
        </p>
      </div>

      {/* Current plan card — active subscription only. */}
      {isActive && currentTier && (
        <UsageCard
          tier={currentTier}
          renewsAt={renewsAt}
          servesThisMonth={dashboard?.servedThisMonth ?? 0}
          standardRateCents={standardRateCents}
          storageUsedBytes={storage?.usedBytes ?? 0}
          storageQuotaBytes={storage?.quotaBytes ?? 0}
          onManageBilling={openPortal}
          isOpeningPortal={portal.isPending}
        />
      )}

      {/* How ProServe works */}
      <HowItWorks />

      {/* Plan cards — 4 columns */}
      <div>
        <h2 className="text-sm font-bold text-gray-700 mb-3">Attorney Plans</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {PLAN_DEFS.map((plan) => {
            const monthlyCents = plan.enterprise
              ? null
              : pricing?.proServeMonthlyCents?.[plan.id];
            const priceLabel = plan.enterprise
              ? "Custom"
              : monthlyCents != null
                ? formatCentsUsd(monthlyCents)
                : "—";
            const periodLabel = plan.enterprise ? "" : "/mo";
            const isCurrent = !plan.enterprise && plan.id === currentTier;
            const cta = isCurrent
              ? "Current Plan"
              : isActive && !plan.enterprise
                ? `Switch to ${plan.name}`
                : plan.cta;
            const isLoading =
              checkout.isPending && pendingTier === plan.id;

            // Enterprise has no fixed rates → all null → renders "Volume Rates".
            const tierRates = plan.enterprise
              ? null
              : pricing?.servePricesCents?.[plan.id as ProServeTier];
            const rates: ServeRates = {
              standardCents: tierRates?.standard ?? null,
              rushCents: tierRates?.rush ?? null,
              licensedCents: tierRates?.licensed ?? null,
              publicStandardCents: publicRates?.standard ?? null,
              publicRushCents: publicRates?.rush ?? null,
              publicLicensedCents: publicRates?.licensed ?? null,
            };

            return (
              <PlanCard
                key={plan.id}
                plan={{ ...plan, cta }}
                priceLabel={priceLabel}
                periodLabel={periodLabel}
                rates={rates}
                isCurrent={isCurrent}
                onSubscribe={() => subscribe(plan.id)}
                isLoading={isLoading}
                isAnyLoading={checkout.isPending}
              />
            );
          })}
        </div>
      </div>

      {/* Worked savings example */}
      <SavingsExample
        firmProMonthlyCents={pricing?.proServeMonthlyCents?.firm_pro ?? null}
        firmProStandardCents={
          pricing?.servePricesCents?.firm_pro?.standard ?? null
        }
        publicStandardCents={publicRates?.standard ?? null}
      />

      {/* Feature callouts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4">
          <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-sky-500" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Priority Dispatch</p>
            <p className="text-xs text-gray-500 mt-1">
              ProServe jobs go to the front of the queue — average assign time under 2 hours.
            </p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-4 h-4 text-indigo-500" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Multi-Attorney Firms</p>
            <p className="text-xs text-gray-500 mt-1">
              Add team members, assign cases by attorney, and see consolidated billing across your firm.
            </p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <Shield className="w-4 h-4 text-emerald-500" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">GPS-Verified Affidavits</p>
            <p className="text-xs text-gray-500 mt-1">
              All serves include GPS-verified proof of service, real-time tracking, and cloud archival.
            </p>
          </div>
        </div>
      </div>

      {/* Enterprise CTA */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
            <Users className="w-5 h-5 text-gray-500" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Enterprise & High-Volume Filers</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Custom contracts for debt collection firms, court services departments, and high-volume filers. Includes negotiated volume rates, custom storage allocation, SLA guarantee, and dedicated API support.
            </p>
          </div>
        </div>
        <button className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors whitespace-nowrap flex-shrink-0">
          <Phone className="w-4 h-4" />
          Contact Sales
        </button>
      </div>
    </div>
  );
}
