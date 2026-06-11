import type { DocCategory } from "@/lib/db/schema";

/**
 * Document-category helpers.
 *
 * Medical forms and training certifications carry a renewal cadence (the
 * portal default is 24 months — a two-year expiration). General and "other"
 * documents typically do not expire (renewal_months = 0).
 *
 * The actual expiry anchor + cadence still lives on `document_types.renewal_months`
 * (see lib/expiry/setExpiry.ts); these helpers describe the family and supply
 * a sensible default cadence when an admin creates a new typed document.
 */

/** Categories whose documents expire on a renewal cadence. */
export const EXPIRING_CATEGORIES: ReadonlySet<DocCategory> = new Set([
  "medical",
  "training",
]);

/** The portal-wide two-year renewal cadence for expiring documents. */
export const DEFAULT_EXPIRING_RENEWAL_MONTHS = 24;

/** True for medical / training documents (the families that expire). */
export function isExpiringCategory(category: DocCategory | string): boolean {
  return EXPIRING_CATEGORIES.has(category as DocCategory);
}

/**
 * Suggested default renewal cadence (months) for a freshly-created document
 * type of the given category: 24 for medical/training, 0 (non-expiring) for
 * general/other. Admins can still override per type.
 */
export function defaultRenewalMonthsForCategory(
  category: DocCategory | string
): number {
  return isExpiringCategory(category) ? DEFAULT_EXPIRING_RENEWAL_MONTHS : 0;
}

/** Plain-English label for a document category. */
export function categoryLabel(category: DocCategory | string): string {
  switch (category) {
    case "medical":
      return "Medical form";
    case "training":
      return "Training certification";
    case "other":
      return "Other";
    case "general":
    default:
      return "General";
  }
}
