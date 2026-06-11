import { describe, expect, it } from "vitest";
import {
  isCurrentlyFirstYearStaff,
  isDocTypeApplicable,
  firstYearEndsAt,
  daysLeftInFirstYear,
} from "@/lib/staff/status";

const NOW = new Date("2026-06-11T12:00:00Z");

function profile(over: Partial<Parameters<typeof isCurrentlyFirstYearStaff>[0]> = {}) {
  return {
    staffStatus: "returning" as const,
    firstYearStartDate: null,
    hireDate: null,
    ...over,
  };
}

const allStaff = { applicability: "all_staff" as const };
const firstYearOnly = { applicability: "new_first_year_only" as const };
const returningOnly = { applicability: "returning_staff_only" as const };

describe("isCurrentlyFirstYearStaff", () => {
  it("returning staff are never first-year", () => {
    expect(
      isCurrentlyFirstYearStaff(
        profile({ staffStatus: "returning", hireDate: "2026-01-01" }),
        NOW
      )
    ).toBe(false);
  });

  it("new staff hired 3 months ago are currently first-year", () => {
    expect(
      isCurrentlyFirstYearStaff(
        profile({ staffStatus: "new_first_year", firstYearStartDate: "2026-03-01" }),
        NOW
      )
    ).toBe(true);
  });

  it("new staff whose first year ended are no longer first-year", () => {
    // started 2024-01-01 → first year ended 2025-01-01, before NOW (2026)
    expect(
      isCurrentlyFirstYearStaff(
        profile({ staffStatus: "new_first_year", firstYearStartDate: "2024-01-01" }),
        NOW
      )
    ).toBe(false);
  });

  it("falls back to hire_date when first_year_start_date is null", () => {
    expect(
      isCurrentlyFirstYearStaff(
        profile({ staffStatus: "new_first_year", hireDate: "2026-03-01" }),
        NOW
      )
    ).toBe(true);
  });

  it("new staff with no date at all are treated as currently first-year", () => {
    expect(
      isCurrentlyFirstYearStaff(profile({ staffStatus: "new_first_year" }), NOW)
    ).toBe(true);
  });

  it("the window boundary: exactly one year is no longer first-year", () => {
    expect(
      isCurrentlyFirstYearStaff(
        profile({ staffStatus: "new_first_year", firstYearStartDate: "2025-06-11" }),
        NOW
      )
    ).toBe(false);
  });

  it("firstYearEndsAt is anchor + exactly one year (UTC)", () => {
    const ends = firstYearEndsAt(
      profile({ staffStatus: "new_first_year", firstYearStartDate: "2026-03-01" })
    );
    expect(ends?.toISOString()).toBe("2027-03-01T00:00:00.000Z");
  });

  it("daysLeftInFirstYear is null for returning staff", () => {
    expect(daysLeftInFirstYear(profile({ staffStatus: "returning" }), NOW)).toBeNull();
  });
});

describe("isDocTypeApplicable", () => {
  const newStaff = profile({
    staffStatus: "new_first_year",
    firstYearStartDate: "2026-03-01",
  });
  const newStaffEnded = profile({
    staffStatus: "new_first_year",
    firstYearStartDate: "2024-01-01",
  });
  const returning = profile({ staffStatus: "returning" });

  it("all_staff applies to everyone (test 4)", () => {
    expect(isDocTypeApplicable(allStaff, newStaff, NOW)).toBe(true);
    expect(isDocTypeApplicable(allStaff, returning, NOW)).toBe(true);
    expect(isDocTypeApplicable(allStaff, newStaffEnded, NOW)).toBe(true);
  });

  it("new first-year staff see first-year-only docs (test 1)", () => {
    expect(isDocTypeApplicable(firstYearOnly, newStaff, NOW)).toBe(true);
  });

  it("returning staff do NOT see first-year-only docs (test 2)", () => {
    expect(isDocTypeApplicable(firstYearOnly, returning, NOW)).toBe(false);
  });

  it("new staff after the first-year window no longer require first-year-only docs (test 3)", () => {
    expect(isDocTypeApplicable(firstYearOnly, newStaffEnded, NOW)).toBe(false);
  });

  it("returning_staff_only applies to returning staff and post-first-year staff", () => {
    expect(isDocTypeApplicable(returningOnly, returning, NOW)).toBe(true);
    expect(isDocTypeApplicable(returningOnly, newStaffEnded, NOW)).toBe(true);
    expect(isDocTypeApplicable(returningOnly, newStaff, NOW)).toBe(false);
  });
});
