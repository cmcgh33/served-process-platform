// Helper to compute the navigation target for a job. When document_handling
// is "pickup", the server should drive to the pickup address first; otherwise
// straight to the recipient. Returns a Google Maps directions URL.
//
// Used by both the server job-feed Navigate button and the server dashboard
// Navigate button so there's one source of truth across the app.

interface NavigateJob {
  documentHandling?: string | null;
  pickupAddress?: string | null;
  pickupCity?: string | null;
  pickupState?: string | null;
  pickupZip?: string | null;
  recipientAddress: string;
  recipientCity: string;
  recipientState: string;
  recipientZip: string;
}

function joinAddress(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(", ");
}

export function getNavigateTarget(job: NavigateJob): {
  kind: "pickup" | "recipient";
  address: string;
  url: string;
} {
  const recipient = joinAddress([
    job.recipientAddress,
    job.recipientCity,
    job.recipientState,
    job.recipientZip,
  ]);

  // For strict "pickup" jobs the server MUST collect originals first, so
  // the navigation routes pickup → recipient. For "either" jobs pickup is
  // optional (server may have downloaded + printed instead), so we don't
  // force the pickup leg into the default Navigate button — the server
  // can still tap "Get Directions" inside the Get Documents modal if they
  // chose to pick up.
  if (job.documentHandling === "pickup" && job.pickupAddress) {
    const pickup = joinAddress([
      job.pickupAddress,
      job.pickupCity,
      job.pickupState,
      job.pickupZip,
    ]);
    // Google Maps: pickup → recipient as a 2-leg trip if both are known.
    const url = recipient
      ? `https://www.google.com/maps/dir/?api=1&origin=&destination=${encodeURIComponent(pickup)}&waypoints=${encodeURIComponent(recipient)}`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pickup)}`;
    return { kind: "pickup", address: pickup, url };
  }

  return {
    kind: "recipient",
    address: recipient,
    url: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(recipient)}`,
  };
}
