import { useMemo, useRef, useState } from "react";
import { X, Camera, Target, AlertTriangle, Info } from "lucide-react";
import {
  useLogServiceAttempt,
  getGetJobQueryKey,
  getListJobAttemptsQueryKey,
  getListJobsQueryKey,
  type LogAttemptBody,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { uploadServerPhoto } from "@/lib/uploadServerPhoto";
import { toast } from "sonner";

type Outcome = "personal" | "substitute" | "unable";
type UnableReason = "no_answer" | "refused" | "wrong_address" | "gated" | "other";

const OUTCOMES: Array<{ value: Outcome; label: string; description: string }> = [
  { value: "personal", label: "Personal service", description: "Documents handed directly to the named recipient." },
  { value: "substitute", label: "Substitute service", description: "Served to another adult at the recipient's residence." },
  { value: "unable", label: "Unable to serve", description: "No service was completed on this attempt." },
];

const UNABLE_REASONS: Array<{ value: UnableReason; label: string }> = [
  { value: "no_answer", label: "No answer" },
  { value: "refused", label: "Recipient refused service" },
  { value: "wrong_address", label: "Wrong / vacant address" },
  { value: "gated", label: "Gated / inaccessible" },
  { value: "other", label: "Other" },
];

interface Props {
  job: {
    id: number;
    recipientName: string;
    documentType?: string | null;
    recipientState?: string | null;
  };
  onClose: () => void;
}

// Mirrors the API's normaliseState() helper. Keeping a tiny copy here so the
// modal can show the right state-specific guidance without round-tripping.
// The API remains the source of truth — bad inputs are rejected with the
// same wording the user sees here.
function normaliseState(state: string | null | undefined): string | null {
  if (!state) return null;
  const trimmed = state.trim();
  if (!trimmed) return null;
  if (trimmed.length === 2) return trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();
  if (lower === "california") return "CA";
  if (lower === "florida") return "FL";
  if (lower === "new york") return "NY";
  return trimmed.slice(0, 2).toUpperCase();
}

interface StateRules {
  code: "CA" | "FL" | "NY";
  label: string;
  summary: string;
  needsMailFollowup: boolean;
  needsCoResident: boolean;
  needsAge: boolean;
  minAge: number;
}

function getStateRules(state: string | null | undefined): StateRules | null {
  const code = normaliseState(state);
  if (code === "CA") {
    return {
      code: "CA",
      label: "California (CCP §415.20)",
      summary:
        "Substitute must be 18+ at the dwelling, AND a copy must be mailed to the recipient within 10 days.",
      needsMailFollowup: true,
      needsCoResident: false,
      needsAge: false,
      minAge: 18,
    };
  }
  if (code === "FL") {
    return {
      code: "FL",
      label: "Florida (F.S. §48.031)",
      summary:
        "Substitute must be a co-resident at least 15 years old. Record their age and confirm co-residency.",
      needsMailFollowup: false,
      needsCoResident: true,
      needsAge: true,
      minAge: 15,
    };
  }
  if (code === "NY") {
    return {
      code: "NY",
      label: "New York (CPLR §308(2))",
      summary:
        "Substitute must be of suitable age and discretion (18+) at the dwelling/workplace, AND a copy must also be mailed.",
      needsMailFollowup: true,
      needsCoResident: false,
      needsAge: false,
      minAge: 18,
    };
  }
  return null;
}

export function LogAttemptModal({ job, onClose }: Props) {
  const queryClient = useQueryClient();
  const logAttempt = useLogServiceAttempt();

  const stateRules = useMemo(() => getStateRules(job.recipientState), [job.recipientState]);

  const [outcome, setOutcome] = useState<Outcome>("unable");
  const [unableReason, setUnableReason] = useState<UnableReason>("no_answer");
  const [substituteName, setSubstituteName] = useState("");
  const [substituteOver18, setSubstituteOver18] = useState(false);
  const [substituteVerifiedResidence, setSubstituteVerifiedResidence] = useState(false);
  const [substituteAge, setSubstituteAge] = useState<string>("");
  const [substituteIsCoResident, setSubstituteIsCoResident] = useState(false);
  const [acknowledgeMailFollowup, setAcknowledgeMailFollowup] = useState(false);

  const [notes, setNotes] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleGps = () => {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation not supported");
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsLoading(false);
        toast.success("Location captured");
      },
      (err) => {
        setGpsLoading(false);
        toast.error(`Location error: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handlePhoto = (file: File | null) => {
    setPhotoFile(file);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  };

  const ageNumber = substituteAge.trim() === "" ? null : Number(substituteAge);

  // Substitute validity: mirrors the API's state-aware validator so the
  // submit button only enables when the request will pass.
  const substituteValid = (() => {
    if (outcome !== "substitute") return true;
    if (substituteName.trim().length === 0) return false;
    if (!substituteVerifiedResidence) return false;

    if (stateRules?.code === "FL") {
      const ageOk = (ageNumber !== null && !Number.isNaN(ageNumber) && ageNumber >= stateRules.minAge) || substituteOver18;
      if (!ageOk) return false;
      if (!substituteIsCoResident) return false;
    } else {
      if (!substituteOver18) return false;
    }

    if (stateRules?.needsMailFollowup && !acknowledgeMailFollowup) return false;
    return true;
  })();

  const unableValid = outcome !== "unable" || Boolean(unableReason);

  const formValid = !!gps && substituteValid && unableValid;

  const handleSubmit = async () => {
    if (!gps) {
      toast.error("Capture GPS first");
      return;
    }
    if (!substituteValid) {
      toast.error("Substitute requirements not met for this jurisdiction.");
      return;
    }
    if (!unableValid) {
      toast.error("Pick a reason for being unable to serve.");
      return;
    }

    let photoUrl: string | undefined;
    if (photoFile) {
      try {
        setUploading(true);
        photoUrl = await uploadServerPhoto(photoFile, job.id);
      } catch (err) {
        toast.error("Photo upload failed", {
          description: err instanceof Error ? err.message : String(err),
        });
        setUploading(false);
        return;
      } finally {
        setUploading(false);
      }
    }

    const substitutePayload =
      outcome === "substitute"
        ? {
            substituteRecipientName: substituteName.trim(),
            substituteOver18: stateRules?.code === "FL" ? substituteOver18 : true,
            substituteVerifiedResidence: true,
            ...(stateRules?.needsAge && ageNumber !== null && !Number.isNaN(ageNumber)
              ? { substituteRecipientAge: ageNumber }
              : {}),
            ...(stateRules?.needsCoResident
              ? { substituteIsCoResident: true }
              : {}),
            ...(stateRules?.needsMailFollowup
              ? { acknowledgeMailFollowup: true }
              : {}),
          }
        : {};

    const data: LogAttemptBody = {
      outcome,
      gpsLat: gps.lat,
      gpsLng: gps.lng,
      ...(notes ? { notes } : {}),
      ...(photoUrl ? { photoUrl } : {}),
      ...substitutePayload,
      ...(outcome === "unable" ? { unableReason } : {}),
    };

    logAttempt.mutate(
      { id: job.id, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListJobAttemptsQueryKey(job.id) });
          queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(job.id) });
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
          toast.success(
            outcome === "personal"
              ? "Personal service recorded — job marked served"
              : outcome === "substitute"
                ? "Substitute service recorded — job marked served"
                : "Attempt logged",
          );
          onClose();
        },
        onError: (err) => {
          toast.error("Failed to log attempt", {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  };

  const selectedOutcomeMeta = OUTCOMES.find((o) => o.value === outcome)!;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <div>
              <h2 className="text-base font-bold text-gray-900">Log Service Attempt</h2>
              <p className="text-xs text-gray-400 mt-0.5">{job.recipientName} · {job.documentType ?? "Documents"}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors" data-testid="button-close-log-attempt">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Outcome</label>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as Outcome)}
              data-testid="select-attempt-outcome"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
            >
              {OUTCOMES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-gray-500">{selectedOutcomeMeta.description}</p>
          </div>

          {outcome === "unable" && (
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                Reason <span className="text-rose-500 font-normal normal-case">required</span>
              </label>
              <select
                value={unableReason}
                onChange={(e) => setUnableReason(e.target.value as UnableReason)}
                data-testid="select-unable-reason"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
              >
                {UNABLE_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          )}

          {outcome === "substitute" && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              {stateRules ? (
                <div
                  className="rounded-lg border border-amber-300 bg-white/70 p-3 text-xs text-amber-900"
                  data-testid="state-substitute-requirements"
                >
                  <div className="flex items-start gap-2">
                    <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-bold mb-0.5">{stateRules.label}</p>
                      <p>{stateRules.summary}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-amber-800">
                  Substitute service requires you to record who received the documents and to confirm
                  they are over 18 and that the recipient lives at the address.
                </p>
              )}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Person served <span className="text-rose-500 font-normal normal-case">required</span>
                </label>
                <input
                  type="text"
                  value={substituteName}
                  onChange={(e) => setSubstituteName(e.target.value)}
                  placeholder="e.g. Jane Smith (sister, lives at residence)"
                  data-testid="input-substitute-name"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
                />
              </div>

              {stateRules?.needsAge && (
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                    Recipient age <span className="text-rose-500 font-normal normal-case">required (must be {stateRules.minAge}+)</span>
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={120}
                    value={substituteAge}
                    onChange={(e) => setSubstituteAge(e.target.value)}
                    placeholder={`e.g. ${stateRules.minAge + 2}`}
                    data-testid="input-substitute-age"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
                  />
                </div>
              )}

              {/* The over-18 checkbox stays for non-FL states; in FL the
                  age input above replaces it (FL accepts 15+). */}
              {stateRules?.code !== "FL" && (
                <label className="flex items-start gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={substituteOver18}
                    onChange={(e) => setSubstituteOver18(e.target.checked)}
                    data-testid="checkbox-substitute-over18"
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                  />
                  <span>I confirm the person served is at least 18 years old.</span>
                </label>
              )}

              <label className="flex items-start gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={substituteVerifiedResidence}
                  onChange={(e) => setSubstituteVerifiedResidence(e.target.checked)}
                  data-testid="checkbox-substitute-residence"
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                />
                <span>I confirm the person verified the recipient lives at this address.</span>
              </label>

              {stateRules?.needsCoResident && (
                <label className="flex items-start gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={substituteIsCoResident}
                    onChange={(e) => setSubstituteIsCoResident(e.target.checked)}
                    data-testid="checkbox-substitute-coresident"
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                  />
                  <span>I confirm the person served lives at this address (co-resident).</span>
                </label>
              )}

              {stateRules?.needsMailFollowup && (
                <label className="flex items-start gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={acknowledgeMailFollowup}
                    onChange={(e) => setAcknowledgeMailFollowup(e.target.checked)}
                    data-testid="checkbox-acknowledge-mail-followup"
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                  />
                  <span>
                    I will mail a copy of the documents to the recipient
                    {stateRules.code === "CA" ? " within 10 days" : ""} as required by{" "}
                    {stateRules.label}.
                  </span>
                </label>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">Photo (recommended)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              data-testid="input-attempt-photo"
              onChange={(e) => handlePhoto(e.target.files?.[0] ?? null)}
            />
            {photoPreview ? (
              <div className="relative inline-block">
                <img src={photoPreview} alt="Attempt preview" className="max-h-40 rounded-md border" />
                <button
                  type="button"
                  onClick={() => handlePhoto(null)}
                  className="absolute top-1 right-1 bg-black/70 text-white rounded-full p-1"
                  aria-label="Remove photo"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border border-dashed border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-50"
              >
                <Camera className="w-4 h-4" />Take or upload photo
              </button>
            )}
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">GPS Location</label>
            <button
              type="button"
              onClick={handleGps}
              disabled={gpsLoading}
              data-testid="button-attempt-gps"
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
            >
              <Target className="w-4 h-4" />
              {gpsLoading ? "Acquiring…" : gps ? `Captured: ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : "Capture GPS"}
            </button>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
              Notes <span className="text-gray-400 font-normal normal-case">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Knocked 3 times, no answer. Lights off, no vehicles in driveway."
              data-testid="textarea-attempt-notes"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 bg-gray-50"
              rows={3}
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!formValid || logAttempt.isPending || uploading}
              data-testid="button-submit-attempt"
              className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {uploading ? "Uploading…" : logAttempt.isPending ? "Saving…" : "Log Attempt"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
