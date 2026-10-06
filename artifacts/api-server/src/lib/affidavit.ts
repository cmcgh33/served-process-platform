/**
 * Higher-level affidavit orchestration. Owns the whole "given a served job,
 * generate the PDF and stash it on the job row" path so the routes layer
 * (POST /jobs/:id/attempts with outcome=personal|substitute, and
 * POST /admin/jobs/:id/regenerate-affidavit) stays small and consistent.
 *
 * Failures here are NEVER fatal to the served-flip — markJobServed already
 * commits the status change inside its transaction; this runs post-commit
 * so a transient PDF/storage hiccup doesn't roll back a successful service.
 */
import {
  db,
  jobsTable,
  serversTable,
  serviceAttemptsTable,
  jobServedDocumentsTable,
  clientsTable,
} from "@workspace/db";
import { eq, asc, and, sql } from "drizzle-orm";
import type { Logger } from "pino";
import {
  generateAffidavitPdf,
  generateMailNoticePdf,
  noticeOfMailRefFor,
} from "./affidavitPdf";
import {
  uploadBufferToObjectStorage,
  downloadObjectBytes,
} from "./uploadServerObject";
import { validateAttemptBody } from "./attemptValidation";

const LEGAL = {
  tradeName: "SERVED.",
  // Platform / engaging-entity business address. Printed on every affidavit
  // under the "Engaged through" line so courts can see who the contracting
  // legal-services platform is, regardless of which individual server
  // executed the proof. Update this constant if SERVED. ever moves offices.
  businessAddress: "732 S 6TH ST #6750, LAS VEGAS, NV 89101",
  // Platform support contacts. Printed verbatim in the SERVER INFO Phone/Email
  // rows on every affidavit so courts and recipients always reach SERVED.
  // (the engaging legal-services platform), never the individual contractor's
  // personal cell or inbox.
  supportPhone: "775-655-3933",
  supportEmail: "support@servedapp.co",
  nevadaDeclaration:
    "I declare under penalty of perjury under the law of the State of Nevada that the foregoing is true and correct. (NRS 53.045)",
} as const;

export interface AffidavitGenResult {
  ok: boolean;
  proofPdfUrl?: string;
  error?: string;
  // HTTP-status hint for callers (ensure-affidavit / regenerate-affidavit).
  // 422 = the affidavit cannot be rendered because the persisted service
  // attempt is missing legally-required fields. 500 = a transient
  // PDF/storage failure that's safe to retry. Defaults to undefined; the
  // route layer treats undefined as 500 for back-compat.
  status?: number;
}

/**
 * Generate the affidavit PDF for a job and persist `proof_pdf_url`.
 * Idempotent: callers may invoke at confirm time (first generation) or
 * via the admin regenerate endpoint (overwrite). On regenerate, the prior
 * blob is intentionally orphaned in storage — cheap and safer than a delete
 * race that could leave the DB pointing at nothing.
 */
