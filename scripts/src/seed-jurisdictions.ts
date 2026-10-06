/**
 * Seed the multi-state compliance model with the initial launch jurisdictions
 * and credential catalogue.
 *
 * Run: pnpm --filter @workspace/scripts run seed-jurisdictions
 *
 * Idempotent — safe to run multiple times. Uses each table's unique code to
 * skip rows that already exist, and reconciles requirements by lookup.
 *
 * Regulatory facts captured here were verified against the state courts /
 * statutes (CO C.R.C.P. 4; UT Code 78B-8-302 eff. 7/1/2024; AZ Code of
 * Judicial Administration 7-204; NV NRS 648). Re-verify before going live in
 * any state — these rules change.
 */
import { eq, and, isNull } from "drizzle-orm";
import {
  db,
  pool,
  jurisdictionsTable,
  credentialTypesTable,
  jurisdictionRequirementsTable,
  type RegulatoryModel,
} from "@workspace/db";

type CredentialSeed = {
  code: string;
  name: string;
  description: string;
  hasExpiry: boolean;
  hasDocument: boolean;
};

const CREDENTIAL_TYPES: CredentialSeed[] = [
  {
    code: "az_court_cert",
    name: "Arizona Private Process Server Certification",
    description:
      "County Superior Court certification under AZ Code of Judicial Administration 7-204. Valid 3 years; requires exam (85%) + FBI background + 10 hrs/yr CE.",
    hasExpiry: true,
    hasDocument: true,
  },
  {
    code: "nv_pilb",
    name: "Nevada PILB Process Server License",
    description:
      "Nevada Private Investigator's Licensing Board license under NRS 648 (licensed individual servers).",
    hasExpiry: true,
    hasDocument: true,
  },
  {
    code: "background_check",
    name: "Background Check",
    description:
      "Criminal background / fingerprint clearance (e.g. AZ DPS/FBI card, or platform-run check).",
    hasExpiry: false,
    hasDocument: true,
  },
  {
    code: "eo_insurance",
    name: "Errors & Omissions Insurance",
    description:
      "Professional liability (E&O) policy. Not legally required in CO/UT/AZ but recommended and may be required by the platform.",
    hasExpiry: true,
    hasDocument: true,
  },
  {
    code: "surety_bond",
    name: "Surety Bond",
    description: "Surety bond where a jurisdiction or court requires one.",
    hasExpiry: true,
    hasDocument: true,
  },
  {
    code: "pi_number",
    name: "Private Investigator Number",
    description:
      "PI identification number — printed on the Utah return of service when the server is a private investigator (UT Code 78B-8-302).",
    hasExpiry: false,
    hasDocument: false,
  },
  {
    code: "w9",
    name: "IRS Form W-9",
    description:
      "Taxpayer identification for 1099 contractor payouts via Stripe Connect.",
    hasExpiry: false,
    hasDocument: true,
  },
];

type JurisdictionSeed = {
  code: string;
  name: string;
  regulatoryModel: RegulatoryModel;
  notes: string;
  // credential type codes required to serve here (empty = unregulated)
  requires: { credentialCode: string; appliesToServerType?: string; notes?: string }[];
};

const JURISDICTIONS: JurisdictionSeed[] = [
  {
    code: "CO",
    name: "Colorado",
    regulatoryModel: "unregulated",
    notes:
      "No statewide license/registration/bond. 18+, not a party (C.R.C.P. 4). No nail-and-mail for general civil; 63-day service deadline; 2026 file-first eviction rule.",
    requires: [],
  },
  {
    code: "UT",
    name: "Utah",
    regulatoryModel: "unregulated",
    notes:
      "No license/certification as of 7/1/2024 (UT Code 78B-8-302). 18+, not a party. PI servers print PI number on the return; peace officers print badge number.",
    requires: [],
  },
  {
    code: "AZ",
    name: "Arizona",
    regulatoryModel: "individual_cert",
    notes:
      "Individual county Superior Court certification required (AZ CJA 7-204). 21+, AZ resident 1yr, exam 85%, FBI background, 10 hrs/yr CE, 3-yr cert. No bond.",
    requires: [
      { credentialCode: "az_court_cert", notes: "Required to serve in AZ." },
      {
        credentialCode: "background_check",
        notes: "FBI fingerprint clearance via AZ DPS (part of certification).",
      },
    ],
  },
  {
    code: "NV",
    name: "Nevada",
    regulatoryModel: "agency_licensed",
    notes:
      "Strictest model (NRS 648). Licensed individual servers hold a PILB license; registered/work-card servers operate under a Qualifying Agent (agency-level, handled separately). Not yet active.",
    requires: [
      {
        credentialCode: "nv_pilb",
        appliesToServerType: "licensed_nv",
        notes:
          "Applies to individually-licensed NV servers. Registered servers satisfy NV via QA/agency linkage, handled outside this requirement.",
      },
    ],
  },
];

async function main() {
  // 1) Credential types
  for (const c of CREDENTIAL_TYPES) {
    await db
      .insert(credentialTypesTable)
      .values(c)
      .onConflictDoNothing({ target: credentialTypesTable.code });
  }
  const credRows = await db.select().from(credentialTypesTable);
  const credByCode = new Map(credRows.map((r) => [r.code, r.id]));

  // 2) Jurisdictions
  for (const j of JURISDICTIONS) {
    await db
      .insert(jurisdictionsTable)
      .values({
        code: j.code,
        name: j.name,
        level: "state",
        regulatoryModel: j.regulatoryModel,
        isActive: false,
        notes: j.notes,
      })
      .onConflictDoNothing({ target: jurisdictionsTable.code });
  }
  const jurRows = await db.select().from(jurisdictionsTable);
  const jurByCode = new Map(jurRows.map((r) => [r.code, r.id]));

  // 3) Requirements — reconcile by (jurisdiction, credential, server-type).
  let added = 0;
  for (const j of JURISDICTIONS) {
    const jurisdictionId = jurByCode.get(j.code);
    if (!jurisdictionId) continue;
    for (const req of j.requires) {
      const credentialTypeId = credByCode.get(req.credentialCode);
      if (!credentialTypeId) {
        console.warn(`  ! unknown credential code: ${req.credentialCode}`);
        continue;
      }
      const scope = req.appliesToServerType ?? null;
      const existing = await db
        .select({ id: jurisdictionRequirementsTable.id })
        .from(jurisdictionRequirementsTable)
        .where(
          and(
            eq(jurisdictionRequirementsTable.jurisdictionId, jurisdictionId),
            eq(jurisdictionRequirementsTable.credentialTypeId, credentialTypeId),
            scope === null
              ? isNull(jurisdictionRequirementsTable.appliesToServerType)
              : eq(jurisdictionRequirementsTable.appliesToServerType, scope),
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(jurisdictionRequirementsTable).values({
          jurisdictionId,
          credentialTypeId,
          isRequired: true,
          appliesToServerType: scope,
          notes: req.notes,
        });
        added++;
      }
    }
  }

  console.log(
    `Seed complete: ${credRows.length} credential types, ${jurRows.length} jurisdictions, ${added} new requirement(s).`,
  );
  for (const j of JURISDICTIONS) {
    const reqList = j.requires.length
      ? j.requires.map((r) => r.credentialCode).join(", ")
      : "(none — unregulated)";
    console.log(`  ${j.code} [${j.regulatoryModel}] → ${reqList}`);
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    return pool.end().finally(() => process.exit(1));
  });
