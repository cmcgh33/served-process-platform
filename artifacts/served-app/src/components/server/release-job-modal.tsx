import { useState } from "react";
import { X, ArrowUpFromLine } from "lucide-react";
import {
  useReleaseJob,
  getGetJobQueryKey,
  getListJobsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  job: { id: number; recipientName: string };
  onClose: () => void;
}

const QUICK_REASONS = [
  "Conflict — recipient is a known party",
  "Outside my coverage area",
  "Personal scheduling conflict",
  "Safety concern at the address",
];

export function ReleaseJobModal({ job, onClose }: Props) {
  const queryClient = useQueryClient();
  const release = useReleaseJob();
  const [reason, setReason] = useState("");

  const handleSubmit = async () => {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      toast.error("Tell us briefly why so the requester knows.");
      return;
    }
    try {
      await release.mutateAsync({ id: job.id, data: { reason: trimmed } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(job.id) }),
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() }),
      ]);
      toast.success("Job returned to the queue");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not release job";
      toast.error(msg);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      data-testid="modal-release-job"
    >
      <div className="bg-white rounded-2xl max-w-md w-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <ArrowUpFromLine className="w-5 h-5 text-amber-600" />
            <h3 className="font-semibold text-gray-900">Return job to queue</h3>
          </div>
          <button
            onClick={onClose}
            data-testid="button-close-release"
            className="p-1.5 rounded-lg hover:bg-gray-100"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">{job.recipientName}</span>{" "}
            will go back to the open queue. The requester will see your reason.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className="px-2.5 py-1 rounded-full text-xs border border-gray-200 text-gray-700 hover:bg-gray-50"
              >
                {r}
              </button>
            ))}
          </div>
          <div>
            <label
              htmlFor="release-reason"
              className="block text-xs font-semibold text-gray-700 mb-1"
            >
              Reason
            </label>
            <textarea
              id="release-reason"
              data-testid="input-release-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Briefly explain why you're releasing this job…"
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <p className="text-[10px] text-gray-400 mt-1">{reason.length}/500</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={release.isPending || reason.trim().length < 3}
            data-testid="button-confirm-release"
            className="px-4 py-2 rounded-lg text-sm font-bold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {release.isPending ? "Releasing…" : "Return to queue"}
          </button>
        </div>
      </div>
    </div>
  );
}
