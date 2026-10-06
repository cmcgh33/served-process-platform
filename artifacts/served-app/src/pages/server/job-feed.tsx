import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useListJobs,
  useGetServerStatus,
  useAcceptJob,
  useMarkJobEnRoute,
  useDismissJobFromFeed,
  useMarkJobPickedUp,
  getListJobsQueryKey,
  getGetJobQueryKey,
} from "@workspace/api-client-react";
import type { Job } from "@workspace/api-client-react";
import { JobTimeline } from "@/components/JobTimeline";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Zap, MapPin, FileText, Navigation, CircleCheck, AlertTriangle, ChevronDown, ChevronUp, ArrowRight,
  ShieldCheck, ShieldAlert, Banknote, Lock, Package, PackageCheck, X, ArrowUpFromLine, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { MarkServedModal } from "@/components/server/mark-served-modal";
import { LogAttemptModal } from "@/components/server/log-attempt-modal";
import { GetDocumentsModal } from "@/components/server/get-documents-modal";
import { ReleaseJobModal } from "@/components/server/release-job-modal";
import { getNavigateTarget } from "@/lib/navigate-target";
import { useMe } from "@/lib/me";

function jobTitle(docType: string | null | undefined, name: string) {
  if (!docType) return `Serve Documents — ${name}`;
  const lower = docType.toLowerCase();
  if (lower.includes("civil")) return `Civil Litigation — ${name} Case`;
  if (lower.includes("subpoena")) return "Subpoena Service — Deposition";
  if (lower.includes("eviction")) return "Serve Eviction Notice";
  if (lower.includes("summons") || lower.includes("family")) return "Serve Family Court Documents";
  return `Serve ${docType}`;
}
function serverEarnings(docType: string | null | undefined) {
  const lower = (docType ?? "").toLowerCase();
  if (lower.includes("civil") || lower.includes("subpoena")) return "$96";
  if (lower.includes("eviction")) return "$76";
  return "$60";
}
function jobType(docType: string | null | undefined) {
  if (!docType) return "Legal";
  const lower = docType.toLowerCase();
  if (lower.includes("civil")) return "Civil Litigation";
  if (lower.includes("subpoena")) return "Subpoena";
  if (lower.includes("eviction")) return "Eviction";
  if (lower.includes("family") || lower.includes("summons")) return "Family Court";
  return docType;
}

const AVAILABLE_STATUSES = ["pending"];
const MY_STATUSES = ["assigned", "in_progress", "en_route", "served", "failed"];

