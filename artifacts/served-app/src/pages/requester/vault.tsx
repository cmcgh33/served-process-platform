import { useRef, useState, useCallback } from "react";
import {
  Lock,
  Upload,
  FileText,
  X,
  Download,
  Search,
  CheckCircle2,
  ShieldCheck,
  Archive,
  Briefcase,
  Check,
  CreditCard,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { redirectTopLevel } from "@/lib/external-redirect";
import {
  useGetPricing,
  useGetMyVaultSubscription,
  useCreateVaultCheckout,
  useCreatePortalSession,
} from "@workspace/api-client-react";
import { formatCentsUsd } from "@workspace/pricing";

interface VaultFile {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: Date;
  category: string;
}


interface VaultPlanDef {
  id: "basic" | "legal" | "pro";
  name: string;
  tagline: string;
  storage: string;
  features: string[];
  popular: boolean;
}

const VAULT_PLAN_DEFS: VaultPlanDef[] = [
  {
    id: "basic",
    name: "Basic Vault",
    tagline: "For one-time needs",
    storage: "5 GB secure storage",
    features: [
      "5 GB secure document storage",
      "Organize by category or date",
      "Download anytime, anywhere",
      "Serve history included",
    ],
    popular: false,
  },
  {
    id: "legal",
    name: "Legal Vault",
    tagline: "Most popular for individuals",
    storage: "25 GB secure storage",
    features: [
      "25 GB secure document storage",
      "All Basic Vault features",
      "Share securely with your attorney",
      "E-sign ready documents",
      "Organize by case or matter",
      "7-year document retention",
    ],
    popular: true,
  },
  {
    id: "pro",
    name: "Pro Vault",
    tagline: "For long-term peace of mind",
    storage: "100 GB secure storage",
    features: [
      "100 GB secure document storage",
      "All Legal Vault features",
      "Unlimited matters & categories",
      "Full audit trail & access log",
      "Priority support",
      "Store any legal document type",
    ],
    popular: false,
  },
];

const CATEGORIES = ["All", "Court Records", "Divorce Papers", "Deeds", "Evidence", "Other"];

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type VaultPlanId = "basic" | "legal" | "pro";
const VAULT_PLAN_ORDER: VaultPlanId[] = ["basic", "legal", "pro"];
const DEFAULT_VAULT_PLAN_ID: VaultPlanId = "legal";

export default function RequesterVault() {
  const { data: pricing } = useGetPricing();
  const { data: mySub, refetch: refetchSub } = useGetMyVaultSubscription();
  const checkout = useCreateVaultCheckout();
  const portal = useCreatePortalSession();

  // Only treat the row as "current" when Stripe is actively billing it.
  // (Stripe "trialing" is normalized server-side to "active" before persisting.)
  const isActive = mySub?.status === "active";
  const currentPlanId: VaultPlanId | null = isActive
    ? ((mySub?.tier as VaultPlanId | undefined) ?? null)
    : null;

  const [tab, setTab] = useState<"archive" | "personal">("archive");
  const [selectedPlan, setSelectedPlan] = useState<VaultPlanId>(
    currentPlanId ?? DEFAULT_VAULT_PLAN_ID,
  );
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles: VaultFile[] = Array.from(fileList).map((f) => ({
      id: `${f.name}-${Date.now()}`,
      name: f.name,
      size: f.size,
      type: f.type,
      uploadedAt: new Date(),
      category: "Other",
    }));
    setFiles((prev) => [...newFiles, ...prev]);
  }, []);

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const filtered = files.filter(
    (f) =>
      (category === "All" || f.category === category) &&
      f.name.toLowerCase().includes(search.toLowerCase())
  );

  const chosenPlan = VAULT_PLAN_DEFS.find((p) => p.id === selectedPlan)!;
  const hasCurrent = currentPlanId !== null;
  const isUpgrade = !hasCurrent || selectedPlan !== currentPlanId;
  const isDowngrade =
    hasCurrent &&
    VAULT_PLAN_ORDER.indexOf(selectedPlan) <
      VAULT_PLAN_ORDER.indexOf(currentPlanId);

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
          SERVED.
        </span>
        <span className="text-xs text-gray-400">/</span>
        <span className="flex items-center gap-1.5 text-xs font-bold text-gray-600 bg-white border border-gray-200 px-2.5 py-1 rounded-full">
          <Lock className="w-3 h-3" />Document Vault
        </span>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Cloud Document Archive</h1>
        <p className="text-sm text-gray-500 mt-1 max-w-xl">
          Secure, searchable storage for every legal document — served affidavits, personal records, and everything in between.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab("archive")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
            tab === "archive" ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-700"
          )}
        >
          <Archive className="w-4 h-4" />Case Archive
        </button>
        <button
          onClick={() => setTab("personal")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
            tab === "personal" ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-700"
          )}
        >
          <Lock className="w-4 h-4" />Personal Vault
        </button>
      </div>

      {/* Safety deposit box info */}
      <div className="flex items-start gap-4 p-5 bg-amber-50 border border-amber-200 rounded-2xl">
        <div className="w-9 h-9 rounded-lg bg-white border border-amber-200 flex items-center justify-center flex-shrink-0">
          <ShieldCheck className="w-4.5 h-4.5 text-amber-500" />
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900">Your Legal Safety Deposit Box</p>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">
            Store every important document in one secure place — divorce papers, property deeds, passports, car titles, medical records. Access anytime. Share securely with your attorney. Documents stored on SERVED. carry a <strong>7-year retention guarantee</strong> to meet standard legal requirements.
          </p>
        </div>
      </div>

      {/* Plan selection */}
      <div>
        <h2 className="text-base font-bold text-gray-900 mb-3">Choose Your Vault Plan</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {VAULT_PLAN_DEFS.map((plan) => {
            const isCurrent = plan.id === currentPlanId;
            const isSelected = plan.id === selectedPlan;
            const monthlyCents = pricing?.vaultPlans?.[plan.id]?.monthlyCents;
            const priceLabel =
              monthlyCents != null ? formatCentsUsd(monthlyCents) : "—";
            return (
              <button
                key={plan.id}
                onClick={() => setSelectedPlan(plan.id)}
                className={cn(
                  "relative text-left rounded-2xl border p-5 flex flex-col transition-all hover:shadow-md",
                  isSelected
                    ? "border-amber-400 shadow-md bg-white"
                    : "border-gray-200 bg-white"
                )}
              >
                {/* Popular badge */}
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-amber-400 text-black text-[10px] font-black tracking-widest uppercase rounded-full whitespace-nowrap">
                    Most Popular
                  </div>
                )}

                {/* Current plan checkmark */}
                {isCurrent && (
                  <div className="absolute top-4 right-4">
                    <div className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center">
                      <Check className="w-3 h-3 text-black" />
                    </div>
                  </div>
                )}

                {/* Icon */}
                <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center mb-3", isSelected ? "bg-amber-50" : "bg-gray-100")}>
                  {plan.id === "basic" ? (
                    <Archive className={cn("w-4 h-4", isSelected ? "text-amber-500" : "text-gray-400")} />
                  ) : plan.id === "legal" ? (
                    <ShieldCheck className={cn("w-4 h-4", isSelected ? "text-amber-500" : "text-gray-400")} />
                  ) : (
                    <Lock className={cn("w-4 h-4", isSelected ? "text-amber-500" : "text-gray-400")} />
                  )}
                </div>

                {/* Name */}
                <p className="text-sm font-bold text-gray-900">{plan.name}</p>
                <p className="text-xs text-gray-400 mt-0.5 mb-3">{plan.tagline}</p>

                {/* Price */}
                <div className="flex items-end gap-1 mb-1">
                  <span className="text-2xl font-black text-gray-900">{priceLabel}</span>
                  <span className="text-xs text-gray-400 mb-1">/mo</span>
                </div>
                <p className="text-xs text-gray-500 mb-4">{plan.storage}</p>

                {/* Features */}
                <ul className="space-y-1.5 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-gray-600">
                      <CheckCircle2 className={cn("w-3.5 h-3.5 flex-shrink-0 mt-0.5", isSelected ? "text-amber-500" : "text-emerald-400")} />
                      {f}
                    </li>
                  ))}
                </ul>

                {isCurrent && (
                  <div className="mt-4 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-center text-xs font-bold text-amber-700">
                    ✓ Current Plan
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* CTA */}
        <div className="mt-4 flex justify-end items-center gap-3">
          {hasCurrent && (
            <button
              type="button"
              onClick={() => {
                portal.mutate(undefined, {
                  onSuccess: (resp) => {
                    const r = resp as { url?: string };
                    if (r.url) redirectTopLevel(r.url);
                  },
                });
              }}
              disabled={portal.isPending}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold text-sm rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {portal.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CreditCard className="w-4 h-4" />
              )}
              Manage Billing
            </button>
          )}
          {selectedPlan !== currentPlanId ? (
            <button
              type="button"
              onClick={() => {
                checkout.mutate(
                  { data: { tier: selectedPlan } },
                  {
                    onSuccess: (resp) => {
                      const r = resp as { mode?: string; url?: string | null };
                      if (r.mode === "checkout" && r.url) {
                        redirectTopLevel(r.url);
                        return;
                      }
                      void refetchSub();
                    },
                  },
                );
              }}
              disabled={checkout.isPending}
              className="flex items-center gap-2 px-6 py-3 bg-amber-400 hover:bg-amber-500 text-black font-bold text-sm rounded-xl transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {checkout.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Redirecting…
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  {!hasCurrent
                    ? `Subscribe to ${chosenPlan.name}`
                    : isDowngrade
                      ? `Downgrade to ${chosenPlan.name}`
                      : `Upgrade to ${chosenPlan.name}`}
                </>
              )}
            </button>
          ) : (
            <div className="flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-500 text-sm font-semibold rounded-xl">
              <Check className="w-4 h-4" />
              You're on {chosenPlan.name}
            </div>
          )}
        </div>
      </div>

      {/* My Documents */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-gray-900">My Documents</h2>
          <button
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-amber-400 hover:bg-amber-500 text-black font-semibold text-sm rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" />Upload
          </button>
          <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="hidden" onChange={(e) => addFiles(e.target.files)} />
        </div>

        {/* Storage meter */}
        {(() => {
          const storageGb =
            isActive && currentPlanId
              ? (pricing?.vaultPlans?.[currentPlanId]?.storageGb ?? 0)
              : 0;
          const usedGb = isActive ? 1.2 : 0;
          const usedPct =
            storageGb > 0
              ? Math.min(100, Math.round((usedGb / storageGb) * 1000) / 10)
              : 0;
          const planLabel =
            isActive && currentPlanId
              ? VAULT_PLAN_DEFS.find((p) => p.id === currentPlanId)?.name
              : null;
          return (
            <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 mb-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                <span>Storage used</span>
                <span className="font-semibold text-gray-700">
                  {isActive ? `${usedGb} GB / ${storageGb} GB` : "No active vault plan"}
                </span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400 rounded-full"
                  style={{ width: `${usedPct}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1.5">
                {planLabel
                  ? `${planLabel} plan · ${(storageGb - usedGb).toFixed(1)} GB remaining`
                  : "Subscribe to a vault plan above to start storing documents."}
              </p>
            </div>
          );
        })()}

        {/* Upload zone */}
        <div
          className={cn(
            "border-2 border-dashed rounded-2xl p-6 text-center transition-colors cursor-pointer mb-4",
            dragging
              ? "border-amber-400 bg-amber-50"
              : "border-gray-200 hover:border-amber-300 hover:bg-amber-50/40 bg-white"
          )}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center">
              <Upload className="w-4.5 h-4.5 text-amber-500" />
            </div>
            <p className="text-sm font-semibold text-gray-700">
              Drop documents here or <span className="text-amber-600">browse</span>
            </p>
            <p className="text-xs text-gray-400">PDF, JPG, PNG, DOC — encrypted at rest</p>
          </div>
        </div>

        {/* Search + filter */}
        <div className="flex gap-3 flex-wrap items-center mb-4">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search documents..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                  category === c
                    ? "bg-amber-400 text-black"
                    : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* File list */}
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <Lock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No documents found.</p>
            </div>
          ) : (
            filtered.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-4 px-5 py-3.5 bg-white border border-gray-200 rounded-xl hover:shadow-sm transition-shadow"
              >
                <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4 h-4 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{f.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {f.category} · {formatSize(f.size)} · {formatDate(f.uploadedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
                    Encrypted
                  </span>
                  <button className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-700">
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => removeFile(f.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-gray-300 hover:text-red-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ProServe upsell */}
        <div className="mt-6 flex items-start gap-4 p-5 rounded-2xl bg-brand-navy">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "rgba(245,158,11,0.15)" }}>
            <Briefcase className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-white">Need attorney-level archive?</p>
            <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>
              Upgrade to ProServe for matter-based organization, e-sign, audit logs, and shared access across your legal team.
            </p>
          </div>
          <button className="flex-shrink-0 px-3 py-2 bg-amber-400 hover:bg-amber-500 text-black text-xs font-bold rounded-lg transition-colors">
            Learn More
          </button>
        </div>
      </div>
    </div>
  );
}
