import { Link } from "wouter";
import { useGetDashboardSummary, useGetRecentJobs } from "@workspace/api-client-react";
import {
  TrendingUp,
  CheckCircle2,
  Clock,
  Lock,
  MapPin,
  ChevronDown,
  ChevronUp,
  FilePlus,
  FileText,
  Users,
  ArrowRight,
  CircleCheck,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  served: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  in_progress: "bg-sky-100 text-sky-700",
  assigned: "bg-violet-100 text-violet-700",
  failed: "bg-red-100 text-red-700",
  accepted: "bg-teal-100 text-teal-700",
};

const STATUS_LABEL: Record<string, string> = {
  served: "Served",
  pending: "Pending",
  in_progress: "In Progress",
  assigned: "Assigned",
  failed: "Failed",
  accepted: "Accepted",
};

const DOC_TYPES: Record<string, string> = {
  summons: "Family Court",
  subpoena: "Subpoena",
  eviction: "Eviction",
  small_claims: "Small Claims",
  default: "Legal Docs",
};

function jobTypeLabel(docType: string | null | undefined) {
  if (!docType) return "Legal Docs";
  const key = docType.toLowerCase().replace(/\s+/g, "_");
  return DOC_TYPES[key] ?? docType;
}

function jobTitle(docType: string | null | undefined, recipientName: string) {
  if (!docType) return `Serve Documents — ${recipientName}`;
  const lower = docType.toLowerCase();
  if (lower.includes("eviction")) return "Serve Eviction Notice";
  if (lower.includes("summons")) return "Serve Family Court Documents";
  if (lower.includes("small") || lower.includes("claim")) return `Small Claims — ${recipientName}`;
  if (lower.includes("subpoena")) return `Subpoena — ${recipientName}`;
  return `Serve ${docType}`;
}

// Render the real customer-facing snapshot price stored on the job (in
// cents). The previous doc-type guess returned $75/$95 regardless of
// what tier the requester actually paid for.
function jobPrice(grossCents: number | null | undefined): string | null {
  if (typeof grossCents !== "number" || grossCents <= 0) return null;
  const dollars = grossCents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars}`
    : `$${dollars.toFixed(2)}`;
}

function JobCard({ job }: { job: { id: number; status: string; recipientName: string; documentType?: string | null; recipientCity?: string | null; recipientState?: string | null; grossCents?: number | null } }) {
  const [open, setOpen] = useState(false);
  const status = job.status;
  const colorClass = STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600";
  const label = STATUS_LABEL[status] ?? status;
  const title = jobTitle(job.documentType, job.recipientName);
  const location = [job.recipientCity, job.recipientState].filter(Boolean).join(", ") || "Las Vegas, NV";

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center px-5 py-4 gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm">{title}</span>
            <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", colorClass)}>
              {label}
            </span>
            <span className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              <FileText className="w-3 h-3" />
              2 docs
            </span>
          </div>
          <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
            <MapPin className="w-3 h-3" />
            <span>{location}</span>
            <span className="mx-1">·</span>
            <span>{jobTypeLabel(job.documentType)}</span>
            {jobPrice(job.grossCents) && (
              <>
                <span className="mx-1">·</span>
                <span className="font-medium">{jobPrice(job.grossCents)}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {status === "served" && (
            <Link
              href={`/app/requester/jobs/${job.id}`}
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
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Status</p>
              <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", colorClass)}>
                {label}
              </span>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Link
              href={`/app/requester/jobs/${job.id}`}
              className="text-xs font-medium text-amber-600 hover:text-amber-700 transition-colors flex items-center gap-1"
            >
              View Details <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RequesterDashboard() {
  const { data: summary } = useGetDashboardSummary();
  const { data: recentJobs } = useGetRecentJobs({ limit: 5 });

  const totalJobs = (summary?.pendingJobs ?? 0) + (summary?.servedToday ?? 0);
  const completed = summary?.servedToday ?? 0;
  const pending = summary?.pendingJobs ?? 0;

  const statCards = [
    {
      value: String(totalJobs),
      label: "Total\nJobs",
      icon: <TrendingUp className="w-5 h-5 text-blue-500" />,
      bg: "bg-blue-50",
      href: "/app/requester/jobs",
    },
    {
      value: String(completed),
      label: "Completed",
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
      bg: "bg-emerald-50",
      href: "/app/requester/jobs",
    },
    {
      value: String(pending),
      label: "Pending",
      icon: <Clock className="w-5 h-5 text-amber-500" />,
      bg: "bg-amber-50",
      href: "/app/requester/jobs",
    },
    {
      value: "Docs",
      label: "My\nVault",
      icon: <Lock className="w-5 h-5 text-blue-400" />,
      bg: "bg-blue-50",
      href: "/app/requester/vault",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Welcome back — here's the latest on your service requests.
          </p>
        </div>
        <Link
          href="/app/requester/post-job"
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-400 hover:bg-amber-500 text-black font-semibold text-sm rounded-lg transition-colors shadow-sm"
        >
          <FilePlus className="w-4 h-4" />
          Post a Job
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4 hover:shadow-md transition-shadow group"
          >
            <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0", card.bg)}>
              {card.icon}
            </div>
            <div className="min-w-0">
              <div className="text-2xl font-black text-gray-900 leading-none">{card.value}</div>
              <div className="text-xs text-gray-500 mt-0.5 leading-tight whitespace-pre-line">
                {card.label}
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-300 ml-auto group-hover:text-gray-500 transition-colors" />
          </Link>
        ))}
      </div>

      {/* CTA Banner */}
      <div className="bg-[#0f1117] rounded-2xl p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
          <Users className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm">
            {summary?.activeServers ?? 3} Verified Process Servers Available
          </p>
          <p className="text-white/50 text-xs mt-0.5">
            GPS-tracked, background-checked, and ready to serve your documents
          </p>
        </div>
        <Link
          href="/app/requester/post-job"
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
            href="/app/requester/jobs"
            className="text-sm font-medium text-amber-600 hover:text-amber-700 flex items-center gap-1"
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

      {/* Bottom CTA cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
            <FilePlus className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <p className="font-bold text-gray-900 text-sm">Need Someone Served?</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Post your legal documents for fast, reliable service.
            </p>
            <Link
              href="/app/requester/post-job"
              className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-amber-600 hover:text-amber-700"
            >
              Post a Job <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <Lock className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="font-bold text-gray-900 text-sm">My Document Vault</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Store legal docs securely — divorce papers, deeds, court records. Your legal safety deposit box.
            </p>
            <Link
              href="/app/requester/vault"
              className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-sky-600 hover:text-sky-700"
            >
              Open Vault <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
