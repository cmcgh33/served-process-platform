import { useMemo, useState } from "react";
import {
  useAdminAssignJob,
  useAdminCancelJob,
  useAdminJobs,
  useAdminRegenerateAffidavit,
  useAdminServers,
  type AdminJobRow,
} from "@/lib/admin";
import { Briefcase, MapPin, X, UserPlus, Loader2, FileText, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { resolveStorageObjectUrl } from "@/lib/storageUrl";

const STATUS_OPTIONS = [
  "all",
  "pending_payment",
  "pending",
  "assigned",
  "accepted",
  "in_progress",
  "served",
  "failed",
  "cancelled",
] as const;

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "bg-gray-100 text-gray-600",
  pending: "bg-amber-100 text-amber-700",
  assigned: "bg-violet-100 text-violet-700",
  accepted: "bg-teal-100 text-teal-700",
  in_progress: "bg-sky-100 text-sky-700",
  served: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

function AssignDialog({
  job,
  onClose,
}: {
  job: AdminJobRow;
  onClose: () => void;
}) {
  const { data: serversData } = useAdminServers();
  const assign = useAdminAssignJob();
  const { toast } = useToast();
  const [serverId, setServerId] = useState<number | "">("");

  const verifiedServers = (serversData?.items ?? []).filter(
    (s) => s.credentialStatus === "verified" && s.active,
  );

  const handleAssign = async () => {
    if (typeof serverId !== "number") return;
    try {
      await assign.mutateAsync({ jobId: job.id, serverId });
      toast({ title: "Job assigned", description: `Job #${job.id} routed.` });
      onClose();
    } catch (err: any) {
      toast({
        title: "Assignment failed",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">
              Assign job #{job.id}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Route to a verified server.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
          <div className="font-medium text-gray-800">{job.recipientName}</div>
          <div className="text-xs text-gray-500">
            {job.documentType} · {job.recipientCity}, {job.recipientState}
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Server
          </label>
          <select
            value={serverId === "" ? "" : String(serverId)}
            onChange={(e) =>
              setServerId(e.target.value ? Number(e.target.value) : "")
            }
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            data-testid="select-assign-server"
          >
            <option value="">— Select server —</option>
            {verifiedServers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.email})
                {s.serviceArea ? ` · ${s.serviceArea}` : ""}
              </option>
            ))}
          </select>
          {verifiedServers.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">
              No verified servers yet. Add one from the Servers page.
            </p>
          )}
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleAssign}
            disabled={typeof serverId !== "number" || assign.isPending}
            className="px-4 py-2 text-sm font-bold bg-amber-400 hover:bg-amber-500 text-black rounded-lg disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            data-testid="button-confirm-assign"
          >
            {assign.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminJobsPage() {
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("all");
  const [assigningJob, setAssigningJob] = useState<AdminJobRow | null>(null);
  const cancelMut = useAdminCancelJob();
  const regenMut = useAdminRegenerateAffidavit();
  const { toast } = useToast();

  const params = useMemo(
    () => (status === "all" ? {} : { status }),
    [status],
  );
  const { data, isLoading } = useAdminJobs(params);

  const handleCancel = async (job: AdminJobRow) => {
    if (!confirm(`Cancel job #${job.id} for ${job.recipientName}?`)) return;
    try {
      await cancelMut.mutateAsync(job.id);
      toast({ title: "Job cancelled" });
    } catch (err: any) {
      toast({
        title: "Cancel failed",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    }
  };

  const handleRegenerate = async (job: AdminJobRow) => {
    try {
      await regenMut.mutateAsync(job.id);
      toast({
        title: "Affidavit regenerated",
        description: `Job #${job.id} now has a fresh PDF.`,
      });
    } catch (err: any) {
      toast({
        title: "Regenerate failed",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All jobs</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Filter, assign, and cancel jobs across the marketplace.
          </p>
        </div>
        <div>
          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as (typeof STATUS_OPTIONS)[number])
            }
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium"
            data-testid="select-job-status-filter"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All statuses" : s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-12 text-center">
            <Briefcase className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <div className="text-sm font-medium text-gray-700">
              No jobs match this filter
            </div>
            <div className="text-xs text-gray-500 mt-1">
              When requesters post jobs they'll show up here.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3">#</th>
                  <th className="text-left px-4 py-3">Recipient</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Requester</th>
                  <th className="text-left px-4 py-3">Plan</th>
                  <th className="text-left px-4 py-3">Server</th>
                  <th className="text-left px-4 py-3">Gross</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.items.map((j) => (
                  <tr key={j.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {j.id}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {j.recipientName}
                      </div>
                      <div className="text-xs text-gray-500 flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {j.recipientCity}, {j.recipientState}
                        {j.caseNumber ? ` · ${j.caseNumber}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[j.status] ?? "bg-gray-100 text-gray-600"}`}
                      >
                        {j.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {j.requesterName ?? <span className="text-gray-400">—</span>}
                      {j.requesterEmail && (
                        <div className="text-gray-400">{j.requesterEmail}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {j.requesterPlan ? (
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${
                            j.requesterPlan === "public"
                              ? "bg-gray-100 text-gray-600"
                              : "bg-violet-100 text-violet-700"
                          }`}
                          data-testid={`badge-requester-plan-${j.id}`}
                        >
                          {j.requesterPlan === "public"
                            ? "pay-as-you-go"
                            : j.requesterPlan.replace(/_/g, " ")}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {j.serverName ?? <span className="text-gray-400">unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {dollars(j.grossCents)}
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      {j.status !== "served" && j.status !== "cancelled" && (
                        <button
                          onClick={() => setAssigningJob(j)}
                          className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-semibold px-2 py-1"
                          data-testid={`button-assign-${j.id}`}
                        >
                          <UserPlus className="w-3 h-3" /> Assign
                        </button>
                      )}
                      {j.status !== "served" && j.status !== "cancelled" && (
                        <button
                          onClick={() => handleCancel(j)}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold px-2 py-1"
                          data-testid={`button-cancel-${j.id}`}
                        >
                          <X className="w-3 h-3" /> Cancel
                        </button>
                      )}
                      {j.status === "served" && j.proofPdfUrl && (
                        <a
                          href={resolveStorageObjectUrl(j.proofPdfUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-1"
                          data-testid={`link-affidavit-${j.id}`}
                        >
                          <FileText className="w-3 h-3" /> PDF
                        </a>
                      )}
                      {j.status === "served" && (
                        <button
                          onClick={() => handleRegenerate(j)}
                          disabled={regenMut.isPending && regenMut.variables === j.id}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-1 disabled:opacity-50"
                          data-testid={`button-regen-${j.id}`}
                          title="Regenerate affidavit PDF"
                        >
                          {regenMut.isPending && regenMut.variables === j.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          Regen
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {assigningJob && (
        <AssignDialog
          job={assigningJob}
          onClose={() => setAssigningJob(null)}
        />
      )}
    </div>
  );
}
