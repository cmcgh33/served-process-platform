/**
 * Affidavit PDF generator — Nevada Proof of Service, template-styled.
 *
 * Layout target: a single Letter-size page styled to match
 * `.local/affidavit-template-personal.jpg`:
 *
 *   • Navy header band with amber stripe + SERVED. wordmark.
 *   • Centered venue / court caption.
 *   • Two-column case caption (parties left, Case/Dept No. right).
 *   • Centered AFFIDAVIT OF SERVICE title + affidavit ID.
 *   • Sworn Statement bullet block.
 *   • Two-column SERVER INFO (with classification check-row) /
 *     REQUESTED BY + DOCUMENTS SERVED.
 *   • Two-column SERVICE DETAILS / RECIPIENT INFO (with identity
 *     check-row).
 *   • GPS Verification with a green "verified" pill (provenance from
 *     gpsProvider — gps / gps_assisted / network).
 *   • Compact ATTEMPT HISTORY box.
 *   • Locked Nevada Declaration (NRS 53.045) callout.
 *   • Two-column signature / notary block.
 *   • Navy footer band with amber stripe.
 *
 * The captured proof photo is intentionally NOT rendered — it's
 * platform evidence, not court evidence (see T001 notes).
 *
 * Failures here are non-fatal — `generateAndStoreAffidavit` swallows
 * render errors and lets the served-flip stay durable.
 */
import PDFDocument from "pdfkit";
import type { Job } from "@workspace/db";

export interface AffidavitInput {
  job: Job;
  server: {
    name: string;
    email?: string | null;
    phone?: string | null;
    licenseNumber?: string | null;
    licenseState?: string | null;
    businessAddress?: string | null;
    isLicensedNvServer?: boolean | null;
    licenseCounty?: string | null;
    /**
     * Server classification — drives the four-checkbox row in the
     * SERVER INFORMATION block. One of:
     *   licensed_nv | registered | private | sheriff
     * Falls back to inferring from `isLicensedNvServer` when missing.
     */
    serverType?: string | null;
  } | null;
  /** Inline PNG bytes of the canvas signature. Optional — generator
   *  degrades gracefully to a typed "/s/ Name" if absent. */
  signatureImagePng?: Buffer | null;
  signatureTypedName: string;
  servedAt: Date;
  generatedAt: Date;
  attempts?: Array<{
    outcome: string;
    attemptedAt: Date;
    notes: string | null;
    gpsLat: number | null;
    gpsLng: number | null;
    serviceAddress?: string | null;
    serviceCity?: string | null;
    serviceState?: string | null;
    serviceZip?: string | null;
    methodNarrative?: string | null;
    substituteRecipientName?: string | null;
    recipientRelationship?: string | null;
    recipientDescription?: string | null;
    recipientAgeEstimate?: string | null;
    recipientGender?: string | null;
    recipientHeight?: string | null;
    recipientWeight?: string | null;
    recipientIdentifyingFeatures?: string | null;
    mailingDate?: Date | null;
    mailingAddress?: string | null;
    postingLocationDescription?: string | null;
    publicationOrderRef?: string | null;
    publicationNewspaper?: string | null;
    publicationCounty?: string | null;
    publicationFirstDate?: Date | null;
    publicationLastDate?: Date | null;
    nonEstSummary?: string | null;
  }>;
  /** Most recent completing attempt — drives the service-details and
   *  recipient blocks. May be null on a malformed job. */
  completingAttempt?: {
    outcome: string;
    attemptedAt: Date;
    serviceAddress?: string | null;
    serviceCity?: string | null;
    serviceState?: string | null;
    serviceZip?: string | null;
    methodNarrative?: string | null;
    substituteRecipientName?: string | null;
    recipientRelationship?: string | null;
    recipientDescription?: string | null;
    recipientAgeEstimate?: string | null;
    recipientGender?: string | null;
    recipientHeight?: string | null;
    recipientWeight?: string | null;
    recipientIdentifyingFeatures?: string | null;
    mailingDate?: Date | null;
    mailingAddress?: string | null;
    postingLocationDescription?: string | null;
    publicationOrderRef?: string | null;
    publicationNewspaper?: string | null;
    publicationCounty?: string | null;
    publicationFirstDate?: Date | null;
    publicationLastDate?: Date | null;
    nonEstSummary?: string | null;
    /** Identity-confirmation method captured at mark-served time.
     *  One of verbal | photo_match | known | other. Drives the
     *  RECIPIENT INFORMATION check-row. */
    identityMethod?: string | null;
    identityOtherText?: string | null;
    /** GPS provenance hint (gps | gps_assisted | network). Powers
     *  the green "GPS Location Verified" pill. */
    gpsProvider?: string | null;
  } | null;
  documentsServed?: Array<{ title: string; documentType: string }>;
  /**
   * Requesting-party (firm/attorney) snapshot. `firmName`/`attorneyName`
   * (i.e. firm contact name) drive the REQUESTED BY block. When the
   * job has no client linkage we fall back to the requester* fields
   * captured on the job itself.
   */
  requesterName?: string | null;
  requesterEmail?: string | null;
  requesterPhone?: string | null;
  client?: {
    firmName?: string | null;
    contactName?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  legalEntityName: string;
  legalBusinessAddress?: string | null;
  nevadaDeclaration: string;
  /**
   * Optional cross-reference to the companion "Notice of Service by Mail"
   * document generated alongside this affidavit (substitute service only).
   * When present, the affidavit body prints "See companion Notice of
   * Service by Mail (Ref: …)" under the substitute block so a clerk
   * pairing the documents can match them by reference number.
   */
  noticeOfMailRef?: string | null;
}

/** Deterministic notice ref number — derived from the platform ref so a
 * regenerate always reproduces the same value the affidavit cross-
 * references. Suffix `-NSM` = "Notice of Service by Mail". */
export function noticeOfMailRefFor(platformRef: string): string {
  return `${platformRef}-NSM`;
}

export interface MailNoticeInput {
  job: Job;
  server: AffidavitInput["server"];
  signatureImagePng?: Buffer | null;
  signatureTypedName: string;
  /** When the substitute service occurred. */
  servedAt: Date;
  /** When the notice itself was generated/printed. */
  generatedAt: Date;
  /** Substitute follow-up commitment captured at mark-served time. */
  mailingDate: Date;
  mailingAddress: string;
  /** Substitute recipient's name — included on the notice for context. */
  substituteRecipientName?: string | null;
  documentsServed?: AffidavitInput["documentsServed"];
  requesterName?: string | null;
  requesterEmail?: string | null;
  requesterPhone?: string | null;
  legalEntityName: string;
  legalBusinessAddress?: string | null;
  /** Stable cross-reference shared with the companion affidavit. */
  noticeRef: string;
}

// ── Brand / layout constants ─────────────────────────────────────────
const COLOR_NAVY = "#0f1e3c";
const COLOR_AMBER = "#f59e0b";
const COLOR_TEXT = "#111827";
const COLOR_MUTED = "#6b7280";
const COLOR_BORDER = "#d1d5db";
const COLOR_GREEN_BG = "#ecfdf5";
const COLOR_GREEN_TEXT = "#047857";
const COLOR_AMBER_SOFT = "#fffbeb";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 40;
const HEADER_H = 4;
const SUPPORT_PHONE = "775-655-3933";
const SUPPORT_EMAIL = "support@servedapp.co";
const FOOTER_H = 38;
const CONTENT_X = MARGIN_X;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const COL_GAP = 16;
const COL_W = (CONTENT_W - COL_GAP) / 2;

const LEGAL_TZ = "America/Los_Angeles";

// ── Date helpers ─────────────────────────────────────────────────────
function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: LEGAL_TZ,
  });
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: LEGAL_TZ,
  });
}
function tzAbbrev(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LEGAL_TZ,
    timeZoneName: "short",
  }).formatToParts(d);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "PT";
}

