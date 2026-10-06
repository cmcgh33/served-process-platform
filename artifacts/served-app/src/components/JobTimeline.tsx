import {
  useListJobAttempts,
  useListJobReleases,
  getListJobAttemptsQueryKey,
  getListJobReleasesQueryKey,
} from "@workspace/api-client-react";
import type {
  Job,
  ServiceAttempt,
  JobReleaseEvent,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Camera,
  Users,
  PackageCheck,
  Navigation,
  RotateCcw,
  XCircle,
  FilePlus2,
  UserCheck,
} from "lucide-react";
import type { ComponentType } from "react";
import { resolveStorageObjectUrl } from "@/lib/storageUrl";
import { privacyServerName } from "@/lib/privacyName";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "amber" | "sky" | "emerald" | "purple" | "red" | "rose";

interface TimelineEvent {
  key: string;
  timestamp: string;
  label: string;
  actor?: string | null;
  notes?: string | null;
  tone: Tone;
  icon: ComponentType<{ className?: string }>;
  gps?: { lat: number; lng: number } | null;
  photoUrl?: string | null;
}

const TONE_ICON_BG: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-600",
  amber: "bg-amber-100 text-amber-600",
  sky: "bg-sky-100 text-sky-600",
  emerald: "bg-emerald-100 text-emerald-600",
  purple: "bg-purple-100 text-purple-600",
  red: "bg-red-100 text-red-600",
  rose: "bg-rose-100 text-rose-600",
};

const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-gray-200",
  amber: "border-amber-200",
  sky: "border-sky-200",
  emerald: "border-emerald-200",
  purple: "border-purple-200",
  red: "border-red-200",
  rose: "border-rose-200",
};

const OUTCOME_LABEL: Record<string, string> = {
  personal: "Personal service attempt",
  substitute: "Substitute service attempt",
  unable: "Unable to serve",
  served: "Personal service attempt",
};

const UNABLE_REASON_LABEL: Record<string, string> = {
  no_answer: "No answer",
  refused: "Recipient refused service",
  wrong_address: "Wrong / vacant address",
  gated: "Gated / inaccessible",
  other: "Other",
};

function timeOf(value: string | null | undefined): number {
  return value ? new Date(value).getTime() : Number.NEGATIVE_INFINITY;
}

function photoSrc(photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null;
  return resolveStorageObjectUrl(photoUrl);
}

