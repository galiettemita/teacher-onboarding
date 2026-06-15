import type { DocApplicability } from "@/lib/db/schema";

/**
 * The school's canonical required-document catalog — the single source of
 * truth shared by the seed (`scripts/seed.ts`), the prod catalog sync script
 * (`scripts/sync-document-types.ts`), and the tests.
 *
 * Exactly five forms:
 *
 *   Everyone (new + current staff) — `all_staff`:
 *     1. Medical Form
 *     2. Foundation in Health and Safety E-learning Certificate of Completion
 *     3. Mandated child abuse certificate of completion
 *
 *   New staff only (first-year onboarding) — `new_first_year_only`:
 *     4. Fingerprinting receipt
 *     5. High school Diploma/ College Degree
 *
 * So a NEW staff member is asked for all 5; a CURRENT/returning staff member
 * is asked for only the 3 `all_staff` forms. Applicability is enforced
 * server-side by `isDocTypeApplicable` (lib/staff/status.ts), which drives
 * BOTH the teacher dashboard and the admin completion calculation — so a
 * returning teacher is never marked incomplete for the two new-staff forms.
 *
 * Medical + the two certificates renew every 24 months (existing expiration
 * tracking applies). Fingerprinting + Diploma are one-time onboarding proof
 * and never expire (renewalMonths: 0).
 */
export type CatalogDocType = {
  name: string;
  description: string;
  required: boolean;
  renewalMonths: number;
  applicability: DocApplicability;
};

export const REQUIRED_DOCUMENT_TYPES: CatalogDocType[] = [
  {
    name: "Medical Form",
    description: "Upload your completed medical form.",
    required: true,
    renewalMonths: 24,
    applicability: "all_staff",
  },
  {
    name: "Foundation in Health and Safety E-learning Certificate of Completion",
    description:
      "Upload your Foundation in Health and Safety E-learning Certificate of Completion.",
    required: true,
    renewalMonths: 24,
    applicability: "all_staff",
  },
  {
    name: "Mandated child abuse certificate of completion",
    description: "Upload your Mandated Child Abuse Certificate of Completion.",
    required: true,
    renewalMonths: 24,
    applicability: "all_staff",
  },
  {
    name: "Fingerprinting receipt",
    description:
      "Upload proof that you completed fingerprinting (your fingerprinting receipt).",
    required: true,
    renewalMonths: 0,
    applicability: "new_first_year_only",
  },
  {
    name: "High school Diploma/ College Degree",
    description: "Send your latest diploma or proof of education.",
    required: true,
    renewalMonths: 0,
    applicability: "new_first_year_only",
  },
];

/** Canonical names, for "deactivate everything not in the catalog" logic. */
export const REQUIRED_DOCUMENT_TYPE_NAMES: string[] =
  REQUIRED_DOCUMENT_TYPES.map((d) => d.name);