// ── Label helpers ────────────────────────────────────────────────────
function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "personal":
      return "Personal Service";
    case "substitute":
      return "Substitute Service";
    case "mail":
      return "Service by Mail";
    case "posting":
      return "Service by Posting";
    case "publication":
      return "Service by Publication";
    case "non_est":
      return "Return of Non-Est";
    case "unable":
      return "Unable to Serve";
    default:
      return outcome;
  }
}
function identityLabel(method: string): string {
  switch (method) {
    case "verbal":
      return "Verbal Confirmation";
    case "photo_match":
      return "Photo Match";
    case "known":
      return "Known to Server";
    case "other":
      return "Other";
    default:
      return method;
  }
}
function gpsProviderLabel(p: string | null | undefined): string {
  switch (p) {
    case "gps":
      return "Device GPS";
    case "gps_assisted":
      return "Assisted GPS";
    case "network":
      return "Network Location";
    case "geolocation_api":
      return "Browser Geolocation";
    default:
      return "Captured On-Site";
  }
}

// State name normaliser — turns "NV" into "NEVADA" for the venue block.
function stateName(state: string | null | undefined): string {
  const s = (state ?? "").trim();
  if (!s) return "NEVADA";
  if (s.length !== 2) return s.toUpperCase();
  const map: Record<string, string> = {
    NV: "NEVADA",
    CA: "CALIFORNIA",
    NY: "NEW YORK",
    FL: "FLORIDA",
    TX: "TEXAS",
    AZ: "ARIZONA",
    UT: "UTAH",
    OR: "OREGON",
    WA: "WASHINGTON",
  };
  return map[s.toUpperCase()] ?? s.toUpperCase();
}

// ── PDFKit primitives ────────────────────────────────────────────────

type PDFDoc = PDFKit.PDFDocument;

function paintHeader(
  _doc: PDFDoc,
  _affidavitId: string,
  _generatedAt: Date,
): void {
  // Header banner intentionally omitted — keeps the document looking like
  // a traditional legal filing. Affidavit ID and SERVED. branding live in
  // the footer band instead. A thin amber stripe at the very top serves
  // as a subtle accent.
  _doc.save();
  _doc.rect(0, 0, PAGE_W, HEADER_H).fillColor(COLOR_AMBER).fill();
  _doc.restore();
}

function paintFooter(doc: PDFDoc, affidavitId: string): void {
  const y = PAGE_H - FOOTER_H;
  doc.save();
  doc.rect(0, y, PAGE_W, 3).fillColor(COLOR_AMBER).fill();
  doc.rect(0, y + 3, PAGE_W, FOOTER_H - 3).fillColor(COLOR_NAVY).fill();

  doc
    .fillColor("#FFFFFF")
    .font("Helvetica")
    .fontSize(7.5)
    .text("Engaged through: ", MARGIN_X, y + 13, {
      lineBreak: false,
      continued: true,
    });
  doc
    .fillColor(COLOR_AMBER)
    .font("Helvetica-Bold")
    .text("SERVED.", { lineBreak: false, continued: true });
  doc
    .fillColor("#FFFFFF")
    .font("Helvetica")
    .text("    servedapp.co    info@servedapp.co", { lineBreak: false });

  doc
    .fillColor("#FFFFFF")
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text(`Affidavit ID: ${affidavitId}`, MARGIN_X, y + 13, {
      width: PAGE_W - MARGIN_X * 2,
      align: "right",
      lineBreak: false,
    });
  doc.opacity(0.7);
  doc
    .font("Helvetica")
    .fontSize(6.5)
    .text(
      "This document is digitally recorded and tamper-evident.",
      MARGIN_X,
      y + 24,
      {
        width: PAGE_W - MARGIN_X * 2,
        align: "right",
        lineBreak: false,
      },
    );
  doc.opacity(1);
  doc.restore();
}