export async function generateAndStoreAffidavit(
  jobId: number,
  log: Pick<Logger, "info" | "warn" | "error">,
): Promise<AffidavitGenResult> {
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);
  if (!job) return { ok: false, error: "Job not found" };
  if (job.status !== "served" || !job.servedAt) {
    return { ok: false, error: "Job is not in served state" };
  }
  if (!job.signatureTypedName) {
    return {
      ok: false,
      error:
        "Cannot generate affidavit: job has no captured signature (typed name missing).",
    };
  }

  const server = job.serverId
    ? (
        await db
          .select({
            name: serversTable.name,
            email: serversTable.email,
            phone: serversTable.phone,
            licenseNumber: serversTable.licenseNumber,
            licenseState: serversTable.licenseState,
            businessAddress: serversTable.businessAddress,
            isLicensedNvServer: serversTable.isLicensedNvServer,
            licenseCounty: serversTable.licenseCounty,
            // Server classification — drives the four-checkbox row in
            // SERVER INFORMATION on the redesigned affidavit.
            serverType: serversTable.serverType,
          })
          .from(serversTable)
          .where(eq(serversTable.id, job.serverId))
          .limit(1)
      )[0] ?? null
    : null;

  // Optional firm/attorney snapshot — drives the REQUESTED BY block.
  // Falls back to the requester* fields on the job when the job has
  // no client linkage (e.g. self-serve requester portal).
  const client = job.clientId
    ? (
        await db
          .select({
            firmName: clientsTable.firmName,
            contactName: clientsTable.contactName,
            email: clientsTable.email,
            phone: clientsTable.phone,
          })
          .from(clientsTable)
          .where(eq(clientsTable.id, job.clientId))
          .limit(1)
      )[0] ?? null
    : null;

  // Fetch the canvas signature image bytes (best-effort; PDF degrades to
  // a typed /s/ name + signature line if the image fetch fails).
  const signaturePng = job.signatureImageUrl
    ? await downloadObjectBytes(job.signatureImageUrl)
    : null;

  const attempts = await db
    .select({
      outcome: serviceAttemptsTable.outcome,
      attemptedAt: serviceAttemptsTable.attemptedAt,
      notes: serviceAttemptsTable.notes,
      gpsLat: serviceAttemptsTable.gpsLat,
      gpsLng: serviceAttemptsTable.gpsLng,
      serviceAddress: serviceAttemptsTable.serviceAddress,
      serviceCity: serviceAttemptsTable.serviceCity,
      serviceState: serviceAttemptsTable.serviceState,
      serviceZip: serviceAttemptsTable.serviceZip,
      methodNarrative: serviceAttemptsTable.methodNarrative,
      substituteRecipientName: serviceAttemptsTable.substituteRecipientName,
      // Universal-trio + state-overlay flags needed by the completeness
      // gate below. Affidavit rendering itself doesn't print these — they
      // exist purely so we can re-run validateAttemptBody against the
      // persisted attempt and refuse to render if anything required is
      // missing.
      substituteOver18: serviceAttemptsTable.substituteOver18,
      substituteVerifiedResidence:
        serviceAttemptsTable.substituteVerifiedResidence,
      substituteRecipientAge: serviceAttemptsTable.substituteRecipientAge,
      substituteIsCoResident: serviceAttemptsTable.substituteIsCoResident,
      acknowledgeMailFollowup: serviceAttemptsTable.acknowledgeMailFollowup,
      recipientRelationship: serviceAttemptsTable.recipientRelationship,
      recipientDescription: serviceAttemptsTable.recipientDescription,
      recipientAgeEstimate: serviceAttemptsTable.recipientAgeEstimate,
      recipientGender: serviceAttemptsTable.recipientGender,
      recipientHeight: serviceAttemptsTable.recipientHeight,
      recipientWeight: serviceAttemptsTable.recipientWeight,
      recipientIdentifyingFeatures:
        serviceAttemptsTable.recipientIdentifyingFeatures,
      mailingDate: serviceAttemptsTable.mailingDate,
      mailingAddress: serviceAttemptsTable.mailingAddress,
      postingLocationDescription:
        serviceAttemptsTable.postingLocationDescription,
      // Service-by-Publication (NRS 14.040) + non-est diligent-search.
      publicationOrderRef: serviceAttemptsTable.publicationOrderRef,
      publicationNewspaper: serviceAttemptsTable.publicationNewspaper,
      publicationCounty: serviceAttemptsTable.publicationCounty,
      publicationFirstDate: serviceAttemptsTable.publicationFirstDate,
      publicationLastDate: serviceAttemptsTable.publicationLastDate,
      nonEstSummary: serviceAttemptsTable.nonEstSummary,
      // Identity-confirmation + GPS provenance fields (T001) drive
      // the RECIPIENT INFORMATION check-row and the green
      // "GPS Location Verified" pill on the redesigned affidavit.
      identityMethod: serviceAttemptsTable.identityMethod,
      identityOtherText: serviceAttemptsTable.identityOtherText,
      gpsProvider: serviceAttemptsTable.gpsProvider,
    })
    .from(serviceAttemptsTable)
    .where(eq(serviceAttemptsTable.jobId, jobId))
    .orderBy(asc(serviceAttemptsTable.attemptedAt));

  // Pick the most recent completing attempt — that's the row whose
  // outcome+method narrative the affidavit body should describe.
  const COMPLETING = new Set([
    "personal",
    "substitute",
    "mail",
    "posting",
    "publication",
    "non_est",
  ]);
  const completingAttempt =
    [...attempts]
      .reverse()
      .find((a) => COMPLETING.has(a.outcome)) ?? attempts[attempts.length - 1] ?? null;

  // Affidavit completeness gate. For substitute outcomes the persisted
  // attempt must satisfy the same validateAttemptBody rules the route
  // enforced at write time (recipientName, over-18, residence, relationship,
  // structured description, plus state overlays). If it doesn't — usually
  // because the row predates a rule — refuse to render rather than emit a
  // facially-defective affidavit. The 422 hint lets the route layer
  // surface the error to the caller without leaking internals.
  if (completingAttempt && completingAttempt.outcome === "substitute") {
    const check = validateAttemptBody(
      {
        outcome: "substitute",
        substituteRecipientName: completingAttempt.substituteRecipientName,
        substituteOver18: completingAttempt.substituteOver18,
        substituteVerifiedResidence:
          completingAttempt.substituteVerifiedResidence,
        substituteRecipientAge: completingAttempt.substituteRecipientAge,
        substituteIsCoResident: completingAttempt.substituteIsCoResident,
        acknowledgeMailFollowup: completingAttempt.acknowledgeMailFollowup,
        mailingDate: completingAttempt.mailingDate,
        mailingAddress: completingAttempt.mailingAddress,
        recipientRelationship: completingAttempt.recipientRelationship,
        recipientAgeEstimate: completingAttempt.recipientAgeEstimate,
        recipientGender: completingAttempt.recipientGender,
        recipientHeight: completingAttempt.recipientHeight,
        recipientWeight: completingAttempt.recipientWeight,
        recipientIdentifyingFeatures:
          completingAttempt.recipientIdentifyingFeatures,
      },
      job.recipientState,
    );
    if (!check.ok) {
      log.warn(
        { jobId, error: check.error },
        "affidavit blocked: substitute attempt missing required fields",
      );
      return {
        ok: false,
        status: 422,
        error: `Cannot generate affidavit: ${check.error}`,
      };
    }
  }

  const documentsServed = await db
    .select({
      title: jobServedDocumentsTable.title,
      documentType: jobServedDocumentsTable.documentType,
    })
    .from(jobServedDocumentsTable)
    .where(eq(jobServedDocumentsTable.jobId, jobId))
    .orderBy(asc(jobServedDocumentsTable.id));

  // When this is a substitute service with a committed follow-up mailing,
  // also generate a companion "Notice of Service by Mail" PDF (NRCP 4.2)
  // and cross-reference it from the affidavit body. The notice ref is
  // deterministic so a regenerate always produces a stable cross-link.
  const needsMailNotice =
    completingAttempt?.outcome === "substitute" &&
    completingAttempt.acknowledgeMailFollowup === true &&
    completingAttempt.mailingDate != null &&
    !!completingAttempt.mailingAddress?.trim();
  const noticeRef = needsMailNotice ? noticeOfMailRefFor(job.platformRef) : null;

  const generatedAt = new Date();
  let pdf: Buffer;
  try {
    pdf = await generateAffidavitPdf({
      job,
      server,
      signatureImagePng: signaturePng,
      signatureTypedName: job.signatureTypedName,
      servedAt: job.servedAt,
      generatedAt,
      attempts,
      completingAttempt,
      documentsServed,
      requesterName: job.requesterName ?? null,
      requesterEmail: job.requesterEmail ?? null,
      requesterPhone: job.requesterPhone ?? null,
      client,
      legalEntityName: LEGAL.tradeName,
      legalBusinessAddress: LEGAL.businessAddress,
      nevadaDeclaration: LEGAL.nevadaDeclaration,
      noticeOfMailRef: noticeRef,
    });
  } catch (err) {
    log.error({ err, jobId }, "Affidavit PDF render failed");
    return { ok: false, error: "Failed to render affidavit PDF" };
  }

  let objectPath: string;
  try {
    objectPath = await uploadBufferToObjectStorage(pdf, "application/pdf");
  } catch (err) {
    log.error({ err, jobId }, "Affidavit PDF upload failed");
    return { ok: false, error: "Failed to upload affidavit PDF" };
  }

  // Generate + upload the companion notice when applicable. A failure here
  // is non-fatal: the affidavit is already persisted above and the notice
  // can be regenerated by the admin or via a future ensure call. We log
  // and continue rather than rolling back the affidavit URL.
  let noticeOfMailPdfUrl: string | null = null;
  if (needsMailNotice && noticeRef && completingAttempt) {
    try {
      const noticePdf = await generateMailNoticePdf({
        job,
        server,
        signatureImagePng: signaturePng,
        signatureTypedName: job.signatureTypedName,
        servedAt: job.servedAt,
        generatedAt,
        mailingDate: completingAttempt.mailingDate as Date,
        mailingAddress: completingAttempt.mailingAddress as string,
        substituteRecipientName: completingAttempt.substituteRecipientName,
        documentsServed,
        requesterName: job.requesterName ?? null,
        requesterEmail: job.requesterEmail ?? null,
        requesterPhone: job.requesterPhone ?? null,
        legalEntityName: LEGAL.tradeName,
        legalBusinessAddress: LEGAL.businessAddress,
        noticeRef,
      });
      noticeOfMailPdfUrl = await uploadBufferToObjectStorage(
        noticePdf,
        "application/pdf",
      );
    } catch (err) {
      log.error(
        { err, jobId },
        "Notice of Service by Mail render/upload failed (non-fatal)",
      );
    }
  }

  await db
    .update(jobsTable)
    .set({
      proofPdfUrl: objectPath,
      // Only overwrite when we actually produced a new notice; preserve
      // any existing URL on partial regenerate so the proof page never
      // loses a working notice link due to a transient failure.
      ...(noticeOfMailPdfUrl ? { noticeOfMailPdfUrl } : {}),
      updatedAt: new Date(),
    })
    .where(eq(jobsTable.id, jobId));

  log.info(
    { jobId, proofPdfUrl: objectPath, noticeOfMailPdfUrl },
    "Affidavit generated",
  );
  return { ok: true, proofPdfUrl: objectPath };
}

