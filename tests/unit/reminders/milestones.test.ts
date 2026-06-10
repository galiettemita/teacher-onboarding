import { describe, expect, it } from "vitest";
import {
  expiringMilestoneForToday,
  isExpiredToday,
  recurringBucketDate,
  missingRequiredBucketDate,
  rejectedReplaceBucketDate,
  utcDaysBetween,
  startOfUtcDay,
  daysOverdue,
} from "@/lib/reminders/milestones";

const utc = (s: string) => new Date(s + "T12:00:00Z"); // mid-day to make sure we don't lean on hour-of-day

describe("utcDaysBetween / startOfUtcDay", () => {
  it("is timezone-of-day insensitive", () => {
    const a = new Date("2026-06-01T00:00:00Z");
    const b = new Date("2026-06-01T23:59:59Z");
    expect(utcDaysBetween(a, b)).toBe(0);
  });

  it("counts whole days, positive when target is in the future", () => {
    expect(utcDaysBetween(utc("2026-06-01"), utc("2026-06-08"))).toBe(7);
    expect(utcDaysBetween(utc("2026-06-08"), utc("2026-06-01"))).toBe(-7);
  });

  it("startOfUtcDay drops the time", () => {
    expect(startOfUtcDay(utc("2026-06-15")).toISOString()).toBe(
      "2026-06-15T00:00:00.000Z"
    );
  });
});

describe("expiringMilestoneForToday", () => {
  it("fires on 90/60/30/14/7 day boundaries", () => {
    const now = utc("2026-06-01");
    for (const [d, expected] of [
      [90, 90],
      [60, 60],
      [30, 30],
      [14, 14],
      [7, 7],
    ] as const) {
      const exp = new Date(now.getTime() + d * 86_400_000);
      expect(expiringMilestoneForToday(exp, now)).toBe(expected);
    }
  });

  it("does not fire on non-milestone days", () => {
    const now = utc("2026-06-01");
    for (const d of [89, 88, 61, 59, 31, 29, 15, 13, 8, 6, 1]) {
      const exp = new Date(now.getTime() + d * 86_400_000);
      expect(expiringMilestoneForToday(exp, now)).toBeNull();
    }
  });

  it("does not fire when expired (days <= 0)", () => {
    const now = utc("2026-06-01");
    expect(
      expiringMilestoneForToday(utc("2026-06-01"), now)
    ).toBeNull();
    expect(
      expiringMilestoneForToday(utc("2026-05-31"), now)
    ).toBeNull();
  });

  it("respects the admin-configured list — only canonical-and-configured milestones fire", () => {
    const now = utc("2026-06-01");
    const at30 = new Date(now.getTime() + 30 * 86_400_000);
    // 30 not configured → no fire
    expect(expiringMilestoneForToday(at30, now, [90, 60, 14, 7])).toBeNull();
    // 30 configured → fires
    expect(expiringMilestoneForToday(at30, now, [30])).toBe(30);
  });
});

describe("isExpiredToday", () => {
  it("true on the exact day, false otherwise", () => {
    const now = utc("2026-06-15");
    expect(isExpiredToday(utc("2026-06-15"), now)).toBe(true);
    expect(isExpiredToday(utc("2026-06-14"), now)).toBe(false);
    expect(isExpiredToday(utc("2026-06-16"), now)).toBe(false);
  });
});

describe("recurringBucketDate", () => {
  it("returns a bucket on every interval multiple after expiration", () => {
    const expiresAt = utc("2026-06-01");
    for (const d of [7, 14, 21, 28]) {
      const now = new Date(expiresAt.getTime() + d * 86_400_000);
      const bucket = recurringBucketDate(expiresAt, now, 7);
      expect(bucket).not.toBeNull();
      expect(bucket!.toISOString().startsWith(now.toISOString().slice(0, 10))).toBe(
        true
      );
    }
  });

  it("returns null on non-cadence days", () => {
    const expiresAt = utc("2026-06-01");
    for (const d of [1, 2, 3, 4, 5, 6, 8, 13, 15]) {
      const now = new Date(expiresAt.getTime() + d * 86_400_000);
      expect(recurringBucketDate(expiresAt, now, 7)).toBeNull();
    }
  });

  it("returns null when not expired (days <= 0)", () => {
    const expiresAt = utc("2026-06-15");
    expect(recurringBucketDate(expiresAt, utc("2026-06-01"), 7)).toBeNull();
    expect(recurringBucketDate(expiresAt, utc("2026-06-15"), 7)).toBeNull();
  });

  it("returns null when intervalDays <= 0", () => {
    expect(
      recurringBucketDate(utc("2026-06-01"), utc("2026-06-08"), 0)
    ).toBeNull();
    expect(
      recurringBucketDate(utc("2026-06-01"), utc("2026-06-08"), -1)
    ).toBeNull();
  });
});

describe("missingRequiredBucketDate", () => {
  it("fires on day 0 (the day the user was created)", () => {
    const created = utc("2026-06-01");
    expect(missingRequiredBucketDate(created, utc("2026-06-01"), 14)).not.toBeNull();
  });

  it("fires every interval days afterwards", () => {
    const created = utc("2026-06-01");
    expect(missingRequiredBucketDate(created, utc("2026-06-15"), 14)).not.toBeNull();
    expect(missingRequiredBucketDate(created, utc("2026-06-29"), 14)).not.toBeNull();
  });

  it("does not fire off cadence", () => {
    const created = utc("2026-06-01");
    expect(missingRequiredBucketDate(created, utc("2026-06-02"), 14)).toBeNull();
    expect(missingRequiredBucketDate(created, utc("2026-06-14"), 14)).toBeNull();
  });
});

describe("rejectedReplaceBucketDate", () => {
  it("fires on day 0 (the day of rejection)", () => {
    expect(
      rejectedReplaceBucketDate(utc("2026-06-01"), utc("2026-06-01"), 7)
    ).not.toBeNull();
  });

  it("fires every interval after rejection", () => {
    expect(
      rejectedReplaceBucketDate(utc("2026-06-01"), utc("2026-06-08"), 7)
    ).not.toBeNull();
    expect(
      rejectedReplaceBucketDate(utc("2026-06-01"), utc("2026-06-15"), 7)
    ).not.toBeNull();
  });

  it("does not fire off cadence", () => {
    expect(
      rejectedReplaceBucketDate(utc("2026-06-01"), utc("2026-06-02"), 7)
    ).toBeNull();
  });
});

describe("daysOverdue", () => {
  it("is positive after expiration", () => {
    expect(daysOverdue(utc("2026-06-01"), utc("2026-06-08"))).toBe(7);
    expect(daysOverdue(utc("2026-06-01"), utc("2026-06-15"))).toBe(14);
  });

  it("clamps to >= 1 for the body text (caller shouldn't ask if not overdue)", () => {
    expect(daysOverdue(utc("2026-06-01"), utc("2026-06-01"))).toBe(1);
  });
});
