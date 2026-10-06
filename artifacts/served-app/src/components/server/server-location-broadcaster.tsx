import { useEffect, useMemo, useRef } from "react";
import {
  getListJobsQueryKey,
  useListJobs,
  usePublishJobLocation,
} from "@workspace/api-client-react";

const PING_THROTTLE_MS = 10_000;
const REFETCH_JOBS_MS = 20_000;

/**
 * Headless component that broadcasts the server's GPS location to every job
 * they currently have en_route or in_progress. Mounted once inside the
 * server portal layout so location sharing turns on automatically the moment
 * the server taps Navigate (which transitions the job to en_route) — no
 * manual "Share Location" button required.
 *
 * Sharing stops as soon as the job leaves en_route/in_progress (released,
 * served, failed, cancelled) or the server signs out / leaves the portal.
 *
 * Permission prompt: the browser will ask for geolocation the first time we
 * call watchPosition. If the server denies, we silently stop trying — the
 * requester will simply see no live pings, but the rest of the workflow
 * continues to work (proof-of-service, mark served, etc. are all
 * independent).
 */
export function ServerLocationBroadcaster() {
  // Refetch every ~20s so we pick up freshly-accepted jobs and stop sharing
  // promptly when status changes from another tab.
  const { data: jobs } = useListJobs(undefined, {
    query: {
      queryKey: getListJobsQueryKey(),
      refetchInterval: REFETCH_JOBS_MS,
    },
  });
  const publish = usePublishJobLocation();

  // Stable list of job ids we should currently broadcast to.
  const activeJobIds = useMemo(() => {
    if (!jobs) return [] as number[];
    return jobs
      .filter(
        (j) =>
          j.status === "en_route" || j.status === "in_progress",
      )
      .map((j) => j.id);
  }, [jobs]);

  // Per-job last-post timestamps so each job gets a fresh ping at most once
  // every PING_THROTTLE_MS. We share a single watchPosition for all jobs to
  // avoid stacking GPS subscriptions.
  const lastPostRef = useRef<Map<number, number>>(new Map());
  const watchIdRef = useRef<number | null>(null);
  // Mirror activeJobIds into a ref so the watchPosition callback always sees
  // the latest value without re-subscribing every render.
  const activeIdsRef = useRef<number[]>([]);
  useEffect(() => {
    activeIdsRef.current = activeJobIds;
  }, [activeJobIds]);

  // Mirror the publish mutation into a ref for the same reason — react-query
  // hands us a new function reference on every render.
  const publishRef = useRef(publish);
  useEffect(() => {
    publishRef.current = publish;
  }, [publish]);

  useEffect(() => {
    // No active jobs → make sure we're not holding a GPS watcher.
    if (activeJobIds.length === 0) {
      if (watchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      lastPostRef.current.clear();
      return;
    }

    // Already watching — nothing to do; the inner callback reads activeIds
    // from the ref so it picks up new jobs without re-subscribing.
    if (watchIdRef.current != null) return;

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      // Browser doesn't support geolocation. Silently no-op; the rest of the
      // app still works.
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const ids = activeIdsRef.current;
        for (const jobId of ids) {
          const last = lastPostRef.current.get(jobId) ?? 0;
          if (now - last < PING_THROTTLE_MS) continue;
          lastPostRef.current.set(jobId, now);
          publishRef.current.mutate(
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
              onError: () => {
                // 409 (job no longer en_route/in_progress) and 403 (lost
                // assignment) are both expected race conditions. Reset the
                // throttle entry so we retry promptly if status flips back,
                // but otherwise stay silent — the next jobs refetch will
                // drop this id from activeJobIds.
                lastPostRef.current.delete(jobId);
              },
            },
          );
        }
      },
      () => {
        // Permission denied / position unavailable. Drop the watcher so we
        // don't spam; servers can re-grant permission via browser settings
        // and the next active job will re-trigger this effect.
        if (watchIdRef.current != null && navigator.geolocation) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5_000,
        timeout: 20_000,
      },
    );
    watchIdRef.current = id;

    return () => {
      if (watchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
    // We intentionally only depend on whether activeJobIds is empty vs not,
    // because the watchPosition callback reads the latest list from a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobIds.length === 0]);

  return null;
}
