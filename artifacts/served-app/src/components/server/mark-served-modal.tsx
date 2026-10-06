import { useRef, useState, useEffect } from "react";
import {
  X,
  CircleCheck,
  Loader2,
  ChevronLeft,
  User,
  Users,
  Mail,
  ClipboardCheck,
  Check,
  Newspaper,
  FileX,
} from "lucide-react";
import { format } from "date-fns";
import {
  useLogServiceAttempt,
  getGetJobQueryKey,
  getListJobAttemptsQueryKey,
  getListJobsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { uploadServerPhoto } from "@/lib/uploadServerPhoto";
import { canvasToPngFile } from "@/lib/canvasToPng";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Stepped Mark-Served flow for Nevada-compliant proofs of service.
 *
 * Flow (4 steps):
 *   1. Service Type — Personal, Substitute, Mail, or Posting.
 *   2. Service Moment — date+time (defaulting to "now") and the address
 *      of service (pre-filled from the job).
 *   3. Branch Details — method narrative + outcome-specific fields:
 *        Substitute  → recipient name, relationship, description,
 *                      co-resident flag, and a follow-up mailing block
 *                      (date + address) the server commits to.
 *        Mail        → mailing date + address.
 *        Posting     → posting location description.
 *        Personal    → just the narrative; nothing extra.
 *   4. Sign & Confirm — typed printed name, drawn signature, GPS verify.
 *
 * The complete payload is shipped to POST /jobs/:id/attempts which then
 * routes through markJobServed → affidavit PDF generation.
 */

type ServiceType =
  | "personal"
  | "substitute"
  | "mail"
  | "posting"
  | "publication"
  | "non_est";

interface Props {
  job: {
    id: number;
    recipientName: string;
    documentType?: string | null;
    recipientAddress?: string | null;
    recipientCity?: string | null;
    recipientState?: string | null;
    recipientZip?: string | null;
  };
  onClose: () => void;
}

const SERVICE_TYPES: Array<{
  id: ServiceType;
  label: string;
  desc: string;
  icon: typeof User;
}> = [
  { id: "personal", label: "Personal", desc: "Handed directly to the named party.", icon: User },
  { id: "substitute", label: "Substitute", desc: "Left with a co-resident or person of suitable age.", icon: Users },
  { id: "mail", label: "Mail", desc: "Mailed to the recipient at their address.", icon: Mail },
  { id: "posting", label: "Posting", desc: "Conspicuously posted at the property.", icon: ClipboardCheck },
  {
    id: "publication",
    label: "Publication (NRS 14.040)",
    desc: "Published in a court-approved newspaper after order.",
    icon: Newspaper,
  },
  {
    id: "non_est",
    label: "Non-Est Return",
    desc: "Recipient could not be served after diligent search.",
    icon: FileX,
  },
];

const STEP_LABELS = ["Type", "When & Where", "Details", "Sign"] as const;

/**
 * Format a Date as the local-timezone string accepted by
 * <input type="datetime-local"> (yyyy-MM-ddTHH:mm).
 */
function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MarkServedModal({ job, onClose }: Props) {
  const queryClient = useQueryClient();
  const logAttempt = useLogServiceAttempt();

  // ── Step state ────────────────────────────────────────────────────────
  const [step, setStep] = useState(0);
  const [outcome, setOutcome] = useState<ServiceType>("personal");

  // Step 2 — service moment + address (pre-filled from the job).
  const [serviceAt, setServiceAt] = useState<string>(toDatetimeLocalValue(new Date()));
  const [serviceAddress, setServiceAddress] = useState(job.recipientAddress ?? "");
  const [serviceCity, setServiceCity] = useState(job.recipientCity ?? "");
  const [serviceState, setServiceState] = useState(job.recipientState ?? "");
  const [serviceZip, setServiceZip] = useState(job.recipientZip ?? "");

  // Step 3 — method narrative + branch-specific fields.
  const [methodNarrative, setMethodNarrative] = useState("");
  const [substituteRecipientName, setSubstituteRecipientName] = useState("");
  const [recipientRelationship, setRecipientRelationship] = useState("");
  const [recipientDescription, setRecipientDescription] = useState("");
  // Structured physical-description fields for the substitute recipient.
  // Nevada PoS forms expect these as discrete columns; we keep the legacy
  // `recipientDescription` free-text alongside for any extra detail.
  const [recipientAgeEstimate, setRecipientAgeEstimate] = useState("");
  const [recipientGender, setRecipientGender] = useState("");
  const [recipientHeight, setRecipientHeight] = useState("");
  const [recipientWeight, setRecipientWeight] = useState("");
  const [recipientIdentifyingFeatures, setRecipientIdentifyingFeatures] =
    useState("");
  const [substituteIsCoResident, setSubstituteIsCoResident] = useState(false);
  const [acknowledgeMailFollowup, setAcknowledgeMailFollowup] = useState(false);
  const [mailingDate, setMailingDate] = useState<string>("");
  const [mailingAddress, setMailingAddress] = useState("");
  const [postingLocationDescription, setPostingLocationDescription] = useState("");
  // Nevada NRCP 4(g) only allows service by posting when a court order
  // authorising it is on file. Server must affirm before continuing.
  const [postingHasCourtOrder, setPostingHasCourtOrder] = useState(false);

  // Service-by-Publication (NRS 14.040) — court order is a hard
  // prerequisite; without it the publication notice is void.
  const [publicationOrderRef, setPublicationOrderRef] = useState("");
  const [publicationNewspaper, setPublicationNewspaper] = useState("");
  const [publicationCounty, setPublicationCounty] = useState("");
  const [publicationFirstDate, setPublicationFirstDate] = useState("");
  const [publicationLastDate, setPublicationLastDate] = useState("");
  const [publicationHasCourtOrder, setPublicationHasCourtOrder] = useState(false);

  // Non-est return — short narrative summarising the diligent search.
  const [nonEstSummary, setNonEstSummary] = useState("");

  // Step 4 — signature + GPS.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasSig, setHasSig] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Stage label shown inside the spinner so a server in the field can tell
  // whether they're stuck on signature upload, photo upload, or the final
  // server call. Critical when retrying on flaky cellular.
  const [submitStage, setSubmitStage] = useState<string>("");

  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  // Provenance heuristic from coords.accuracy. Surfaces on the affidavit so
  // a court can tell whether the fix came from a GPS chip or a coarser
  // network/IP lookup.
  const [gpsProvider, setGpsProvider] = useState<string | null>(null);

  // Identity confirmation (Step 3, personal/substitute only). Captured for
  // internal tracking — NOT rendered onto the affidavit PDF.
  const [identityMethod, setIdentityMethod] = useState<
    "verbal" | "photo_match" | "known" | "other" | ""
  >("");
  const [identityOtherText, setIdentityOtherText] = useState("");

  // Optional internal-only photo of the recipient/scene. Required by the
  // wizard for personal service, optional for substitute. Stored at
  // jobs.proof_photo_url + service_attempts.photo_url; never shown on
  // the affidavit PDF.
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);

  // Auto-acquire GPS at modal open. The capture is non-blocking; the
  // server will reject the final POST if we never got a fix, so we keep
  // retrying in the background while the user fills the earlier steps.
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setGpsError("GPS unavailable on this device");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        // Heuristic: GPS chips typically deliver < 50m, assisted GPS
        // 50–200m, network/IP lookups much coarser. Stored as a string
        // so the schema isn't married to this exact ladder.
        const acc = pos.coords.accuracy;
        if (typeof acc === "number") {
          if (acc < 50) setGpsProvider("gps");
          else if (acc < 200) setGpsProvider("gps_assisted");
          else setGpsProvider("network");
        } else {
          setGpsProvider("geolocation_api");
        }
      },
      (err) => setGpsError(err.message),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  // Free the object URL when the photo is replaced or the modal unmounts.
  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  const handlePhotoPick = (file: File | null) => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoFile(file);
    setPhotoPreviewUrl(file ? URL.createObjectURL(file) : null);
  };

  // ── Signature pad ─────────────────────────────────────────────────────
  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const touch = e.touches[0];
      return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };
  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    setDrawing(true);
    setHasSig(true);
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
  };
  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!drawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };
  const endDraw = () => setDrawing(false);
  const clearSig = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    setHasSig(false);
  };

  // ── Per-step validity gate (drives the Continue / Confirm button). ────
  const canContinue = (() => {
    if (step === 0) return Boolean(outcome);
    if (step === 1) {
      return (
        serviceAt.length > 0 &&
        serviceAddress.trim().length > 0 &&
        serviceCity.trim().length > 0
      );
    }
    if (step === 2) {
      if (outcome === "substitute") {
        if (substituteRecipientName.trim().length < 2) return false;
        // The form now exposes structured physical-description fields
        // (age/gender/height/weight/identifying features) alongside the
        // legacy free-text description. We require at least one of them
        // so the affidavit always carries some description of the person
        // who accepted service.
        const hasAnyDescription =
          recipientDescription.trim().length > 0 ||
          recipientAgeEstimate.trim().length > 0 ||
          recipientGender.trim().length > 0 ||
          recipientHeight.trim().length > 0 ||
          recipientWeight.trim().length > 0 ||
          recipientIdentifyingFeatures.trim().length > 0;
        if (!hasAnyDescription) return false;
        if (!acknowledgeMailFollowup) return false;
        if (!mailingAddress.trim()) return false;
        // The follow-up mailing date is part of the affidavit's manner-
        // of-service block — the API rejects substitute service without
        // it whenever the mail-followup commitment is on.
        if (!mailingDate) return false;
      }
      if (outcome === "mail") {
        if (!mailingDate) return false;
        if (!mailingAddress.trim()) return false;
      }
      if (outcome === "posting") {
        if (!postingLocationDescription.trim()) return false;
        // NRCP 4(g) gate — required by the API.
        if (!postingHasCourtOrder) return false;
      }
      if (outcome === "publication") {
        if (!publicationHasCourtOrder) return false;
        if (!publicationOrderRef.trim()) return false;
        if (!publicationNewspaper.trim()) return false;
        if (!publicationCounty.trim()) return false;
        if (!publicationFirstDate) return false;
        if (!publicationLastDate) return false;
      }
      if (outcome === "non_est") {
        if (nonEstSummary.trim().length < 10) return false;
      }
      return true;
    }
    if (step === 3) {
      if (!hasSig) return false;
      if (typedName.trim().length < 2) return false;
      if (!gps) return false;
      // Identity confirmation is mandatory for personal + substitute.
      if (outcome === "personal" || outcome === "substitute") {
        if (!identityMethod) return false;
        if (identityMethod === "other" && identityOtherText.trim().length < 2) {
          return false;
        }
      }
      // Photo: required for personal, optional for substitute, n/a for
      // mail/posting/publication/non_est. Required is enforced at this gate
      // so the Confirm button stays disabled until the server captures one.
      if (outcome === "personal" && !photoFile) return false;
      return true;
    }
    return true;
  })();

  const handleConfirm = async () => {
    if (!canContinue) return;
    if (!gps) {
      toast.error(gpsError ?? "Waiting for GPS — try again in a moment.");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    setSubmitting(true);
    setSubmitStage("Uploading signature…");
    try {
      const sigFile = await canvasToPngFile(canvas, `signature-${job.id}.png`);
      const signatureImageUrl = await uploadServerPhoto(sigFile, job.id);
      // Upload the optional internal-tracking photo separately. Stored
      // on the job + attempt rows but intentionally NOT rendered onto
      // the affidavit PDF — it's evidence for the platform, not the court.
      let proofPhotoUrl: string | undefined;
      if (photoFile) {
        setSubmitStage("Uploading photo…");
        proofPhotoUrl = await uploadServerPhoto(photoFile, job.id);
      }
      setSubmitStage("Recording service & generating affidavit…");

      // Build the LogAttemptBody. We only ship branch-specific fields
      // when they're applicable — the backend validator is strict about
      // required combos but is happy to ignore unrelated extras.
      const body: Parameters<typeof logAttempt.mutateAsync>[0]["data"] = {
        outcome,
        // Send the actual moment of service (from the When/Where step)
        // so the affidavit reflects when service occurred — not when the
        // server confirmed it later. The API clamps to a sane window
        // (no future, no older than 30 days).
        attemptedAt: serviceAt
          ? new Date(serviceAt).toISOString()
          : undefined,
        gpsLat: gps.lat,
        gpsLng: gps.lng,
        gpsProvider: gpsProvider ?? undefined,
        identityMethod:
          (outcome === "personal" || outcome === "substitute") && identityMethod
            ? (identityMethod as "verbal" | "photo_match" | "known" | "other")
            : undefined,
        identityOtherText:
          identityMethod === "other"
            ? identityOtherText.trim() || undefined
            : undefined,
        photoUrl: proofPhotoUrl,
        notes: methodNarrative.trim() || undefined,
        signatureTypedName: typedName.trim(),
        signatureImageUrl,
        serviceAddress: serviceAddress.trim() || undefined,
        serviceCity: serviceCity.trim() || undefined,
        serviceState: serviceState.trim() || undefined,
        serviceZip: serviceZip.trim() || undefined,
        methodNarrative: methodNarrative.trim() || undefined,
      };

      if (outcome === "substitute") {
        body.substituteRecipientName = substituteRecipientName.trim();
        body.substituteOver18 = true;
        body.substituteVerifiedResidence = substituteIsCoResident;
        body.substituteIsCoResident = substituteIsCoResident;
        body.acknowledgeMailFollowup = acknowledgeMailFollowup;
        body.recipientRelationship = recipientRelationship.trim() || undefined;
        body.recipientDescription = recipientDescription.trim() || undefined;
        body.recipientAgeEstimate = recipientAgeEstimate.trim() || undefined;
        body.recipientGender = recipientGender.trim() || undefined;
        body.recipientHeight = recipientHeight.trim() || undefined;
        body.recipientWeight = recipientWeight.trim() || undefined;
        body.recipientIdentifyingFeatures =
          recipientIdentifyingFeatures.trim() || undefined;
        if (mailingDate) body.mailingDate = new Date(mailingDate).toISOString();
        body.mailingAddress = mailingAddress.trim() || undefined;
      } else if (outcome === "mail") {
        body.mailingDate = new Date(mailingDate).toISOString();
        body.mailingAddress = mailingAddress.trim();
      } else if (outcome === "posting") {
        body.postingLocationDescription = postingLocationDescription.trim();
        body.postingHasCourtOrder = postingHasCourtOrder;
      } else if (outcome === "publication") {
        body.publicationOrderRef = publicationOrderRef.trim();
        body.publicationNewspaper = publicationNewspaper.trim();
        body.publicationCounty = publicationCounty.trim();
        body.publicationFirstDate = new Date(publicationFirstDate).toISOString();
        body.publicationLastDate = new Date(publicationLastDate).toISOString();
        body.publicationHasCourtOrder = publicationHasCourtOrder;
      } else if (outcome === "non_est") {
        body.nonEstSummary = nonEstSummary.trim();
      }

      await logAttempt.mutateAsync({ id: job.id, data: body });

      setSubmitStage("Refreshing…");
      // Refresh job + attempts + lists so the dashboard/feed reflect the
      // new "served" status with the freshly-generated affidavit.
      // allSettled so a slow background refetch never blocks the success
      // confirmation — the served-flip is already durable on the server.
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(job.id) }),
        queryClient.invalidateQueries({ queryKey: getListJobAttemptsQueryKey(job.id) }),
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() }),
      ]);

      setConfirmed(true);
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      // Field-resilience: leave submitting=false so the server can hit
      // Confirm again without re-doing the four wizard steps. The toast
      // surfaces the timeout/HTTP message from uploadServerPhoto so it's
      // obvious whether to move to better signal or escalate.
      toast.error("Couldn't confirm service — try again", {
        description: err instanceof Error ? err.message : "Unknown error",
        duration: 8000,
      });
    } finally {
      setSubmitting(false);
      setSubmitStage("");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (confirmed) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      >
        <div className="bg-white rounded-2xl p-10 text-center max-w-sm w-full">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <CircleCheck className="w-8 h-8 text-emerald-500" />
          </div>
          <p className="text-lg font-black text-gray-900">Service Confirmed!</p>
          <p className="text-sm text-gray-500 mt-1">Affidavit PDF generated.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3 min-w-0">
            {step > 0 && !submitting && (
              <button
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                aria-label="Back"
              >
                <ChevronLeft className="w-5 h-5 text-gray-500" />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-base font-bold text-gray-900 truncate">Mark Job as Served</h2>
              <p className="text-xs text-gray-400 mt-0.5 truncate">
                {job.documentType ?? "Serve Documents"} — {job.recipientName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-6 pt-4">
          <div className="flex items-center gap-1.5">
            {STEP_LABELS.map((label, i) => (
              <div key={label} className="flex items-center gap-1.5 flex-1 last:flex-none">
                <div
                  className={cn(
                    "flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold transition-colors",
                    i < step
                      ? "bg-emerald-500 text-white"
                      : i === step
                      ? "bg-amber-400 text-black"
                      : "bg-gray-200 text-gray-400",
                  )}
                >
                  {i < step ? <Check className="w-3 h-3" /> : i + 1}
                </div>
                <span
                  className={cn(
                    "text-[11px] font-semibold hidden sm:block",
                    i === step ? "text-gray-900" : "text-gray-400",
                  )}
                >
                  {label}
                </span>
                {i < STEP_LABELS.length - 1 && (
                  <div className={cn("flex-1 h-0.5 rounded", i < step ? "bg-emerald-300" : "bg-gray-200")} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 space-y-5">
          {step === 0 && (
            <Step0Type outcome={outcome} setOutcome={setOutcome} />
          )}

          {step === 1 && (
            <Step1WhenWhere
              serviceAt={serviceAt}
              setServiceAt={setServiceAt}
              serviceAddress={serviceAddress}
              setServiceAddress={setServiceAddress}
              serviceCity={serviceCity}
              setServiceCity={setServiceCity}
              serviceState={serviceState}
              setServiceState={setServiceState}
              serviceZip={serviceZip}
              setServiceZip={setServiceZip}
              gps={gps}
              gpsError={gpsError}
            />
          )}

          {step === 2 && (
            <Step2Details
              outcome={outcome}
              methodNarrative={methodNarrative}
              setMethodNarrative={setMethodNarrative}
              substituteRecipientName={substituteRecipientName}
              setSubstituteRecipientName={setSubstituteRecipientName}
              recipientRelationship={recipientRelationship}
              setRecipientRelationship={setRecipientRelationship}
              recipientDescription={recipientDescription}
              setRecipientDescription={setRecipientDescription}
              recipientAgeEstimate={recipientAgeEstimate}
              setRecipientAgeEstimate={setRecipientAgeEstimate}
              recipientGender={recipientGender}
              setRecipientGender={setRecipientGender}
              recipientHeight={recipientHeight}
              setRecipientHeight={setRecipientHeight}
              recipientWeight={recipientWeight}
              setRecipientWeight={setRecipientWeight}
              recipientIdentifyingFeatures={recipientIdentifyingFeatures}
              setRecipientIdentifyingFeatures={setRecipientIdentifyingFeatures}
              substituteIsCoResident={substituteIsCoResident}
              setSubstituteIsCoResident={setSubstituteIsCoResident}
              acknowledgeMailFollowup={acknowledgeMailFollowup}
              setAcknowledgeMailFollowup={setAcknowledgeMailFollowup}
              mailingDate={mailingDate}
              setMailingDate={setMailingDate}
              mailingAddress={mailingAddress}
              setMailingAddress={setMailingAddress}
              postingLocationDescription={postingLocationDescription}
              setPostingLocationDescription={setPostingLocationDescription}
              postingHasCourtOrder={postingHasCourtOrder}
              setPostingHasCourtOrder={setPostingHasCourtOrder}
              publicationOrderRef={publicationOrderRef}
              setPublicationOrderRef={setPublicationOrderRef}
              publicationNewspaper={publicationNewspaper}
              setPublicationNewspaper={setPublicationNewspaper}
              publicationCounty={publicationCounty}
              setPublicationCounty={setPublicationCounty}
              publicationFirstDate={publicationFirstDate}
              setPublicationFirstDate={setPublicationFirstDate}
              publicationLastDate={publicationLastDate}
              setPublicationLastDate={setPublicationLastDate}
              publicationHasCourtOrder={publicationHasCourtOrder}
              setPublicationHasCourtOrder={setPublicationHasCourtOrder}
              nonEstSummary={nonEstSummary}
              setNonEstSummary={setNonEstSummary}
            />
          )}

          {step === 3 && (outcome === "personal" || outcome === "substitute") && (
            <IdentityAndPhotoBlock
              outcome={outcome}
              identityMethod={identityMethod}
              setIdentityMethod={setIdentityMethod}
              identityOtherText={identityOtherText}
              setIdentityOtherText={setIdentityOtherText}
              photoFile={photoFile}
              photoPreviewUrl={photoPreviewUrl}
              onPhotoPick={handlePhotoPick}
            />
          )}

          {step === 3 && (
            <Step3Sign
              typedName={typedName}
              setTypedName={setTypedName}
              hasSig={hasSig}
              clearSig={clearSig}
              canvasRef={canvasRef}
              startDraw={startDraw}
              draw={draw}
              endDraw={endDraw}
              gps={gps}
              gpsError={gpsError}
              outcome={outcome}
              serviceAt={serviceAt}
            />
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              disabled={submitting}
              className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            {step < 3 ? (
              <button
                onClick={() => setStep((s) => Math.min(3, s + 1))}
                disabled={!canContinue}
                data-testid="button-modal-continue"
                className="flex-1 py-3 bg-amber-400 hover:bg-amber-500 disabled:bg-gray-200 disabled:text-gray-400 text-black font-bold text-sm rounded-xl transition-colors"
              >
                Continue
              </button>
            ) : (
              <button
                onClick={handleConfirm}
                disabled={!canContinue || submitting}
                data-testid="button-modal-confirm-service"
                className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="truncate">{submitStage || "Working…"}</span>
                  </>
                ) : (
                  <>
                    <CircleCheck className="w-4 h-4" /> Confirm Service
                  </>
                )}
              </button>
            )}
          </div>

          <p className="text-[10px] text-center text-gray-400">
            By signing, you certify under penalty of perjury (NRS 53.045) that the foregoing is true and correct.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Step 0 — Service Type ───────────────────────────────────────────────

function Step0Type({
  outcome,
  setOutcome,
}: {
  outcome: ServiceType;
  setOutcome: (s: ServiceType) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-bold text-gray-900">Type of Service</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Pick how the documents reached the named party. Each branch collects different facts on the next step.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {SERVICE_TYPES.map((opt) => {
          const Icon = opt.icon;
          const selected = outcome === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setOutcome(opt.id)}
              data-testid={`button-service-type-${opt.id}`}
              className={cn(
                "flex items-start gap-3 text-left p-4 rounded-xl border transition-colors",
                selected
                  ? "border-amber-400 bg-amber-50"
                  : "border-gray-200 hover:border-amber-200 hover:bg-amber-50/30",
              )}
            >
              <div
                className={cn(
                  "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                  selected ? "bg-amber-100" : "bg-gray-100",
                )}
              >
                <Icon className={cn("w-4 h-4", selected ? "text-amber-600" : "text-gray-500")} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900">{opt.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Step 1 — Service Moment + Address ───────────────────────────────────

function Step1WhenWhere(props: {
  serviceAt: string;
  setServiceAt: (v: string) => void;
  serviceAddress: string;
  setServiceAddress: (v: string) => void;
  serviceCity: string;
  setServiceCity: (v: string) => void;
  serviceState: string;
  setServiceState: (v: string) => void;
  serviceZip: string;
  setServiceZip: (v: string) => void;
  gps: { lat: number; lng: number } | null;
  gpsError: string | null;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-gray-900">When &amp; Where</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Confirm the date, time, and street address of service. Pre-filled from the job record.
        </p>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Date &amp; Time of Service</label>
        <input
          type="datetime-local"
          value={props.serviceAt}
          onChange={(e) => props.setServiceAt(e.target.value)}
          data-testid="input-service-at"
          className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs font-semibold text-gray-600">Address of Service</label>
          {props.gps && props.serviceAddress ? (
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
              ✓ GPS CONFIRMED
            </span>
          ) : null}
        </div>
        <input
          value={props.serviceAddress}
          onChange={(e) => props.setServiceAddress(e.target.value)}
          placeholder="Street address"
          data-testid="input-service-address"
          className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
        />
        {props.gps && props.serviceAddress ? (
          <p className="text-[11px] text-gray-400 mt-1">
            Pre-filled from the job and confirmed by your GPS fix. Edit only if the actual service address differs.
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-[1fr,80px,100px] gap-2">
        <input
          value={props.serviceCity}
          onChange={(e) => props.setServiceCity(e.target.value)}
          placeholder="City"
          data-testid="input-service-city"
          className="px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
        />
        <input
          value={props.serviceState}
          onChange={(e) => props.setServiceState(e.target.value.toUpperCase())}
          placeholder="State"
          maxLength={2}
          className="px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
        />
        <input
          value={props.serviceZip}
          onChange={(e) => props.setServiceZip(e.target.value)}
          placeholder="ZIP"
          className="px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
        />
      </div>
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
        <p className="font-bold text-gray-500 uppercase tracking-wider text-[10px] mb-0.5">GPS</p>
        {props.gps ? (
          <p className="font-mono text-gray-700">
            {props.gps.lat.toFixed(5)}, {props.gps.lng.toFixed(5)}
          </p>
        ) : props.gpsError ? (
          <p className="text-red-500">{props.gpsError} — required to confirm service.</p>
        ) : (
          <p className="text-gray-400">Acquiring location…</p>
        )}
      </div>
    </div>
  );
}

// ── Step 2 — Branch-specific details ────────────────────────────────────

function Step2Details(props: {
  outcome: ServiceType;
  methodNarrative: string;
  setMethodNarrative: (v: string) => void;
  substituteRecipientName: string;
  setSubstituteRecipientName: (v: string) => void;
  recipientRelationship: string;
  setRecipientRelationship: (v: string) => void;
  recipientDescription: string;
  setRecipientDescription: (v: string) => void;
  recipientAgeEstimate: string;
  setRecipientAgeEstimate: (v: string) => void;
  recipientGender: string;
  setRecipientGender: (v: string) => void;
  recipientHeight: string;
  setRecipientHeight: (v: string) => void;
  recipientWeight: string;
  setRecipientWeight: (v: string) => void;
  recipientIdentifyingFeatures: string;
  setRecipientIdentifyingFeatures: (v: string) => void;
  substituteIsCoResident: boolean;
  setSubstituteIsCoResident: (v: boolean) => void;
  acknowledgeMailFollowup: boolean;
  setAcknowledgeMailFollowup: (v: boolean) => void;
  mailingDate: string;
  setMailingDate: (v: string) => void;
  mailingAddress: string;
  setMailingAddress: (v: string) => void;
  postingLocationDescription: string;
  setPostingLocationDescription: (v: string) => void;
  postingHasCourtOrder: boolean;
  setPostingHasCourtOrder: (v: boolean) => void;
  publicationOrderRef: string;
  setPublicationOrderRef: (v: string) => void;
  publicationNewspaper: string;
  setPublicationNewspaper: (v: string) => void;
  publicationCounty: string;
  setPublicationCounty: (v: string) => void;
  publicationFirstDate: string;
  setPublicationFirstDate: (v: string) => void;
  publicationLastDate: string;
  setPublicationLastDate: (v: string) => void;
  publicationHasCourtOrder: boolean;
  setPublicationHasCourtOrder: (v: boolean) => void;
  nonEstSummary: string;
  setNonEstSummary: (v: string) => void;
}) {
  const placeholderByOutcome: Record<ServiceType, string> = {
    personal:
      "e.g., Personally handed the documents to John Doe at the front door of the residence. Recipient identified themselves verbally.",
    substitute:
      "e.g., Co-resident Jane Doe, approx 45, identified herself as John Doe's spouse and accepted the documents on his behalf.",
    mail:
      "e.g., Deposited true and correct copies in a sealed envelope with first-class postage prepaid in a USPS collection box at 123 Post Office Way.",
    posting:
      "e.g., Posted a true copy in a conspicuous place at the recipient's last known dwelling, secured at eye level on the front door.",
    publication:
      "e.g., Pursuant to court order, caused notice to be published once a week for four consecutive weeks in the Las Vegas Review-Journal, Clark County, Nevada.",
    non_est:
      "e.g., After diligent search and inquiry I have been unable to locate the named party. Detail attempts in the Diligent Search Summary below.",
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-gray-900">Service Details</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Describe how service was effected. This narrative is rendered into the affidavit&apos;s &quot;Manner of Service&quot; block.
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Method Narrative</label>
        <textarea
          value={props.methodNarrative}
          onChange={(e) => props.setMethodNarrative(e.target.value)}
          rows={3}
          placeholder={placeholderByOutcome[props.outcome]}
          data-testid="input-method-narrative"
          className="w-full px-4 py-3 text-sm bg-gray-50 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
        />
      </div>

      {props.outcome === "substitute" && (
        <div className="space-y-3 pt-3 border-t border-gray-100">
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wider">Substitute Recipient</p>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Person Served</label>
            <input
              value={props.substituteRecipientName}
              onChange={(e) => props.setSubstituteRecipientName(e.target.value)}
              placeholder="Name of person who accepted documents"
              data-testid="input-substitute-name"
              className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Relationship to Named Party</label>
            <input
              value={props.recipientRelationship}
              onChange={(e) => props.setRecipientRelationship(e.target.value)}
              placeholder="e.g., Spouse, adult co-resident, office manager"
              className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Estimated Age
              </label>
              <input
                value={props.recipientAgeEstimate}
                onChange={(e) => props.setRecipientAgeEstimate(e.target.value)}
                placeholder="e.g., 40s, 35-45"
                data-testid="input-recipient-age"
                className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Gender
              </label>
              <input
                value={props.recipientGender}
                onChange={(e) => props.setRecipientGender(e.target.value)}
                placeholder="e.g., Female"
                data-testid="input-recipient-gender"
                className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Height
              </label>
              <input
                value={props.recipientHeight}
                onChange={(e) => props.setRecipientHeight(e.target.value)}
                placeholder={`e.g., 5'6"`}
                data-testid="input-recipient-height"
                className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Weight
              </label>
              <input
                value={props.recipientWeight}
                onChange={(e) => props.setRecipientWeight(e.target.value)}
                placeholder="e.g., 150 lbs"
                data-testid="input-recipient-weight"
                className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Identifying Features
            </label>
            <input
              value={props.recipientIdentifyingFeatures}
              onChange={(e) =>
                props.setRecipientIdentifyingFeatures(e.target.value)
              }
              placeholder="e.g., Brown hair, glasses, tattoo on left forearm"
              data-testid="input-recipient-identifying-features"
              className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Additional Description
            </label>
            <input
              value={props.recipientDescription}
              onChange={(e) => props.setRecipientDescription(e.target.value)}
              placeholder="Anything else worth recording (clothing, demeanor, etc.)"
              data-testid="input-recipient-description"
              className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
            />
          </div>
          <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={props.substituteIsCoResident}
              onChange={(e) => props.setSubstituteIsCoResident(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded"
            />
            <span className="text-xs text-gray-700">
              The substitute resides at this address and is of suitable age and discretion (18+).
            </span>
          </label>

          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Follow-up Mailing</p>
            <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={props.acknowledgeMailFollowup}
                onChange={(e) => props.setAcknowledgeMailFollowup(e.target.checked)}
                data-testid="checkbox-mail-followup"
                className="mt-0.5 w-4 h-4 rounded"
              />
              <span className="text-xs text-gray-700">
                I will mail a true copy to the named party at the address below within the time required by law.
              </span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Mailing Date</label>
                <input
                  type="date"
                  value={props.mailingDate}
                  onChange={(e) => props.setMailingDate(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Mailing Address</label>
                <input
                  value={props.mailingAddress}
                  onChange={(e) => props.setMailingAddress(e.target.value)}
                  placeholder="Where the copy will be mailed"
                  className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {props.outcome === "mail" && (
        <div className="space-y-3 pt-3 border-t border-gray-100">
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wider">Mail Service</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Date Deposited</label>
              <input
                type="date"
                value={props.mailingDate}
                onChange={(e) => props.setMailingDate(e.target.value)}
                data-testid="input-mailing-date"
                className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Mailed To</label>
              <input
                value={props.mailingAddress}
                onChange={(e) => props.setMailingAddress(e.target.value)}
                placeholder="Recipient mailing address"
                data-testid="input-mailing-address"
                className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
              />
            </div>
          </div>
        </div>
      )}

      {props.outcome === "publication" && (
        <div className="space-y-3 pt-3 border-t border-gray-100">
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wider">Publication (NRS 14.040)</p>
          <label className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={props.publicationHasCourtOrder}
              onChange={(e) => props.setPublicationHasCourtOrder(e.target.checked)}
              data-testid="checkbox-publication-court-order"
              className="mt-0.5 w-4 h-4 rounded"
            />
            <span className="text-xs text-gray-800">
              I confirm a court order authorising service by publication (NRS 14.040) has been entered for this matter.
            </span>
          </label>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Court Order Ref. / Date</label>
            <input
              value={props.publicationOrderRef}
              onChange={(e) => props.setPublicationOrderRef(e.target.value)}
              placeholder="e.g., Order entered 2026-04-15, Dept III"
              data-testid="input-publication-order-ref"
              className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Newspaper</label>
              <input
                value={props.publicationNewspaper}
                onChange={(e) => props.setPublicationNewspaper(e.target.value)}
                placeholder="e.g., Las Vegas Review-Journal"
                data-testid="input-publication-newspaper"
                className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">County</label>
              <input
                value={props.publicationCounty}
                onChange={(e) => props.setPublicationCounty(e.target.value)}
                placeholder="e.g., Clark"
                data-testid="input-publication-county"
                className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">First Publication Date</label>
              <input
                type="date"
                value={props.publicationFirstDate}
                onChange={(e) => props.setPublicationFirstDate(e.target.value)}
                data-testid="input-publication-first-date"
                className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Last Publication Date</label>
              <input
                type="date"
                value={props.publicationLastDate}
                onChange={(e) => props.setPublicationLastDate(e.target.value)}
                data-testid="input-publication-last-date"
                className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
              />
            </div>
          </div>
          <p className="text-[11px] text-gray-500">
            The newspaper publisher files a separate Affidavit of Publication; this affidavit attests to the underlying court order and your compliance.
          </p>
        </div>
      )}

      {props.outcome === "non_est" && (
        <div className="space-y-3 pt-3 border-t border-gray-100">
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wider">Diligent Search Summary</p>
          <textarea
            value={props.nonEstSummary}
            onChange={(e) => props.setNonEstSummary(e.target.value)}
            rows={4}
            placeholder="Summarise the diligent search efforts (skip trace, alternate addresses contacted, employer/relatives queried, dates of attempts, etc.)."
            data-testid="input-non-est-summary"
            className="w-full px-4 py-3 text-sm bg-gray-50 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
          />
          <p className="text-[11px] text-gray-500">
            All logged attempts are also listed on the affidavit. This summary appears under &quot;Diligent Search&quot; in the Service Details block.
          </p>
        </div>
      )}

      {props.outcome === "posting" && (
        <div className="space-y-3 pt-3 border-t border-gray-100">
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wider">Posting Location</p>
          <textarea
            value={props.postingLocationDescription}
            onChange={(e) => props.setPostingLocationDescription(e.target.value)}
            rows={2}
            placeholder="e.g., Affixed at eye level on the front door of the dwelling, secured with weatherproof tape."
            data-testid="input-posting-location"
            className="w-full px-4 py-3 text-sm bg-gray-50 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
          />
          <label className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={props.postingHasCourtOrder}
              onChange={(e) => props.setPostingHasCourtOrder(e.target.checked)}
              data-testid="checkbox-posting-court-order"
              className="mt-0.5 w-4 h-4 rounded"
            />
            <span className="text-xs text-gray-800">
              I confirm a court order authorising service by posting (NRCP 4(g)) is on file for this matter.
              Service by posting is invalid without it.
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

// ── Step 3 prelude — Identity confirmation + internal-tracking photo ────
// Surfaces ONLY for personal/substitute outcomes. Captured for platform
// evidence; intentionally NOT rendered onto the affidavit PDF.

const IDENTITY_OPTIONS: Array<{
  id: "verbal" | "photo_match" | "known" | "other";
  label: string;
  desc: string;
}> = [
  { id: "verbal", label: "Verbal", desc: "Recipient stated their name." },
  { id: "photo_match", label: "Photo Match", desc: "Compared face / ID to a photo." },
  { id: "known", label: "Known to Me", desc: "I already knew the recipient by sight." },
  { id: "other", label: "Other", desc: "Describe in the note below." },
];

function IdentityAndPhotoBlock(props: {
  outcome: ServiceType;
  identityMethod: "verbal" | "photo_match" | "known" | "other" | "";
  setIdentityMethod: (
    v: "verbal" | "photo_match" | "known" | "other" | "",
  ) => void;
  identityOtherText: string;
  setIdentityOtherText: (v: string) => void;
  photoFile: File | null;
  photoPreviewUrl: string | null;
  onPhotoPick: (f: File | null) => void;
}) {
  const photoRequired = props.outcome === "personal";
  return (
    <div className="space-y-4 pb-4 border-b border-gray-100">
      <div>
        <h3 className="text-sm font-bold text-gray-900">
          Identity Confirmation <span className="text-red-500">*</span>
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">
          How did you confirm the person you served? Captured for internal records — not printed on the affidavit.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {IDENTITY_OPTIONS.map((opt) => {
          const selected = props.identityMethod === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => props.setIdentityMethod(opt.id)}
              data-testid={`button-identity-${opt.id}`}
              className={cn(
                "text-left p-3 rounded-xl border transition-colors",
                selected
                  ? "border-amber-400 bg-amber-50"
                  : "border-gray-200 hover:border-amber-200 hover:bg-amber-50/30",
              )}
            >
              <p className="text-xs font-bold text-gray-900">{opt.label}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{opt.desc}</p>
            </button>
          );
        })}
      </div>
      {props.identityMethod === "other" && (
        <input
          value={props.identityOtherText}
          onChange={(e) => props.setIdentityOtherText(e.target.value)}
          placeholder="Briefly describe how identity was confirmed"
          data-testid="input-identity-other"
          className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
        />
      )}

      <div>
        <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
          Photo {photoRequired ? <span className="text-red-500">*</span> : <span className="text-gray-400 normal-case font-medium">(optional)</span>}
        </label>
        <p className="text-[11px] text-gray-500 mb-2">
          Internal evidence only. The photo is stored with the job record but never appears on the affidavit PDF.
        </p>
        {props.photoPreviewUrl ? (
          <div className="space-y-2">
            <img
              src={props.photoPreviewUrl}
              alt="Service evidence preview"
              className="w-full max-h-48 object-cover rounded-xl border border-gray-200"
              data-testid="img-photo-preview"
            />
            <button
              type="button"
              onClick={() => props.onPhotoPick(null)}
              data-testid="button-photo-clear"
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Remove photo
            </button>
          </div>
        ) : (
          <label
            className={cn(
              "flex flex-col items-center justify-center gap-1 px-4 py-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors",
              photoRequired && !props.photoFile
                ? "border-amber-300 bg-amber-50/40 hover:bg-amber-50"
                : "border-gray-200 bg-gray-50 hover:bg-gray-100",
            )}
          >
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => props.onPhotoPick(e.target.files?.[0] ?? null)}
              className="sr-only"
              data-testid="input-photo-file"
            />
            <p className="text-xs font-semibold text-gray-700">
              Tap to capture or upload a photo
            </p>
            <p className="text-[10px] text-gray-400">
              {photoRequired ? "Required for personal service" : "Optional for substitute service"}
            </p>
          </label>
        )}
      </div>
    </div>
  );
}

// ── Step 3 — Sign & Confirm ─────────────────────────────────────────────

function Step3Sign(props: {
  typedName: string;
  setTypedName: (v: string) => void;
  hasSig: boolean;
  clearSig: () => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  startDraw: (e: React.MouseEvent | React.TouchEvent) => void;
  draw: (e: React.MouseEvent | React.TouchEvent) => void;
  endDraw: () => void;
  gps: { lat: number; lng: number } | null;
  gpsError: string | null;
  outcome: ServiceType;
  serviceAt: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-gray-900">Sign &amp; Confirm</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Your printed name and drawn signature will appear on the affidavit alongside the locked NRS 53.045 declaration.
        </p>
      </div>
      <div className="border border-gray-200 rounded-xl p-3 bg-gray-50 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-1">Type</p>
          <p className="font-bold text-gray-900 capitalize">{props.outcome}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-1">Service Time</p>
          <p className="font-medium text-emerald-600">
            {props.serviceAt
              ? format(new Date(props.serviceAt), "MMM d, yyyy 'at' h:mm aa")
              : "—"}
          </p>
        </div>
        <div className="col-span-2">
          <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-1">GPS</p>
          {props.gps ? (
            <p className="font-mono text-gray-700">
              {props.gps.lat.toFixed(5)}, {props.gps.lng.toFixed(5)}
            </p>
          ) : props.gpsError ? (
            <p className="text-red-500">{props.gpsError}</p>
          ) : (
            <p className="text-gray-400">Acquiring…</p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
          Printed Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          autoComplete="name"
          value={props.typedName}
          onChange={(e) => props.setTypedName(e.target.value)}
          placeholder="e.g., Pat M. Server"
          data-testid="input-modal-typed-name"
          className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 bg-gray-50"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
            Server Signature <span className="text-red-500">*</span>
          </label>
          {props.hasSig && (
            <button onClick={props.clearSig} className="text-xs text-gray-400 hover:text-gray-600">
              Clear
            </button>
          )}
        </div>
        <div
          className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden"
          style={{ borderStyle: props.hasSig ? "solid" : "dashed" }}
        >
          <canvas
            ref={props.canvasRef}
            width={600}
            height={160}
            data-testid="canvas-modal-signature"
            className="w-full touch-none cursor-crosshair"
            style={{ height: 120 }}
            onMouseDown={props.startDraw}
            onMouseMove={props.draw}
            onMouseUp={props.endDraw}
            onMouseLeave={props.endDraw}
            onTouchStart={props.startDraw}
            onTouchMove={props.draw}
            onTouchEnd={props.endDraw}
          />
        </div>
        {!props.hasSig && (
          <p className="text-xs text-center text-gray-400 mt-2">
            Draw your signature above using your finger or stylus.
          </p>
        )}
      </div>
    </div>
  );
}