function JobFeedCard({ job, mine, canAccept }: {
  job: Job;
  mine: boolean;
  canAccept: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [markServedOpen, setMarkServedOpen] = useState(false);
  const [logAttemptOpen, setLogAttemptOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);

  const acceptJob = useAcceptJob();
  const markEnRoute = useMarkJobEnRoute();
  const dismissJob = useDismissJobFromFeed();
  const markPickedUp = useMarkJobPickedUp();
  const [, navigate] = useLocation();
  const title = jobTitle(job.documentType, job.recipientName);
  const earnings = serverEarnings(job.documentType);
  const location = [job.recipientCity, job.recipientState].filter(Boolean).join(", ") || "Las Vegas, NV";
  const isInProgress = job.status === "in_progress";
  const isEnRoute = job.status === "en_route";
  const isAssigned = job.status === "assigned";
  const isServed = job.status === "served";
  // The server has the job (accepted/assigned/working it) — they need
  // the requester's uploaded documents to actually serve. Keep this
  // predicate identical to the one in dashboard.tsx so both surfaces
  // expose document access for the same set of statuses.
  const canViewDocuments = mine && (isAssigned || isInProgress || isEnRoute);
  // `isPickup` here = pickup is REQUIRED (strict pickup mode). The badge,
  // navigate-to-pickup-first logic, and the "no docs to download" copy all
  // hinge on that. `isPickupOffered` covers strict pickup OR the new
  // "either" mode where the server may optionally collect originals; that
  // controls whether the Mark Picked Up button + pickup address card are
  // available, since a server who chose to drive over to the firm still
  // wants to log it.
  const isPickup = job.documentHandling === "pickup";
  const isPickupOffered =
    job.documentHandling === "pickup" || job.documentHandling === "either";
  const isPickedUp = Boolean(job.pickedUpAt);

  const handleMarkPickedUp = () => {
    markPickedUp.mutate(
      { id: job.id },
      {
        onSuccess: () => {
          toast.success("Documents marked as picked up");
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(job.id) });
        },
        onError: (err: unknown) => {
          const message =
            err && typeof err === "object" && "message" in err
              ? String((err as { message?: unknown }).message)
              : "Could not mark pickup";
          toast.error(message);
        },
      },
    );
  };
  const navTarget = getNavigateTarget({
    documentHandling: job.documentHandling,
    pickupAddress: job.pickupAddress,
    pickupCity: job.pickupCity,
    pickupState: job.pickupState,
    pickupZip: job.pickupZip,
    recipientAddress: job.recipientAddress ?? "",
    recipientCity: job.recipientCity ?? "",
    recipientState: job.recipientState ?? "",
    recipientZip: job.recipientZip ?? "",
  });

  const invalidateLists = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(job.id) }),
    ]);
  };

  const handleAccept = async () => {
    try {
      await acceptJob.mutateAsync({ id: job.id });
      await invalidateLists();
      toast.success("Job accepted — get the documents next.");
      setDocsOpen(true);
    } catch (err) {
      const fallback = "Could not accept job";
      let msg = fallback;
      // axios-style error w/ response body from our API
      const anyErr = err as {
        response?: { data?: { error?: string; code?: string; reason?: string } };
        message?: string;
      };
      const reason = anyErr?.response?.data?.reason;
      if (reason === "training_required") {
        // Server hasn't completed onboarding training yet — bounce them to
        // the Training tab with a flag so the page can show a contextual
        // banner and auto-return to the feed after they finish.
        toast.error(
          anyErr?.response?.data?.error ??
            "Finish the SERVED. server training video before claiming jobs.",
        );
        navigate("/app/server/training?from=claim");
        return;
      }
      if (anyErr?.response?.data?.error) msg = anyErr.response.data.error;
      else if (anyErr?.message) msg = anyErr.message;
      toast.error(msg);
    }
  };

  const handleEnRoute = async () => {
    try {
      await markEnRoute.mutateAsync({ id: job.id });
      await invalidateLists();
      toast.success("You're en route — requester notified.");
    } catch (err) {
      const anyErr = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error(anyErr?.response?.data?.error ?? anyErr?.message ?? "Could not update status");
    }
  };

  const handleDismiss = async () => {
    try {
      await dismissJob.mutateAsync({ id: job.id });
      await invalidateLists();
      toast.success("Hidden from your feed.");
    } catch (err) {
      const anyErr = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error(anyErr?.response?.data?.error ?? anyErr?.message ?? "Could not dismiss job");
    }
  };

  return (
    <>
      <div className="relative bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Top row stacks vertically on phones — process servers were
            seeing the title squeezed to nothing because earnings + up
            to 6 action buttons crammed into the right column. From sm+
            we keep the original two-column layout. */}
        <div className="flex flex-col sm:flex-row sm:items-start px-5 py-4 gap-3 pr-12 sm:pr-5">
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900 text-sm">{title}</span>
              {isInProgress && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">In Progress</span>
              )}
              {isEnRoute && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">En Route</span>
              )}
              {isServed && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Served</span>
              )}
              <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                <FileText className="w-3 h-3" />2 docs
              </span>
              {job.requiresLicensedServer && (
                <span
                  data-testid={`badge-licensed-only-${job.id}`}
                  title="Subpoena / civil litigation — requires NV PILB licensed process server"
                  className="flex items-center gap-1 text-xs font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full"
                >
                  <ShieldCheck className="w-3 h-3" />Licensed only
                </span>
              )}
              {isPickup && !isPickedUp && (
                <span
                  data-testid={`badge-pickup-${job.id}`}
                  className="flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"
                >
                  <Package className="w-3 h-3" />Pickup required
                </span>
              )}
              {isPickupOffered && isPickedUp && (
                <span
                  data-testid={`badge-picked-up-${job.id}`}
                  className="flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full"
                >
                  <PackageCheck className="w-3 h-3" />Picked up
                </span>
              )}
              {(isInProgress || isEnRoute) && (job.attemptCount ?? 0) > 0 && (
                <span
                  data-testid={`badge-attempts-${job.id}`}
                  className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200"
                >
                  <AlertTriangle className="w-3 h-3" />
                  {job.attemptCount}/3 Attempts
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <MapPin className="w-3 h-3" />{location}
              <span className="mx-1">·</span>{jobType(job.documentType)}
            </div>
            {!mine && job.releaseReason && (
              <div
                data-testid={`hint-previously-released-${job.id}`}
                className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mt-1"
              >
                <RotateCcw className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>
                  <span className="font-semibold">Previously released:</span>{" "}
                  <span className="italic">{job.releaseReason}</span>
                </span>
              </div>
            )}
          </div>
          {/* On mobile: span full width with earnings + buttons left-aligned
              for easier thumb reach. On sm+: revert to right-aligned column. */}
          <div className="flex flex-col items-start sm:items-end gap-2 flex-shrink-0 w-full sm:w-auto">
            <div className="flex items-baseline gap-1.5">
              <div className="text-lg font-black text-gray-900">{earnings}</div>
              <div className="text-[10px] text-gray-400">you earn</div>
            </div>
            <div className="flex gap-1.5 flex-wrap sm:justify-end">
              {!mine && (
                canAccept ? (
                  <button
                    onClick={handleAccept}
                    disabled={acceptJob.isPending}
                    data-testid={`button-accept-job-${job.id}`}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-500 text-black text-xs font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    {acceptJob.isPending ? "Accepting…" : "Accept Job"}
                  </button>
                ) : (
                  <button disabled data-testid={`button-accept-job-${job.id}`} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-400 text-xs font-bold cursor-not-allowed" title="Finish credentialing & bank onboarding to accept jobs">
                    <Lock className="w-3.5 h-3.5" />Accept Job
                  </button>
                )
              )}
              {mine && (isInProgress || isEnRoute) && (
                <>
                  <button
                    type="button"
                    onClick={() => setDocsOpen(true)}
                    data-testid={`button-get-documents-${job.id}`}
                    title="View and print the documents to be served"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-sky-300 bg-sky-50 text-sky-700 text-xs font-bold hover:bg-sky-100 transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5" />Get Docs
                  </button>
                  <a
                    href={navTarget.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => {
                      if (!isEnRoute && !markEnRoute.isPending) handleEnRoute();
                    }}
                    data-testid={`button-navigate-${job.id}`}
                    title={
                      isEnRoute
                        ? "You're already en route"
                        : navTarget.kind === "pickup"
                          ? "Mark en route and navigate to pickup first"
                          : "Mark en route and navigate to recipient"
                    }
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors",
                      isEnRoute
                        ? "bg-purple-100 text-purple-700"
                        : "bg-amber-400 hover:bg-amber-500 text-black",
                      markEnRoute.isPending && "opacity-60 cursor-wait",
                    )}
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    {isEnRoute
                      ? "En Route"
                      : navTarget.kind === "pickup"
                        ? "Navigate · Pickup"
                        : "Navigate"}
                  </a>
                  {isPickupOffered && !isPickedUp && (
                    <button
                      onClick={handleMarkPickedUp}
                      disabled={markPickedUp.isPending}
                      data-testid={`button-mark-picked-up-${job.id}`}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-xs font-bold hover:bg-amber-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <PackageCheck className="w-3.5 h-3.5" />
                      {markPickedUp.isPending ? "Saving…" : "Mark Picked Up"}
                    </button>
                  )}
                  <button onClick={() => setMarkServedOpen(true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-bold hover:bg-emerald-50 transition-colors">
                    <CircleCheck className="w-3.5 h-3.5" />Mark Served
                  </button>
                  <button onClick={() => setLogAttemptOpen(true)} data-testid={`button-log-attempt-${job.id}`} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-200 text-amber-700 text-xs font-semibold hover:bg-amber-50 transition-colors">
                    <AlertTriangle className="w-3.5 h-3.5" />Log Attempt
                  </button>
                  <button
                    onClick={() => setReleaseOpen(true)}
                    data-testid={`button-release-${job.id}`}
                    title="Return this job to the open queue"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50 transition-colors"
                  >
                    <ArrowUpFromLine className="w-3.5 h-3.5" />Return
                  </button>
                </>
              )}
              {isServed && (
                <Link href={`/app/server/proof/${job.id}`} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-bold hover:bg-emerald-50 transition-colors">
                  <CircleCheck className="w-3.5 h-3.5" />View Proof
                </Link>
              )}
            </div>
          </div>
          {/* Anchor the dismiss + expand chevrons to the top-right of the
              card on mobile (where the row is column-stacked) so they
              don't dangle below the action buttons. On sm+ they stay as
              normal flex children at the end of the row. */}
          <div className="absolute top-3 right-3 flex items-start gap-1 sm:static sm:top-auto sm:right-auto">
            {!mine && (
              <button
                onClick={handleDismiss}
                disabled={dismissJob.isPending}
                data-testid={`button-dismiss-${job.id}`}
                title="Hide this job from my feed"
                aria-label="Hide this job from my feed"
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors self-start text-gray-400 hover:text-gray-600 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => setOpen(v => !v)}
              aria-label={open ? "Hide job details" : "Show job details"}
              aria-expanded={open}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors self-start"
            >
              {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
            </button>
          </div>
        </div>
        {open && (
          <div className="border-t border-gray-100 px-5 py-4 bg-gray-50">
            {isPickupOffered && (
              <div
                data-testid={`pickup-section-${job.id}`}
                className={cn(
                  "mb-3 rounded-lg border p-3",
                  isPickedUp
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-amber-200 bg-amber-50",
                )}
              >
                <p
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-wider flex items-center gap-1",
                    isPickedUp ? "text-emerald-700" : "text-amber-700",
                  )}
                >
                  {isPickedUp ? (
                    <>
                      <PackageCheck className="w-3 h-3" />Documents Picked Up
                    </>
                  ) : (
                    <>
                      <Package className="w-3 h-3" />Pickup First
                    </>
                  )}
                </p>
                <p
                  className={cn(
                    "text-sm font-medium mt-1",
                    isPickedUp ? "text-emerald-900" : "text-amber-900",
                  )}
                >
                  {/* Always show the FIRM pickup address here, regardless of
                      whether navTarget routed to recipient (which happens for
                      "either" jobs by design). Falls back to navTarget for
                      strict-pickup legacy jobs that may be missing pickup
                      address columns. */}
                  {[
                    job.pickupAddress,
                    job.pickupCity,
                    job.pickupState,
                    job.pickupZip,
                  ]
                    .filter((p): p is string => Boolean(p && p.trim()))
                    .join(", ") || navTarget.address}
                </p>
                {isPickedUp && job.pickedUpAt && (
                  <p
                    className="text-xs text-emerald-800 mt-0.5"
                    data-testid={`pickup-time-${job.id}`}
                  >
                    Collected {format(new Date(job.pickedUpAt), "MMM d, yyyy 'at' h:mm a")}
                  </p>
                )}
                {!isPickedUp && (job.pickupContactName || job.pickupContactPhone) && (
                  <p className="text-xs text-amber-800 mt-0.5">
                    Contact: {job.pickupContactName}
                    {job.pickupContactPhone ? ` · ${job.pickupContactPhone}` : ""}
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-xs text-gray-500 mb-0.5">Recipient</p><p className="font-medium text-gray-800">{job.recipientName}</p></div>
              <div><p className="text-xs text-gray-500 mb-0.5">Location</p><p className="font-medium text-gray-800">{location}</p></div>
              {job.caseNumber && <div><p className="text-xs text-gray-500 mb-0.5">Case #</p><p className="font-mono text-xs text-gray-800">{job.caseNumber}</p></div>}
            </div>
            <div className="mt-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">
                Timeline
              </p>
              <JobTimeline job={job} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {canViewDocuments && (
                <button
                  type="button"
                  onClick={() => setDocsOpen(true)}
                  data-testid={`button-view-documents-${job.id}`}
                  className="text-xs font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-1"
                >
                  <FileText className="w-3 h-3" />View Documents
                </button>
              )}
              {isServed && (
                <Link
                  href={`/app/server/proof/${job.id}`}
                  className="text-xs font-medium text-amber-600 hover:text-amber-700 flex items-center gap-1"
                >
                  View Proof of Service <ArrowRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
      {markServedOpen && (
        <MarkServedModal
          job={{
            id: job.id,
            recipientName: job.recipientName,
            documentType: job.documentType,
            recipientAddress: job.recipientAddress,
            recipientCity: job.recipientCity,
            recipientState: job.recipientState,
            recipientZip: job.recipientZip,
          }}
          onClose={() => setMarkServedOpen(false)}
        />
      )}
      {logAttemptOpen && (
        <LogAttemptModal
          job={{
            id: job.id,
            recipientName: job.recipientName,
            documentType: job.documentType,
            recipientState: job.recipientState,
          }}
          onClose={() => setLogAttemptOpen(false)}
        />
      )}
      {docsOpen && (
        <GetDocumentsModal
          job={{
            id: job.id,
            documentType: job.documentType,
            documentHandling: job.documentHandling ?? null,
            pickupAddress: job.pickupAddress ?? null,
            pickupCity: job.pickupCity ?? null,
            pickupState: job.pickupState ?? null,
            pickupZip: job.pickupZip ?? null,
          }}
          onClose={() => setDocsOpen(false)}
        />
      )}
      {releaseOpen && (
        <ReleaseJobModal
          job={{ id: job.id, recipientName: job.recipientName }}
          onClose={() => setReleaseOpen(false)}
        />
      )}
    </>
  );
}

export default function ServerJobFeed() {
  const { data: jobs, isLoading } = useListJobs();
  const { data: serverStatus } = useGetServerStatus();
  const me = useMe();
  const [tab, setTab] = useState<"available" | "mine">("available");
  const displayName =
    [me.data?.firstName, me.data?.lastName].filter(Boolean).join(" ") ||
    me.data?.email ||
    "Server";

  const available = jobs?.filter(j => AVAILABLE_STATUSES.includes(j.status)) ?? [];
  const mine = jobs?.filter(j => MY_STATUSES.includes(j.status)) ?? [];
  const displayed = tab === "available" ? available : mine;

  const isVerified = serverStatus?.credentialing.status === "verified";
  const payoutsEnabled = serverStatus?.payouts.payoutsEnabled ?? false;
  const accountStatus = serverStatus?.serverStatus ?? "active";
  const isBlocked =
    accountStatus === "suspended" ||
    accountStatus === "inactive" ||
    accountStatus === "pending";
  const canAccept = !isBlocked && isVerified && payoutsEnabled;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Job Feed</h1>
          <p className="text-sm text-gray-500 mt-0.5">Viewing as: {displayName}</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ backgroundColor: "rgba(74,222,128,0.1)", color: "#22c55e", border: "1px solid rgba(74,222,128,0.3)" }}>
          <Zap className="w-3.5 h-3.5" />{available.length} Available Near You
        </div>
      </div>

      {/* Account-status block (admin-controlled) */}
      {isBlocked && (
        <div
          data-testid="banner-server-blocked"
          className={cn(
            "rounded-2xl border p-4 flex items-start gap-3",
            accountStatus === "suspended"
              ? "bg-amber-50 border-amber-200"
              : accountStatus === "inactive"
              ? "bg-gray-100 border-gray-300"
              : "bg-blue-50 border-blue-200",
          )}
        >
          <ShieldAlert
            className={cn(
              "w-5 h-5 mt-0.5 flex-shrink-0",
              accountStatus === "suspended"
                ? "text-amber-600"
                : accountStatus === "inactive"
                ? "text-gray-600"
                : "text-blue-600",
            )}
          />
          <div className="flex-1">
            <p className="text-sm font-bold text-gray-900">
              {accountStatus === "suspended"
                ? "Your account is suspended"
                : accountStatus === "inactive"
                ? "Your account is inactive"
                : "Your account is pending review"}
            </p>
            <p className="text-xs text-gray-700 mt-0.5">
              {accountStatus === "suspended"
                ? "You can't accept new jobs while suspended. Contact support@servedlegal.com to resolve this."
                : accountStatus === "inactive"
                ? "This account has been deactivated. Email support@servedlegal.com if this was a mistake."
                : "An admin will activate your account shortly."}
            </p>
          </div>
        </div>
      )}

      {/* Eligibility banner (only when account is active but onboarding incomplete) */}
      {!isBlocked && !canAccept && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
            {!isVerified ? (
              <ShieldCheck className="w-4 h-4 text-amber-600" />
            ) : (
              <Banknote className="w-4 h-4 text-amber-600" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-900">
              {!isVerified
                ? "Finish credentialing to accept jobs"
                : "Connect your bank to accept jobs"}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {!isVerified
                ? "Your $24.99 background check unlocks the Accept button on every job."
                : "Stripe Express needs to be fully onboarded before you can be paid for accepted jobs."}
            </p>
          </div>
          <Link
            href={isVerified ? "/app/server/dashboard" : "/app/server/credentialing"}
            data-testid="link-fix-eligibility"
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors flex-shrink-0"
          >
            {isVerified ? "Connect Bank" : "Get Verified"}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {(["available", "mine"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("px-4 py-2 rounded-lg text-sm font-semibold transition-colors", tab === t ? "bg-amber-400 text-black" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50")}>
            {t === "available" ? `Available (${available.length})` : `My Jobs (${mine.length})`}
          </button>
        ))}
      </div>

      {/* Earnings hint */}
      {tab === "available" && available.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-medium">
          <Zap className="w-4 h-4 flex-shrink-0" />
          Accept a job to get documents and navigate to the serve location. You earn 80% of each job.
        </div>
      )}

      {/* Job list */}
      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-52 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-36" />
            </div>
          ))
        ) : displayed.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <Zap className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">{tab === "available" ? "No jobs available right now. Check back soon." : "You haven't accepted any jobs yet."}</p>
          </div>
        ) : (
          displayed.map(job => (
            <JobFeedCard
              key={job.id}
              job={job}
              mine={tab === "mine"}
              canAccept={canAccept}
            />
          ))
        )}
      </div>
    </div>
  );
}
