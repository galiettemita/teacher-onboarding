import type { DocumentType, TeacherDocument } from "@/lib/db/schema";

/**
 * Compute `expires_at` for a freshly-approved document.
 *
 * Rule: `expires_at = reviewed_at + docType.renewal_months months`.
 *
 * - Pure function. No DB, no clock side-effects.
 * - Uses UTC month arithmetic to dodge DST edges (everything in our schema
 *   is `timestamp with time zone`).
 * - Month overflow follows JS `Date.UTC` rounding behaviour: e.g. Jan 31 +
 *   1 month becomes Mar 3 (Feb has no day 31). Acceptable for renewal
 *   cadence — the next renewal cycle naturally re-anchors on the new
 *   review date.
 *
 * Throws if `docType` is null/undefined: callers must look up the doc type
 * up front. A missing doc type is a programming error, not a runtime
 * condition we want to silently absorb (we'd produce an unbounded expiry).
 */
export function setExpiryOnApproval(
  doc: Pick<TeacherDocument, "reviewedAt">,
  docType: Pick<DocumentType, "renewalMonths"> | null | undefined
): Date {
  if (!docType) {
    throw new Error("setExpiryOnApproval: docType is required");
  }
  const reviewedAt = doc.reviewedAt;
  if (!reviewedAt) {
    throw new Error(
      "setExpiryOnApproval: doc.reviewedAt must be set before computing expiry"
    );
  }
  return addMonthsUTC(reviewedAt, docType.renewalMonths);
}

/**
 * Add `months` to `date`, operating purely in UTC. Day-of-month overflow
 * cascades to the next month (matches JS `Date.UTC` semantics, which is
 * what we want — see comment on `setExpiryOnApproval`).
 */
export function addMonthsUTC(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  return new Date(
    Date.UTC(
      y,
      m + months,
      d,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  );
}
