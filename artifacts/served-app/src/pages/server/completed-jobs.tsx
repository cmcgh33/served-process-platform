import { Link } from "wouter";
import { ArrowLeft, CheckCircle2, MapPin, FileText, Loader2 } from "lucide-react";
import { useListJobs } from "@workspace/api-client-react";
import type { Job } from "@workspace/api-client-react";
import { formatCentsUsd } from "@workspace/pricing";
import { format } from "date-fns";

export default function ServerCompletedJobs() {
  const { data, isLoading } = useListJobs({ status: "served" });
  const jobs: Job[] = data ?? [];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link
            href="/app/server/wallet"
            data-testid="link-back-to-wallet"
            className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700 mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Wallet
          </Link>
          <h1 className="text-2xl font-black text-gray-900">Completed Jobs</h1>
          <p className="text-sm text-gray-500 mt-1">
            Every job you've successfully served on SERVED.
          </p>
        </div>
        <div
          data-testid="text-completed-count"
          className="text-right hidden sm:block"
        >
          <div className="text-3xl font-black text-gray-900 tabular-nums">
            {jobs.length}
          </div>
          <div className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">
            Total
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : jobs.length === 0 ? (
          <div
            data-testid="empty-completed-jobs"
            className="text-center py-16 px-6"
          >
            <CheckCircle2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-gray-700">
              No completed jobs yet
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Once you serve a job, it'll show up here as verified experience.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {jobs.map((job: Job) => {
              const recipient = job.recipientName ?? "Recipient";
              const city = job.recipientCity ?? "";
              const state = job.recipientState ?? "";
              const location = [city, state].filter(Boolean).join(", ");
              const servedAt = job.servedAt
                ? format(new Date(job.servedAt), "MMM d, yyyy")
                : null;
              const earnings = formatCentsUsd(job.serverPayoutCents ?? 0);
              return (
                <li
                  key={job.id}
                  data-testid={`row-completed-job-${job.id}`}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50/60"
                >
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-900 truncate">
                        {recipient}
                      </span>
                      {job.platformRef && (
                        <span className="text-[11px] font-mono text-gray-400">
                          {job.platformRef}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 mt-0.5">
                      {location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {location}
                        </span>
                      )}
                      {job.documentType && (
                        <span className="inline-flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          {job.documentType}
                        </span>
                      )}
                      {servedAt && <span>· Served {servedAt}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-lg font-black text-gray-900 tabular-nums">
                      {earnings}
                    </div>
                    <div className="text-[10px] text-gray-400">you earned</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
