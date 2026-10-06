import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  useGetJob,
  useUpdateJob,
  useEnsureJobAffidavit,
  getGetJobQueryKey,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  MapPin,
  FileText,
  CheckCircle,
  Clock,
  Camera,
  Download,
  Navigation,
  XCircle,
  User,
  Briefcase,
  Phone,
  Package,
  PackageCheck,
  CreditCard,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { resolveStorageObjectUrl } from "@/lib/storageUrl";
import { privacyServerName } from "@/lib/privacyName";
import { JobTimeline } from "@/components/JobTimeline";
import { SubstituteServiceDetails } from "@/components/SubstituteServiceDetails";
import { cn } from "@/lib/utils";
import { useResumeJobPayment } from "@/lib/resume-job-payment";

const STATUS_COLORS: Record<string, string> = {
  served: "bg-emerald-100 text-emerald-700 border-emerald-200",
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  // Distinct red-tinted style so unpaid jobs are visually unmistakable
  // — previously they fell through to the gray default and were trivially
  // confused with paid jobs awaiting assignment.
  pending_payment: "bg-rose-100 text-rose-700 border-rose-200",
  in_progress: "bg-sky-100 text-sky-700 border-sky-200",
  assigned: "bg-violet-100 text-violet-700 border-violet-200",
  failed: "bg-red-100 text-red-700 border-red-200",
  accepted: "bg-teal-100 text-teal-700 border-teal-200",
  cancelled: "bg-gray-100 text-gray-600 border-gray-200",
};

const STATUS_LABEL: Record<string, string> = {
  served: "Served",
  pending: "Pending",
  pending_payment: "Payment Required",
  in_progress: "In Progress",
  assigned: "Assigned",
  failed: "Failed",
  accepted: "Accepted",
  cancelled: "Cancelled",
};

/**
 * Read-only job detail page used by both the Requester and Attorney
 * portals. The data model + permitted actions are identical (view +
 * cancel-while-unstarted), so we render the same component and just
 * swap the layout wrapper at the route level via `withRoleLayout`.
 * The `portalBasePath` prop drives the back-link target so each portal
 * navigates back to its OWN job list instead of cross-linking. Mounted
 * at /app/requester/jobs/:id (RequesterLayout) and /app/attorney/jobs/:id
 * (AttorneyLayout).
 */
