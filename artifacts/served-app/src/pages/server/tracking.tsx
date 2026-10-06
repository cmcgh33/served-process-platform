import { useLocation, useRoute, useSearch } from "wouter";
import LiveTrackingMap from "@/components/tracking/live-tracking-map";

export default function ServerTracking() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/app/server/tracking/:id");
  const search = useSearch();
  const queryId = new URLSearchParams(search).get("jobId");
  const raw = params?.id ?? queryId;
  const jobId = raw ? parseInt(raw, 10) : null;
  return (
    <LiveTrackingMap
      role="server"
      jobId={jobId != null && Number.isFinite(jobId) ? jobId : null}
      onBack={() => setLocation("/app/server/job-feed")}
    />
  );
}
