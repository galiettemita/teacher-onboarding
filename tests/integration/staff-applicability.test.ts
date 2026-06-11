import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verifies that staff status drives which document types a teacher is asked for
 * (teacher dashboard) and how admin completion is computed. The db client is
 * mocked: each `select()` call shifts the next pre-loaded result set off a queue,
 * mirroring the existing approve-sets-expiry test style.
 */

type Row = Record<string, unknown>;
const selectQueue: Row[][] = [];

vi.mock("@/lib/db/client", () => {
  const select = vi.fn(() => {
    const rows = selectQueue.shift() ?? [];
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (v: Row[]) => unknown) => resolve(rows),
    };
    return chain;
  });
  return { db: { select } };
});

const teacher = { id: "u-teacher", email: "t@x.com", name: "T", role: "teacher" as const };
const admin = { role: "admin" as const };

// Active doc types: one all_staff required, one first-year-only required.
const allStaffType = {
  id: "dt-all",
  name: "Background Check",
  applicability: "all_staff",
  required: true,
  active: true,
  category: "general",
  renewalMonths: 24,
};
const firstYearType = {
  id: "dt-fy",
  name: "New Hire Orientation",
  applicability: "new_first_year_only",
  required: true,
  active: true,
  category: "general",
  renewalMonths: 0,
};

beforeEach(() => {
  selectQueue.length = 0;
});
afterEach(() => vi.clearAllMocks());

describe("teacher dashboard applicability (listMyDocumentTypesWithStatus)", () => {
  it("new first-year staff SEE first-year-only docs (tests 1, 4)", async () => {
    const { listMyDocumentTypesWithStatus } = await import(
      "@/lib/db/queries/teacher-documents"
    );
    selectQueue.push([allStaffType, firstYearType]); // documentTypes
    selectQueue.push([
      { userId: teacher.id, staffStatus: "new_first_year", firstYearStartDate: "2026-03-01", hireDate: null },
    ]); // profile
    selectQueue.push([]); // teacher docs (none uploaded)

    const out = await listMyDocumentTypesWithStatus(teacher);
    const names = out.map((e) => e.documentType.name).sort();
    expect(names).toEqual(["Background Check", "New Hire Orientation"]);
  });

  it("returning staff do NOT see first-year-only docs (test 2)", async () => {
    const { listMyDocumentTypesWithStatus } = await import(
      "@/lib/db/queries/teacher-documents"
    );
    selectQueue.push([allStaffType, firstYearType]);
    selectQueue.push([
      { userId: teacher.id, staffStatus: "returning", firstYearStartDate: null, hireDate: null },
    ]);
    selectQueue.push([]);

    const out = await listMyDocumentTypesWithStatus(teacher);
    const names = out.map((e) => e.documentType.name);
    expect(names).toEqual(["Background Check"]);
    expect(names).not.toContain("New Hire Orientation");
  });

  it("new staff whose first year has ended no longer see first-year-only docs (test 3)", async () => {
    const { listMyDocumentTypesWithStatus } = await import(
      "@/lib/db/queries/teacher-documents"
    );
    selectQueue.push([allStaffType, firstYearType]);
    selectQueue.push([
      { userId: teacher.id, staffStatus: "new_first_year", firstYearStartDate: "2020-01-01", hireDate: null },
    ]);
    selectQueue.push([]);

    const out = await listMyDocumentTypesWithStatus(teacher);
    expect(out.map((e) => e.documentType.name)).toEqual(["Background Check"]);
  });

  it("history query returns every upload regardless of applicability (test 5)", async () => {
    const { listMyDocuments } = await import("@/lib/db/queries/teacher-documents");
    // A historical upload for a now-non-applicable first-year-only type.
    selectQueue.push([
      { id: "doc-old", userId: teacher.id, documentTypeId: "dt-fy", status: "approved" },
    ]);
    const out = await listMyDocuments(teacher);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("doc-old");
  });
});

describe("admin completion uses the per-teacher applicable required set", () => {
  it("returning staff missing a first-year-only doc are NOT incomplete (tests 11, 12)", async () => {
    const { listAllTeachers } = await import("@/lib/db/queries/admin-teachers");
    const profile = {
      userId: teacher.id,
      staffStatus: "returning",
      firstYearStartDate: null,
      hireDate: null,
    };
    selectQueue.push([allStaffType, firstYearType]); // required types
    selectQueue.push([{ user: { ...teacher }, profile }]); // users+profiles
    selectQueue.push([
      // teacher has approved the all_staff doc, never uploaded the first-year one
      { userId: teacher.id, documentTypeId: "dt-all", status: "approved", supersededBy: null, uploadedAt: new Date() },
    ]); // docs

    const out = await listAllTeachers(admin, {});
    expect(out).toHaveLength(1);
    // Only the all_staff doc is required for returning staff → 1/1 = 100%.
    expect(out[0].completion).toMatchObject({
      approvedRequired: 1,
      totalRequired: 1,
      pct: 100,
    });
  });

  it("new first-year staff missing a first-year-only doc ARE incomplete", async () => {
    const { listAllTeachers } = await import("@/lib/db/queries/admin-teachers");
    const profile = {
      userId: teacher.id,
      staffStatus: "new_first_year",
      firstYearStartDate: "2026-03-01",
      hireDate: null,
    };
    selectQueue.push([allStaffType, firstYearType]);
    selectQueue.push([{ user: { ...teacher }, profile }]);
    selectQueue.push([
      { userId: teacher.id, documentTypeId: "dt-all", status: "approved", supersededBy: null, uploadedAt: new Date() },
    ]);

    const out = await listAllTeachers(admin, {});
    expect(out[0].completion).toMatchObject({
      approvedRequired: 1,
      totalRequired: 2,
      pct: 50,
    });
  });
});
