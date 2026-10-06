import { useState } from "react";
import { Link } from "wouter";
import { useListJobs, getListJobsQueryKey } from "@workspace/api-client-react";
import { MapPin, FileText, FilePlus, ArrowRight, ChevronDown, ChevronUp, CircleCheck, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  served: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  // Distinct rose tint so customers can spot abandoned-checkout jobs
  // and tell them apart from paid-but-unassigned (yellow) at a glance.
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

const ALL_STATUSES = [
  "all",
  "pending_payment",
  "pending",
  "in_progress",
  "assigned",
  "served",
  "failed",
];

function jobTitle(docType: string | null | undefined, recipientName: string) {
  if (!docType) return `Serve Documents — ${recipientName}`;
  const lower = docType.toLowerCase();
  if (lower.includes("eviction")) return "Serve Eviction Notice";
  if (lower.includes("summons") || lower.includes("family")) return "Serve Family Court Documents";
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

function JobRow({ job }: {
  job: {
    id: number;
    status: string;
    recipientName: string;
    documentType?: string | null;
    recipientCity?: string | null;
    recipientState?: string | null;
    platformRef?: string | null;
    grossCents?: number | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const colorClass = STATUS_COLORS[job.status] ?? "bg-gray-100 text-gray-600";
  const label = STATUS_LABEL[job.status] ?? job.status;
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
            {jobPrice(job.grossCents) && (
              <>
                <span className="mx-1">·</span>
                <span className="font-medium">{jobPrice(job.grossCents)}</span>
              </>
            )}
            {job.platformRef && (
              <>
                <span className="mx-1">·</span>
                <span className="font-mono text-gray-400">{job.platformRef}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {job.status === "in_progress" && (
            <Link
              href={`/app/requester/tracking/${job.id}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-500 text-black text-xs font-bold transition-colors"
            >
              <Navigation className="w-3.5 h-3.5" />
              Track Serve
            </Link>
          )}
          {job.status === "served" && (
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
            {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
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
              <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", colorClass)}>{label}</span>
            </div>
          </div>
          <div className="mt-3">
            <Link
              href={`/app/requester/jobs/${job.id}`}
              className="text-xs font-medium text-amber-600 hover:text-amber-700 flex items-center gap-1"
            >
              View Full Details <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RequesterMyJobs() {
  const { data: jobs, isLoading } = useListJobs(undefined, {
    query: {
      queryKey: getListJobsQueryKey(),
      refetchOnWindowFocus: true,
      refetchInterval: (q) => {
        const list = q.state.data ?? [];
        const hasActive = list.some((j) => ["pending", "assigned", "in_progress"].includes(j.status));
        return hasActive ? 30000 : false;
      },
    },
  });
  const [filter, setFilter] = useState("all");

  const filtered = jobs?.filter((j) => filter === "all" || j.status === filter) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">My Jobs</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track all your service requests.</p>
        </div>
        <Link
          href="/app/requester/post-job"
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-400 hover:bg-amber-500 text-black font-semibold text-sm rounded-lg transition-colors"
        >
          <FilePlus className="w-4 h-4" />
          Post a Job
        </Link>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {ALL_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors",
              filter === s
                ? "bg-amber-400 text-black"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            )}
          >
            {s === "all" ? "All" : STATUS_LABEL[s] ?? s}
          </button>
        ))}
      </div>

      {/* Job list */}
      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-48 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-32" />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <FilePlus className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No jobs found.</p>
            <Link href="/app/requester/post-job" className="text-sm font-semibold text-amber-600 mt-1 inline-block">
              Post your first job
            </Link>
          </div>
        ) : (
          filtered.map((job) => <JobRow key={job.id} job={job} />)
        )}
      </div>
    </div>
  );
}
