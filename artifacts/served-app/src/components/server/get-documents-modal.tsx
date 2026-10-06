import { useMemo } from "react";
import { X, Download, Navigation, FileText, Loader2, AlertCircle } from "lucide-react";
import { useListJobDocuments } from "@workspace/api-client-react";

interface Props {
  job: {
    id: number;
    documentType?: string | null;
    // Mirror the JobDocumentHandling enum from the API schema. We only
    // special-case "pickup"; anything else (including "prints" and unset)
    // shows the digital-download flow.
    documentHandling?: string | null;
    pickupAddress?: string | null;
    pickupCity?: string | null;
    pickupState?: string | null;
    pickupZip?: string | null;
  };
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function GetDocumentsModal({ job, onClose }: Props) {
  const { data: docs, isLoading, error } = useListJobDocuments(job.id);

  const pickupAddress = useMemo(() => {
    const parts = [
      job.pickupAddress,
      job.pickupCity,
      job.pickupState,
      job.pickupZip,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }, [job.pickupAddress, job.pickupCity, job.pickupState, job.pickupZip]);

  const isPickupOnly = job.documentHandling === "pickup";
  const isEither = job.documentHandling === "either";
  const showPickup = isPickupOnly || isEither;
  const showDownload = !isPickupOnly; // hide download UI only when pickup is mandatory
  const directionsHref = pickupAddress
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pickupAddress)}`
    : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="get-docs-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
    >
      <div className="bg-[#f0f2f5] rounded-2xl shadow-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-white rounded-t-2xl border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
              <FileText className="w-4 h-4 text-amber-500" />
            </div>
            <h2 id="get-docs-title" className="text-base font-bold text-gray-900">
              Get Your Documents
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            {isPickupOnly
              ? "This job's originals are at the attorney's office. Pick them up before serving."
              : isEither
                ? "The attorney offers both options — download and print yourself, or stop by their office for originals."
                : "Download and print these documents before serving."}
          </p>

          {/* Digital Download — hidden only when handling is strictly "pickup" */}
          {showDownload && (
          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Download className="w-4 h-4 text-amber-500" />
              <p className="text-sm font-bold text-gray-900">Digital Download</p>
            </div>

            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-gray-500 py-3">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading documents…
              </div>
            )}

            {!isLoading && error && (
              <div
                role="alert"
                className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  Couldn't load documents. Try again or contact the attorney.
                </span>
              </div>
            )}

            {!isLoading && !error && docs && docs.length === 0 && (
              <p className="text-xs text-gray-500 py-2">
                No documents have been attached to this job yet. The attorney
                may be uploading them now or providing originals at pickup.
              </p>
            )}

            {!isLoading && !error && docs && docs.length > 0 && (
              <div className="space-y-2">
                {docs.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0"
                    data-testid={`doc-row-${d.id}`}
                  >
                    <div className="w-6 h-7 flex-shrink-0">
                      <svg viewBox="0 0 24 28" fill="none" className="w-full h-full">
                        <rect x="0" y="0" width="24" height="28" rx="3" fill="#fee2e2" />
                        <path
                          d="M4 8h16M4 12h16M4 16h10"
                          stroke="#ef4444"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-xs text-gray-700 font-mono truncate"
                        title={d.name}
                      >
                        {d.name}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {formatBytes(d.size)}
                      </p>
                    </div>
                    <a
                      href={d.downloadUrl}
                      download={d.name}
                      target="_blank"
                      rel="noreferrer"
                      data-testid={`button-download-doc-${d.id}`}
                      className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors flex-shrink-0"
                    >
                      <Download className="w-3 h-3" />
                      Save
                    </a>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-amber-600 font-medium">
              Print tip: nearest UPS Store / FedEx Office.
            </p>
          </div>
          )}

          {/* Physical Pickup — when this job requires pickup OR offers it as an option */}
          {showPickup && (
            <div className="bg-amber-50 rounded-2xl border border-amber-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg
                    viewBox="0 0 24 24"
                    className="w-4 h-4 text-amber-600"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="1" y="3" width="15" height="13" rx="1" />
                    <path d="M16 8h4l3 3v5h-7V8z" />
                    <circle cx="5.5" cy="18.5" r="2.5" />
                    <circle cx="18.5" cy="18.5" r="2.5" />
                  </svg>
                  <p className="text-sm font-bold text-amber-900">Physical Pickup</p>
                </div>
                <span className="text-[10px] font-bold px-2 py-1 bg-amber-200 text-amber-800 rounded-full">
                  Attorney's Office
                </span>
              </div>
              <p className="text-xs text-amber-700">
                Drive to the attorney's office and pick up the originals before serving.
              </p>
              {pickupAddress ? (
                <div className="bg-white/60 rounded-lg p-3">
                  <p className="text-[10px] font-bold tracking-widest text-amber-600 uppercase mb-1">
                    Pickup Address
                  </p>
                  <p className="text-sm font-medium text-gray-800">{pickupAddress}</p>
                </div>
              ) : (
                <div className="bg-white/60 rounded-lg p-3">
                  <p className="text-xs text-amber-700">
                    Pickup address not yet provided. Contact the attorney for the address.
                  </p>
                </div>
              )}
              {directionsHref ? (
                <a
                  href={directionsHref}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-3 bg-amber-400 hover:bg-amber-500 text-black font-bold text-sm rounded-xl transition-colors"
                >
                  <Navigation className="w-4 h-4" />
                  Get Directions ↗
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  className="w-full flex items-center justify-center gap-2 py-3 bg-amber-200 text-amber-700 font-bold text-sm rounded-xl cursor-not-allowed"
                >
                  <Navigation className="w-4 h-4" />
                  Get Directions
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
