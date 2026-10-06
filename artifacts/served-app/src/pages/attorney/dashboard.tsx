import { Link } from "wouter";
import { useGetDashboardSummary, useGetRecentJobs, useGetMyFirmProfile } from "@workspace/api-client-react";
import {
  TrendingUp,
  CheckCircle2,
  Clock,
  Archive,
  MapPin,
  FileText,
  Users,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Navigation,
  AlertTriangle,
  Scale,
  CreditCard,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  served: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  pending_payment: "bg-rose-100 text-rose-700",
  in_progress: "bg-sky-100 text-sky-700",
  assigned: "bg-violet-100 text-violet-700",
  failed: "bg-red-100 text-red-700",
  accepted: "bg-teal-100 text-teal-700",
};

const STATUS_LABEL: Record<string, string> = {
  served: "Served",
  pending: "Pending",
  pending_payment: "Payment Required",
  in_progress: "In Progress",
  assigned: "Assigned",
  failed: "Failed",
  accepted: "Accepted",
};

function jobTitle(docType: string | null | undefined, recipientName: string) {
  if (!docType) return `Service — ${recipientName}`;
  const lower = docType.toLowerCase();
  if (lower.includes("eviction")) return "Eviction Notice Service";
  if (lower.includes("summons") || lower.includes("family")) return "Family Court Documents";
  if (lower.includes("small") || lower.includes("claim")) return `Small Claims — ${recipientName}`;
  if (lower.includes("subpoena")) return `Subpoena Service — Deposition`;
  if (lower.includes("divorce")) return "Divorce Petition Service";
  if (lower.includes("civil") || lower.includes("litigation")) return `Civil Litigation — ${recipientName} Case`;
  if (lower.includes("restraining")) return "Restraining Order Service";
  return `${docType} — ${recipientName}`;
}

