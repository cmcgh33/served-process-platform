import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import {
  useListJobs,
  getListJobsQueryKey,
  useDeleteJob,
  useCreateDraftJobsCheckout,
  useGetMyDraftCheckoutQueue,
  getGetMyDraftCheckoutQueueQueryKey,
  useUpsertMyDraftCheckoutQueue,
  useDismissMyDraftCheckoutQueue,
  type DraftCheckoutQueue as ServerDraftCheckoutQueue,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  MapPin,
  FileText,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Navigation,
  AlertTriangle,
  FilePlus,
  CreditCard,
  Trash2,
  Loader2,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  served: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  // Distinct rose tint so attorneys can spot abandoned-checkout jobs
  // at a glance and tell them apart from paid+pending (yellow).
  pending_payment: "bg-rose-100 text-rose-700",
  in_progress: "bg-sky-100 text-sky-700",
  assigned: "bg-violet-100 text-violet-700",
  failed: "bg-red-100 text-red-700",
  accepted: "bg-teal-100 text-teal-700",
  draft: "bg-gray-100 text-gray-600",
};

const STATUS_LABEL: Record<string, string> = {
  served: "Served",
  pending: "Pending",
  pending_payment: "Payment Required",
  in_progress: "In Progress",
  assigned: "Assigned",
  failed: "Failed",
  accepted: "Accepted",
  draft: "Draft",
};

const ALL_STATUSES = [
  "all",
  "drafts",
  "pending_payment",
  "pending",
  "in_progress",
  "assigned",
  "served",
  "failed",
];