function buildEvents(
  job: Job,
  attempts: ServiceAttempt[],
  releases: JobReleaseEvent[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const displayName = privacyServerName(job.server?.name);

  events.push({
    key: "created",
    timestamp: job.createdAt,
    label: "Job created",
    actor: "Requester",
    tone: "neutral",
    icon: FilePlus2,
  });

  if (job.assignedAt) {
    events.push({
      key: "assigned",
      timestamp: job.assignedAt,
      label: `Assigned to ${displayName}`,
      actor: displayName,
      tone: "sky",
      icon: UserCheck,
    });
  }

  if (job.pickedUpAt) {
    events.push({
      key: "picked-up",
      timestamp: job.pickedUpAt,
      label: "Documents picked up",
      actor: displayName,
      tone: "amber",
      icon: PackageCheck,
    });
  }

  if (job.enRouteAt) {
    events.push({
      key: "en-route",
      timestamp: job.enRouteAt,
      label: "Server en route",
      actor: displayName,
      tone: "purple",
      icon: Navigation,
    });
  }

  for (const a of attempts) {
    const isUnable = a.outcome === "unable";
    const isSubstitute = a.outcome === "substitute";
    const label = OUTCOME_LABEL[a.outcome] ?? "Service attempt";
    const tone: Tone = isUnable ? "amber" : isSubstitute ? "sky" : "emerald";
    const icon = isUnable ? AlertTriangle : isSubstitute ? Users : CheckCircle2;

    const noteParts: string[] = [];
    if (isUnable && a.unableReason) {
      noteParts.push(UNABLE_REASON_LABEL[a.unableReason] ?? a.unableReason);
    }
    if (isSubstitute && a.substituteRecipientName) {
      const subBits = [`Served ${a.substituteRecipientName}`];
      if (a.substituteOver18) subBits.push("over 18");
      if (a.substituteVerifiedResidence) subBits.push("residence verified");
      noteParts.push(subBits.join(" · "));
    }
    if (a.notes) noteParts.push(a.notes);

    events.push({
      key: `attempt-${a.id}`,
      timestamp: a.attemptedAt,
      label,
      actor: displayName,
      notes: noteParts.length > 0 ? noteParts.join("\n") : null,
      tone,
      icon,
      gps:
        typeof a.gpsLat === "number" && typeof a.gpsLng === "number"
          ? { lat: a.gpsLat, lng: a.gpsLng }
          : null,
      photoUrl: a.photoUrl ?? null,
    });
  }

  for (const r of releases) {
    events.push({
      key: `release-${r.id}`,
      timestamp: r.releasedAt,
      label: "Returned to queue",
      actor: privacyServerName(r.serverName),
      notes: r.reason,
      tone: "rose",
      icon: RotateCcw,
    });
  }

  if (job.status === "served" && job.servedAt) {
    events.push({
      key: "served",
      timestamp: job.servedAt,
      label: "Service confirmed",
      actor: displayName,
      tone: "emerald",
      icon: CheckCircle2,
      gps:
        typeof job.gpsLat === "number" && typeof job.gpsLng === "number"
          ? { lat: job.gpsLat, lng: job.gpsLng }
          : null,
      photoUrl: job.proofPhotoUrl ?? null,
    });
  } else if (job.status === "cancelled") {
    events.push({
      key: "cancelled",
      timestamp: job.updatedAt,
      label: "Job cancelled",
      actor: "Requester",
      tone: "red",
      icon: XCircle,
    });
  } else if (job.status === "failed") {
    events.push({
      key: "failed",
      timestamp: job.updatedAt,
      label: "Service failed",
      actor: displayName,
      tone: "red",
      icon: XCircle,
    });
  }

  // Most-recent activity at the top.
  events.sort((a, b) => timeOf(b.timestamp) - timeOf(a.timestamp));
  return events;
}

interface JobTimelineProps {
  job: Job;
  className?: string;
  pollInterval?: number;
}

export function JobTimeline({ job, className, pollInterval }: JobTimelineProps) {
  const { data: attempts, isLoading: attemptsLoading } = useListJobAttempts(job.id, {
    query: {
      queryKey: getListJobAttemptsQueryKey(job.id),
      enabled: !!job.id,
      refetchInterval: pollInterval ?? false,
      refetchOnWindowFocus: true,
    },
  });
  const { data: releases, isLoading: releasesLoading } = useListJobReleases(job.id, {
    query: {
      queryKey: getListJobReleasesQueryKey(job.id),
      enabled: !!job.id,
      refetchInterval: pollInterval ?? false,
      refetchOnWindowFocus: true,
    },
  });

  if (attemptsLoading || releasesLoading) {
    return (
      <div className={cn("text-sm text-muted-foreground", className)}>
        Loading timeline…
      </div>
    );
  }

  const events = buildEvents(job, attempts ?? [], releases ?? []);

  return (
    <ol
      data-testid="job-timeline"
      className={cn("relative space-y-4", className)}
    >
      <span
        aria-hidden
        className="absolute left-[18px] top-3 bottom-3 w-px bg-gray-200"
      />
      {events.map((e) => {
        const Icon = e.icon;
        const photo = photoSrc(e.photoUrl);
        return (
          <li
            key={e.key}
            data-testid={`timeline-event-${e.key}`}
            className="relative flex gap-3 pl-12"
          >
            <div
              className={cn(
                "absolute left-0 top-0 w-9 h-9 rounded-full flex items-center justify-center border-2 border-white shadow-sm",
                TONE_ICON_BG[e.tone],
              )}
            >
              <Icon className="w-4 h-4" />
            </div>
            <div
              className={cn(
                "flex-1 min-w-0 rounded-lg border bg-white p-3",
                TONE_BORDER[e.tone],
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-gray-900">
                  {e.label}
                </span>
                <time
                  dateTime={e.timestamp}
                  data-testid={`timeline-event-${e.key}-time`}
                  className="text-xs text-gray-500 font-medium"
                >
                  {format(new Date(e.timestamp), "MMM d, yyyy · h:mm a")}
                </time>
              </div>
              {e.actor && (
                <div
                  data-testid={`timeline-event-${e.key}-actor`}
                  className="text-xs text-gray-600 mt-0.5"
                >
                  {e.actor}
                </div>
              )}
              {e.notes && (
                <p className="text-sm text-gray-700 mt-1.5 whitespace-pre-wrap">
                  {e.notes}
                </p>
              )}
              {(e.gps || photo) && (
                <div className="flex flex-wrap items-center gap-3 text-xs mt-2">
                  {e.gps && (
                    <a
                      href={`https://maps.google.com/?q=${e.gps.lat},${e.gps.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sky-700 hover:underline font-mono"
                    >
                      <MapPin className="w-3 h-3" />
                      {e.gps.lat.toFixed(5)}, {e.gps.lng.toFixed(5)}
                    </a>
                  )}
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
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
