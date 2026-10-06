import { useListJobAttempts, getListJobAttemptsQueryKey } from "@workspace/api-client-react";
import type { ServiceAttempt } from "@workspace/api-client-react";
import { format } from "date-fns";
import { CheckCircle2, AlertTriangle, MapPin, Camera, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const OUTCOME_LABEL: Record<string, string> = {
  personal: "Personal service",
  substitute: "Substitute service",
  unable: "Unable to serve",
  // Legacy values (pre-task-22 backfill) kept defensively in case any
  // rows escape the migration backfill in older mirrors.
  served: "Personal service",
  no_answer: "No answer",
  refused: "Refused",
  wrong_address: "Wrong address",
  gated: "Gated / inaccessible",
  other: "Other",
};

const UNABLE_REASON_LABEL: Record<string, string> = {
  no_answer: "No answer",
  refused: "Recipient refused service",
  wrong_address: "Wrong / vacant address",
  gated: "Gated / inaccessible",
  other: "Other",
};

const OUTCOME_STYLE: Record<string, string> = {
  personal: "bg-emerald-100 text-emerald-700 border-emerald-200",
  substitute: "bg-sky-100 text-sky-700 border-sky-200",
  unable: "bg-amber-100 text-amber-700 border-amber-200",
  // legacy
  served: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

function isCompleted(outcome: string): boolean {
  return outcome === "personal" || outcome === "substitute" || outcome === "served";
}

function photoSrc(photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null;
  if (photoUrl.startsWith("http")) return photoUrl;
  return photoUrl.startsWith("/") ? photoUrl : `/${photoUrl}`;
}

interface Props {
  jobId: number;
  pollInterval?: number;
  className?: string;
}

export function AttemptHistory({ jobId, pollInterval, className }: Props) {
  const { data: attempts, isLoading } = useListJobAttempts(jobId, {
    query: {
      queryKey: getListJobAttemptsQueryKey(jobId),
      enabled: !!jobId,
      refetchInterval: pollInterval ?? false,
      refetchOnWindowFocus: true,
    },
  });

  if (isLoading) {
    return <div className={cn("text-sm text-muted-foreground", className)}>Loading attempts…</div>;
  }

  if (!attempts || attempts.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground italic", className)}>
        No service attempts logged yet.
      </div>
    );
  }

  // Show most-recent attempt first (API returns ascending by attemptedAt).
  const sortedAttempts = [...attempts].sort(
    (a, b) => new Date(b.attemptedAt).getTime() - new Date(a.attemptedAt).getTime(),
  );

  return (
    <ol className={cn("space-y-3", className)} data-testid="attempt-history">
      {sortedAttempts.map((a: ServiceAttempt, i: number) => {
        const completed = isCompleted(a.outcome);
        const isSubstitute = a.outcome === "substitute";
        const Icon = isSubstitute ? Users : completed ? CheckCircle2 : AlertTriangle;
        const photo = photoSrc(a.photoUrl);
        const outcomeLabel = OUTCOME_LABEL[a.outcome] ?? a.outcome;
        const reasonLabel = a.unableReason ? UNABLE_REASON_LABEL[a.unableReason] ?? a.unableReason : null;

        const substituteParts: string[] = [];
        if (isSubstitute) {
          if (a.substituteRecipientName) substituteParts.push(a.substituteRecipientName);
          if (a.substituteOver18) substituteParts.push("over 18");
          if (a.substituteVerifiedResidence) substituteParts.push("residence verified");
        }

        return (
          <li
            key={a.id}
            data-testid={`attempt-${a.id}`}
            className={cn(
              "border rounded-xl p-4 bg-white",
              completed && !isSubstitute ? "border-emerald-200" : isSubstitute ? "border-sky-200" : "border-gray-200",
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
                  isSubstitute
                    ? "bg-sky-100 text-sky-600"
                    : completed
                      ? "bg-emerald-100 text-emerald-600"
                      : "bg-amber-100 text-amber-600",
                )}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "text-xs font-bold px-2 py-0.5 rounded-full border",
                      OUTCOME_STYLE[a.outcome] ?? "bg-gray-100 text-gray-700 border-gray-200",
                    )}
                  >
                    {outcomeLabel}
                  </span>
                  {a.outcome === "unable" && reasonLabel && (
                    <span className="text-xs font-semibold text-amber-700">· {reasonLabel}</span>
                  )}
                  <span className="text-xs text-gray-500">Attempt #{sortedAttempts.length - i}</span>
                  <span className="text-xs text-gray-500">·</span>
                  <span className="text-xs text-gray-700 font-medium">
                    {format(new Date(a.attemptedAt), "MMM d, yyyy 'at' h:mm a")}
                  </span>
                </div>
                {isSubstitute && substituteParts.length > 0 && (
                  <p className="text-sm text-sky-900" data-testid={`attempt-${a.id}-substitute`}>
                    Served <span className="font-semibold">{a.substituteRecipientName ?? "—"}</span>
                    {substituteParts.length > 1 && (
                      <span className="text-sky-700"> ({substituteParts.slice(1).join(", ")})</span>
                    )}
                  </p>
                )}
                {a.notes && <p className="text-sm text-gray-700">{a.notes}</p>}
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <a
                    href={`https://maps.google.com/?q=${a.gpsLat},${a.gpsLng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sky-700 hover:underline font-mono"
                  >
                    <MapPin className="w-3 h-3" />
                    {a.gpsLat.toFixed(5)}, {a.gpsLng.toFixed(5)}
                  </a>
                  {photo && (
                    <a
                      href={photo}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-amber-700 hover:underline"
                    >
                      <Camera className="w-3 h-3" />View photo
                    </a>
                  )}
                </div>
                {photo && (
                  <a href={photo} target="_blank" rel="noreferrer" className="block mt-2">
                    <img
                      src={photo}
                      alt={`Attempt ${a.id} photo`}
                      className="max-h-40 rounded-md border border-gray-200"
                    />
                  </a>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
