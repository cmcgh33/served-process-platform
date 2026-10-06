import { useMemo } from "react";
import { format } from "date-fns";
import { Mail, MapPin, User, Loader2 } from "lucide-react";
import {
  useListJobAttempts,
  getListJobAttemptsQueryKey,
  type ServiceAttempt,
} from "@workspace/api-client-react";

const COMPLETING_OUTCOMES = new Set([
  "personal",
  "substitute",
  "mail",
  "posting",
]);

/**
 * Read-only "Service Details" panel for the attorney + requester job
 * detail pages. Surfaces the substitute-service facts captured by the
 * server (recipient name, relationship, structured physical
 * description) and the lifecycle of the substitute follow-up mailing
 * commitment vs completion.
 *
 * Only renders when the *completing* attempt is a substitute. Personal
 * service shows nothing (the existing "Service confirmed" card already
 * carries every fact). Posting/mail outcomes also render nothing here
 * since they have their own affidavit branches and aren't covered by
 * Phase 2 substitute hardening.
 */
export function SubstituteServiceDetails({ jobId }: { jobId: number }) {
  const { data: attempts, isLoading } = useListJobAttempts(jobId, {
    query: {
      queryKey: getListJobAttemptsQueryKey(jobId),
      enabled: Number.isFinite(jobId) && jobId > 0,
    },
  });

  // Mirror the server-side completingAttempt resolution: most-recent
  // completing outcome wins. The list endpoint already returns attempts
  // newest-first, so we walk it in order and take the first completing
  // entry. (The previous `.reverse().find()` flipped the list to oldest-
  // first and would surface stale substitute facts whenever a job had
  // multiple completing attempts.) If no completing attempt exists,
  // there are no substitute facts to surface.
  const completing = useMemo<ServiceAttempt | null>(() => {
    if (!attempts || attempts.length === 0) return null;
    return attempts.find((a) => COMPLETING_OUTCOMES.has(a.outcome)) ?? null;
  }, [attempts]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading service details…
      </div>
    );
  }

  if (!completing || completing.outcome !== "substitute") return null;

  // Condense whichever structured physical-description fields are
  // present onto a single line (mirrors affidavit rendering).
  const physical: string[] = [];
  if (completing.recipientAgeEstimate?.trim()) {
    physical.push(`Age ${completing.recipientAgeEstimate.trim()}`);
  }
  if (completing.recipientGender?.trim()) {
    physical.push(completing.recipientGender.trim());
  }
  if (completing.recipientHeight?.trim()) {
    physical.push(`${completing.recipientHeight.trim()} tall`);
  }
  if (completing.recipientWeight?.trim()) {
    physical.push(completing.recipientWeight.trim());
  }

  const mailingCommitted = Boolean(
    completing.mailingDate || completing.mailingAddress,
  );
  const mailingDone = Boolean(completing.mailingCompletedAt);

  return (
    <section
      className="bg-white rounded-xl border border-gray-200 p-5 space-y-4"
      data-testid="card-substitute-service-details"
    >
      <h2 className="font-semibold text-gray-900 flex items-center gap-2">
        <User className="w-4 h-4 text-amber-500" />
        Substitute Service Details
      </h2>

      <div className="grid gap-3 text-sm">
        {completing.substituteRecipientName && (
          <div>
            <div className="text-xs text-gray-500 mb-0.5">Person served</div>
            <div className="font-medium text-gray-900">
              {completing.substituteRecipientName}
            </div>
          </div>
        )}
        {completing.recipientRelationship && (
          <div>
            <div className="text-xs text-gray-500 mb-0.5">Relationship to named party</div>
            <div className="text-gray-800">{completing.recipientRelationship}</div>
          </div>
        )}
        {physical.length > 0 && (
          <div>
            <div className="text-xs text-gray-500 mb-0.5">Physical description</div>
            <div className="text-gray-800">{physical.join(" · ")}</div>
          </div>
        )}
        {completing.recipientIdentifyingFeatures && (
          <div>
            <div className="text-xs text-gray-500 mb-0.5">Identifying features</div>
            <div className="text-gray-800">
              {completing.recipientIdentifyingFeatures}
            </div>
          </div>
        )}
        {completing.serviceAddress && (
          <div>
            <div className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> Address of service
            </div>
            <div className="text-gray-800">
              {completing.serviceAddress}
              {[completing.serviceCity, completing.serviceState]
                .filter(Boolean)
                .join(", ") && (
                <>
                  <br />
                  {[completing.serviceCity, completing.serviceState]
                    .filter(Boolean)
                    .join(", ")}{" "}
                  {completing.serviceZip ?? ""}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mailing-status badge — three states. The "not committed" case
          intentionally renders nothing: substitute service in non-NV
          jurisdictions (or the unusual NV case where mailing wasn't
          required) shouldn't surface a misleading "pending" pill. */}
      {mailingCommitted && (
        <div
          className={
            "rounded-lg border p-3 flex items-start gap-3 " +
            (mailingDone
              ? "bg-emerald-50 border-emerald-200"
              : "bg-amber-50 border-amber-200")
          }
          data-testid={
            mailingDone ? "badge-mailing-confirmed" : "badge-mailing-pending"
          }
        >
          <Mail
            className={
              "w-4 h-4 mt-0.5 flex-shrink-0 " +
              (mailingDone ? "text-emerald-600" : "text-amber-600")
            }
          />
          <div className="text-xs">
            {mailingDone ? (
              <p className="text-emerald-900">
                <span className="font-bold">Follow-up mailing completed.</span>{" "}
                Mailed on{" "}
                {format(
                  new Date(completing.mailingCompletedAt as string),
                  "MMMM d, yyyy",
                )}
                {completing.mailingAddress
                  ? ` to ${completing.mailingAddress}`
                  : ""}
                .
              </p>
            ) : (
              <p className="text-amber-900">
                <span className="font-bold">Mailing pending.</span> Server
                committed to mailing a copy of the documents
                {completing.mailingAddress
                  ? ` to ${completing.mailingAddress}`
                  : ""}
                {completing.mailingDate
                  ? ` on or about ${format(
                      new Date(completing.mailingDate),
                      "MMMM d, yyyy",
                    )}`
                  : ""}
                . The affidavit will be updated once the server confirms the
                mailing was deposited.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