export interface NoticeGenResult {
  ok: boolean;
  noticeOfMailPdfUrl?: string;
  alreadyExisted?: boolean;
  /** True when the job legitimately doesn't qualify for a notice
   * (personal service, mail-only outcome, missing follow-up commitment).
   * Callers should treat this as a no-op success. */
  notApplicable?: boolean;
  error?: string;
  status?: number;
}

/**
 * Notice-of-Service-by-Mail self-heal. The companion notice is generated
 * inline alongside the affidavit during the served-flip, but a transient
 * PDF/storage hiccup (the notice path is non-fatal there) can leave a
 * served substitute job with `proofPdfUrl` filled and `noticeOfMailPdfUrl`
 * still null. This function is the targeted recovery path: it never
 * touches an existing notice, never re-renders the affidavit, and is
 * safe to call on any job (returns `notApplicable: true` for jobs that
 * shouldn't have a notice in the first place).
 */
export async function generateAndStoreNoticeOfMail(
  jobId: number,
  log: Pick<Logger, "info" | "warn" | "error">,
): Promise<NoticeGenResult> {
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);
  if (!job) return { ok: false, status: 404, error: "Job not found" };
  if (job.status !== "served" || !job.servedAt) {
    return {
      ok: false,
      status: 412,
      error: "Notice is only available after service is completed",
    };
  }
  if (job.noticeOfMailPdfUrl) {
    return {
      ok: true,
      noticeOfMailPdfUrl: job.noticeOfMailPdfUrl,
      alreadyExisted: true,
    };
  }
  if (!job.signatureTypedName) {
    return {
      ok: false,
      status: 422,
      error: "Cannot generate notice: job has no captured signature.",
    };
  }

  // Find the most recent substitute attempt with a committed mailing.
  const subs = await db
    .select({
      substituteRecipientName: serviceAttemptsTable.substituteRecipientName,
      acknowledgeMailFollowup: serviceAttemptsTable.acknowledgeMailFollowup,
      mailingDate: serviceAttemptsTable.mailingDate,
      mailingAddress: serviceAttemptsTable.mailingAddress,
      outcome: serviceAttemptsTable.outcome,
      attemptedAt: serviceAttemptsTable.attemptedAt,
    })
    .from(serviceAttemptsTable)
    .where(eq(serviceAttemptsTable.jobId, jobId))
    .orderBy(asc(serviceAttemptsTable.attemptedAt));
  const completingAttempt =
    [...subs].reverse().find((a) => a.outcome === "substitute") ?? null;
  const qualifies =
    completingAttempt &&
    completingAttempt.acknowledgeMailFollowup === true &&
    completingAttempt.mailingDate != null &&
    !!completingAttempt.mailingAddress?.trim();
  if (!qualifies) {
    return { ok: true, notApplicable: true };
  }

  const server = job.serverId
    ? (
        await db
          .select({
            name: serversTable.name,
            licenseNumber: serversTable.licenseNumber,
            licenseState: serversTable.licenseState,
            businessAddress: serversTable.businessAddress,
            isLicensedNvServer: serversTable.isLicensedNvServer,
            licenseCounty: serversTable.licenseCounty,
          })
          .from(serversTable)
          .where(eq(serversTable.id, job.serverId))
          .limit(1)
      )[0] ?? null
    : null;

  const signaturePng = job.signatureImageUrl
    ? await downloadObjectBytes(job.signatureImageUrl)
    : null;

  const documentsServed = await db
    .select({
      title: jobServedDocumentsTable.title,
      documentType: jobServedDocumentsTable.documentType,
    })
    .from(jobServedDocumentsTable)
    .where(eq(jobServedDocumentsTable.jobId, jobId))
    .orderBy(asc(jobServedDocumentsTable.id));

  const noticeRef = noticeOfMailRefFor(job.platformRef);
  let pdf: Buffer;
  try {
    pdf = await generateMailNoticePdf({
      job,
      server,
      signatureImagePng: signaturePng,
      signatureTypedName: job.signatureTypedName,
      servedAt: job.servedAt,
      generatedAt: new Date(),
      mailingDate: completingAttempt!.mailingDate as Date,
      mailingAddress: completingAttempt!.mailingAddress as string,
      substituteRecipientName: completingAttempt!.substituteRecipientName,
      documentsServed,
      requesterName: job.requesterName ?? null,
      requesterEmail: job.requesterEmail ?? null,
      requesterPhone: job.requesterPhone ?? null,
      legalEntityName: LEGAL.tradeName,
      legalBusinessAddress: LEGAL.businessAddress,
      noticeRef,
    });
  } catch (err) {
    log.error({ err, jobId }, "Notice PDF render failed");
    return { ok: false, status: 500, error: "Failed to render notice PDF" };
  }

  let path: string;
  try {
    path = await uploadBufferToObjectStorage(pdf, "application/pdf");
  } catch (err) {
    log.error({ err, jobId }, "Notice PDF upload failed");
    return { ok: false, status: 500, error: "Failed to upload notice PDF" };
  }

  // Atomic-ish: only fill if still null, so a concurrent affidavit-regen
  // that just persisted its own notice wins and we orphan our blob.
  const [updated] = await db
    .update(jobsTable)
    .set({ noticeOfMailPdfUrl: path, updatedAt: new Date() })
    .where(
      and(
        eq(jobsTable.id, jobId),
        sql`${jobsTable.noticeOfMailPdfUrl} IS NULL`,
      ),
    )
    .returning({ noticeOfMailPdfUrl: jobsTable.noticeOfMailPdfUrl });
  if (!updated) {
    const [current] = await db
      .select({ noticeOfMailPdfUrl: jobsTable.noticeOfMailPdfUrl })
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId));
    return {
      ok: true,
      noticeOfMailPdfUrl: current?.noticeOfMailPdfUrl ?? path,
      alreadyExisted: true,
    };
  }
  log.info({ jobId, noticeOfMailPdfUrl: path }, "Notice generated (self-heal)");
  return { ok: true, noticeOfMailPdfUrl: path, alreadyExisted: false };
}