export default function RequesterJobDetail({
  portalBasePath = "/app/requester",
}: { portalBasePath?: string } = {}) {
  const { id } = useParams<{ id: string }>();
  const jobId = Number.parseInt(id ?? "", 10);
  const qc = useQueryClient();

  const { data: job, isLoading } = useGetJob(jobId, {
    query: {
      queryKey: getGetJobQueryKey(jobId),
      enabled: Number.isFinite(jobId) && jobId > 0,
      refetchOnWindowFocus: true,
      refetchInterval: (q) => {
        const s = q.state.data?.status;
        return s &&
          ["pending", "assigned", "in_progress", "en_route"].includes(s)
          ? 15000
          : false;
      },
    },
  });

  const updateJob = useUpdateJob();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const { resumePayment, resumingPayment } = useResumeJobPayment();

  // On-demand affidavit generator. The post-commit hook on /confirm-service
  // already builds the PDF, but for jobs that completed before the PDF
  // pipeline existed (or where a transient error skipped generation) the
  // requester needs a way to trigger it themselves.
  const ensureAffidavit = useEnsureJobAffidavit({
    mutation: {
      onSuccess: (data) => {
        if (Number.isFinite(jobId)) {
          qc.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
        }
        if (data?.proofPdfUrl) {
          // Open the freshly-generated PDF for the user. The downstream
          // refetch will also light up the persistent Download Affidavit link.
          window.open(resolveStorageObjectUrl(data.proofPdfUrl), "_blank", "noopener,noreferrer");
        }
      },
      onError: (err: unknown) => {
        const message =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          "Couldn't generate the affidavit. Please try again.";
        toast.error(message);
      },
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-64 bg-gray-200 rounded" />
        <div className="h-40 bg-gray-100 rounded-xl" />
        <div className="h-64 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <h2 className="font-semibold text-gray-900">Job not found</h2>
        <p className="text-sm text-gray-500 mt-1">
          We couldn't find that job, or you don't have access to view it.
        </p>
        <Link
          href={`${portalBasePath}/jobs`}
          className="inline-flex items-center gap-2 mt-5 text-sm font-semibold text-amber-600 hover:text-amber-700"
        >
          <ArrowLeft className="w-4 h-4" /> Back to My Jobs
        </Link>
      </div>
    );
  }

  const status = job.status ?? "pending";
  const colorClass =
    STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600 border-gray-200";
  const label = STATUS_LABEL[status] ?? status;
  const affidavitHref = job.proofPdfUrl
    ? resolveStorageObjectUrl(job.proofPdfUrl)
    : null;
  const recipientLine = [job.recipientCity, job.recipientState, job.recipientZip]
    .filter(Boolean)
    .join(", ");
  // Unpaid jobs are cancellable so customers can clean up abandoned
  // checkout attempts; paid+unstarted jobs are also cancellable; once
  // a server marks the job in_progress that option goes away.
  const canCancel =
    status === "pending" ||
    status === "assigned" ||
    status === "pending_payment";
  const isAwaitingPayment = status === "pending_payment";

  const handleCancel = () => {
    updateJob.mutate(
      { id: jobId, data: { status: "cancelled" } },
      {
        onSuccess: (data) => {
          qc.setQueryData(getGetJobQueryKey(jobId), data);
          setConfirmingCancel(false);
          toast.success("Job cancelled.");
        },
        onError: (err: unknown) => {
          const message =
            err && typeof err === "object" && "message" in err
              ? String((err as { message?: unknown }).message)
              : "Could not cancel job.";
          toast.error(message);
        },
      },
    );
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link
          href={`${portalBasePath}/jobs`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="w-4 h-4" /> Back to My Jobs
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">
              {job.documentType
                ? `Serve ${job.documentType}`
                : "Service of Process"}
            </h1>
            <span
              className={cn(
                "text-xs font-semibold px-2.5 py-1 rounded-full border",
                colorClass,
              )}
            >
              {label}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {job.platformRef && (
              <>
                <span className="font-mono">{job.platformRef}</span>
                <span className="mx-2">·</span>
              </>
            )}
            Created {format(new Date(job.createdAt), "MMM d, yyyy")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {status === "in_progress" && (
            <Link
              href={`/app/requester/tracking/${job.id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-400 hover:bg-amber-500 text-black text-sm font-bold px-4 py-2 transition-colors"
            >
              <Navigation className="w-4 h-4" />
              Track Serve
            </Link>
          )}
          {status === "served" && affidavitHref && (
            <a
              href={affidavitHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold px-4 py-2 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download Affidavit
            </a>
          )}
          {status === "served" && !affidavitHref && (
            <button
              type="button"
              onClick={() => {
                if (!Number.isFinite(jobId)) return;
                ensureAffidavit.mutate({ id: jobId });
              }}
              disabled={ensureAffidavit.isPending}
              data-testid="button-generate-affidavit"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-bold px-4 py-2 transition-colors"
            >
              {ensureAffidavit.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Preparing affidavit…
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Download Affidavit
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <FileText className="w-4 h-4 text-amber-500" />
              Job details
            </h2>
            <dl className="grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs text-gray-500 mb-0.5">Document type</dt>
                <dd className="font-medium text-gray-800">
                  {job.documentType || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500 mb-0.5">Case number</dt>
                <dd className="font-mono text-gray-800">
                  {job.caseNumber || "—"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-gray-500 mb-0.5">Matter name</dt>
                <dd className="font-medium text-gray-800">
                  {job.matterName || "—"}
                </dd>
              </div>
            </dl>
          </section>

          {job.documentHandling === "pickup" && (
            <section
              className={cn(
                "rounded-xl border p-5",
                job.pickedUpAt
                  ? "border-emerald-200 bg-emerald-50/60"
                  : "border-amber-200 bg-amber-50/60",
              )}
            >
              <h2
                className={cn(
                  "font-semibold flex items-center gap-2 mb-2",
                  job.pickedUpAt ? "text-emerald-800" : "text-amber-900",
                )}
              >
                {job.pickedUpAt ? (
                  <>
                    <PackageCheck className="w-4 h-4" /> Documents picked up
                  </>
                ) : (
                  <>
                    <Package className="w-4 h-4" /> Document pickup pending
                  </>
                )}
              </h2>
              <p
                className={cn(
                  "text-sm",
                  job.pickedUpAt ? "text-emerald-800/80" : "text-amber-900/80",
                )}
              >
                {job.pickedUpAt
                  ? `Collected on ${format(
                      new Date(job.pickedUpAt),
                      "PPP 'at' p",
                    )}.`
                  : "Your server will collect the physical documents from the pickup location before serving the recipient."}
              </p>
              <div className="mt-3 text-sm text-gray-700">
                <div className="text-xs text-gray-500 mb-0.5">
                  Pickup address
                </div>
                <div>{job.pickupAddress || "—"}</div>
                <div>
                  {[job.pickupCity, job.pickupState, job.pickupZip]
                    .filter(Boolean)
                    .join(", ")}
                </div>
                {(job.pickupContactName || job.pickupContactPhone) && (
                  <div className="mt-3 grid gap-1">
                    <div className="text-xs text-gray-500">Pickup contact</div>
                    {job.pickupContactName && (
                      <div className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5 text-gray-500" />
                        {job.pickupContactName}
                      </div>
                    )}
                    {job.pickupContactPhone && (
                      <a
                        href={`tel:${job.pickupContactPhone}`}
                        className="flex items-center gap-2 text-amber-700 hover:underline"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        {job.pickupContactPhone}
                      </a>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4 text-amber-500" />
              Recipient
            </h2>
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs text-gray-500 mb-0.5">Name</div>
                <div className="font-medium text-gray-900 text-base">
                  {job.recipientName}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-0.5">Address</div>
                <div className="text-gray-800">{job.recipientAddress}</div>
                {recipientLine && (
                  <div className="text-gray-800">{recipientLine}</div>
                )}
              </div>
              {job.notes && (
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">
                    Instructions
                  </div>
                  <p className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-gray-700 whitespace-pre-wrap">
                    {job.notes}
                  </p>
                </div>
              )}
            </div>
          </section>

          {job.servedAt && (
            <section className="bg-emerald-50/60 rounded-xl border border-emerald-200 p-5">
              <h2 className="font-semibold text-emerald-800 flex items-center gap-2 mb-4">
                <CheckCircle className="w-4 h-4" /> Service confirmed
              </h2>
              <div className="grid sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs text-emerald-800/70 mb-0.5">
                    Served at
                  </div>
                  <div className="font-medium text-emerald-900">
                    {format(new Date(job.servedAt), "PPP 'at' p")}
                  </div>
                </div>
                {job.gpsLat != null && job.gpsLng != null && (
                  <div>
                    <div className="text-xs text-emerald-800/70 mb-0.5">
                      Location
                    </div>
                    <a
                      href={`https://maps.google.com/?q=${job.gpsLat},${job.gpsLng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-emerald-700 hover:underline"
                    >
                      {job.gpsLat.toFixed(5)}, {job.gpsLng.toFixed(5)}
                    </a>
                  </div>
                )}
                {job.proofPhotoUrl && (
                  <div className="sm:col-span-2">
                    <div className="text-xs text-emerald-800/70 mb-2 flex items-center gap-1">
                      <Camera className="w-3.5 h-3.5" /> Proof photo
                    </div>
                    <a
                      href={resolveStorageObjectUrl(job.proofPhotoUrl)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={resolveStorageObjectUrl(job.proofPhotoUrl)}
                        alt="Proof of service"
                        className="max-h-64 rounded-lg border border-emerald-200"
                      />
                    </a>
                  </div>
                )}
              </div>
            </section>
          )}

          <SubstituteServiceDetails jobId={jobId} />

          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-amber-500" />
              Timeline
            </h2>
            <JobTimeline
              job={job}
              pollInterval={
                ["pending", "assigned", "in_progress", "en_route"].includes(
                  status,
                )
                  ? 15000
                  : undefined
              }
            />
          </section>
        </div>

        <div className="space-y-6">
          {isAwaitingPayment ? (
            // Payment-required card replaces "Process server" for unpaid
            // jobs so customers don't see the misleading "we'll match a
            // server shortly" copy on a job that hasn't been paid for.
            <section className="bg-rose-50 rounded-xl border border-rose-200 p-5">
              <h2 className="font-semibold text-rose-900 flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                Payment required
              </h2>
              <p className="text-sm text-rose-800/90 mb-4">
                This job is saved but hasn't been paid for yet, so we
                haven't started matching a server. Complete checkout to
                publish it to our verified servers.
              </p>
              <button
                onClick={() =>
                  resumePayment({
                    id: String(job.id),
                    grossCents: job.grossCents,
                    documentType: job.documentType,
                    recipientName: job.recipientName,
                  })
                }
                disabled={resumingPayment}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-amber-400 hover:bg-amber-500 disabled:bg-gray-300 disabled:text-gray-500 text-black text-sm font-bold px-4 py-2 transition-colors"
              >
                <CreditCard className="w-4 h-4" />
                {resumingPayment ? "Opening checkout…" : "Complete payment"}
              </button>
              {typeof job.grossCents === "number" && job.grossCents > 0 && (
                <p className="text-xs text-rose-700/80 mt-2 text-center">
                  Amount: ${(job.grossCents / 100).toFixed(2)}
                </p>
              )}
            </section>
          ) : (
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
                <Briefcase className="w-4 h-4 text-amber-500" />
                Process server
              </h2>
              {job.server ? (
                <div className="space-y-1.5 text-sm">
                  <div className="font-medium text-gray-900">
                    {privacyServerName(job.server.name)}
                  </div>
                  <div className="text-gray-500 text-xs">
                    Verified SERVED. Process Server
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-500">
                  We'll match a verified server in your area shortly. You'll
                  get an update as soon as they're assigned.
                </div>
              )}
            </section>
          )}

          {canCancel && (
            <section className="bg-white rounded-xl border border-red-200 p-5">
              <h2 className="text-xs font-bold uppercase tracking-wide text-red-600 mb-2">
                {isAwaitingPayment ? "Discard this job" : "Cancel this job"}
              </h2>
              <p className="text-xs text-gray-500 mb-3">
                {isAwaitingPayment
                  ? "Drop this saved job if you'd rather start a new one. Nothing has been charged."
                  : "You can cancel any time before service begins. Once a server marks the job in progress this option goes away."}
              </p>
              {confirmingCancel ? (
                <div className="space-y-2">
                  <button
                    onClick={handleCancel}
                    disabled={updateJob.isPending}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold px-4 py-2 transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                    {updateJob.isPending ? "Cancelling…" : "Yes, cancel job"}
                  </button>
                  <button
                    onClick={() => setConfirmingCancel(false)}
                    disabled={updateJob.isPending}
                    className="w-full text-xs text-gray-500 hover:text-gray-700"
                  >
                    Keep this job
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmingCancel(true)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-red-300 hover:bg-red-50 text-red-700 text-sm font-semibold px-4 py-2 transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  Cancel job
                </button>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
