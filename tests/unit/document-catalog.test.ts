import { describe, expect, it } from "vitest";
import {
  REQUIRED_DOCUMENT_TYPES,
  REQUIRED_DOCUMENT_TYPE_NAMES,
} from "@/lib/db/document-catalog";
import { isDocTypeApplicable } from "@/lib/staff/status";

/**
 * Pins the five-form catalog to the staff-status visibility + completion rules:
 *
 *   New staff (new_first_year, in their first year) → all 5 forms.
 *   Current staff (returning)                       → only the 3 all-staff forms.
 *
 * Pure: exercises the canonical catalog through `isDocTypeApplicable`, the same
 * function the teacher dashboard and admin completion calc both use.
 */

const NOW = new Date("2026-06-15T00:00:00Z");

// A genuinely new hire: first year started ~5 months ago, still in-window.
const newStaff = {
  staffStatus: "new_first_year" as const,
  firstYearStartDate: "2026-01-15",
  hireDate: "2026-01-15",
};

const currentStaff = {
  staffStatus: "returning" as const,
  firstYearStartDate: null,
  hireDate: null,
};

const ALL_STAFF_FORMS = [
  "Medical Form",
  "Foundation in Health and Safety E-learning Certificate of Completion",
  "Mandated child abuse certificate of completion",
];
const NEW_STAFF_ONLY_FORMS = [
  "Fingerprinting receipt",
  "High school Diploma/ College Degree",
];

function applicableNames(profile: {
  staffStatus: "new_first_year" | "returning";
  firstYearStartDate: string | null;
  hireDate: string | null;
}): string[] {
  return REQUIRED_DOCUMENT_TYPES.filter((dt) =>
    isDocTypeApplicable(dt, profile, NOW)
  ).map((dt) => dt.name);
}

describe("required document catalog (the five forms)", () => {
  it("contains exactly five required forms", () => {
    expect(REQUIRED_DOCUMENT_TYPES).toHaveLength(5);
    expect(REQUIRED_DOCUMENT_TYPES.every((d) => d.required)).toBe(true);
    expect(REQUIRED_DOCUMENT_TYPE_NAMES).toEqual([
      ...ALL_STAFF_FORMS,
      ...NEW_STAFF_ONLY_FORMS,
    ]);
  });

  it("classifies the 3 all-staff forms and 2 new-staff-only forms correctly", () => {
    const allStaff = REQUIRED_DOCUMENT_TYPES.filter(
      (d) => d.applicability === "all_staff"
    ).map((d) => d.name);
    const newOnly = REQUIRED_DOCUMENT_TYPES.filter(
      (d) => d.applicability === "new_first_year_only"
    ).map((d) => d.name);
    expect(allStaff.sort()).toEqual([...ALL_STAFF_FORMS].sort());
    expect(newOnly.sort()).toEqual([...NEW_STAFF_ONLY_FORMS].sort());
  });

  it("fingerprinting + diploma never expire; medical + certificates renew", () => {
    const byName = new Map(REQUIRED_DOCUMENT_TYPES.map((d) => [d.name, d]));
    expect(byName.get("Fingerprinting receipt")!.renewalMonths).toBe(0);
    expect(byName.get("High school Diploma/ College Degree")!.renewalMonths).toBe(0);
    for (const name of ALL_STAFF_FORMS) {
      expect(byName.get(name)!.renewalMonths).toBe(24);
    }
  });
});

describe("staff-status visibility", () => {
  it("NEW staff are asked for all five forms", () => {
    const names = applicableNames(newStaff);
    expect(names).toHaveLength(5);
    expect(names.sort()).toEqual(
      [...ALL_STAFF_FORMS, ...NEW_STAFF_ONLY_FORMS].sort()
    );
  });

  it("CURRENT staff are asked for only the three all-staff forms", () => {
    const names = applicableNames(currentStaff);
    expect(names.sort()).toEqual([...ALL_STAFF_FORMS].sort());
    // and never the new-staff-only forms
    for (const f of NEW_STAFF_ONLY_FORMS) {
      expect(names).not.toContain(f);
    }
  });
});

describe("completion is computed against the applicable subset", () => {
  // Mirrors lib/db/queries/admin-teachers.ts: totalRequired = applicable
  // required types; a teacher is complete when all of those are approved.
  function completion(
    profile: Parameters<typeof applicableNames>[0],
    approvedNames: string[]
  ): { approved: number; total: number; complete: boolean } {
    const applicable = applicableNames(profile);
    const total = applicable.length;
    const approved = applicable.filter((n) => approvedNames.includes(n)).length;
    return { approved, total, complete: total > 0 && approved === total };
  }

  it("a CURRENT staff member is complete with just the 3 all-staff forms", () => {
    const c = completion(currentStaff, ALL_STAFF_FORMS);
    expect(c).toEqual({ approved: 3, total: 3, complete: true });
  });

  it("a CURRENT staff member is NOT penalized for missing new-staff-only forms", () => {
    // They have none of the new-only forms — still complete on their 3.
    const c = completion(currentStaff, ALL_STAFF_FORMS);
    expect(c.complete).toBe(true);
  });

  it("a NEW staff member is incomplete until all five are approved", () => {
    const partial = completion(newStaff, [...ALL_STAFF_FORMS, "Fingerprinting receipt"]);
    expect(partial).toEqual({ approved: 4, total: 5, complete: false });

    const full = completion(newStaff, [...ALL_STAFF_FORMS, ...NEW_STAFF_ONLY_FORMS]);
    expect(full).toEqual({ approved: 5, total: 5, complete: true });
  });
});
