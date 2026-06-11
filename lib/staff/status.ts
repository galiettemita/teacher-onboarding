import type {
  DocApplicability,
  DocumentType,
  StaffStatus,
  TeacherProfile,
} from "@/lib/db/schema";

/**
 * Staff-status + first-year document applicability logic.
 *
 * Pure functions only — no DB, no clock side-effects (callers pass `now`).
 * This is the single source of truth for "is this teacher currently in their
 * first year?" and "does this document type apply to this teacher?" so the
 * teacher checklist and the admin completion calculation can never drift.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type ProfileLike = {
  staffStatus: TeacherProfile["staffStatus"];
  // `date` columns are 'YYYY-MM-DD' strings at runtime; allow Date for tests.
  firstYearStartDate: string | Date | null;
  hireDate: string | Date | null;
};

/**
 * The date the first year is anchored on. Prefer the explicit
 * `first_year_start_date`; fall back to `hire_date`. Returns `null` when
 * neither is set (the caller decides what that means per status).
 *
 * `date` columns come back as 'YYYY-MM-DD' strings from the driver; we parse
 * them as UTC midnight so the math is DST-proof.
 */
export function firstYearAnchor(profile: ProfileLike): Date | null {
  const raw: string | Date | null =
    profile.firstYearStartDate ?? profile.hireDate;
  if (!raw) return null;
  // `date` columns come back as 'YYYY-MM-DD' strings; tests may pass a Date.
  const d =
    typeof raw === "string"
      ? new Date(`${raw}T00:00:00Z`)
      : new Date(raw.getTime());
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The instant the first year ends (anchor + 1 year), or `null` if there's no
 * anchor date to compute from.
 */
export function firstYearEndsAt(profile: ProfileLike): Date | null {
  const anchor = firstYearAnchor(profile);
  if (!anchor) return null;
  return new Date(
    Date.UTC(
      anchor.getUTCFullYear() + 1,
      anchor.getUTCMonth(),
      anchor.getUTCDate(),
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds()
    )
  );
}

/**
 * True iff the teacher is *currently* first-year staff:
 *   staff_status === 'new_first_year' AND today is before (anchor + 1 year).
 *
 * If marked new_first_year but with no anchor date, we treat them as currently
 * first-year (they were explicitly flagged new — show the first-year docs).
 * Returning staff are never first-year.
 */
export function isCurrentlyFirstYearStaff(
  profile: ProfileLike,
  now: Date = new Date()
): boolean {
  if ((profile.staffStatus as StaffStatus) !== "new_first_year") return false;
  const endsAt = firstYearEndsAt(profile);
  if (!endsAt) return true; // flagged new, no date → assume still in first year
  return now.getTime() < endsAt.getTime();
}

/**
 * Whole days remaining in the first year (>= 0), or `null` if not currently
 * first-year staff or no anchor date. Used for friendly admin/teacher copy.
 */
export function daysLeftInFirstYear(
  profile: ProfileLike,
  now: Date = new Date()
): number | null {
  if (!isCurrentlyFirstYearStaff(profile, now)) return null;
  const endsAt = firstYearEndsAt(profile);
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / MS_PER_DAY));
}

/**
 * Does `docType` apply to this teacher right now?
 *
 *   all_staff            → always.
 *   new_first_year_only  → only while currently first-year staff.
 *   returning_staff_only → only when NOT currently first-year staff
 *                          (returning staff, or new staff whose first year ended).
 *
 * Unknown/garbage applicability defaults to applicable (fail-safe: better to
 * show a doc than to silently drop a requirement).
 */
export function isDocTypeApplicable(
  docType: Pick<DocumentType, "applicability">,
  profile: ProfileLike,
  now: Date = new Date()
): boolean {
  const applicability = docType.applicability as DocApplicability;
  switch (applicability) {
    case "new_first_year_only":
      return isCurrentlyFirstYearStaff(profile, now);
    case "returning_staff_only":
      return !isCurrentlyFirstYearStaff(profile, now);
    case "all_staff":
    default:
      return true;
  }
}

/** Plain-English label for a staff status (grandma-friendly). */
export function staffStatusLabel(status: StaffStatus | string): string {
  return status === "new_first_year" ? "New first-year staff" : "Returning staff";
}

/** Plain-English label for a document's applicability. */
export function applicabilityLabel(applicability: DocApplicability | string): string {
  switch (applicability) {
    case "new_first_year_only":
      return "Only required during first year";
    case "returning_staff_only":
      return "Only required for returning staff";
    case "all_staff":
    default:
      return "Applies to all staff";
  }
}
