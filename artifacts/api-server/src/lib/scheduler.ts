/**
 * Tiny in-process scheduler. Runs registered jobs on boot and then on a
 * fixed interval. Designed for tasks that are idempotent and tolerate the
 * occasional double-fire (the license-expiry job dedups via its own table).
 *
 * For multi-instance deployments we'd want a real cron with leader election,
 * but the api-server runs as a single autoscale process and every job here
 * is dedup-safe, so an interval is sufficient and avoids new dependencies.
 */
import { logger } from "./logger";

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  /** If true, run once immediately on registration. Defaults to true. */
  runOnStart?: boolean;
  run(): Promise<unknown>;
}

const HANDLES = new Set<NodeJS.Timeout>();

export function scheduleJob(job: ScheduledJob): void {
  const runOnStart = job.runOnStart ?? true;

  const tick = async () => {
    try {
      await job.run();
    } catch (err) {
      logger.error({ err, job: job.name }, "scheduler: job failed");
    }
  };

  if (runOnStart) {
    // Fire-and-forget; never block server boot on the job.
    void tick();
  }
  const handle = setInterval(tick, job.intervalMs);
  // Don't keep the event loop alive solely for the timer.
  handle.unref?.();
  HANDLES.add(handle);
  logger.info(
    { job: job.name, intervalMs: job.intervalMs, runOnStart },
    "scheduler: job registered",
  );
}

/** Test helper — clears every registered interval. */
export function _stopAllScheduledJobs(): void {
  for (const h of HANDLES) clearInterval(h);
  HANDLES.clear();
}
