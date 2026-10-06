import { useState } from "react";
import { useListJobs } from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  Archive,
  Search,
  FileText,
  MapPin,
  ArrowRight,
  Download,
  CircleCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { CloudVault } from "./cloud-vault";

const CLIENTS = ["All Clients", "Harrison & Associates", "Smith Legal Group", "Rivera Law Firm"];
const CASE_TYPES = ["All Types", "Civil Litigation", "Family Court", "Subpoena", "Eviction"];

function jobTitle(docType: string | null | undefined, name: string) {
  if (!docType) return `Service — ${name}`;
  const lower = docType.toLowerCase();
  if (lower.includes("civil") || lower.includes("litigation")) return `Civil Litigation — ${name} Case`;
  if (lower.includes("subpoena")) return "Subpoena Service";
  if (lower.includes("divorce")) return "Divorce Petition Service";
  if (lower.includes("eviction")) return "Eviction Notice";
  if (lower.includes("summons") || lower.includes("family")) return "Family Court Documents";
  return `${docType} — ${name}`;
}

export default function AttorneyArchive() {
  const { data: jobs, isLoading } = useListJobs();
  const [search, setSearch] = useState("");
  const [client, setClient] = useState("All Clients");
  const [caseType, setCaseType] = useState("All Types");

  const servedJobs = jobs?.filter((j) => j.status === "served") ?? [];
  const filtered = servedJobs.filter((j) => {
    const matchSearch =
      j.recipientName.toLowerCase().includes(search.toLowerCase()) ||
      (j.caseNumber ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (j.documentType ?? "").toLowerCase().includes(search.toLowerCase());
    return matchSearch;
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Cloud Archive</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            All completed service affidavits — searchable by client or case.
          </p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ backgroundColor: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }}>
          ProServe
        </div>
      </div>

      {/* Cloud Vault — encrypted document storage gated by attorney plan quota. */}
      <CloudVault />

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Archived", value: String(servedJobs.length) },
          { label: "This Month", value: String(servedJobs.length) },
          { label: "Avg Serve Time", value: servedJobs.length > 0 ? "—" : "—" },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-gray-200 p-4 text-center"
          >
            <div className="text-2xl font-black text-gray-900">{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by recipient, case #, or document..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400"
          />
        </div>
        <select
          value={client}
          onChange={(e) => setClient(e.target.value)}
          className="text-xs font-medium px-3 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400/30 text-gray-600"
        >
          {CLIENTS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select
          value={caseType}
          onChange={(e) => setCaseType(e.target.value)}
          className="text-xs font-medium px-3 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400/30 text-gray-600"
        >
          {CASE_TYPES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      {/* Archive list */}
      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-56 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-36" />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <Archive className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No archived matters found.</p>
          </div>
        ) : (
          filtered.map((job) => (
            <div
              key={job.id}
              className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center gap-4 hover:shadow-sm transition-shadow"
            >
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <CircleCheck className="w-5 h-5 text-emerald-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">
                    {jobTitle(job.documentType, job.recipientName)}
                  </span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                    Served
                  </span>
                  <span className="flex items-center gap-1 text-xs text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full">
                    <FileText className="w-3 h-3" />
                    1 doc
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                  <MapPin className="w-3 h-3" />
                  <span>
                    {[job.recipientCity, job.recipientState].filter(Boolean).join(", ") || "Henderson, NV"}
                  </span>
                  {job.caseNumber && (
                    <>
                      <span className="mx-1">·</span>
                      <span className="font-mono">{job.caseNumber}</span>
                    </>
                  )}
                  <span className="mx-1">·</span>
                  <span>{format(new Date(job.createdAt), "MMM d, yyyy")}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                  <Download className="w-3.5 h-3.5" />
                  Affidavit
                </button>
                <Link
                  href={`/app/attorney/jobs/${job.id}`}
                  className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400"
                >
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
