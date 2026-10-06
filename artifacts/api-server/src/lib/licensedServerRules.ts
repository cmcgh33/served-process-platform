/**
 * Single source of truth for which Nevada document types require a PILB-
 * licensed process server. The post-job UI catalogues `civil_litigation`
 * and `subpoena` as `licensed: true`; that decision is enforced server-side
 * by inspecting each documents-served row's `documentType` against the list
 * below. The match is case-insensitive on a normalized title.
 *
 * Stamped onto `jobs.requires_licensed_server` at create time and on the
 * Stripe draft→pending flip so the marketplace feed and `/jobs/:id/accept`
 * gate can run an O(1) boolean check.
 */

const LICENSED_REQUIRED_TYPES = new Set<string>([
  "summons",
  "complaint",
  "summons & complaint",
  "civil subpoena",
  "subpoena duces tecum",
  "subpoena",
]);

export interface DocumentsServedLike {
  documentType?: string | null;
  title?: string | null;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * Returns true iff at least one documents-served entry matches a known
 * Nevada-PILB-restricted document type.
 */
export function deriveRequiresLicensedServer(
  documentsServed: DocumentsServedLike[] | null | undefined,
): boolean {
  if (!documentsServed || documentsServed.length === 0) return false;
  return documentsServed.some((d) => {
    const t = norm(d.documentType);
    if (LICENSED_REQUIRED_TYPES.has(t)) return true;
    // "Other" titles get a broader keyword sweep so a hand-typed
    // "Civil Subpoena - Records" still catches the gate.
    if (t === "other") {
      const title = norm(d.title);
      if (title.includes("subpoena")) return true;
      if (title.includes("summons")) return true;
      if (title.includes("complaint")) return true;
    }
    return false;
  });
}
