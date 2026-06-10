import { describe, expect, it } from "vitest";
import {
  keyExpiredRecurring,
  keyExpiredToday,
  keyExpiring,
  keyMissingRequired,
  keyPendingAdminAlert,
  keyRejectedReplace,
  toYMD,
} from "@/lib/reminders/keys";

/**
 * §11.4 rule 1 verbatim formats. These strings end up in the UNIQUE
 * `(teacher_id, milestone_key)` index — getting the format wrong here
 * is how duplicate emails ship to production.
 */

const DOC = "00000000-0000-0000-0000-000000000abc";
const USER = "11111111-1111-1111-1111-111111111111";
const DT = "22222222-2222-2222-2222-222222222222";

describe("milestone key formats — match §11.4 rule 1 exactly", () => {
  it("expiring_{N}:{teacher_document_id}", () => {
    expect(keyExpiring(90, DOC)).toBe(`expiring_90:${DOC}`);
    expect(keyExpiring(60, DOC)).toBe(`expiring_60:${DOC}`);
    expect(keyExpiring(30, DOC)).toBe(`expiring_30:${DOC}`);
    expect(keyExpiring(14, DOC)).toBe(`expiring_14:${DOC}`);
    expect(keyExpiring(7, DOC)).toBe(`expiring_7:${DOC}`);
  });

  it("expired_today:{teacher_document_id}", () => {
    expect(keyExpiredToday(DOC)).toBe(`expired_today:${DOC}`);
  });

  it("expired_recurring:{teacher_document_id}:{YYYY-MM-DD}", () => {
    const d = new Date("2026-06-15T12:34:56Z");
    expect(keyExpiredRecurring(DOC, d)).toBe(`expired_recurring:${DOC}:2026-06-15`);
  });

  it("missing_required:{user_id}:{document_type_id}:{YYYY-MM-DD}", () => {
    const d = new Date("2026-06-15T00:00:00Z");
    expect(keyMissingRequired(USER, DT, d)).toBe(
      `missing_required:${USER}:${DT}:2026-06-15`
    );
  });

  it("rejected_replace:{teacher_document_id}:{YYYY-MM-DD}", () => {
    const d = new Date("2026-06-15T23:59:59Z");
    expect(keyRejectedReplace(DOC, d)).toBe(`rejected_replace:${DOC}:2026-06-15`);
  });

  it("pending_admin_alert:{teacher_document_id}", () => {
    expect(keyPendingAdminAlert(DOC)).toBe(`pending_admin_alert:${DOC}`);
  });
});

describe("toYMD — UTC", () => {
  it("renders YYYY-MM-DD with zero padding", () => {
    expect(toYMD(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01-05");
    expect(toYMD(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-31");
  });

  it("uses UTC, not local TZ", () => {
    // A local-time interpretation in UTC-12 would give 2025-12-31,
    // in UTC+14 it would give 2026-01-02. We want 2026-01-01 always.
    expect(toYMD(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
  });
});

describe("milestone key reuse — same teacher + same milestone produces same key", () => {
  it("rerunning the cron produces identical keys for the same conditions", () => {
    const k1 = keyExpiring(30, DOC);
    const k2 = keyExpiring(30, DOC);
    expect(k1).toBe(k2);
  });

  it("different documents produce different keys (no cross-doc collisions)", () => {
    expect(keyExpiring(30, "a")).not.toBe(keyExpiring(30, "b"));
  });

  it("different milestones for the same doc produce different keys", () => {
    expect(keyExpiring(30, DOC)).not.toBe(keyExpiring(60, DOC));
  });

  it("recurring keys are stable within a cadence bucket and change across buckets", () => {
    const bucket1 = new Date("2026-06-08T00:00:00Z");
    const bucket2 = new Date("2026-06-15T00:00:00Z");
    expect(keyExpiredRecurring(DOC, bucket1)).toBe(
      keyExpiredRecurring(DOC, bucket1)
    );
    expect(keyExpiredRecurring(DOC, bucket1)).not.toBe(
      keyExpiredRecurring(DOC, bucket2)
    );
  });
});