// Format a job's snapshot price for the recent-jobs card. The price is
// stored as integer cents on the job (immutable snapshot taken at
// post-job time per the @workspace/pricing module). Previously this
// function guessed a price from the document type string ($120/$150)
// which had nothing to do with what the attorney was actually charged
// — a Standard $75 job would render as "$120". Render the real number.
function jobPrice(grossCents: number | null | undefined): string | null {
  if (typeof grossCents !== "number" || grossCents <= 0) return null;
  const dollars = grossCents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars}`
    : `$${dollars.toFixed(2)}`;
}

function jobType(docType: string | null | undefined) {
  if (!docType) return "Legal Service";
  const lower = docType.toLowerCase();
  if (lower.includes("civil") || lower.includes("litigation")) return "Civil Litigation";
  if (lower.includes("subpoena")) return "Subpoena";
  if (lower.includes("eviction")) return "Eviction";
  if (lower.includes("family") || lower.includes("summons")) return "Family Court";
  if (lower.includes("divorce")) return "Family Court";
  return docType;
}

function JobCard({
  job,
}: {
  job: {
    id: number;
    status: string;
    recipientName: string;
    documentType?: string | null;
    recipientCity?: string | null;
    recipientState?: string | null;
    caseNumber?: string | null;
    attemptCount?: number | null;
    grossCents?: number | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const status = job.status;
  const colorClass = STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600";
  const label = STATUS_LABEL[status] ?? status;
  const title = jobTitle(job.documentType, job.recipientName);
  const location =
    [job.recipientCity, job.recipientState].filter(Boolean).join(", ") ||
    "Henderson, NV";
  const isInProgress = status === "in_progress";
  const isEnRoute = status === "en_route";
  const attemptCount = job.attemptCount ?? 0;
  const showAttempts = (isInProgress || isEnRoute) && attemptCount > 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center px-5 py-4 gap-3">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm">{title}</span>
            <span
              className={cn(
                "text-xs font-semibold px-2 py-0.5 rounded-full",
                colorClass
              )}
            >
              {label}
            </span>
          </div>
          {showAttempts && (
            <div className="flex items-center gap-1 text-xs font-medium text-amber-600">
              <AlertTriangle className="w-3 h-3" />
              {attemptCount}/3 {attemptCount === 1 ? "Attempt" : "Attempts"}
            </div>
          )}
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <MapPin className="w-3 h-3" />
            <span>{location}</span>
            <span className="mx-1">·</span>
            <span>{jobType(job.documentType)}</span>
            {jobPrice(job.grossCents) && (
              <>
                <span className="mx-1">·</span>
                <span className="font-medium">{jobPrice(job.grossCents)}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isInProgress && (
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-500 text-black text-xs font-bold transition-colors">
              <Navigation className="w-3.5 h-3.5" />
              Navigate
            </button>
          )}
          {status === "served" && (
            <Link
              href={`/app/attorney/jobs/${job.id}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <CircleCheck className="w-3.5 h-3.5" />
              Proof
            </Link>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            {open ? (
              <ChevronUp className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            )}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Recipient</p>
              <p className="font-medium text-gray-800">{job.recipientName}</p>
            </div>
            {job.caseNumber && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Case Number</p>
                <p className="font-medium text-gray-800 font-mono text-xs">
                  {job.caseNumber}
                </p>
              </div>
            )}
          </div>
          <div className="mt-3">
            <Link
              href={`/app/attorney/jobs/${job.id}`}
              className="text-xs font-medium text-sky-600 hover:text-sky-700 flex items-center gap-1"
            >
              View Full Details <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AttorneyDashboard() {
  const { data: summary } = useGetDashboardSummary();
  const { data: recentJobs } = useGetRecentJobs({ limit: 5 });
  const { data: firmProfile } = useGetMyFirmProfile();
  const firmName = firmProfile?.firmName?.trim() ?? "";

  const totalJobs = summary?.totalJobs ?? 0;
  const completed = summary?.servedCount ?? 0;
  const pending = summary?.pendingJobs ?? 0;

  const statCards = [
    {
      value: String(totalJobs),
      label: "Total\nJobs",
      icon: <TrendingUp className="w-5 h-5 text-blue-500" />,
      bg: "bg-blue-50",
      href: "/app/attorney/jobs",
    },
    {
      value: String(completed),
      label: "Completed",
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
      bg: "bg-emerald-50",
      href: "/app/attorney/jobs",
    },
    {
      value: String(pending),
      label: "Pending",
      icon: <Clock className="w-5 h-5 text-amber-500" />,
      bg: "bg-amber-50",
      href: "/app/attorney/jobs",
    },
    {
      value: "Docs",
      label: "Archive",
      icon: <Archive className="w-5 h-5 text-indigo-400" />,
      bg: "bg-indigo-50",
      href: "/app/attorney/archive",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ProServe Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {firmName ? `${firmName} — ` : ""}active matters and service status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/app/attorney/archive"
            className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 font-semibold text-sm rounded-lg border border-gray-200 transition-colors"
          >
            <Archive className="w-4 h-4" />
            Archive
          </Link>
          <Link
            href="/app/attorney/post-job"
            className="flex items-center gap-2 px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-semibold text-sm rounded-lg transition-colors shadow-sm"
          >
            <FileText className="w-4 h-4" />
            Post a Job
          </Link>
        </div>
      </div>

      {/* ProServe Plan Banner */}
      <Link
        href="/app/attorney/subscription"
        className="flex items-center gap-4 px-5 py-4 bg-white rounded-xl border border-gray-200 hover:shadow-md transition-shadow group"
      >
        <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
          <Scale className="w-5 h-5 text-indigo-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">ProServe Plan</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Subscription &amp; billing — view your tier, per-serve discounted rates, and storage usage
          </p>
        </div>
        <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-gray-600 transition-colors" />
      </Link>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4 hover:shadow-md transition-shadow group"
          >
            <div
              className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                card.bg
              )}
            >
              {card.icon}
            </div>
            <div className="min-w-0">
              <div className="text-2xl font-black text-gray-900 leading-none">
                {card.value}
              </div>
              <div className="text-xs text-gray-500 mt-0.5 leading-tight whitespace-pre-line">
                {card.label}
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-300 ml-auto group-hover:text-gray-500 transition-colors" />
          </Link>
        ))}
      </div>

      {/* CTA Banner */}
      <div
        className="rounded-2xl p-5 flex items-center gap-4 bg-brand-navy"
      >
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
        >
          <Users className="w-5 h-5 text-sky-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm">
            {summary?.activeServers ?? 3} Verified Process Servers Available
          </p>
          <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>
            GPS-tracked, background-checked, and ready to serve your documents
          </p>
        </div>
        <Link
          href="/app/attorney/post-job"
          className="flex items-center gap-1.5 px-4 py-2 bg-white text-black font-semibold text-sm rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
        >
          Post a Job <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Recent Jobs */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-gray-900">Recent Jobs</h2>
          <Link
            href="/app/attorney/jobs"
            className="text-sm font-medium text-sky-600 hover:text-sky-700 flex items-center gap-1"
          >
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="space-y-2">
          {recentJobs && recentJobs.length > 0 ? (
            recentJobs.map((job) => (
              <JobCard
                key={job.id}
                job={{
                  id: job.id,
                  status: job.status,
                  recipientName: job.recipientName,
                  documentType: job.documentType,
                  recipientCity: job.recipientCity,
                  recipientState: job.recipientState,
                  caseNumber: job.caseNumber,
                  grossCents: job.grossCents,
                }}
              />
            ))
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
              No jobs yet. Post your first job above.
            </div>
          )}
        </div>
      </div>

      {/* Bottom quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href="/app/attorney/post-job"
          className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4 hover:shadow-sm transition-shadow"
        >
          <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
            <FileText className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <p className="font-bold text-gray-900 text-sm">Post a New Matter</p>
            <p className="text-xs text-gray-500 mt-1">File a service request for any case.</p>
          </div>
        </Link>
        <Link
          href="/app/attorney/archive"
          className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4 hover:shadow-sm transition-shadow"
        >
          <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <Archive className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <p className="font-bold text-gray-900 text-sm">Cloud Archive</p>
            <p className="text-xs text-gray-500 mt-1">Search affidavits by client or case.</p>
          </div>
        </Link>
        <Link
          href="/app/attorney/subscription"
          className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4 hover:shadow-sm transition-shadow"
        >
          <div className="w-10 h-10 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0">
            <CreditCard className="w-5 h-5 text-violet-500" />
          </div>
          <div>
            <p className="font-bold text-gray-900 text-sm">Subscription</p>
            <p className="text-xs text-gray-500 mt-1">Manage your ProServe plan &amp; billing.</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