/** Section label (small caps, gray, with thin underline). */
function sectionLabel(doc: PDFDoc, text: string, x: number, y: number, w: number): number {
  doc.save();
  doc
    .fillColor(COLOR_NAVY)
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text(text.toUpperCase(), x, y, {
      width: w,
      characterSpacing: 0.7,
      lineBreak: false,
    });
  doc
    .moveTo(x, y + 11)
    .lineTo(x + w, y + 11)
    .strokeColor(COLOR_BORDER)
    .lineWidth(0.5)
    .stroke();
  doc.restore();
  return y + 16;
}

/** label : value field row. Returns next-row Y. */
function fieldRow(
  doc: PDFDoc,
  label: string,
  value: string,
  x: number,
  y: number,
  labelW: number,
  valueW: number,
): number {
  doc
    .fillColor(COLOR_MUTED)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(label, x, y, { width: labelW, lineBreak: false });
  doc
    .fillColor(COLOR_TEXT)
    .font("Helvetica")
    .fontSize(9)
    .text(value, x + labelW, y - 1, { width: valueW });
  return y + Math.max(11, doc.heightOfString(value, { width: valueW }) + 2);
}

/** Checkbox row: square + label, optional checked fill. */
function checkRow(
  doc: PDFDoc,
  x: number,
  y: number,
  checked: boolean,
  label: string,
  w: number,
): number {
  doc.save();
  doc
    .rect(x, y + 1, 8, 8)
    .strokeColor(checked ? COLOR_NAVY : "#9ca3af")
    .lineWidth(0.7)
    .stroke();
  if (checked) {
    doc.rect(x + 1.8, y + 2.8, 4.4, 4.4).fillColor(COLOR_NAVY).fill();
  }
  doc
    .fillColor(checked ? COLOR_TEXT : COLOR_MUTED)
    .font(checked ? "Helvetica-Bold" : "Helvetica")
    .fontSize(8.5)
    .text(label, x + 13, y, { width: w - 13, lineBreak: false });
  doc.restore();
  return y + 12;
}

/** Pill badge (rounded background + colored bold label). */
function pill(doc: PDFDoc, x: number, y: number, text: string): number {
  doc.font("Helvetica-Bold").fontSize(8.5);
  const w = doc.widthOfString(text) + 18;
  doc.save();
  doc.roundedRect(x, y, w, 16, 8).fillColor(COLOR_GREEN_BG).fill();
  doc
    .fillColor(COLOR_GREEN_TEXT)
    .text(text, x + 9, y + 4, { lineBreak: false });
  doc.restore();
  return x + w;
}

