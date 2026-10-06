import { useEffect, useMemo, useRef, useState } from "react";
import {
  Navigation,
  MapPin,
  CheckCircle2,
  Radio,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  useGetJobLatestLocation,
  getGetJobLatestLocationQueryKey,
  usePublishJobLocation,
  useGetJob,
  getGetJobQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

export type TrackingRole = "requester" | "attorney" | "server";

interface LiveTrackingMapProps {
  role: TrackingRole;
  jobId: number | null;
  onBack?: () => void;
}

function ageLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${String(s).padStart(2, "0")}s ago`;
  }
  return `${Math.floor(seconds / 3600)}h ago`;
}

function osmEmbedUrl(lat: number, lng: number, zoom = 15): string {
  // OSM bbox roughly centered on the point. Half-side in degrees.
  const d = 0.008;
  const left = lng - d;
  const right = lng + d;
  const top = lat + d / 2;
  const bottom = lat - d / 2;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat}%2C${lng}`;
}

function SharingToggle({ jobId }: { jobId: number }) {
  const storageKey = `served:location-sharing:${jobId}`;
  const [sharing, setSharing] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastPostRef = useRef<number>(0);
  const queryClient = useQueryClient();
  const publish = usePublishJobLocation();

  // Re-load persisted sharing state whenever jobId changes so we never
  // auto-share to the wrong job after a soft-nav between two tracking pages
  // in the same tab. Defaults to off if storage has nothing for the new job.
  useEffect(() => {
    let next = false;
    try {
      next = sessionStorage.getItem(storageKey) === "1";
    } catch {
      /* ignore */
    }
    setSharing(next);
    setError(null);
    setLastSentAt(null);
    lastPostRef.current = 0;
  }, [storageKey]);

  const { data: job } = useGetJob(jobId, {
    query: {
      queryKey: getGetJobQueryKey(jobId),
      // Auto-disable when status leaves in_progress.
      refetchInterval: sharing ? 15000 : false,
    },
  });
  const jobStatus = job?.status;

  useEffect(() => {
    if (
      sharing &&
      jobStatus &&
      jobStatus !== "in_progress" &&
      jobStatus !== "en_route"
    ) {
      setSharing(false);
    }
  }, [sharing, jobStatus]);

  // Persist toggle state.
  useEffect(() => {
    try {
      if (sharing) sessionStorage.setItem(storageKey, "1");
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [sharing, storageKey]);

  // Manage geolocation watcher.
  useEffect(() => {
    if (!sharing) {
      if (watchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }
    if (!navigator.geolocation) {
      setError("Your browser doesn't support GPS sharing.");
      setSharing(false);
      return;
    }
    setError(null);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        // Throttle posts to one every ~10 seconds.
        if (now - lastPostRef.current < 10000) return;
        lastPostRef.current = now;
        publish.mutate(
          {
            id: jobId,
            data: {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracyM: pos.coords.accuracy ?? undefined,
              headingDeg: pos.coords.heading ?? undefined,
              speedMps: pos.coords.speed ?? undefined,
            },
          },
          {
            onSuccess: () => {
              setLastSentAt(now);
              void queryClient.invalidateQueries({
                queryKey: getGetJobLatestLocationQueryKey(jobId),
              });
            },
            onError: (err) => {
              setError(
                err instanceof Error
                  ? err.message
                  : "Couldn't publish location",
              );
            },
          },
        );
      },
      (err) => {
        setError(err.message || "Location permission denied");
        setSharing(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 20000,
      },
    );
    watchIdRef.current = id;
    return () => {
      if (id != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(id);
      }
      watchIdRef.current = null;
    };
  }, [sharing, jobId, publish, queryClient]);

  return (
    <div
      className={cn(
        "rounded-xl border p-4 flex items-center gap-3",
        sharing
          ? "bg-emerald-50 border-emerald-200"
          : "bg-white border-gray-200",
      )}
    >
      <div
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
          sharing ? "bg-emerald-100" : "bg-gray-100",
        )}
      >
        <Radio
          className={cn(
            "w-5 h-5",
            sharing ? "text-emerald-600" : "text-gray-500",
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900">
          {sharing ? "Sharing live location" : "Share live location"}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {sharing
            ? lastSentAt
              ? `Last sent ${ageLabel(Math.round((Date.now() - lastSentAt) / 1000))}`
              : "Waiting for first GPS fix…"
            : "The requester can see your position while you're en-route."}
        </p>
        {error && (
          <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {error}
          </p>
        )}
      </div>
      <button
        onClick={() => setSharing((v) => !v)}
        disabled={
          jobStatus !== undefined &&
          jobStatus !== "in_progress" &&
          jobStatus !== "en_route"
        }
        className={cn(
          "px-4 py-2 rounded-lg text-xs font-bold transition-colors",
          sharing
            ? "bg-emerald-500 hover:bg-emerald-600 text-white"
            : "bg-amber-400 hover:bg-amber-500 text-black",
          jobStatus !== undefined &&
            jobStatus !== "in_progress" &&
            jobStatus !== "en_route" &&
            "opacity-40 cursor-not-allowed",
        )}
      >
        {sharing ? "Stop" : "Start"}
      </button>
    </div>
  );
}

export default function LiveTrackingMap({
  role,
  jobId,
  onBack,
}: LiveTrackingMapProps) {
  const validJobId = jobId != null && Number.isFinite(jobId) && jobId > 0;

  const safeJobId = validJobId ? jobId! : 0;
  const { data: job } = useGetJob(safeJobId, {
    query: {
      queryKey: getGetJobQueryKey(safeJobId),
      enabled: validJobId,
    },
  });

  const {
    data: latest,
    isLoading,
    isError,
    error,
  } = useGetJobLatestLocation(safeJobId, {
    query: {
      queryKey: getGetJobLatestLocationQueryKey(safeJobId),
      enabled: validJobId,
      refetchInterval: 5000,
      refetchOnWindowFocus: true,
      retry: false,
    },
  });

  const ping = latest?.location ?? null;
  const destinationAddress = latest?.destination?.address ?? null;

  // Tick to keep "X seconds ago" fresh between polls.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const liveAgeSeconds = useMemo(() => {
    if (!ping?.recordedAt) return null;
    const recorded = new Date(ping.recordedAt).getTime();
    if (Number.isNaN(recorded)) return null;
    return Math.max(0, Math.round((Date.now() - recorded) / 1000));
  }, [ping?.recordedAt, tick]);

  if (!validJobId) {
    return (
      <div className="space-y-4">
        {onBack && (
          <button
            onClick={onBack}
            className="text-xs text-gray-500 hover:text-gray-700 font-medium"
          >
            ← Back
          </button>
        )}
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
          <AlertCircle className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">
            Pick a job from your active jobs list to track it live.
          </p>
        </div>
      </div>
    );
  }

  const recipientName = job?.recipientName ?? "Recipient";
  const fallbackAddress =
    destinationAddress ??
    (job
      ? [
          job.recipientAddress,
          job.recipientCity,
          job.recipientState,
          job.recipientZip,
        ]
          .filter(Boolean)
          .join(", ")
      : "");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {onBack && (
            <button
              onClick={onBack}
              className="text-xs text-gray-500 hover:text-gray-700 font-medium mb-1"
            >
              ← Back
            </button>
          )}
          <h1 className="text-xl font-bold text-gray-900 truncate">
            Live Tracking — Job #{jobId}
          </h1>
          {fallbackAddress && (
            <p className="text-sm text-gray-500 mt-0.5 truncate">
              {fallbackAddress}
            </p>
          )}
        </div>
        <div
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full border flex-shrink-0",
            ping
              ? "bg-emerald-50 border-emerald-200"
              : "bg-amber-50 border-amber-200",
          )}
        >
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full animate-pulse",
              ping ? "bg-emerald-500" : "bg-amber-400",
            )}
          />
          <span
            className={cn(
              "text-xs font-bold",
              ping ? "text-emerald-700" : "text-amber-700",
            )}
          >
            {ping ? "Live" : "Awaiting GPS"}
          </span>
        </div>
      </div>

      {/* Server-side toggle (only) */}
      {role === "server" && <SharingToggle jobId={jobId!} />}

      {/* Map / state */}
      <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white">
        {isLoading ? (
          <div className="h-72 flex items-center justify-center text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : isError ? (
          <div className="h-72 flex flex-col items-center justify-center px-6 text-center">
            <AlertCircle className="w-8 h-8 text-amber-400 mb-2" />
            <p className="text-sm font-semibold text-gray-700">
              Live tracking isn't available
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {error instanceof Error
                ? error.message
                : "This job isn't currently in progress."}
            </p>
          </div>
        ) : ping ? (
          <div className="relative">
            <iframe
              key={`${ping.lat.toFixed(5)},${ping.lng.toFixed(5)}`}
              title="Live driver location"
              src={osmEmbedUrl(ping.lat, ping.lng)}
              className="w-full h-72 border-0"
              loading="lazy"
            />
            <div className="absolute top-3 left-3 bg-white/95 backdrop-blur rounded-lg px-3 py-1.5 shadow text-xs font-semibold text-gray-700 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Last seen {liveAgeSeconds != null ? ageLabel(liveAgeSeconds) : "just now"}
            </div>
          </div>
        ) : (
          <div className="h-72 flex flex-col items-center justify-center px-6 text-center">
            <Navigation className="w-8 h-8 text-gray-300 mb-2" />
            <p className="text-sm font-semibold text-gray-700">
              {role === "server"
                ? "Tap Start above to share your location"
                : "Driver hasn't shared location yet"}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              We'll show their position the moment they go live.
            </p>
          </div>
        )}
      </div>

      {/* Coords detail */}
      {ping && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Latitude / Longitude</span>
            <span className="font-mono text-gray-800">
              {ping.lat.toFixed(5)}, {ping.lng.toFixed(5)}
            </span>
          </div>
          {ping.accuracyM != null && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Accuracy</span>
              <span className="font-mono text-gray-800">
                ±{Math.round(ping.accuracyM)} m
              </span>
            </div>
          )}
          {ping.speedMps != null && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Speed</span>
              <span className="font-mono text-gray-800">
                {(ping.speedMps * 2.237).toFixed(0)} mph
              </span>
            </div>
          )}
        </div>
      )}

      {/* Destination card */}
      {fallbackAddress && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-red-50 border-2 border-red-100 flex items-center justify-center flex-shrink-0">
            <MapPin className="w-5 h-5 text-red-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black tracking-widest text-gray-400 uppercase mb-1">
              Recipient
            </p>
            <p className="text-sm font-bold text-gray-900 truncate">
              {recipientName}
            </p>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {fallbackAddress}
            </p>
          </div>
        </div>
      )}

      {job?.status &&
        job.status !== "in_progress" &&
        job.status !== "en_route" && (
        <div
          className={cn(
            "flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-semibold",
            job.status === "served"
              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : "bg-gray-50 border-gray-200 text-gray-600",
          )}
        >
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {job.status === "served"
            ? "Job complete — affidavit available."
            : `Job status: ${job.status}.`}
        </div>
      )}
    </div>
  );
}
