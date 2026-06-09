import { describe, expect, it } from "vitest";
import { addMonthsUTC, setExpiryOnApproval } from "@/lib/expiry/setExpiry";
import type { DocumentType, TeacherDocument } from "@/lib/db/schema";

function docType(renewalMonths: number): Pick<DocumentType, "renewalMonths"> {
  return { renewalMonths };
}

function approvedDoc(reviewedAt: Date): Pick<TeacherDocument, "reviewedAt"> {
  return { reviewedAt };
}

describe("setExpiryOnApproval", () => {
  it("default 24 months: reviewed 2025-01-15 → 2027-01-15", () => {
    const reviewed = new Date(Date.UTC(2025, 0, 15, 10, 30, 0));
    const expires = setExpiryOnApproval(approvedDoc(reviewed), docType(24));
    expect(expires.toISOString()).toBe("2027-01-15T10:30:00.000Z");
  });

  it("custom 12 months: reviewed 2025-06-01 → 2026-06-01", () => {
    const reviewed = new Date(Date.UTC(2025, 5, 1));
    const expires = setExpiryOnApproval(approvedDoc(reviewed), docType(12));
    expect(expires.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("preserves time-of-day (UTC)", () => {
    const reviewed = new Date(Date.UTC(2025, 2, 10, 14, 22, 33, 444));
    const expires = setExpiryOnApproval(approvedDoc(reviewed), docType(6));
    expect(expires.toISOString()).toBe("2025-09-10T14:22:33.444Z");
  });

  it("leap-year boundary: Feb 29 2024 + 12 months → Mar 1 2025 (no Feb 29)", () => {
    const reviewed = new Date(Date.UTC(2024, 1, 29, 0, 0, 0));
    const expires = setExpiryOnApproval(approvedDoc(reviewed), docType(12));
    // Date.UTC(2025, 1, 29) overflows to Mar 1 2025 — documented behaviour.
    expect(expires.toISOString()).toBe("2025-03-01T00:00:00.000Z");
  });

  it("Jan 31 + 1 month → Mar 3 (overflow into next month documented)", () => {
    // Feb has no day 31, so JS Date.UTC overflows: Jan 31 → "Feb 31" → Mar 3.
    const reviewed = new Date(Date.UTC(2025, 0, 31, 0, 0, 0));
    const expires = setExpiryOnApproval(approvedDoc(reviewed), docType(1));
    expect(expires.toISOString()).toBe("2025-03-03T00:00:00.000Z");
  });

  it("DST is irrelevant in UTC: Mar 9 2025 (US DST start) + 12 months", () => {
    const reviewed = new Date(Date.UTC(2025, 2, 9, 7, 0, 0));
    const expires = setExpiryOnApproval(approvedDoc(reviewed), docType(12));
    expect(expires.toISOString()).toBe("2026-03-09T07:00:00.000Z");
  });

  it("throws when docType is null", () => {
    const reviewed = new Date();
    expect(() =>
      setExpiryOnApproval(approvedDoc(reviewed), null)
    ).toThrow(/docType is required/);
  });

  it("throws when docType is undefined", () => {
    const reviewed = new Date();
    expect(() =>
      setExpiryOnApproval(approvedDoc(reviewed), undefined)
    ).toThrow(/docType is required/);
  });

  it("throws when reviewedAt is missing", () => {
    expect(() =>
      setExpiryOnApproval({ reviewedAt: null }, docType(24))
    ).toThrow(/reviewedAt must be set/);
  });

  it("renewalMonths=0 returns reviewedAt unchanged (caller must guard)", () => {
    // Documented contract: setExpiryOnApproval is pure math. A
    // renewalMonths of 0 produces the same instant — it's the caller's
    // job (approveDocument) to skip the helper and store null instead.
    const reviewed = new Date(Date.UTC(2025, 0, 15, 10, 30, 0));
    const expires = setExpiryOnApproval(approvedDoc(reviewed), docType(0));
    expect(expires.toISOString()).toBe(reviewed.toISOString());
  });
});

describe("addMonthsUTC", () => {
  it("adds zero", () => {
    const d = new Date(Date.UTC(2025, 0, 1));
    expect(addMonthsUTC(d, 0).toISOString()).toBe(d.toISOString());
  });

  it("crosses a year boundary", () => {
    const d = new Date(Date.UTC(2025, 10, 15));
    expect(addMonthsUTC(d, 3).toISOString()).toBe("2026-02-15T00:00:00.000Z");
  });
});
