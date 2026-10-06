export const LEGAL_ENTITY = {
  tradeName: "SERVED.",
} as const;

/**
 * Locked Nevada perjury declaration block. Required verbatim on every
 * affidavit/proof of service filed in a Nevada court (modeled on
 * NRS 53.045 — declarations under penalty of perjury). Rendered as the
 * paragraph immediately preceding the server's signature on both the
 * on-page preview and the generated PDF.
 *
 * Centralised here (and mirrored in `artifacts/api-server/src/lib/affidavit.ts`
 * for the back-office PDF pipeline) so the legal text is changed in
 * exactly two places.
 */
export const NEVADA_DECLARATION =
  "I declare under penalty of perjury under the law of the State of Nevada that the foregoing is true and correct. (NRS 53.045)";