function formatCents(c: number | null | undefined): string {
  if (c == null) return "—";
  return `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;
}

function jobTitle(docType: string | null | undefined, name: string) {
  if (!docType) return `Service — ${name}`;
  const lower = docType.toLowerCase();
  if (lower.includes("civil") || lower.includes("litigation")) return `Civil Litigation — ${name} Case`;
  if (lower.includes("subpoena") || lower.includes("deposition")) return "Subpoena Service — Deposition";
  if (lower.includes("divorce")) return "Divorce Petition Service";
  if (lower.includes("eviction")) return "Eviction Notice Service";
  if (lower.includes("summons") || lower.includes("family")) return "Family Court Documents";
  return `${docType} — ${name}`;
}

function jobType(docType: string | null | undefined) {
  if (!docType) return "Legal Service";
  const lower = docType.toLowerCase();
  if (lower.includes("civil")) return "Civil Litigation";
  if (lower.includes("subpoena")) return "Subpoena";
  if (lower.includes("eviction")) return "Eviction";
  if (lower.includes("family") || lower.includes("summons") || lower.includes("divorce")) return "Family Court";
  return docType;
}

// Stripe metadata values are capped at 500 chars and the API additionally
// caps each checkout at 50 jobs. Split the selection into chunks that respect
// both limits so very large batches can be paid in sequential checkout
// sessions instead of returning a 400.
const DRAFT_CHUNK_MAX_COUNT = 50;
const DRAFT_CHUNK_MAX_CSV_CHARS = 500;

export function chunkDraftIds(ids: number[]): number[][] {
  const chunks: number[][] = [];
  let current: number[] = [];
  let currentCsvLen = 0;
  for (const id of ids) {
    const s = String(id);
    const projectedLen =
      current.length === 0 ? s.length : currentCsvLen + 1 + s.length;
    if (
      current.length >= DRAFT_CHUNK_MAX_COUNT ||
      projectedLen > DRAFT_CHUNK_MAX_CSV_CHARS
    ) {
      chunks.push(current);
      current = [id];
      currentCsvLen = s.length;
    } else {
      current.push(id);
      currentCsvLen = projectedLen;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// Queue persistence: previously this queue lived in `sessionStorage`,
// which made the resume banner disappear the moment the attorney closed
// the tab. The queue now lives server-side in `draft_checkout_queues`
// and is fetched / mutated via `useGetMyDraftCheckoutQueue` and
// friends. The webhook for each completed Stripe Checkout session
// atomically advances the queue's `paidCount`, so the banner stays in
// sync across tabs and devices without any client-side bookkeeping.

interface JobRowJob {
  id: number;
  status: string;
  recipientName: string;
  documentType?: string | null;
  recipientCity?: string | null;
  recipientState?: string | null;
  caseNumber?: string | null;
  platformRef?: string | null;
  attemptCount?: number | null;
  grossCents?: number | null;
  serviceType?: string | null;
}

function JobRow({
  job,
  isDraft,
  selected,
  onToggleSelect,
  onPayNow,
  onDelete,
  isWorking,
}: {
  job: JobRowJob;
  isDraft: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onPayNow: () => void;
  onDelete: () => void;
  isWorking: boolean;
}) {
  const [open, setOpen] = useState(false);
  const colorClass = STATUS_COLORS[job.status] ?? "bg-gray-100 text-gray-600";
  const label = STATUS_LABEL[job.status] ?? job.status;
  const title = jobTitle(job.documentType, job.recipientName);
  const location =
    [job.recipientCity, job.recipientState].filter(Boolean).join(", ") ||
    "Henderson, NV";
  const isInProgress = job.status === "in_progress";

  return (
    <div
      className={cn(
        "bg-white rounded-xl border overflow-hidden transition-colors",
        selected ? "border-sky-400 ring-2 ring-sky-100" : "border-gray-200",
      )}
    >
      <div className="flex items-center px-5 py-4 gap-3">
        {isDraft && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="h-4 w-4 accent-sky-500"
            aria-label="Select draft"
          />
        )}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm">{title}</span>
            <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", colorClass)}>
              {label}
            </span>
            {!isDraft && (
              <span className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                <FileText className="w-3 h-3" />2 docs
              </span>
            )}
            {isDraft && job.serviceType && (
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                {job.serviceType}
              </span>
            )}
          </div>
          {isInProgress && (job.attemptCount ?? 0) > 0 && (
            <div className="flex items-center gap-1 text-xs font-medium text-amber-600">
              <AlertTriangle className="w-3 h-3" />
              {job.attemptCount} {job.attemptCount === 1 ? "Attempt" : "Attempts"}
            </div>
          )}
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <MapPin className="w-3 h-3" />
            <span>{location}</span>
            <span className="mx-1">·</span>
            <span>{jobType(job.documentType)}</span>
            <span className="mx-1">·</span>
            <span className="font-medium">{formatCents(job.grossCents)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isDraft && (
            <>
              <Link
                href={`/app/attorney/post-job?edit=${job.id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-semibold transition-colors"
                aria-label="Edit draft"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </Link>
              <button
                type="button"
                onClick={onPayNow}
                disabled={isWorking}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold transition-colors disabled:opacity-60"
              >
                <CreditCard className="w-3.5 h-3.5" />
                Pay {formatCents(job.grossCents)}
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={isWorking}
                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-60"
                aria-label="Delete draft"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
          {isInProgress && (
            <Link
              href={`/app/attorney/tracking/${job.id}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-500 text-black text-xs font-bold transition-colors"
            >
              <Navigation className="w-3.5 h-3.5" />
              Track Serve
            </Link>
          )}
          {job.status === "served" && (
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
          {!isDraft && (
            <div className="mt-3">
              <Link
                href={`/app/attorney/jobs/${job.id}`}
                className="text-xs font-medium text-sky-600 hover:text-sky-700 flex items-center gap-1"
              >
                View Full Details <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AttorneyMyJobs() {
  const queryClient = useQueryClient();
  const search = useSearch();
  const initialFilter = useMemo(() => {
    const params = new URLSearchParams(search);
    return params.get("tab") === "drafts" ? "drafts" : "all";
  }, [search]);

  // The attorney's /jobs feed already includes drafts (server-side scope is
  // requesterUserId=me, no status filter). One request gives us everything.
  const { data: jobs, isLoading } = useListJobs(undefined, {
    query: {
      queryKey: getListJobsQueryKey(),
      refetchOnWindowFocus: true,
      refetchInterval: (q) => {
        const list = q.state.data ?? [];
        const hasActive = list.some((j) =>
          ["pending", "assigned", "in_progress"].includes(j.status),
        );
        return hasActive ? 30000 : false;
      },
    },
  });

  const merged = jobs ?? [];

  const [filter, setFilter] = useState(initialFilter);
  useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);

  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<number>>(
    new Set(),
  );

  const drafts = useMemo(
    () => merged.filter((j) => j.status === "draft"),
    [merged],
  );
  const filtered = useMemo(() => {
    if (filter === "all") return merged.filter((j) => j.status !== "draft");
    if (filter === "drafts") return drafts;
    return merged.filter((j) => j.status === filter);
  }, [merged, drafts, filter]);

  const deleteJob = useDeleteJob({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      },
    },
  });
  const draftCheckout = useCreateDraftJobsCheckout();

  const isWorking = deleteJob.isPending || draftCheckout.isPending;

  const toggleDraftSelect = (id: number) =>
    setSelectedDraftIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedDrafts = drafts.filter((d) => selectedDraftIds.has(d.id));
  const selectedTotalCents = selectedDrafts.reduce(
    (sum, d) => sum + (d.grossCents ?? 0),
    0,
  );

  // Server-backed multi-batch payment queue. Survives tab close, sign-out,
  // and even hopping to a different device — the row lives in
  // `draft_checkout_queues` and the Stripe webhook is what advances
  // `paidCount` once each batch is paid.
  const queueQuery = useGetMyDraftCheckoutQueue({
    query: {
      queryKey: getGetMyDraftCheckoutQueueQueryKey(),
      // 404 = no active queue. Treat the missing data as the steady state
      // and don't retry; we'll refetch deliberately on Stripe return and
      // after upserts.
      retry: false,
      refetchOnWindowFocus: true,
    },
  });
  const queue: ServerDraftCheckoutQueue | undefined = queueQuery.data;

  const upsertQueueMut = useUpsertMyDraftCheckoutQueue({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetMyDraftCheckoutQueueQueryKey(),
        });
      },
    },
  });
  const dismissQueueMut = useDismissMyDraftCheckoutQueue({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetMyDraftCheckoutQueueQueryKey(),
        });
      },
    },
  });

  const draftsById = useMemo(() => {
    const m = new Map<number, JobRowJob>();
    for (const d of drafts) m.set(d.id, d);
    return m;
  }, [drafts]);

  const sumCentsForChunk = (jobIds: number[]) =>
    jobIds.reduce((sum, id) => sum + (draftsById.get(id)?.grossCents ?? 0), 0);

  const launchCheckout = (jobIds: number[], queueId?: number) => {
    draftCheckout.mutate(
      { data: { jobIds, ...(queueId ? { queueId } : {}) } },
      {
        onSuccess: (resp) => {
          window.location.assign(resp.url);
        },
        onError: (err) => {
          toast.error("Couldn't start checkout", {
            description:
              err instanceof Error ? err.message : "Unknown error",
          });
        },
      },
    );
  };

  const startCheckout = async (jobIds: number[]) => {
    if (jobIds.length === 0) return;
    const chunks = chunkDraftIds(jobIds);
    if (chunks.length <= 1) {
      // Common case — fits in a single Stripe session. No persisted queue
      // is necessary; if one already exists from a prior multi-batch run
      // we leave it alone (it's scoped to its own job ids).
      launchCheckout(chunks[0] ?? jobIds);
      return;
    }
    const totalCents = jobIds.reduce(
      (sum, id) => sum + (draftsById.get(id)?.grossCents ?? 0),
      0,
    );
    const proceed = window.confirm(
      `Your selection of ${jobIds.length} drafts is too large for a single Stripe checkout, so it will be split into ${chunks.length} sequential payments. ` +
        `You'll pay batch 1 of ${chunks.length} (${chunks[0].length} drafts, ${formatCents(sumCentsForChunk(chunks[0]))}) now and we'll bring you back here to continue with the next batch. ` +
        `Closing the tab between batches is fine — your progress is saved on our servers, so you can pick up where you left off from any device.`,
    );
    if (!proceed) return;
    try {
      const saved = await upsertQueueMut.mutateAsync({
        data: { chunks, totalCents },
      });
      launchCheckout(chunks[0], saved.id);
    } catch (err) {
      toast.error("Couldn't save your checkout queue", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const continueQueue = () => {
    if (!queue) return;
    const next = queue.chunks[queue.paidCount];
    if (!next || next.length === 0) return;
    // The server prunes whole chunks that have left `draft`, but a chunk
    // with a partial leftover (some paid via the single-job button, the
    // rest still draft) survives. Trim those leftovers here so we only
    // ask Stripe for the jobs that still need paying — otherwise the
    // /stripe/draft-jobs/checkout route 409s on the non-draft ids.
    const stillDraftIds = next.filter((id) => draftsById.has(id));
    if (stillDraftIds.length === 0) return;
    launchCheckout(stillDraftIds, queue.id);
  };

  const discardQueue = () => {
    dismissQueueMut.mutate(undefined, {
      onSuccess: () => {
        toast.message("Cleared remaining batches", {
          description:
            "Drafts that were already paid for remain activated; the rest stay as drafts.",
        });
      },
      onError: (err) => {
        toast.error("Couldn't dismiss the queue", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      },
    });
  };

  // Handle return from Stripe checkout. The success_url adds
  // `?payment=success&session_id=...`, the cancel_url adds `?payment=cancelled`.
  // The webhook is the source of truth for `paidCount` — here we just
  // refresh the queue and the job list so the UI catches up quickly.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("payment");
    if (status !== "success" && status !== "cancelled") return;

    // Strip the params so this effect doesn't re-fire on subsequent renders.
    params.delete("payment");
    params.delete("session_id");
    const qs = params.toString();
    const cleanUrl =
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
    window.history.replaceState(null, "", cleanUrl);

    if (status === "success") {
      // Webhook should have flipped the paid jobs and bumped the queue's
      // paidCount. Poll for a couple seconds to cover the small window
      // between user redirect and Stripe webhook delivery.
      let attempts = 0;
      const tick = () => {
        attempts += 1;
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetMyDraftCheckoutQueueQueryKey(),
        });
      };
      tick();
      const timer = setInterval(() => {
        tick();
        if (attempts >= 5) clearInterval(timer);
      }, 1500);
      toast.success("Payment received — refreshing your batches…");
      return () => clearInterval(timer);
    } else {
      // Cancelled. Refetch the queue so the banner shows the un-advanced
      // state; if there's no queue it's a single-batch cancel and we
      // just say so.
      queryClient.invalidateQueries({
        queryKey: getGetMyDraftCheckoutQueueQueryKey(),
      });
      toast.message("Checkout cancelled");
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = (jobId: number) => {
    if (!window.confirm("Delete this draft? This cannot be undone.")) return;
    deleteJob.mutate(
      { id: jobId },
      {
        onSuccess: () => {
          setSelectedDraftIds((prev) => {
            const next = new Set(prev);
            next.delete(jobId);
            return next;
          });
          toast.success("Draft deleted");
        },
        onError: (err) => {
          toast.error("Couldn't delete draft", {
            description:
              err instanceof Error ? err.message : "Unknown error",
          });
        },
      },
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">My Matters</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            All active and completed service requests for your firm.
          </p>
        </div>
        <Link
          href="/app/attorney/post-job"
          className="flex items-center gap-2 px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-semibold text-sm rounded-lg transition-colors"
        >
          <FilePlus className="w-4 h-4" />
          Post a Matter
        </Link>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        {ALL_STATUSES.map((s) => {
          const count =
            s === "all"
              ? merged.filter((j) => j.status !== "draft").length
              : s === "drafts"
                ? drafts.length
                : merged.filter((j) => j.status === s).length;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors flex items-center gap-1.5",
                filter === s
                  ? "bg-sky-500 text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50",
              )}
            >
              <span>
                {s === "all"
                  ? "All Active"
                  : s === "drafts"
                    ? "Drafts"
                    : STATUS_LABEL[s] ?? s}
              </span>
              {count > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] font-bold",
                    filter === s
                      ? "bg-white/30 text-white"
                      : "bg-gray-100 text-gray-600",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {queue && queue.paidCount < queue.chunks.length && (() => {
        const nextChunk = queue.chunks[queue.paidCount];
        const nextDraftIds = nextChunk.filter((id) => draftsById.has(id));
        return (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <p className="text-sm text-amber-900">
              <span className="font-bold">
                {queue.paidCount === 0
                  ? `Split checkout in progress (${queue.chunks.length} batches).`
                  : `Batch ${queue.paidCount} of ${queue.chunks.length} paid.`}
              </span>{" "}
              Continue with batch {queue.paidCount + 1} (
              {nextDraftIds.length} drafts,{" "}
              <span className="font-semibold">
                {formatCents(sumCentsForChunk(nextDraftIds))}
              </span>
              ) when you're ready.{" "}
              <span className="text-xs text-amber-700">
                Saved on our servers — closing this tab is fine.
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={discardQueue}
            disabled={isWorking}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            Discard remaining
          </button>
          <button
            type="button"
            onClick={continueQueue}
            disabled={isWorking}
            className="px-4 py-1.5 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 flex items-center gap-1.5"
          >
            {draftCheckout.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CreditCard className="w-3.5 h-3.5" />
            )}
            Pay batch {queue.paidCount + 1} of {queue.chunks.length}
          </button>
        </div>
        );
      })()}

      {filter === "drafts" && drafts.length > 0 && (
        <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <p className="text-sm text-sky-900 flex-1 min-w-[200px]">
            <span className="font-bold">
              {selectedDraftIds.size}
            </span>{" "}
            of {drafts.length} drafts selected
            {selectedDraftIds.size > 0 && (
              <>
                {" "}
                · Total{" "}
                <span className="font-bold">
                  {formatCents(selectedTotalCents)}
                </span>
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() =>
              setSelectedDraftIds(
                selectedDraftIds.size === drafts.length
                  ? new Set()
                  : new Set(drafts.map((d) => d.id)),
              )
            }
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-sky-200 text-sky-700 hover:bg-sky-100"
          >
            {selectedDraftIds.size === drafts.length
              ? "Clear all"
              : "Select all"}
          </button>
          <button
            type="button"
            onClick={() => startCheckout(Array.from(selectedDraftIds))}
            disabled={selectedDraftIds.size === 0 || isWorking}
            className="px-4 py-1.5 rounded-lg text-xs font-bold bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-50 flex items-center gap-1.5"
          >
            {draftCheckout.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CreditCard className="w-3.5 h-3.5" />
            )}
            Pay & Activate Selected
          </button>
        </div>
      )}

      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse"
            >
              <div className="h-4 bg-gray-200 rounded w-48 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-32" />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <FilePlus className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              {filter === "drafts"
                ? "No saved drafts."
                : "No matters found."}
            </p>
            <Link
              href="/app/attorney/post-job"
              className="text-sm font-semibold text-sky-600 mt-1 inline-block"
            >
              File your first matter
            </Link>
          </div>
        ) : (
          filtered.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              isDraft={job.status === "draft"}
              selected={selectedDraftIds.has(job.id)}
              onToggleSelect={() => toggleDraftSelect(job.id)}
              onPayNow={() => startCheckout([job.id])}
              onDelete={() => handleDelete(job.id)}
              isWorking={isWorking}
            />
          ))
        )}
      </div>
    </div>
  );
}
