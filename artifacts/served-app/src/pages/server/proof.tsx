import { useEffect, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetJob,
  useListJobAttempts,
  useEnsureJobAffidavit,
  useEnsureJobNoticeOfMail,
  useConfirmJobMailing,
  useBackfillJobAttemptIdentity,
  getGetJobQueryKey,
  getListJobAttemptsQueryKey,
  type Job,
  type Server as ApiServer,
  type ServiceAttempt,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/lib/me";
import { MapPin, Download, Printer, Mail, CheckCircle2, ArrowLeft, Zap, User, CircleCheck, Camera, Loader2, Send, FileText, Upload } from "lucide-react";
import { format } from "date-fns";
import { LEGAL_ENTITY, NEVADA_DECLARATION } from "@/data/legal";
import { AttemptHistory } from "@/components/AttemptHistory";
import { resolveStorageObjectUrl } from "@/lib/storageUrl";
import { uploadServerPhoto } from "@/lib/uploadServerPhoto";

const COMPLETING_OUTCOMES = new Set([
  "personal",
  "substitute",
  "mail",
  "posting",
  "publication",
  "non_est",
]);

function outcomeLabel(outcome: string | null | undefined): string {
  switch (outcome) {
    case "personal":
      return "PERSONAL SERVICE";
    case "substitute":
      return "SUBSTITUTE SERVICE";
    case "mail":
      return "SERVICE BY MAIL";
    case "posting":
      return "SERVICE BY POSTING";
    case "publication":
      return "SERVICE BY PUBLICATION";
    case "non_est":
      return "RETURN OF NON-EST";
    case "unable":
      return "UNABLE TO SERVE";
    default:
      return (outcome ?? "PERSONAL SERVICE").toUpperCase();
  }
}

// ── helpers shared by the new template-styled affidavit preview ─────
const STATE_NAMES: Record<string, string> = {
  NV: "NEVADA", CA: "CALIFORNIA", NY: "NEW YORK", FL: "FLORIDA",
  TX: "TEXAS", AZ: "ARIZONA", UT: "UTAH", OR: "OREGON", WA: "WASHINGTON",
};
function expandState(s: string | null | undefined): string {
  const v = (s ?? "").trim();
  if (!v) return "NEVADA";
  if (v.length === 2) return STATE_NAMES[v.toUpperCase()] ?? v.toUpperCase();
  return v.toUpperCase();
}
function gpsProviderLabel(p: string | null | undefined): string {
  switch (p) {
    case "gps": return "Device GPS";
    case "gps_assisted": return "Assisted GPS";
    case "network": return "Network Location";
    case "geolocation_api": return "Browser Geolocation";
    default: return "Captured On-Site";
  }
}
function identityLabel(m: string | null | undefined): string {
  switch (m) {
    case "verbal": return "Verbal Confirmation";
    case "photo_match": return "Photo Match";
    case "known": return "Known to Server";
    case "other": return "Other";
    default: return "—";
  }
}
function outcomeNiceLabel(o: string | null | undefined): string {
  switch (o) {
    case "personal": return "Personal Service";
    case "substitute": return "Substitute Service";
    case "mail": return "Service by Mail";
    case "posting": return "Service by Posting";
    case "publication": return "Service by Publication";
    case "non_est": return "Return of Non-Est";
    case "unable": return "Unable to Serve";
    default: return outcomeLabel(o);
  }
}

/** Tiny check-row used inside the SERVER INFO and RECIPIENT INFO blocks. */
function CheckRow({ checked, label }: { checked: boolean; label: string }) {
  return (
    <div className="flex items-start gap-1.5 text-[11px] leading-tight">
      <div
        className={`mt-0.5 w-2.5 h-2.5 border ${
          checked ? "bg-brand-navy border-brand-navy" : "border-gray-400"
        }`}
        aria-hidden
      />
      <span className={checked ? "font-bold text-gray-900" : "text-gray-500"}>
        {label}
      </span>
    </div>
  );
}

/** Section label — small caps, navy, with a thin underline. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-gray-300 pb-0.5 mb-1.5">
      <p className="text-[9px] font-bold tracking-[0.12em] text-brand-navy uppercase">
        {children}
      </p>
    </div>
  );
}

/** label : value pair used everywhere on the affidavit. */
function Field({
  label,
  value,
  labelW = "w-20",
}: {
  label: string;
  value: React.ReactNode;
  labelW?: string;
}) {
  return (
    <div className="flex items-start text-[11px] leading-tight gap-1">
      <span className={`${labelW} flex-shrink-0 font-bold text-gray-500 text-[10px] tracking-wide pt-px`}>
        {label}
      </span>
      <span className="text-gray-900 break-words">{value || "—"}</span>
    </div>
  );
}

/**
 * On-page proof-of-service preview. Mirrors the navy/amber template
 * rendered by `affidavitPdf.ts` so what the server sees here matches
 * the filed PDF: navy header band, two-column case caption, sworn
 * statement, two-column server-info / requested-by, two-column
 * service-details / recipient-info (with identity check-row), GPS
 * pill, attempt history, NRS 53.045 declaration callout, and the
 * signature/notary block. The internal-tracking photo is intentionally
 * NOT shown — it lives on the platform record only.
 */
function AffidavitDocument({
  job,
  server,
  completingAttempt,
  attempts,
  serverDisplayName,
}: {
  job: Job;
  server: ApiServer | undefined;
  completingAttempt: ServiceAttempt | null;
  attempts: ServiceAttempt[];
  serverDisplayName: string;
}) {
  const servedAtIso = completingAttempt?.attemptedAt ?? job.servedAt ?? null;
  const servedDate = servedAtIso ? format(new Date(servedAtIso), "MMMM d, yyyy") : "—";
  const servedTime = servedAtIso ? format(new Date(servedAtIso), "h:mm a") : "—";

  const venueCounty =
    server?.licenseCounty?.trim() ||
    completingAttempt?.serviceCity?.trim() ||
    job.recipientCity?.trim() ||
    "_______________";

  const courtName =
    job.courtName?.trim() ||
    "Eighth Judicial District Court, Clark County, Nevada";
  const petitioner =
    job.petitioner?.trim() ||
    job.matterName?.trim() ||
    "Petitioner";
  const respondent = job.respondent?.trim() || job.recipientName;

  const credLine = server?.isLicensedNvServer
    ? `, a licensed process server in the State of Nevada (Work Card No. ${
        server.licenseNumber || "____"
      }${server.licenseCounty ? `, ${server.licenseCounty} County` : ""})`
    : server?.licenseNumber
    ? ` (License No. ${server.licenseNumber})`
    : "";
  const businessLine = server?.businessAddress
    ? ` Business address: ${server.businessAddress.trim()}.`
    : "";

  const docs = job.documentsServed && job.documentsServed.length > 0
    ? job.documentsServed
    : null;

  const outcome = completingAttempt?.outcome ?? "personal";
  const addrLine1 =
    completingAttempt?.serviceAddress?.trim() || job.recipientAddress;
  const addrCity =
    completingAttempt?.serviceCity?.trim() || job.recipientCity;
  const addrState =
    completingAttempt?.serviceState?.trim() || job.recipientState;
  const addrZip = completingAttempt?.serviceZip?.trim() || job.recipientZip;
  const addrCityLine = [addrCity, addrState].filter(Boolean).join(", ");
  const addrFooter = [addrCityLine, addrZip].filter(Boolean).join(" ") || "—";

  const narrative = completingAttempt?.methodNarrative?.trim() || null;

  const gpsLat = completingAttempt?.gpsLat ?? job.gpsLat ?? null;
  const gpsLng = completingAttempt?.gpsLng ?? job.gpsLng ?? null;
  const gpsFull =
    gpsLat != null && gpsLng != null
      ? `${gpsLat.toFixed(6)}, ${gpsLng.toFixed(6)}`
      : "GPS not recorded";

  const signedName = (job.signatureTypedName ?? "").trim() || serverDisplayName;
  const signatureSrc = job.signatureImageUrl
    ? resolveStorageObjectUrl(job.signatureImageUrl)
    : null;

  // ── derive template-block data ────────────────────────────────────
  // Server profile doesn't expose licenseState publicly — fall back to
  // the job's recipient state, which for our NV MVP will normally be NV.
  const venueState = expandState(job.recipientState);
  const affidavitId = job.platformRef ?? `JOB-${job.id}`;
  const generatedAt = job.servedAt ? new Date(job.servedAt) : new Date();
  const generatedDate = format(generatedAt, "MMMM d, yyyy");

  // Server classification → drives the four-checkbox row in SERVER INFO.
  const sType =
    (server?.serverType ?? "").trim() ||
    (server?.isLicensedNvServer ? "licensed_nv" : "");

  // Firm/attorney snapshot → REQUESTED BY block. Falls back to the
  // requester* fields captured on the job when no client is linked.
  const firmName =
    job.client?.firmName?.trim() || job.requesterName?.trim() || "—";
  const attorneyName =
    job.client?.contactName?.trim() || job.requesterName?.trim() || "—";
  const fileNo = job.matterName?.trim() || affidavitId;
  const firmPhone =
    job.client?.phone?.trim() || job.requesterPhone?.trim() || "—";
  const firmEmail =
    job.client?.email?.trim() || job.requesterEmail?.trim() || "—";

  const fullAddress = [
    addrLine1,
    [addrCity, addrState].filter(Boolean).join(", "),
    addrZip,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(", ,", ",");

  const idMethod = (completingAttempt?.identityMethod ?? "").trim();
  const idOther = completingAttempt?.identityOtherText?.trim() || "";
  const showIdentityRow = outcome === "personal" || outcome === "substitute";

  const gpsProvider = completingAttempt?.gpsProvider ?? null;
  const hasGps = gpsLat != null && gpsLng != null;

  const recentAttempts = attempts.slice(-3);

  return (
    <div
      className="bg-white border border-gray-200 rounded-xl overflow-hidden text-[12px] text-gray-900 shadow-sm"
      data-testid="affidavit-document"
    >
      {/* Header banner intentionally omitted — keeps the document
          looking like a traditional legal filing. Affidavit ID and
          SERVED. branding live in the footer band instead. */}
      <div className="h-1 bg-amber-500" />

      <div className="px-6 py-5 space-y-4">
        {/* ── Venue (centered) ──────────────────────────────────── */}
        <div className="text-center space-y-0.5">
          <p className="font-bold text-[11px] tracking-wide">STATE OF {venueState}</p>
          <p className="font-bold text-[11px] tracking-wide">
            COUNTY OF {venueCounty.toUpperCase()}
          </p>
          <p className="font-bold text-[12px] tracking-wide pt-1 uppercase">
            {courtName}
          </p>
        </div>

        {/* ── Caption: parties left, case/dept right with rule ──── */}
        <div className="grid grid-cols-2 gap-4 relative">
          <div className="text-[12px] leading-relaxed pr-4">
            <p className="font-bold">{petitioner},</p>
            <p className="pl-4 italic text-gray-600 text-[11px]">
              Petitioner / Plaintiff,
            </p>
            <p className="pl-4 italic text-gray-600 text-[11px]">vs.</p>
            <p className="font-bold">{respondent},</p>
            <p className="pl-4 italic text-gray-600 text-[11px]">
              Respondent / Defendant.
            </p>
          </div>
          <div className="border-l border-gray-300 pl-4 space-y-1 pt-1">
            <Field
              labelW="w-16"
              label="Case No.:"
              value={job.caseNumber || "______________________"}
            />
            <Field
              labelW="w-16"
              label="Dept No.:"
              value={job.deptNumber?.trim() || "______"}
            />
          </div>
        </div>

        {/* ── Title ─────────────────────────────────────────────── */}
        <div className="text-center pt-1 space-y-1">
          <h2 className="text-lg font-bold tracking-[0.2em] uppercase">
            {outcome === "non_est" ? "Return of Non-Est" : "Affidavit of Service"}
          </h2>
          <p className="text-[10px] text-gray-500">Affidavit ID: {affidavitId}</p>
        </div>

        {/* ── Sworn statement ───────────────────────────────────── */}
        <div>
          <SectionLabel>Sworn Statement</SectionLabel>
          <p className="text-[11px] text-gray-800 mb-1">
            I, the undersigned, being first duly sworn upon oath, declare:
          </p>
          <ul className="space-y-0.5">
            {[
              "I am over the age of eighteen (18)",
              "I am not a party to this action",
              `I am legally authorized to serve process in the State of ${venueState}`,
            ].map((b) => (
              <li key={b} className="flex gap-1.5 text-[11px] text-gray-800">
                <span className="text-amber-500 font-bold leading-none mt-0.5">•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* ── SERVER INFO + REQUESTED BY / DOCS SERVED ──────────── */}
        <div className="grid grid-cols-2 gap-5">
          <div>
            <SectionLabel>Server Information</SectionLabel>
            <div className="space-y-0.5">
              <Field label="Name:" value={serverDisplayName} />
              <div className="flex items-start text-[11px] gap-1">
                <span className="w-20 flex-shrink-0 font-bold text-gray-500 text-[10px] tracking-wide pt-px">
                  Type:
                </span>
                <div className="space-y-0.5">
                  <CheckRow checked={sType === "licensed_nv"} label="Licensed Process Server" />
                  <CheckRow checked={sType === "registered"} label="Registered Process Server" />
                  <CheckRow checked={sType === "private"} label="Private Individual" />
                </div>
              </div>
              {sType === "licensed_nv" && (
                <Field label="License No.:" value={server?.licenseNumber?.trim() || "—"} />
              )}
              <Field label="County:" value={server?.licenseCounty?.trim() || "—"} />
              <Field label="Address:" value={server?.businessAddress?.trim() || "—"} />
              <Field label="Phone:" value="775-655-3933" />
              <Field label="Email:" value="support@servedapp.co" />
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <SectionLabel>Requested By</SectionLabel>
              <div className="space-y-0.5">
                <Field label="Law Firm:" value={firmName} />
                <Field label="Attorney:" value={attorneyName} />
                <Field label="File No.:" value={fileNo} />
                <Field label="Phone:" value={firmPhone} />
                <Field label="Email:" value={firmEmail} />
              </div>
            </div>
            <div>
              <SectionLabel>Documents Served</SectionLabel>
              <ul className="space-y-0.5">
                {docs ? (
                  docs.map((d, i) => {
                    const title = d.title?.trim() || d.documentType?.trim() || "Document";
                    const type = d.documentType?.trim();
                    const showType =
                      type && type !== title && type.toLowerCase() !== "other";
                    return (
                      <li
                        key={i}
                        className="flex gap-1.5 text-[11px] text-gray-800"
                        data-testid={`text-document-served-${i}`}
                      >
                        <span className="text-amber-500 font-bold leading-none mt-0.5">•</span>
                        <span>
                          {title}
                          {showType ? ` (${type})` : ""}
                        </span>
                      </li>
                    );
                  })
                ) : (
                  <li className="flex gap-1.5 text-[11px] text-gray-800">
                    <span className="text-amber-500 font-bold leading-none mt-0.5">•</span>
                    <span>{job.documentType || "Legal documents"}</span>
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>

        {/* ── SERVICE DETAILS + RECIPIENT INFO ──────────────────── */}
        <div className="grid grid-cols-2 gap-5">
          <div>
            <SectionLabel>Service Details</SectionLabel>
            <div className="space-y-0.5">
              <Field label="Manner:" value={outcomeNiceLabel(outcome)} />
              <Field label="Date:" value={servedDate} />
              <Field label="Time:" value={servedTime} />
              <Field label="Address:" value={fullAddress || "—"} />
              {outcome === "substitute" && completingAttempt?.substituteRecipientName && (
                <Field
                  labelW="w-28"
                  label="Sub. Recipient:"
                  value={completingAttempt.substituteRecipientName}
                />
              )}
              {outcome === "substitute" && completingAttempt?.recipientRelationship && (
                <Field
                  labelW="w-28"
                  label="Relationship:"
                  value={completingAttempt.recipientRelationship}
                />
              )}
              {outcome === "mail" && completingAttempt?.mailingDate && (
                <Field
                  label="Deposited:"
                  value={format(new Date(completingAttempt.mailingDate), "MMMM d, yyyy")}
                />
              )}
              {outcome === "mail" && completingAttempt?.mailingAddress && (
                <Field label="Mailed To:" value={completingAttempt.mailingAddress} />
              )}
              {outcome === "posting" && completingAttempt?.postingLocationDescription && (
                <Field label="Location:" value={completingAttempt.postingLocationDescription} />
              )}
              {outcome === "publication" && completingAttempt?.publicationNewspaper && (
                <Field labelW="w-28" label="Newspaper:" value={completingAttempt.publicationNewspaper} />
              )}
              {outcome === "publication" && completingAttempt?.publicationCounty && (
                <Field labelW="w-28" label="County:" value={completingAttempt.publicationCounty} />
              )}
              {outcome === "publication" && (completingAttempt?.publicationFirstDate || completingAttempt?.publicationLastDate) && (
                <Field
                  labelW="w-28"
                  label="Pub. Dates:"
                  value={`${completingAttempt?.publicationFirstDate ? format(new Date(completingAttempt.publicationFirstDate), "MMMM d, yyyy") : "—"} – ${completingAttempt?.publicationLastDate ? format(new Date(completingAttempt.publicationLastDate), "MMMM d, yyyy") : "—"}`}
                />
              )}
              {outcome === "publication" && completingAttempt?.publicationOrderRef && (
                <Field labelW="w-28" label="Court Order:" value={completingAttempt.publicationOrderRef} />
              )}
              {outcome === "non_est" && completingAttempt?.nonEstSummary && (
                <Field labelW="w-32" label="Diligent Search:" value={completingAttempt.nonEstSummary} />
              )}
            </div>
          </div>

          <div>
            <SectionLabel>Recipient Information</SectionLabel>
            <div className="space-y-0.5">
              <Field labelW="w-24" label="Named Party:" value={job.recipientName} />
              {showIdentityRow && (
                <div className="flex items-start text-[11px] gap-1">
                  <span className="w-24 flex-shrink-0 font-bold text-gray-500 text-[10px] tracking-wide pt-px">
                    Identity By:
                  </span>
                  <div className="space-y-0.5">
                    <CheckRow checked={idMethod === "verbal"} label="Verbal Confirmation" />
                    <CheckRow checked={idMethod === "photo_match"} label="Photo Match" />
                    <CheckRow checked={idMethod === "known"} label="Known to Server" />
                    <CheckRow
                      checked={idMethod === "other"}
                      label={
                        idMethod === "other" && idOther
                          ? `Other: ${idOther}`
                          : "Other"
                      }
                    />
                  </div>
                </div>
              )}
              {narrative && (
                <Field labelW="w-24" label="Notes:" value={narrative} />
              )}
            </div>
          </div>
        </div>

        {/* ── GPS VERIFICATION ──────────────────────────────────── */}
        <div>
          <SectionLabel>GPS Verification</SectionLabel>
          <div className="flex items-center gap-3">
            <Field
              labelW="w-24"
              label="Coordinates:"
              value={
                hasGps
                  ? `${gpsLat!.toFixed(6)}, ${gpsLng!.toFixed(6)}`
                  : "Not recorded"
              }
            />
            {hasGps && (
              <span
                className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold"
                data-testid="badge-gps-verified"
              >
                GPS Location Verified — {gpsProviderLabel(gpsProvider)}
              </span>
            )}
          </div>
        </div>

        {/* ── ATTEMPT HISTORY ───────────────────────────────────── */}
        {recentAttempts.length > 0 && (
          <div>
            <SectionLabel>Attempt History</SectionLabel>
            <div className="space-y-1">
              {recentAttempts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 border border-gray-200 rounded px-2 py-1 text-[11px]"
                  data-testid={`attempt-history-row-${a.id}`}
                >
                  <span className="font-bold text-brand-navy w-32 flex-shrink-0">
                    {outcomeNiceLabel(a.outcome).toUpperCase()}
                  </span>
                  <span className="text-gray-700 w-40 flex-shrink-0">
                    {a.attemptedAt
                      ? format(new Date(a.attemptedAt), "MMM d, yyyy h:mm a")
                      : "—"}
                  </span>
                  {a.notes && (
                    <span className="text-gray-500 truncate">{a.notes}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── DECLARATION (NRS 53.045) ─────────────────────────── */}
        <div className="border-l-4 border-amber-500 bg-amber-50 px-3 py-2">
          <p className="text-[11px] text-gray-800" data-testid="text-nevada-declaration">
            <span className="font-bold text-brand-navy mr-1">
              DECLARATION (NRS 53.045):
            </span>
            {NEVADA_DECLARATION}
          </p>
        </div>

        {/* ── SIGNATURE (full-width, compact) ─────────────────────── */}
        <div className="pt-1">
          <div className="h-10 w-1/2 flex items-end">
            {signatureSrc ? (
              <img
                src={signatureSrc}
                alt={`Signature of ${signedName}`}
                data-testid="img-affidavit-signature"
                className="max-h-10 object-contain"
              />
            ) : (
              <span className="text-2xl italic text-gray-800">{signedName}</span>
            )}
          </div>
          <div className="border-t border-gray-700 pt-1 flex items-baseline justify-between">
            <p className="text-[11px] font-bold">/s/ {signedName}</p>
            <p className="text-[10px] text-gray-500">
              Printed name: {signedName} &nbsp;&bull;&nbsp; Signed on: {generatedDate}
            </p>
          </div>
        </div>
      </div>

      {/* ── Footer band ──────────────────────────────────────────── */}
      <div className="h-0.5 bg-amber-500" />
      <div className="bg-brand-navy px-6 py-2 flex items-center justify-between text-[9px]">
        <div className="text-white">
          Engaged through:{" "}
          <span className="text-amber-400 font-bold">{LEGAL_ENTITY.tradeName}</span>
          {"    "}servedapp.co{"    "}info@servedapp.co
        </div>
        <div className="text-right">
          <div className="text-white font-bold">Affidavit ID: {affidavitId}</div>
          <div className="text-white/60 text-[8px]">
            This document is digitally recorded and tamper-evident.
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Inline card shown to the assigned server when a substitute job has a
 * *committed* follow-up mailing (mailingDate + mailingAddress captured at
 * mark-served time) but the actual deposit hasn't been confirmed yet.
 *
 * Once the server taps "Mark mailed", we POST /jobs/:id/confirm-mailing
 * which stamps `mailingCompletedAt` on the latest substitute attempt.
 * The endpoint is idempotent on that timestamp, so a duplicate tap (or
 * an opened-in-two-tabs scenario) returns 409 with the existing record
 * — handled below by treating both "200 success" and "409 already-set"
 * as terminal states that swap the card for the success badge.
 */
function MailingConfirmationCard({
  jobId,
  attempt,
}: {
  jobId: number;
  attempt: ServiceAttempt;
}) {
  const queryClient = useQueryClient();
  const [completedAt, setCompletedAt] = useState<string>(
    () => format(new Date(), "yyyy-MM-dd"),
  );
  const [confirmedRow, setConfirmedRow] = useState<ServiceAttempt | null>(
    attempt.mailingCompletedAt ? attempt : null,
  );
  // Mailing-receipt photo: the server snaps the post-office receipt /
  // certified-mail label and we PUT it through the existing presigned-URL
  // flow, then forward the resulting objectPath in the confirm-mailing
  // POST body so it lands on `service_attempts.mailingProofPhotoUrl`.
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPath, setReceiptPath] = useState<string | null>(
    attempt.mailingProofPhotoUrl ?? null,
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const confirm = useConfirmJobMailing({
    mutation: {
      onSuccess: (row) => {
        setConfirmedRow(row);
        queryClient.invalidateQueries({ queryKey: getListJobAttemptsQueryKey(jobId) });
      },
      onError: (err: unknown) => {
        // The 409 path returns the existing row in the response body.
        // Surface it as success so a stale tab doesn't get stuck.
        const status = (err as { status?: number })?.status;
        const data = (err as { data?: ServiceAttempt })?.data;
        if (status === 409 && data?.mailingCompletedAt) {
          setConfirmedRow(data);
          queryClient.invalidateQueries({ queryKey: getListJobAttemptsQueryKey(jobId) });
        }
      },
    },
  });

  if (confirmedRow?.mailingCompletedAt) {
    const receiptHref = confirmedRow.mailingProofPhotoUrl
      ? resolveStorageObjectUrl(confirmedRow.mailingProofPhotoUrl)
      : null;
    // Post-confirmation receipt attach: the server may have hit
    // "Mark mailed" without uploading the receipt photo (e.g. went to
    // the post office later). The endpoint accepts a follow-up POST
    // that fills `mailingProofPhotoUrl` only while it's still null,
    // so this control stays visible until evidence is on file.
    const handleLateAttach = async (file: File) => {
      setUploadError(null);
      setReceiptFile(file);
      setUploading(true);
      try {
        const path = await uploadServerPhoto(file, jobId);
        setReceiptPath(path);
        confirm.mutate({ id: jobId, data: { proofPhotoUrl: path } });
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Failed to upload receipt photo",
        );
        setReceiptFile(null);
      } finally {
        setUploading(false);
      }
    };
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-3" data-testid="card-mailing-confirmed">
        <div className="flex items-start gap-3">
          <CircleCheck className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-emerald-800">Follow-up mailing confirmed</p>
            <p className="text-xs text-emerald-700 mt-0.5">
              Mailed on{" "}
              {format(new Date(confirmedRow.mailingCompletedAt), "MMMM d, yyyy")}
              {attempt.mailingAddress ? ` to ${attempt.mailingAddress}` : ""}.
            </p>
          </div>
        </div>
        {receiptHref ? (
          <a
            href={receiptHref}
            target="_blank"
            rel="noreferrer"
            data-testid="link-mailing-receipt-photo"
            className="block bg-white border border-emerald-200 rounded-lg overflow-hidden"
          >
            <img
              src={receiptHref}
              alt="Mailing receipt"
              className="w-full max-h-64 object-contain bg-slate-50"
            />
            <div className="px-3 py-2 text-[11px] font-medium text-emerald-700 flex items-center gap-1">
              <Camera className="w-3 h-3" /> Mailing receipt on file
            </div>
          </a>
        ) : (
          <div
            className="border-t border-emerald-200 pt-3"
            data-testid="block-mailing-receipt-late-attach"
          >
            <p className="text-[11px] font-bold tracking-widest text-emerald-700 uppercase mb-1">
              Mailing receipt photo (still pending)
            </p>
            <p className="text-[11px] text-emerald-700/80 mb-2">
              You can still attach the post-office receipt — recommended for
              the audit trail.
            </p>
            <label
              data-testid="label-mailing-receipt-late-input"
              className="flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-emerald-300 rounded-lg text-xs font-semibold text-emerald-700 bg-white hover:bg-emerald-100 cursor-pointer transition-colors"
            >
              {uploading || confirm.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />Uploading…
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />Attach mailing receipt photo
                </>
              )}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={uploading || confirm.isPending}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleLateAttach(f);
                }}
                data-testid="input-mailing-receipt-late-photo"
                className="hidden"
              />
            </label>
            {uploadError && (
              <p
                className="mt-1 text-xs text-red-600"
                data-testid="text-mailing-receipt-late-error"
              >
                {uploadError}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  const handleReceiptPick = async (file: File) => {
    setUploadError(null);
    setReceiptFile(file);
    setUploading(true);
    try {
      const path = await uploadServerPhoto(file, jobId);
      setReceiptPath(path);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Failed to upload receipt photo",
      );
      setReceiptFile(null);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = () => {
    // The date input is `yyyy-MM-dd`; turn it into an ISO instant at noon
    // local time so the affidavit reads the calendar date the server
    // intended (not yesterday in UTC for evening submissions).
    const iso = new Date(`${completedAt}T12:00:00`).toISOString();
    confirm.mutate({
      id: jobId,
      data: {
        completedAt: iso,
        ...(receiptPath ? { proofPhotoUrl: receiptPath } : {}),
      },
    });
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3" data-testid="card-confirm-mailing">
      <div className="flex items-start gap-3">
        <Mail className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-bold text-amber-900">Confirm follow-up mailing</p>
          <p className="text-xs text-amber-800 mt-0.5">
            Substitute service requires mailing a copy of the documents
            {attempt.mailingAddress ? ` to ${attempt.mailingAddress}` : ""}.
            Mark the date you actually deposited the mailing — this gets stamped
            on the affidavit.
          </p>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
        <label className="flex-1 block">
          <span className="text-[10px] font-bold tracking-widest text-amber-700 uppercase">Date mailed</span>
          <input
            type="date"
            value={completedAt}
            max={format(new Date(), "yyyy-MM-dd")}
            onChange={(e) => setCompletedAt(e.target.value)}
            data-testid="input-mailing-completed-at"
            className="mt-1 w-full px-3 py-2 border border-amber-300 rounded-lg text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </label>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={confirm.isPending || uploading || !completedAt}
          data-testid="button-confirm-mailing"
          className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {confirm.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />Saving…
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />Mark mailed
            </>
          )}
        </button>
      </div>
      {/* Mailing receipt photo upload — strongly encouraged (the post-
          office receipt or certified-mail label is the auditable proof
          that the follow-up mailing actually happened). Optional on the
          API side so a server who genuinely lost the receipt can still
          confirm; the date alone is captured on the affidavit. */}
      <div className="border-t border-amber-200 pt-3">
        <label className="block">
          <span className="text-[10px] font-bold tracking-widest text-amber-700 uppercase">
            Mailing receipt photo (optional but recommended)
          </span>
          <div className="mt-1 flex items-center gap-2">
            <label
              data-testid="label-mailing-receipt-input"
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-amber-300 rounded-lg text-xs font-semibold text-amber-700 bg-white hover:bg-amber-50 cursor-pointer transition-colors"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />Uploading…
                </>
              ) : receiptPath ? (
                <>
                  <CircleCheck className="w-3.5 h-3.5 text-emerald-600" />
                  {receiptFile?.name ?? "Receipt attached"}
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />Attach photo of mailing receipt
                </>
              )}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleReceiptPick(f);
                }}
                data-testid="input-mailing-receipt-photo"
                className="hidden"
              />
            </label>
          </div>
        </label>
        {uploadError && (
          <p className="mt-1 text-xs text-red-600" data-testid="text-mailing-receipt-error">
            {uploadError}
          </p>
        )}
      </div>
      {confirm.isError && (
        <p className="text-xs text-red-600" data-testid="text-confirm-mailing-error">
          Couldn't save the mailing confirmation. Please try again.
        </p>
      )}
    </div>
  );
}

export default function ServerProof() {
  const [, params] = useRoute("/app/server/proof/:id");
  const jobId = Number(params?.id);
  const { data: job, isLoading } = useGetJob(jobId);
  const { data: attempts } = useListJobAttempts(jobId, {
    query: {
      queryKey: getListJobAttemptsQueryKey(jobId),
      enabled: Number.isFinite(jobId),
    },
  });
  // The "completing" attempt is the most recent one whose outcome
  // actually finishes service (personal/substitute/mail/posting).
  // Its method-narrative + branch-specific facts drive the affidavit
  // body. Fall back to the latest attempt if nothing has completed yet.
  const completingAttempt: ServiceAttempt | null =
    [...(attempts ?? [])]
      .reverse()
      .find((a) => COMPLETING_OUTCOMES.has(a.outcome)) ??
    (attempts && attempts.length > 0 ? attempts[attempts.length - 1] : null);
  const me = useMe();
  // Prefer the server profile name (the licensed name used on the PDF
  // affidavit and shown to requesters/attorneys). Fall back to the user's
  // first/last name from their account, and only as a last resort their
  // sign-up email — which should never appear on a Proof of Service.
  const rawServerName = (job?.server?.name ?? "").trim();
  const serverDisplayName =
    (rawServerName && !rawServerName.includes("@") ? rawServerName : "") ||
    [me.data?.firstName, me.data?.lastName].filter(Boolean).join(" ").trim() ||
    "—";

  // Self-heal: if the affidavit PDF didn't generate at served-time (transient
  // storage or pdfkit error in the post-commit hook), trigger generation once
  // when the server lands on this page so the Download button has something
  // to point at. Idempotent on the backend; one attempt per page mount.
  const queryClient = useQueryClient();
  const ensureAffidavit = useEnsureJobAffidavit({
    mutation: {
      onSuccess: () => {
        if (Number.isFinite(jobId)) {
          queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
        }
      },
    },
  });
  const triedEnsureRef = useRef(false);
  useEffect(() => {
    if (triedEnsureRef.current) return;
    if (!job) return;
    if (job.status !== "served") return;
    if (job.proofPdfUrl) return;
    if (!job.signatureTypedName) return;
    triedEnsureRef.current = true;
    ensureAffidavit.mutate({ id: jobId });
  }, [job, jobId, ensureAffidavit]);

  // Identity-confirmation backfill. The affidavit completeness gate refuses
  // to render the PDF when the completing personal/substitute attempt has a
  // null `identityMethod`. That can happen on rows persisted before the
  // mark-served wizard required the field, or if the client dropped it on
  // the wire. We surface a small inline form whenever ensure-affidavit
  // returns 422 with the "Identity confirmation is required" message — the
  // form POSTs to the new backfill endpoint, then re-triggers both the
  // affidavit and notice-of-mail self-heals so the buttons get a target.
  const [identityChoice, setIdentityChoice] = useState<
    "" | "verbal" | "photo_match" | "known" | "other"
  >("");
  const [identityOther, setIdentityOther] = useState("");
  const backfillIdentity = useBackfillJobAttemptIdentity();
  const ensureAffidavitErrMsg =
    (
      ensureAffidavit.error as
        | { data?: { error?: string }; message?: string }
        | undefined
    )?.data?.error ?? (ensureAffidavit.error as { message?: string } | undefined)?.message ?? "";
  const needsIdentityBackfill =
    !!ensureAffidavit.isError &&
    /identity confirmation is required/i.test(ensureAffidavitErrMsg);

  // Companion self-heal for the Notice of Service by Mail. The notice is
  // generated alongside the affidavit during the served-flip, but its
  // upload is non-fatal there — so a transient failure can leave the
  // job with proofPdfUrl filled and noticeOfMailPdfUrl null. When the
  // proof page loads such a job, fire the targeted ensure endpoint once
  // so the Download/Print/Email buttons get a target without admin help.
  const ensureNotice = useEnsureJobNoticeOfMail({
    mutation: {
      onSuccess: () => {
        if (Number.isFinite(jobId)) {
          queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
        }
      },
    },
  });
  const triedEnsureNoticeRef = useRef(false);
  useEffect(() => {
    if (triedEnsureNoticeRef.current) return;
    if (!job) return;
    if (job.status !== "served") return;
    if (job.noticeOfMailPdfUrl) return;
    if (!job.signatureTypedName) return;
    // Don't burn the one-shot until the affidavit itself exists; the
    // notice ref is printed on the affidavit so we want the affidavit
    // generator to run (and succeed) first whenever possible.
    if (!job.proofPdfUrl) return;
    triedEnsureNoticeRef.current = true;
    ensureNotice.mutate({ id: jobId });
  }, [job, jobId, ensureNotice]);

  const proofPdfHref = job?.proofPdfUrl ? resolveStorageObjectUrl(job.proofPdfUrl) : null;
  const noticePdfHref = job?.noticeOfMailPdfUrl
    ? resolveStorageObjectUrl(job.noticeOfMailPdfUrl)
    : null;
  // Generic "open this PDF the way the server asked" actions — used by
  // both the affidavit block and the Notice of Service by Mail block so
  // the two cards share identical UX (download/print/email).
  const downloadPdf = (href: string | null, fileName: string) => {
    if (!href) return;
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  const printPdf = (href: string | null) => {
    if (!href) return;
    const w = window.open(href, "_blank", "noopener,noreferrer");
    if (w) {
      setTimeout(() => {
        try {
          w.print();
        } catch {
          /* no-op: user can still print from the opened tab */
        }
      }, 800);
    }
  };
  const emailPdf = (href: string | null, subject: string, intro: string) => {
    if (!href) return;
    const absolute = new URL(href, window.location.origin).toString();
    const body = encodeURIComponent(
      `${intro}\n\n${absolute}\n\nSent via SERVED.`,
    );
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${body}`;
  };
  const handleDownload = () =>
    downloadPdf(proofPdfHref, `affidavit-${job?.platformRef ?? jobId}.pdf`);
  const handlePrint = () => printPdf(proofPdfHref);
  const handleEmail = () =>
    emailPdf(
      proofPdfHref,
      `Affidavit of Service — ${job?.platformRef ?? `Job #${jobId}`}`,
      "The signed proof of service affidavit is available here:",
    );
  const handleDownloadNotice = () =>
    downloadPdf(
      noticePdfHref,
      `notice-of-service-by-mail-${job?.platformRef ?? jobId}.pdf`,
    );
  const handlePrintNotice = () => printPdf(noticePdfHref);
  const handleEmailNotice = () =>
    emailPdf(
      noticePdfHref,
      `Notice of Service by Mail — ${job?.platformRef ?? `Job #${jobId}`}-NSM`,
      "The companion Notice of Service by Mail (NRCP 4.2) is available here:",
    );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-48 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-36" />
          </div>
        ))}
      </div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 text-sm">Job not found.</p>
        <Link href="/app/server/dashboard" className="text-amber-600 text-sm font-medium mt-2 inline-block">Back to Dashboard</Link>
      </div>
    );
  }

  const address = [job.recipientAddress, job.recipientCity, job.recipientState, job.recipientZip].filter(Boolean).join(", ") || "4821 Flamingo Rd, Las Vegas, NV 89103";
  const servedAt = job.servedAt ? format(new Date(job.servedAt), "M/d/yyyy, h:mm:ss a") : "—";
  const gpsLat = job.gpsLat ?? null;
  const gpsLng = job.gpsLng ?? null;
  const gpsFull = gpsLat !== null && gpsLng !== null ? `${gpsLat.toFixed(6)}, ${gpsLng.toFixed(6)}` : "GPS not recorded";
  const proofPhoto = job.proofPhotoUrl ? resolveStorageObjectUrl(job.proofPhotoUrl) : null;

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      {/* Back */}
      <div className="flex items-center gap-3">
        <Link href="/app/server/dashboard" className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors">
          <ArrowLeft className="w-4 h-4 text-gray-600" />
        </Link>
        <h1 className="text-base font-bold text-gray-900">Proof of Service</h1>
      </div>

      {/* SERVICE VERIFIED banner */}
      <div className="bg-white rounded-2xl border border-emerald-200 p-8 flex flex-col items-center text-center">
        <div className="relative mb-4">
          <div className="w-20 h-20 rounded-full border-4 border-emerald-200 flex items-center justify-center">
            <div className="w-14 h-14 rounded-full border-4 border-emerald-300 flex items-center justify-center">
              <div className="w-10 h-10 rounded-full bg-emerald-50 border-2 border-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              </div>
            </div>
          </div>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="absolute w-1.5 h-1.5 rounded-full bg-emerald-400" style={{ top: "50%", left: "50%", transform: `rotate(${i * 60}deg) translateY(-42px) translateX(-3px)` }} />
          ))}
        </div>
        <p className="text-sm font-black tracking-widest text-emerald-600 uppercase">Service Verified</p>
        <p className="text-xs text-gray-400 mt-1">SERVED. Platform — Proof of Service</p>
      </div>

      {/* Job details */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-base font-bold text-gray-900">{job.documentType ?? "Serve Family Court Documents"}</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-1">Document Type</p>
            <p className="font-medium text-gray-800">{job.documentType ?? "Family Court"}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-1">Recipient</p>
            <p className="font-medium text-gray-800">{job.recipientName}</p>
          </div>
          <div className="col-span-2">
            <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-1">Address</p>
            <p className="font-medium text-gray-800">{address}</p>
          </div>
          <div className="col-span-2">
            <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-1">Served On</p>
            <p className="font-medium text-gray-800">{servedAt}</p>
          </div>
        </div>
      </div>

      {/* GPS */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-center justify-between">
        <div className="flex items-start gap-3">
          <MapPin className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-[10px] font-bold tracking-widest text-emerald-700 uppercase mb-1">GPS Verified Location</p>
            <p className="text-sm font-mono font-medium text-emerald-700">{gpsFull}</p>
            <p className="text-xs text-emerald-600 mt-0.5">{servedAt}</p>
          </div>
        </div>
        <CircleCheck className="w-6 h-6 text-emerald-500 flex-shrink-0" />
      </div>

      {/* Process Server */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-amber-500" />
        </div>
        <div>
          <p className="font-bold text-gray-900 text-sm">{serverDisplayName}</p>
          <p className="flex items-center gap-1 text-xs text-amber-600 mt-0.5">
            <Zap className="w-3 h-3" />Verified SERVED. Process Server
          </p>
        </div>
      </div>

      {/* Photo Documentation */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Photo Documentation</p>
          {proofPhoto && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded">
              <CircleCheck className="w-3 h-3" />GPS Verified
            </span>
          )}
        </div>
        {proofPhoto ? (
          <a href={proofPhoto} target="_blank" rel="noreferrer" className="block bg-slate-900">
            <img
              src={proofPhoto}
              alt="Proof of service photo"
              data-testid="img-proof-photo"
              className="w-full max-h-80 object-contain"
            />
          </a>
        ) : (
          <div className="px-5 py-10 text-center text-xs text-gray-400">
            <Camera className="w-6 h-6 mx-auto mb-2 text-gray-300" />
            No photo on file for this service.
          </div>
        )}
      </div>

      {/* Substitute follow-up mailing — only renders for substitute jobs
          where mark-served captured a mailing commitment. Hidden after
          confirmation (the card swaps itself to a success badge). */}
      {completingAttempt?.outcome === "substitute" &&
        completingAttempt.mailingDate &&
        completingAttempt.mailingAddress && (
          <MailingConfirmationCard jobId={jobId} attempt={completingAttempt} />
        )}

      {/* Affidavit download */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
            <Download className="w-4 h-4 text-amber-500" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Proof of Service Affidavit</p>
            <p className="text-xs text-gray-500">Pre-filled, signed, and ready to file</p>
          </div>
        </div>
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={handleDownload}
            disabled={!proofPdfHref || ensureAffidavit.isPending}
            data-testid="button-download-affidavit"
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-400 hover:bg-amber-500 text-black font-bold text-sm rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {ensureAffidavit.isPending && !proofPdfHref ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />Preparing…
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />Download
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!proofPdfHref}
            data-testid="button-print-affidavit"
            className="flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 bg-white text-gray-700 font-semibold text-sm rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Printer className="w-4 h-4" />Print
          </button>
          <button
            type="button"
            onClick={handleEmail}
            disabled={!proofPdfHref}
            data-testid="button-email-affidavit"
            className="flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 bg-white text-gray-700 font-semibold text-sm rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Mail className="w-4 h-4" />Email
          </button>
        </div>
        {ensureAffidavit.isError && !needsIdentityBackfill && (
          <p className="mb-3 text-xs text-red-600" data-testid="text-ensure-affidavit-error">
            We couldn't generate the affidavit automatically. Please refresh, or contact support if it keeps happening.
          </p>
        )}
        {needsIdentityBackfill && (
          <div
            className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg"
            data-testid="block-identity-backfill"
          >
            <p className="text-xs font-bold text-amber-900 mb-1">
              One detail is missing from your service attempt.
            </p>
            <p className="text-[11px] text-amber-800 mb-2 leading-relaxed">
              How did you confirm the recipient's identity at the door? This is
              required by the affidavit declaration. Once saved, the affidavit
              and Notice of Service by Mail will generate automatically.
            </p>
            <div className="space-y-1.5 mb-2">
              {(
                [
                  ["verbal", "They told me their name"],
                  ["photo_match", "Photo ID match"],
                  ["known", "Personally known to me"],
                  ["other", "Other (describe)"],
                ] as const
              ).map(([id, label]) => (
                <label
                  key={id}
                  className="flex items-center gap-2 text-[11px] text-amber-900 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="identity-backfill"
                    value={id}
                    checked={identityChoice === id}
                    onChange={() => setIdentityChoice(id)}
                    data-testid={`radio-identity-${id}`}
                    className="accent-amber-600"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            {identityChoice === "other" && (
              <input
                type="text"
                value={identityOther}
                onChange={(e) => setIdentityOther(e.target.value)}
                placeholder="Briefly describe how identity was confirmed"
                data-testid="input-identity-other"
                className="w-full mb-2 px-2 py-1.5 text-[11px] border border-amber-300 rounded bg-white"
              />
            )}
            <button
              type="button"
              data-testid="button-backfill-identity"
              disabled={
                !identityChoice ||
                (identityChoice === "other" && identityOther.trim().length < 2) ||
                backfillIdentity.isPending ||
                ensureAffidavit.isPending
              }
              onClick={() => {
                if (!identityChoice) return;
                backfillIdentity.mutate(
                  {
                    id: jobId,
                    data: {
                      identityMethod: identityChoice,
                      ...(identityChoice === "other"
                        ? { identityOtherText: identityOther.trim() }
                        : {}),
                    },
                  },
                  {
                    onSuccess: () => {
                      // Re-fire both self-heals now that the gate is unblocked.
                      // Reset the one-shot refs so the useEffect-driven retries
                      // fire again on the next render after invalidation.
                      triedEnsureRef.current = false;
                      triedEnsureNoticeRef.current = false;
                      queryClient.invalidateQueries({
                        queryKey: getListJobAttemptsQueryKey(jobId),
                      });
                      ensureAffidavit.reset();
                      ensureAffidavit.mutate({ id: jobId });
                    },
                  },
                );
              }}
              className="w-full py-2 text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
            >
              {backfillIdentity.isPending || ensureAffidavit.isPending
                ? "Saving…"
                : "Save & generate affidavit"}
            </button>
            {backfillIdentity.isError && (
              <p
                className="mt-1.5 text-[11px] text-red-700"
                data-testid="text-backfill-identity-error"
              >
                {((backfillIdentity.error as { data?: { error?: string } } | undefined)
                  ?.data?.error) ??
                  "Couldn't save identity confirmation. Please try again."}
              </p>
            )}
          </div>
        )}
        <button className="flex items-center gap-2 text-xs font-medium text-amber-600 hover:text-amber-700 mb-4">
          View Full Proof of Service Template ↗
        </button>
        <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-700 leading-relaxed">
          <strong>Need to print?</strong> UPS Store or FedEx Office — email the file to any location for same-day pickup. Or use a Bluetooth mobile printer (Brother PocketJet · Canon PIXMA TR150) in the field.
        </div>
      </div>

      {/* Notice of Service by Mail — only renders for Nevada substitute jobs
          where the server committed to a follow-up mailing during mark-served.
          The notice PDF is generated server-side alongside the affidavit and
          surfaced here with the same download/print/email actions so the
          server can hand it to the post office or file it with the court. */}
      {completingAttempt?.outcome === "substitute" &&
        completingAttempt.mailingDate &&
        completingAttempt.mailingAddress && (
          <div
            className="bg-white rounded-2xl border border-gray-200 p-6"
            data-testid="card-notice-of-mail"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
                <FileText className="w-4 h-4 text-sky-500" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">
                  Notice of Service by Mail
                </p>
                <p className="text-xs text-gray-500">
                  NRCP 4.2 follow-up · Ref{" "}
                  <span className="font-mono">
                    {job.platformRef}-NSM
                  </span>
                </p>
              </div>
            </div>
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={handleDownloadNotice}
                disabled={!noticePdfHref}
                data-testid="button-download-notice"
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {!noticePdfHref ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />Preparing…
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />Download
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handlePrintNotice}
                disabled={!noticePdfHref}
                data-testid="button-print-notice"
                className="flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 bg-white text-gray-700 font-semibold text-sm rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Printer className="w-4 h-4" />Print
              </button>
              <button
                type="button"
                onClick={handleEmailNotice}
                disabled={!noticePdfHref}
                data-testid="button-email-notice"
                className="flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 bg-white text-gray-700 font-semibold text-sm rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Mail className="w-4 h-4" />Email
              </button>
            </div>
            <div className="p-3 bg-sky-50 rounded-lg text-xs text-sky-800 leading-relaxed">
              <strong>Bring this to the post office.</strong> Have the clerk
              affix the postage receipt or postmark in the stamp box, then
              upload a photo of the receipt above so it's stored with the
              attempt record.
            </div>
          </div>
        )}

      {/* Service History */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="text-sm font-bold text-gray-900 mb-4">Service History</h2>
        <AttemptHistory jobId={job.id} />
      </div>

      {/* Payment Summary */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-gray-900">Payment Summary</h2>
          <Download className="w-4 h-4 text-gray-400" />
        </div>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Service fee</span>
            <span className="font-medium text-gray-900">$75</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Platform fee (20%)</span>
            <span className="font-medium text-gray-900">$15</span>
          </div>
          <div className="flex justify-between text-sm border-t border-gray-100 pt-3">
            <span className="font-bold text-gray-900">Server earned (80%)</span>
            <span className="font-black text-emerald-600 text-base">$60</span>
          </div>
        </div>
        <div className="mt-4 p-3 bg-emerald-50 rounded-lg flex items-center justify-between">
          <span className="text-xs font-medium text-emerald-700">Payment Status</span>
          <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">Paid · Instant</span>
        </div>
      </div>

      {/* Full Affidavit */}
      <div>
        <h2 className="text-sm font-bold text-gray-900 mb-3">Full Affidavit Document</h2>
        <AffidavitDocument
          job={job}
          server={job.server}
          completingAttempt={completingAttempt}
          attempts={attempts ?? []}
          serverDisplayName={serverDisplayName}
        />
      </div>
    </div>
  );
}