// ── Main entry ───────────────────────────────────────────────────────
export async function generateAffidavitPdf(input: AffidavitInput): Promise<Buffer> {
  const {
    job,
    server,
    signatureImagePng,
    signatureTypedName,
    servedAt,
    generatedAt,
    attempts,
    completingAttempt,
    documentsServed,
    requesterName,
    requesterEmail,
    requesterPhone,
    client,
    legalEntityName,
    legalBusinessAddress,
    nevadaDeclaration,
  } = input;

  return await new Promise<Buffer>((resolve, reject) => {
    try {
      const info: Record<string, string> = {
        Title: `Affidavit of Service — ${job.platformRef}`,
        Subject: `Affidavit of Service for ${job.recipientName}`,
      };
      if (legalEntityName) info.Author = legalEntityName;

      const doc = new PDFDocument({
        size: "LETTER",
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        info,
        autoFirstPage: false,
      });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const affidavitId = job.platformRef ?? `JOB-${job.id}`;

      // Paint header/footer on every page so multi-page renders stay
      // visually consistent.
      doc.on("pageAdded", () => {
        paintHeader(doc, affidavitId, generatedAt);
        paintFooter(doc, affidavitId);
      });
      doc.addPage();

      // ── Top venue block (centered) ──────────────────────────────
      let y = HEADER_H + 18;
      const venueState = stateName(server?.licenseState ?? job.recipientState);
      const venueCounty = (
        server?.licenseCounty?.trim() ||
        job.recipientCity?.trim() ||
        "_____________"
      ).toUpperCase();
      const courtName =
        job.courtName?.trim() ||
        "Eighth Judicial District Court, Clark County, Nevada";

      doc
        .fillColor(COLOR_TEXT)
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(`STATE OF ${venueState}`, MARGIN_X, y, {
          width: CONTENT_W,
          align: "center",
          lineBreak: false,
        });
      y += 13;
      doc.text(`COUNTY OF ${venueCounty}`, MARGIN_X, y, {
        width: CONTENT_W,
        align: "center",
        lineBreak: false,
      });
      y += 13;
      doc
        .fontSize(11)
        .text(courtName.toUpperCase(), MARGIN_X, y, {
          width: CONTENT_W,
          align: "center",
        });
      y += 18;

      // ── Caption (parties left, case/dept right, vertical rule) ──
      const captionTop = y;
      const leftColX = MARGIN_X;
      const captionLeftW = COL_W;
      const captionRightX = MARGIN_X + COL_W + COL_GAP;
      const captionRightW = COL_W;

      const petitioner =
        job.petitioner?.trim() ||
        job.matterName?.trim() ||
        "Petitioner";
      const respondent = job.respondent?.trim() || job.recipientName;

      doc
        .fillColor(COLOR_TEXT)
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(`${petitioner},`, leftColX, y, { width: captionLeftW });
      doc
        .font("Helvetica-Oblique")
        .fontSize(9)
        .fillColor(COLOR_MUTED)
        .text("Petitioner / Plaintiff,", leftColX + 8, doc.y, {
          width: captionLeftW - 8,
        });
      doc
        .font("Helvetica-Oblique")
        .fontSize(9)
        .text("vs.", leftColX + 8, doc.y + 2, { width: captionLeftW - 8 });
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(COLOR_TEXT)
        .text(`${respondent},`, leftColX, doc.y + 2, { width: captionLeftW });
      doc
        .font("Helvetica-Oblique")
        .fontSize(9)
        .fillColor(COLOR_MUTED)
        .text("Respondent / Defendant.", leftColX + 8, doc.y, {
          width: captionLeftW - 8,
        });
      const captionLeftBottom = doc.y + 4;

      // Case + Dept (right column).
      let ry = captionTop;
      ry = fieldRow(
        doc,
        "Case No.: ",
        job.caseNumber?.trim() || "______________________",
        captionRightX,
        ry,
        50,
        captionRightW - 50,
      );
      ry = fieldRow(
        doc,
        "Dept No.: ",
        job.deptNumber?.trim() || "______",
        captionRightX,
        ry,
        50,
        captionRightW - 50,
      );

      // Vertical rule separating the two caption columns.
      const rulerX = MARGIN_X + COL_W + COL_GAP / 2;
      const captionBottom = Math.max(captionLeftBottom, ry);
      doc
        .moveTo(rulerX, captionTop - 2)
        .lineTo(rulerX, captionBottom)
        .strokeColor(COLOR_BORDER)
        .lineWidth(0.5)
        .stroke();
      y = captionBottom + 8;

      // ── Title ────────────────────────────────────────────────────
      // Non-est returns are filed as "RETURN OF NON-EST / AFFIDAVIT OF
      // DILIGENT SEARCH"; service-by-publication still files under the
      // standard AFFIDAVIT OF SERVICE banner (the publisher files a
      // separate Affidavit of Publication).
      const titleText =
        completingAttempt?.outcome === "non_est"
          ? "RETURN OF NON-EST"
          : "AFFIDAVIT OF SERVICE";
      doc
        .fillColor(COLOR_TEXT)
        .font("Helvetica-Bold")
        .fontSize(15)
        .text(titleText, MARGIN_X, y, {
          width: CONTENT_W,
          align: "center",
          characterSpacing: 1.5,
        });
      y += 18;
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(COLOR_MUTED)
        .text(`Affidavit ID: ${affidavitId}`, MARGIN_X, y, {
          width: CONTENT_W,
          align: "center",
          lineBreak: false,
        });
      y += 16;

      // ── Sworn statement ─────────────────────────────────────────
      y = sectionLabel(doc, "Sworn Statement", MARGIN_X, y, CONTENT_W);
      doc
        .fillColor(COLOR_TEXT)
        .font("Helvetica")
        .fontSize(9.5)
        .text(
          "I, the undersigned, being first duly sworn upon oath, declare:",
          MARGIN_X,
          y,
          { width: CONTENT_W },
        );
      y = doc.y + 4;
      const swornBullets = [
        "I am over the age of eighteen (18)",
        "I am not a party to this action",
        `I am legally authorized to serve process in the State of ${stateName(
          server?.licenseState ?? job.recipientState,
        )}`,
      ];
      for (const b of swornBullets) {
        doc
          .fillColor(COLOR_AMBER)
          .font("Helvetica-Bold")
          .fontSize(10)
          .text("•", MARGIN_X + 4, y, { lineBreak: false });
        doc
          .fillColor(COLOR_TEXT)
          .font("Helvetica")
          .fontSize(9)
          .text(b, MARGIN_X + 14, y, { width: CONTENT_W - 14 });
        y = doc.y + 2;
      }
      y += 6;

      // ── SERVER INFO (left col) + REQUESTED BY/DOCS (right col) ──
      const blockTop = y;
      const leftX = MARGIN_X;
      const rightX = MARGIN_X + COL_W + COL_GAP;

      // LEFT — SERVER INFORMATION
      let ly = sectionLabel(doc, "Server Information", leftX, blockTop, COL_W);
      const serverName = (server?.name ?? "").trim() || "—";
      ly = fieldRow(doc, "Name: ", serverName, leftX, ly, 50, COL_W - 50);

      // Server-type check-row. Map serverType → one of the four
      // checkboxes; legacy rows without serverType infer from
      // isLicensedNvServer so older affidavits still mark a box.
      const t = (server?.serverType ?? "").trim() ||
        (server?.isLicensedNvServer ? "licensed_nv" : "");
      doc
        .fillColor(COLOR_MUTED)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text("Type: ", leftX, ly, { lineBreak: false });
      const typeBoxX = leftX + 50;
      let ty = ly;
      ty = checkRow(doc, typeBoxX, ty, t === "licensed_nv", "Licensed Process Server", COL_W - 50);
      ty = checkRow(doc, typeBoxX, ty, t === "registered", "Registered Process Server", COL_W - 50);
      ty = checkRow(doc, typeBoxX, ty, t === "private", "Private Individual", COL_W - 50);
      ly = ty + 1;

      // License No. is meaningful only for licensed Nevada process servers.
      // Suppress the row entirely for registered / private to avoid the
      // misleading "License No.: —" line on the affidavit.
      if (t === "licensed_nv") {
        ly = fieldRow(
          doc,
          "License No.: ",
          server?.licenseNumber?.trim() || "—",
          leftX,
          ly,
          70,
          COL_W - 70,
        );
      }
      ly = fieldRow(
        doc,
        "County: ",
        server?.licenseCounty?.trim() || "—",
        leftX,
        ly,
        70,
        COL_W - 70,
      );
      ly = fieldRow(
        doc,
        "Address: ",
        server?.businessAddress?.trim() || legalBusinessAddress?.trim() || "—",
        leftX,
        ly,
        70,
        COL_W - 70,
      );
      // Contact info on the affidavit always routes to SERVED. support so
      // recipients/courts contact the platform — never the individual
      // server's personal line. Server's own phone/email stay on file
      // internally but are not printed on the legal document.
      ly = fieldRow(
        doc,
        "Phone: ",
        SUPPORT_PHONE,
        leftX,
        ly,
        70,
        COL_W - 70,
      );
      ly = fieldRow(
        doc,
        "Email: ",
        SUPPORT_EMAIL,
        leftX,
        ly,
        70,
        COL_W - 70,
      );

      // RIGHT — REQUESTED BY (firm/attorney) + DOCUMENTS SERVED
      let ry2 = sectionLabel(doc, "Requested By", rightX, blockTop, COL_W);
      const firmName =
        client?.firmName?.trim() ||
        requesterName?.trim() ||
        "—";
      const attorneyName =
        client?.contactName?.trim() ||
        requesterName?.trim() ||
        "—";
      const fileNo = job.matterName?.trim() || affidavitId;
      const firmPhone = client?.phone?.trim() || requesterPhone?.trim() || "—";
      const firmEmail = client?.email?.trim() || requesterEmail?.trim() || "—";
      ry2 = fieldRow(doc, "Law Firm: ", firmName, rightX, ry2, 60, COL_W - 60);
      ry2 = fieldRow(doc, "Attorney: ", attorneyName, rightX, ry2, 60, COL_W - 60);
      ry2 = fieldRow(doc, "File No.: ", fileNo, rightX, ry2, 60, COL_W - 60);
      ry2 = fieldRow(doc, "Phone: ", firmPhone, rightX, ry2, 60, COL_W - 60);
      ry2 = fieldRow(doc, "Email: ", firmEmail, rightX, ry2, 60, COL_W - 60);
      ry2 += 6;
      ry2 = sectionLabel(doc, "Documents Served", rightX, ry2, COL_W);
      doc.fillColor(COLOR_TEXT).font("Helvetica").fontSize(9);
      if (documentsServed && documentsServed.length > 0) {
        for (const d of documentsServed) {
          const title = d.title?.trim() || d.documentType?.trim() || "Document";
          const type = d.documentType?.trim();
          const showType =
            type && type !== title && type.toLowerCase() !== "other";
          doc
            .fillColor(COLOR_AMBER)
            .text("•", rightX + 4, ry2, { lineBreak: false });
          doc
            .fillColor(COLOR_TEXT)
            .text(`${title}${showType ? ` (${type})` : ""}`, rightX + 14, ry2, {
              width: COL_W - 14,
            });
          ry2 = doc.y + 1;
        }
      } else {
        doc
          .fillColor(COLOR_AMBER)
          .text("•", rightX + 4, ry2, { lineBreak: false });
        doc
          .fillColor(COLOR_TEXT)
          .text(job.documentType || "Legal documents", rightX + 14, ry2, {
            width: COL_W - 14,
          });
        ry2 = doc.y + 1;
      }
      y = Math.max(ly, ry2) + 8;

      // ── SERVICE DETAILS / RECIPIENT INFO ────────────────────────
      const detail = completingAttempt;
      const outcome = (detail?.outcome ?? "personal") as
        | "personal"
        | "substitute"
        | "mail"
        | "posting"
        | "publication"
        | "non_est"
        | "unable";

      let sdY = sectionLabel(doc, "Service Details", leftX, y, COL_W);
      sdY = fieldRow(doc, "Manner: ", outcomeLabel(outcome), leftX, sdY, 60, COL_W - 60);
      sdY = fieldRow(
        doc,
        "Date: ",
        fmtDate(detail?.attemptedAt ?? servedAt),
        leftX,
        sdY,
        60,
        COL_W - 60,
      );
      sdY = fieldRow(
        doc,
        "Time: ",
        `${fmtTime(detail?.attemptedAt ?? servedAt)} ${tzAbbrev(detail?.attemptedAt ?? servedAt)}`,
        leftX,
        sdY,
        60,
        COL_W - 60,
      );
      const addrLine1 = detail?.serviceAddress?.trim() || job.recipientAddress;
      const addrCity = detail?.serviceCity?.trim() || job.recipientCity;
      const addrState = detail?.serviceState?.trim() || job.recipientState;
      const addrZip = detail?.serviceZip?.trim() || job.recipientZip;
      const fullAddr = `${addrLine1}, ${addrCity}, ${addrState} ${addrZip}`;
      sdY = fieldRow(doc, "Address: ", fullAddr, leftX, sdY, 60, COL_W - 60);

      // Branch-specific narrative (substitute / mail / posting).
      if (outcome === "substitute" && detail) {
        if (detail.substituteRecipientName) {
          sdY = fieldRow(doc, "Sub. Recipient: ", detail.substituteRecipientName, leftX, sdY, 80, COL_W - 80);
        }
        if (detail.recipientRelationship) {
          sdY = fieldRow(doc, "Relationship: ", detail.recipientRelationship, leftX, sdY, 80, COL_W - 80);
        }
        if (detail.mailingDate || detail.mailingAddress) {
          sdY = fieldRow(
            doc,
            "Follow-up Mailing: ",
            `${detail.mailingDate ? fmtDate(detail.mailingDate) : ""}${
              detail.mailingAddress ? ` to ${detail.mailingAddress}` : ""
            }`,
            leftX,
            sdY,
            90,
            COL_W - 90,
          );
        }
        // Cross-reference the companion Notice of Service by Mail when
        // one was generated alongside this affidavit. Lets a clerk pair
        // the two filings deterministically by reference number.
        if (input.noticeOfMailRef) {
          sdY = fieldRow(
            doc,
            "Companion Notice: ",
            `See Notice of Service by Mail (Ref: ${input.noticeOfMailRef})`,
            leftX,
            sdY,
            90,
            COL_W - 90,
          );
        }
      } else if (outcome === "mail" && detail) {
        if (detail.mailingDate) {
          sdY = fieldRow(doc, "Deposited: ", fmtDate(detail.mailingDate), leftX, sdY, 70, COL_W - 70);
        }
        if (detail.mailingAddress) {
          sdY = fieldRow(doc, "Mailed To: ", detail.mailingAddress, leftX, sdY, 70, COL_W - 70);
        }
      } else if (outcome === "posting" && detail?.postingLocationDescription) {
        sdY = fieldRow(doc, "Location: ", detail.postingLocationDescription, leftX, sdY, 70, COL_W - 70);
      } else if (outcome === "publication" && detail) {
        if (detail.publicationNewspaper) {
          sdY = fieldRow(doc, "Newspaper: ", detail.publicationNewspaper, leftX, sdY, 80, COL_W - 80);
        }
        if (detail.publicationCounty) {
          sdY = fieldRow(doc, "County: ", detail.publicationCounty, leftX, sdY, 80, COL_W - 80);
        }
        if (detail.publicationFirstDate || detail.publicationLastDate) {
          const first = detail.publicationFirstDate ? fmtDate(detail.publicationFirstDate) : "—";
          const last = detail.publicationLastDate ? fmtDate(detail.publicationLastDate) : "—";
          sdY = fieldRow(doc, "Pub. Dates: ", `${first} – ${last}`, leftX, sdY, 80, COL_W - 80);
        }
        if (detail.publicationOrderRef) {
          sdY = fieldRow(doc, "Court Order: ", detail.publicationOrderRef, leftX, sdY, 80, COL_W - 80);
        }
      } else if (outcome === "non_est" && detail?.nonEstSummary) {
        sdY = fieldRow(doc, "Diligent Search: ", detail.nonEstSummary, leftX, sdY, 90, COL_W - 90);
      }

      // RIGHT — RECIPIENT INFORMATION
      let riY = sectionLabel(doc, "Recipient Information", rightX, y, COL_W);
      riY = fieldRow(doc, "Named Party: ", job.recipientName, rightX, riY, 80, COL_W - 80);

      // Identity-confirmation check-row. Surfaces ONLY for personal /
      // substitute outcomes. The captured photo is intentionally not
      // rendered — it lives on the platform record only.
      if (outcome === "personal" || outcome === "substitute") {
        const im = (detail?.identityMethod ?? "").trim();
        doc
          .fillColor(COLOR_MUTED)
          .font("Helvetica-Bold")
          .fontSize(8)
          .text("Identity By: ", rightX, riY, { lineBreak: false });
        const idBoxX = rightX + 80;
        let idy = riY;
        idy = checkRow(doc, idBoxX, idy, im === "verbal", "Verbal Confirmation", COL_W - 80);
        idy = checkRow(doc, idBoxX, idy, im === "photo_match", "Photo Match", COL_W - 80);
        idy = checkRow(doc, idBoxX, idy, im === "known", "Known to Server", COL_W - 80);
        const otherLabel =
          im === "other" && detail?.identityOtherText?.trim()
            ? `Other: ${detail.identityOtherText.trim()}`
            : "Other";
        idy = checkRow(doc, idBoxX, idy, im === "other", otherLabel, COL_W - 80);
        riY = idy + 2;
      }

      const notes = (detail?.methodNarrative?.trim() || job.notes?.trim() || "");
      if (notes) {
        doc
          .fillColor(COLOR_MUTED)
          .font("Helvetica-Bold")
          .fontSize(8)
          .text("Notes: ", rightX, riY, { lineBreak: false });
        doc
          .fillColor(COLOR_TEXT)
          .font("Helvetica")
          .fontSize(9)
          .text(notes, rightX + 38, riY - 1, { width: COL_W - 38 });
        riY = doc.y + 2;
      }

      y = Math.max(sdY, riY) + 8;

      // ── GPS Verification ────────────────────────────────────────
      y = sectionLabel(doc, "GPS Verification", MARGIN_X, y, CONTENT_W);
      const lat = typeof job.gpsLat === "number" ? job.gpsLat.toFixed(6) : null;
      const lng = typeof job.gpsLng === "number" ? job.gpsLng.toFixed(6) : null;
      doc
        .fillColor(COLOR_MUTED)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text("Coordinates: ", MARGIN_X, y, { lineBreak: false });
      doc
        .fillColor(COLOR_TEXT)
        .font("Helvetica")
        .fontSize(9)
        .text(
          lat && lng ? `${lat}, ${lng}` : "Not recorded",
          MARGIN_X + 70,
          y - 1,
          { lineBreak: false },
        );
      y += 14;
      if (lat && lng) {
        pill(
          doc,
          MARGIN_X,
          y,
          `GPS Location Verified — ${gpsProviderLabel(detail?.gpsProvider)}`,
        );
        y += 22;
      } else {
        y += 6;
      }

      // ── Attempt history (compact) ───────────────────────────────
      if (attempts && attempts.length > 0) {
        y = sectionLabel(doc, "Attempt History", MARGIN_X, y, CONTENT_W);
        const showAttempts = attempts.slice(-3); // most recent three
        for (const a of showAttempts) {
          const rowH = 12;
          doc
            .rect(MARGIN_X, y, CONTENT_W, rowH)
            .strokeColor(COLOR_BORDER)
            .lineWidth(0.4)
            .stroke();
          doc
            .fillColor(COLOR_NAVY)
            .font("Helvetica-Bold")
            .fontSize(8)
            .text(outcomeLabel(a.outcome).toUpperCase(), MARGIN_X + 6, y + 2.5, {
              width: 110,
              lineBreak: false,
            });
          doc
            .fillColor(COLOR_TEXT)
            .font("Helvetica")
            .fontSize(8.5)
            .text(
              `${fmtDate(a.attemptedAt)} ${fmtTime(a.attemptedAt)}`,
              MARGIN_X + 120,
              y + 2.5,
              { width: 130, lineBreak: false },
            );
          if (a.notes) {
            doc
              .fillColor(COLOR_MUTED)
              .text(a.notes, MARGIN_X + 254, y + 2.5, {
                width: CONTENT_W - 260,
                lineBreak: false,
                ellipsis: true,
              });
          }
          y += rowH + 1;
        }
        y += 2;
      }

      // ── Locked Nevada Declaration callout ───────────────────────
      // Render label + body as two separate text calls (no continued)
      // so the width constraint applies cleanly to the wrapped body —
      // PDFKit drops the width when you mid-sentence-continue.
      const declLabel = "DECLARATION (NRS 53.045):";
      doc.font("Helvetica-Bold").fontSize(8.5);
      const labelW = doc.widthOfString(declLabel) + 4;
      const bodyW = CONTENT_W - 20 - labelW;
      doc.font("Helvetica").fontSize(8.5);
      const bodyH = doc.heightOfString(nevadaDeclaration, { width: bodyW });
      const declH = Math.max(22, bodyH + 10);
      doc
        .rect(MARGIN_X, y, CONTENT_W, declH)
        .fillColor(COLOR_AMBER_SOFT)
        .fill();
      doc
        .rect(MARGIN_X, y, 3, declH)
        .fillColor(COLOR_AMBER)
        .fill();
      doc
        .fillColor(COLOR_NAVY)
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .text(declLabel, MARGIN_X + 10, y + 7, { lineBreak: false });
      doc
        .fillColor(COLOR_TEXT)
        .font("Helvetica")
        .fontSize(8.5)
        .text(nevadaDeclaration, MARGIN_X + 10 + labelW, y + 7, {
          width: bodyW,
        });
      y += declH + 4;

      // ── Signature block (full-width, compact) ───────────────────
      // Notary jurat omitted — NRS 53.045 declaration above is the
      // sworn statement under Nevada law. Signature image left,
      // printed name + signed-on date inline right of the same rule.
      const SIG_BLOCK_H = 46;
      if (y + SIG_BLOCK_H > PAGE_H - FOOTER_H - 8) {
        doc.addPage();
        y = HEADER_H + 18;
      }
      const sigTop = y;
      const sigImgW = 200;
      if (signatureImagePng && signatureImagePng.length > 0) {
        try {
          doc.image(signatureImagePng, MARGIN_X, sigTop, { fit: [sigImgW, 28] });
        } catch {
          doc
            .fillColor(COLOR_TEXT)
            .font("Helvetica-Oblique")
            .fontSize(15)
            .text(signatureTypedName, MARGIN_X, sigTop + 6, {
              width: sigImgW,
              lineBreak: false,
            });
        }
      } else {
        doc
          .fillColor(COLOR_TEXT)
          .font("Helvetica-Oblique")
          .fontSize(16)
          .text(signatureTypedName, MARGIN_X, sigTop + 4, {
            width: sigImgW,
            lineBreak: false,
          });
      }
      doc
        .moveTo(MARGIN_X, sigTop + 30)
        .lineTo(MARGIN_X + CONTENT_W, sigTop + 30)
        .strokeColor(COLOR_TEXT)
        .lineWidth(0.7)
        .stroke();
      doc
        .fillColor(COLOR_TEXT)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(`/s/ ${signatureTypedName}`, MARGIN_X, sigTop + 34, {
          width: sigImgW,
          lineBreak: false,
        });
      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor(COLOR_MUTED)
        .text(
          `Printed name: ${signatureTypedName}    \u2022    Signed on: ${fmtDate(generatedAt)}`,
          MARGIN_X + sigImgW + 12,
          sigTop + 36,
          { width: CONTENT_W - sigImgW - 12, lineBreak: false },
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Companion "Notice of Service by Mail" — Nevada substitute service
 * (NRCP 4.2(a)(2)) requires the server to mail an additional copy of the
 * served documents to the named party at their dwelling/usual place of
 * abode. This document is the stamped, court-fileable record of that
 * mailing the server can hand the post office (or photograph as proof
 * of mailing).
 *
 * The notice carries the same `noticeRef` printed on the companion
 * affidavit so a clerk can pair the two filings deterministically.
 */
export async function generateMailNoticePdf(input: MailNoticeInput): Promise<Buffer> {
  const {
    job,
    server,
    signatureImagePng,
    signatureTypedName,
    servedAt,
    generatedAt,
    mailingDate,
    mailingAddress,
    substituteRecipientName,
    documentsServed,
    requesterName,
    requesterEmail,
    requesterPhone,
    legalEntityName,
    legalBusinessAddress,
    noticeRef,
  } = input;

  return await new Promise<Buffer>((resolve, reject) => {
    try {
      const info: Record<string, string> = {
        Title: `Notice of Service by Mail — ${noticeRef}`,
        Subject: `Notice of Service by Mail for ${job.recipientName}`,
      };
      if (legalEntityName) info.Author = legalEntityName;

      const doc = new PDFDocument({
        size: "LETTER",
        margins: { top: 56, bottom: 56, left: 64, right: 64 },
        info,
      });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // ---- Venue header (mirrors the affidavit so a court accepts the
      // pair as a single filing). ----
      const venueCounty =
        server?.licenseCounty?.trim() || job.recipientCity?.trim() || null;
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("STATE OF NEVADA");
      doc.text(
        `COUNTY OF ${venueCounty ? venueCounty.toUpperCase() : "_______________"}`,
      );
      doc.moveDown(0.75);

      // ---- Court caption ----
      const court =
        job.courtName?.trim() ||
        "Eighth Judicial District Court, Clark County, Nevada";
      doc.font("Helvetica-Bold").fontSize(11).text(court.toUpperCase(), {
        align: "center",
      });
      doc.moveDown(0.4);
      const petitioner =
        job.petitioner?.trim() ||
        (job.matterName?.trim() ? job.matterName.trim() : "Petitioner");
      const respondent = job.respondent?.trim() || job.recipientName;
      doc.font("Helvetica").fontSize(10);
      doc.text(`${petitioner},`);
      doc.text("    Petitioner / Plaintiff,", { indent: 12 });
      doc.moveDown(0.2);
      doc.text("vs.", { indent: 12 });
      doc.moveDown(0.2);
      doc.text(`${respondent},`);
      doc.text("    Respondent / Defendant.", { indent: 12 });
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").text("Case No.: ", { continued: true });
      doc.font("Helvetica").text(job.caseNumber || "______________________");
      doc.moveDown(0.75);

      // ---- Title ----
      doc
        .font("Helvetica-Bold")
        .fontSize(15)
        .text("NOTICE OF SERVICE BY MAIL", { align: "center" });
      doc.moveDown(0.2);
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#555")
        .text(`Reference: ${noticeRef}`, { align: "center" });
      doc.fillColor("#000");
      doc.moveDown(0.6);

      // ---- Body / attestation ----
      const rawName = (server?.name ?? "").trim();
      const serverName =
        rawName && !rawName.includes("@") ? rawName : "the undersigned";
      const credLine = server?.isLicensedNvServer
        ? `, a licensed process server in the State of Nevada (Work Card No. ${
            server.licenseNumber || "____"
          }${server.licenseCounty ? `, ${server.licenseCounty} County` : ""})`
        : "";
      doc
        .font("Helvetica")
        .fontSize(11)
        .text(
          `I, ${serverName}${credLine}, give notice that, pursuant to NRCP 4.2(a)(2), I am depositing in the United States Mail an additional copy of the documents identified below — previously left at the recipient's dwelling or usual place of abode by substitute service on ${fmtDate(
            servedAt,
          )} — addressed to the named party at their last known address.`,
          { align: "justify" },
        );
      doc.moveDown(0.6);

      // ---- Mailing details ----
      doc.font("Helvetica-Bold").fontSize(11).text("MAILING DETAILS");
      doc.font("Helvetica").fontSize(10);
      doc.text(`Named party (addressee): ${job.recipientName}`);
      if (substituteRecipientName?.trim()) {
        doc.text(`Originally left with: ${substituteRecipientName.trim()}`);
      }
      doc.text(`Date of mailing: ${fmtDate(mailingDate)}`);
      doc.text(`Mailed to: ${mailingAddress}`);
      doc.text(`Class of mail: First-class, postage prepaid`);
      doc.moveDown(0.6);

      // ---- Documents enclosed ----
      doc.font("Helvetica-Bold").fontSize(11).text("DOCUMENTS ENCLOSED");
      doc.font("Helvetica").fontSize(10);
      if (documentsServed && documentsServed.length > 0) {
        for (const d of documentsServed) {
          const title = d.title?.trim() || d.documentType?.trim() || "Document";
          const type = d.documentType?.trim();
          const showType =
            type && type !== title && type.toLowerCase() !== "other";
          doc.text(`• ${title}${showType ? ` (${type})` : ""}`, { indent: 8 });
        }
      } else {
        doc.text(`• ${job.documentType || "Legal documents"}`, { indent: 8 });
      }
      doc.moveDown(0.6);

      // ---- Requesting party (matches the affidavit) ----
      const requesterNameLine = requesterName?.trim();
      if (requesterNameLine) {
        doc.font("Helvetica-Bold").fontSize(11).text("REQUESTING PARTY");
        doc.font("Helvetica").fontSize(10);
        doc.text(`Name: ${requesterNameLine}`, { indent: 8 });
        if (requesterEmail?.trim()) {
          doc.text(`Email: ${requesterEmail.trim()}`, { indent: 8 });
        }
        if (requesterPhone?.trim()) {
          doc.text(`Phone: ${requesterPhone.trim()}`, { indent: 8 });
        }
        doc.moveDown(0.6);
      }

      // ---- Post-office stamp area ----
      doc.font("Helvetica-Bold").fontSize(10).text("POSTAGE / POSTMARK");
      doc.font("Helvetica").fontSize(9).fillColor("#555");
      doc.text(
        "Affix postage receipt or postmark below. Retain a copy of this notice with the receipt as proof of the follow-up mailing.",
        { align: "justify" },
      );
      doc.fillColor("#000");
      const stampTop = doc.y + 6;
      doc
        .rect(doc.page.margins.left, stampTop, 240, 80)
        .strokeColor("#666")
        .lineWidth(0.75)
        .dash(3, { space: 3 })
        .stroke();
      doc.undash();
      doc.y = stampTop + 90;
      doc.moveDown(0.4);

      // ---- Signature block ----
      const sigBlockTop = doc.y;
      doc
        .moveTo(doc.page.margins.left, sigBlockTop + 50)
        .lineTo(doc.page.margins.left + 240, sigBlockTop + 50)
        .strokeColor("#000")
        .lineWidth(0.5)
        .stroke();
      if (signatureImagePng && signatureImagePng.length > 0) {
        try {
          doc.image(signatureImagePng, doc.page.margins.left, sigBlockTop, {
            fit: [240, 50],
          });
        } catch {
          /* fall through to typed /s/ */
        }
      }
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(`/s/ ${signatureTypedName}`, doc.page.margins.left, sigBlockTop + 56);
      doc
        .font("Helvetica")
        .fontSize(9)
        .text(`Printed name: ${signatureTypedName}`, doc.page.margins.left, sigBlockTop + 70);
      doc.text(`Signed on: ${fmtDate(generatedAt)}`, doc.page.margins.left, sigBlockTop + 84);
      doc.text(`Engaged through: ${legalEntityName}`, doc.page.margins.left, sigBlockTop + 98);
      let cursorY = sigBlockTop + 112;
      if (legalBusinessAddress && legalBusinessAddress.trim().length > 0) {
        doc.text(
          `Business address: ${legalBusinessAddress.trim()}`,
          doc.page.margins.left,
          cursorY,
        );
        cursorY += 14;
      }
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#777")
        .text(
          `Ref: ${noticeRef}  ·  Companion to affidavit ${job.platformRef}`,
          doc.page.margins.left,
          cursorY,
        );
      doc.fillColor("#000");

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
