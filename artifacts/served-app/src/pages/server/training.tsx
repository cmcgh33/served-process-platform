import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { GraduationCap, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetServerStatus,
  useCompleteServerTraining,
  getGetServerStatusQueryKey,
} from "@workspace/api-client-react";

// Resolve the training-video iframe URL relative to the deploy origin so it
// works whether served-app is mounted at "/" (dev preview) or under a
// sub-path. The proxy routes "/server-training/*" to the video artifact
// regardless of where the parent app is mounted.
const VIDEO_URL = `${window.location.origin}/server-training/`;

export default function ServerTrainingPage() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const blockedFromClaim = params.get("from") === "claim";

  const status = useGetServerStatus();
  const trainingDone = Boolean(status.data?.trainingCompletedAt);
  const completedAt = status.data?.trainingCompletedAt ?? null;

  const completeMutation = useCompleteServerTraining();
  const [watched, setWatched] = useState(false);
  const watchTimer = useRef<number | null>(null);

  // Require ~80 seconds of dwell time on the page before the "Mark complete"
  // button enables. Honest signal that they actually played the video.
  useEffect(() => {
    if (trainingDone || watched) return;
    watchTimer.current = window.setTimeout(() => setWatched(true), 80_000);
    return () => {
      if (watchTimer.current) window.clearTimeout(watchTimer.current);
    };
  }, [trainingDone, watched]);

  const handleComplete = async () => {
    try {
      await completeMutation.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: getGetServerStatusQueryKey() });
      toast.success("Training complete — you're cleared to claim jobs.");
      if (blockedFromClaim) {
        navigate("/app/server/job-feed");
      }
    } catch (err) {
      const anyErr = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error(anyErr?.response?.data?.error ?? anyErr?.message ?? "Could not save");
    }
  };

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-amber-400/15 flex items-center justify-center">
          <GraduationCap className="w-5 h-5 text-amber-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Server Training</h1>
          <p className="text-sm text-slate-500">
            Watch the 90-second walkthrough, then mark it complete to unlock your first claim.
          </p>
        </div>
      </div>

      {blockedFromClaim && !trainingDone && (
        <div
          className="flex items-start gap-3 rounded-lg border p-4"
          style={{ borderColor: "rgba(245,158,11,0.4)", backgroundColor: "rgba(245,158,11,0.08)" }}
          data-testid="banner-training-required"
        >
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-slate-800">
            <strong>Training required.</strong> You can't claim a job yet — finish the
            walkthrough below, mark it complete, and you'll be sent right back to the Job Feed.
          </div>
        </div>
      )}

      {trainingDone && (
        <div
          className="flex items-start gap-3 rounded-lg border p-4"
          style={{ borderColor: "rgba(52,211,153,0.4)", backgroundColor: "rgba(52,211,153,0.1)" }}
          data-testid="banner-training-complete"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-slate-800 flex-1">
            <strong>Training complete</strong>
            {completedAt && (
              <span className="text-slate-500">
                {" "}
                — finished {new Date(completedAt).toLocaleDateString()}.
              </span>
            )}{" "}
            You're cleared to claim jobs. Rewatch any time.
          </div>
          <Link
            href="/app/server/job-feed"
            className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1"
          >
            Go to Job Feed <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      )}

      <div className="rounded-xl overflow-hidden border border-slate-200 bg-black shadow-sm">
        <div className="relative" style={{ paddingTop: "56.25%" }}>
          <iframe
            src={VIDEO_URL}
            title="SERVED. server training video"
            className="absolute inset-0 w-full h-full"
            allow="autoplay; fullscreen"
            data-testid="iframe-training-video"
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="font-semibold text-slate-900">What you'll learn</h2>
        <ol className="list-decimal pl-5 space-y-1 text-sm text-slate-700">
          <li>Reading the Job Feed and your 80% payout split.</li>
          <li>Claiming a job — and when Nevada PILB licensing is required.</li>
          <li>Going en-route and broadcasting GPS automatically.</li>
          <li>Logging attempts: personal, substitute (NRCP 4.2), mail, posting, publication, non-est.</li>
          <li>Capturing identity, GPS provenance, signature → court-ready affidavit (NRS 53.045).</li>
          <li>Earnings Wallet — weekly Friday payouts and the "Pay Now" instant option.</li>
        </ol>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-5">
        <div className="text-sm text-slate-600">
          {trainingDone
            ? "You've already completed training. You can revisit any time."
            : watched
            ? "Ready when you are — confirm you've watched the video."
            : "Once you've watched the full video, the button below will enable."}
        </div>
        <button
          type="button"
          onClick={handleComplete}
          disabled={trainingDone || (!watched) || completeMutation.isPending}
          className="rounded-lg px-5 py-2.5 text-sm font-semibold text-black transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: "var(--color-brand-amber)" }}
          data-testid="button-mark-training-complete"
        >
          {trainingDone
            ? "Training complete"
            : completeMutation.isPending
            ? "Saving…"
            : "Mark training complete"}
        </button>
      </div>
    </div>
  );
}
