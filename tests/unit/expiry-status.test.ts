import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deriveUiStatus,
  isExpiringSoon,
  getExpiringSoonWindowDays,
} from "@/lib/expiry/status";
import type { TeacherDocument } from "@/lib/db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2025-06-15T12:00:00Z");

function approved(
  expiresInDays: number | null
): Pick<TeacherDocument, "status" | "expiresAt"> {
  return {
    status: "approved",
    expiresAt: expiresInDays === null ? null : new Date(NOW.getTime() + expiresInDays * DAY_MS),
  };
}

describe("deriveUiStatus", () => {
  it("returns missing for null", () => {
    expect(deriveUiStatus(null, { now: NOW })).toBe("missing");
  });

  it("pending → pending (regardless of expiresAt)", () => {
    expect(
      deriveUiStatus({ status: "pending", expiresAt: null }, { now: NOW })
    ).toBe("pending");
  });

  it("rejected → rejected (always)", () => {
    expect(
      deriveUiStatus(
        { status: "rejected", expiresAt: new Date(NOW.getTime() + 365 * DAY_MS) },
        { now: NOW }
      )
    ).toBe("rejected");
  });

  it("status='expired' → expired (always)", () => {
    expect(
      deriveUiStatus(
        { status: "expired", expiresAt: new Date(NOW.getTime() + 99 * DAY_MS) },
        { now: NOW }
      )
    ).toBe("expired");
  });

  it("approved with no expiresAt → approved", () => {
    expect(deriveUiStatus(approved(null), { now: NOW })).toBe("approved");
  });

  it("approved, expires in 100d → approved (outside the 90-day window)", () => {
    expect(deriveUiStatus(approved(100), { now: NOW })).toBe("approved");
  });

  it("approved, expires in 91d → approved (boundary just outside)", () => {
    expect(deriveUiStatus(approved(91), { now: NOW })).toBe("approved");
  });

  it("approved, expires in 90d → expiring_soon (three-month boundary on the window)", () => {
    expect(deriveUiStatus(approved(90), { now: NOW })).toBe("expiring_soon");
  });

  it("approved, expires in 60d → expiring_soon (inside the 3-month window)", () => {
    expect(deriveUiStatus(approved(60), { now: NOW })).toBe("expiring_soon");
  });

  it("approved, expires in 29d → expiring_soon (inside window)", () => {
    expect(deriveUiStatus(approved(29), { now: NOW })).toBe("expiring_soon");
  });

  it("approved, expires in 1d → expiring_soon", () => {
    expect(deriveUiStatus(approved(1), { now: NOW })).toBe("expiring_soon");
  });

  it("approved, expired 1d ago → expired (safety net for cron)", () => {
    expect(deriveUiStatus(approved(-1), { now: NOW })).toBe("expired");
  });

  it("approved, expires exactly at now → expired (window is strict >)", () => {
    expect(
      deriveUiStatus({ status: "approved", expiresAt: NOW }, { now: NOW })
    ).toBe("expired");
  });

  it("respects windowDays override (window=7 → 8d outside)", () => {
    expect(deriveUiStatus(approved(8), { now: NOW, windowDays: 7 })).toBe(
      "approved"
    );
    expect(deriveUiStatus(approved(7), { now: NOW, windowDays: 7 })).toBe(
      "expiring_soon"
    );
  });
});

describe("isExpiringSoon", () => {
  it("false for null", () => {
    expect(isExpiringSoon(null, { now: NOW })).toBe(false);
  });
  it("false for non-approved", () => {
    expect(isExpiringSoon({ status: "pending", expiresAt: null }, { now: NOW })).toBe(false);
  });
  it("false for approved with no expiresAt", () => {
    expect(isExpiringSoon(approved(null), { now: NOW })).toBe(false);
  });
  it("day-90 true, day-91 false (the contracted three-month boundary)", () => {
    expect(isExpiringSoon(approved(90), { now: NOW })).toBe(true);
    expect(isExpiringSoon(approved(91), { now: NOW })).toBe(false);
  });
  it("false for past-expiry approved (handled separately by deriveUiStatus)", () => {
    expect(isExpiringSoon(approved(-1), { now: NOW })).toBe(false);
  });
});

describe("getExpiringSoonWindowDays", () => {
  const orig = process.env.EXPIRING_SOON_WINDOW_DAYS;
  beforeEach(() => {
    delete process.env.EXPIRING_SOON_WINDOW_DAYS;
  });
  afterEach(() => {
    if (orig === undefined) delete process.env.EXPIRING_SOON_WINDOW_DAYS;
    else process.env.EXPIRING_SOON_WINDOW_DAYS = orig;
  });

  it("defaults to 90 (three months)", () => {
    expect(getExpiringSoonWindowDays()).toBe(90);
  });
  it("explicit opt wins over env", () => {
    process.env.EXPIRING_SOON_WINDOW_DAYS = "60";
    expect(getExpiringSoonWindowDays({ windowDays: 7 })).toBe(7);
  });
  it("env override accepted when positive int", () => {
    process.env.EXPIRING_SOON_WINDOW_DAYS = "14";
    expect(getExpiringSoonWindowDays()).toBe(14);
  });
  it("env garbage falls back to default", () => {
    process.env.EXPIRING_SOON_WINDOW_DAYS = "garbage";
    expect(getExpiringSoonWindowDays()).toBe(90);
  });
  it("env zero / negative falls back to default", () => {
    process.env.EXPIRING_SOON_WINDOW_DAYS = "0";
    expect(getExpiringSoonWindowDays()).toBe(90);
    process.env.EXPIRING_SOON_WINDOW_DAYS = "-5";
    expect(getExpiringSoonWindowDays()).toBe(90);
  });
});
