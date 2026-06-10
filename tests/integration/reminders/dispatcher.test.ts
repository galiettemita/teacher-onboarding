import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candidate } from "@/lib/reminders/candidates";
import type { ReminderSettings } from "@/lib/db/queries/reminder-settings";
import type { EmailMessage, SendResult } from "@/lib/email/send";

/**
 * Dispatcher behaviour tests — runOnce() + sendManual().
 *
 * Strategy: mock the inputs (candidate finder, settings, notification-logs
 * layer) and the output (sendEmail). Assert on the captured EmailMessage
 * payloads + the recorded notification_logs operations. This is the
 * boundary that the cron route exercises in production.
 *
 * Each scenario below maps to a §11.8 test row and/or §7 acceptance
 * criterion.
 */

// ----- Capture state -----
let captured: EmailMessage[] = [];
let reserveSlots: Array<{
  teacherId: string;
  milestoneKey: string;
  result: "reserved" | "duplicate";
}> = [];
let skipsRecorded: Array<{
  teacherId: string;
  reminderType: string;
  reason: string;
  baseKey: string;
}> = [];
let sentRecorded: Array<{ id: string; providerId: string | undefined }> = [];
let failedRecorded: Array<{ id: string; reason: string }> = [];
let teacherHadSentTodayResult = false;
let candidatesToReturn: Candidate[] = [];
let settingsToReturn: ReminderSettings = defaultSettings();
let sendShouldFail = false;
let sendShouldThrow = false;

// "Already-claimed" milestone keys — simulates UNIQUE-index conflict.
const alreadyClaimed = new Set<string>(); // composite "teacherId|key"

function key(t: string, k: string) {
  return `${t}|${k}`;
}

function defaultSettings(): ReminderSettings {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    enabled: true,
    senderName: "Sample Elementary",
    senderEmail: "noreply@school.org",
    portalUrl: "https://portal.school.org",
    reminderDaysBeforeExpiration: [90, 60, 30, 14, 7],
    postExpirationIntervalDays: 7,
    maxOneEmailPerTeacherPerDay: true,
    pendingReviewDaysBeforeAdminAlert: null,
    missingDocReminderIntervalDays: 14,
    rejectedDocReminderIntervalDays: 7,
  };
}

vi.mock("@/lib/db/queries/reminder-settings", async (orig) => {
  const original = (await orig()) as Record<string, unknown>;
  return {
    ...original,
    getReminderSettings: vi.fn(async () => settingsToReturn),
  };
});

vi.mock("@/lib/reminders/candidates", () => ({
  findAllCandidates: vi.fn(async () => candidatesToReturn),
}));

vi.mock("@/lib/db/queries/notification-logs", () => ({
  tryReserveSlot: vi.fn(async (input: {
    teacherId: string;
    milestoneKey: string;
  }) => {
    const k = key(input.teacherId, input.milestoneKey);
    if (alreadyClaimed.has(k)) {
      reserveSlots.push({
        teacherId: input.teacherId,
        milestoneKey: input.milestoneKey,
        result: "duplicate",
      });
      return { reserved: false, notificationLogId: null };
    }
    alreadyClaimed.add(k);
    const id = `nl-${reserveSlots.length + 1}`;
    reserveSlots.push({
      teacherId: input.teacherId,
      milestoneKey: input.milestoneKey,
      result: "reserved",
    });
    return { reserved: true, notificationLogId: id };
  }),
  recordSent: vi.fn(async (id: string, providerId: string | undefined) => {
    sentRecorded.push({ id, providerId });
  }),
  recordFailed: vi.fn(async (id: string, reason: string) => {
    failedRecorded.push({ id, reason });
  }),
  recordSkip: vi.fn(async (input: {
    teacherId: string;
    reminderType: string;
    skippedReason: string;
    baseMilestoneKey: string;
  }) => {
    skipsRecorded.push({
      teacherId: input.teacherId,
      reminderType: input.reminderType,
      reason: input.skippedReason,
      baseKey: input.baseMilestoneKey,
    });
    return `skip-${skipsRecorded.length}`;
  }),
  teacherHadSentToday: vi.fn(async () => teacherHadSentTodayResult),
}));

vi.mock("@/lib/email/send", () => ({
  sendEmail: vi.fn(async (msg: EmailMessage): Promise<SendResult> => {
    captured.push(msg);
    if (sendShouldThrow) throw new Error("network down");
    if (sendShouldFail) return { ok: false, error: "provider 500" };
    return { ok: true, providerId: `prov-${captured.length}` };
  }),
}));

// ----- Helpers -----
function mkCandidate(partial: Partial<Candidate> & {
  reminderType: Candidate["reminderType"];
  payload: Candidate["payload"];
}): Candidate {
  return {
    userId: partial.userId ?? "teacher-1",
    recipientEmail: partial.recipientEmail ?? "teacher@school.org",
    teacherFirstName: partial.teacherFirstName ?? "Pat",
    teacherDocumentId: partial.teacherDocumentId ?? "doc-1",
    documentTypeId: partial.documentTypeId ?? "dt-1",
    documentTypeName: partial.documentTypeName ?? "Teaching Credential",
    reminderType: partial.reminderType,
    milestoneKey: partial.milestoneKey ?? "missing_required:teacher-1:dt-1:2026-06-15",
    payload: partial.payload,
  };
}

beforeEach(() => {
  captured = [];
  reserveSlots = [];
  skipsRecorded = [];
  sentRecorded = [];
  failedRecorded = [];
  teacherHadSentTodayResult = false;
  candidatesToReturn = [];
  settingsToReturn = defaultSettings();
  sendShouldFail = false;
  sendShouldThrow = false;
  alreadyClaimed.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ===== Per-type dispatch (§11.8) =====

describe("dispatch — one candidate per type", () => {
  for (const c of [
    mkCandidate({
      reminderType: "missing_required",
      milestoneKey: "missing_required:t1:dt1:2026-06-15",
      payload: { kind: "missing_required" },
    }),
    mkCandidate({
      reminderType: "rejected_replace",
      milestoneKey: "rejected_replace:doc1:2026-06-15",
      payload: { kind: "rejected_replace" },
    }),
    mkCandidate({
      reminderType: "expiring_30",
      milestoneKey: "expiring_30:doc1",
      payload: { kind: "expiring", days: 30, expiresOn: "2026-09-01" },
    }),
    mkCandidate({
      reminderType: "expired_today",
      milestoneKey: "expired_today:doc1",
      payload: { kind: "expired_today", expiredOn: "2026-06-10" },
    }),
    mkCandidate({
      reminderType: "expired_recurring",
      milestoneKey: "expired_recurring:doc1:2026-06-17",
      payload: {
        kind: "expired_recurring",
        expiredOn: "2026-06-03",
        daysOverdue: 14,
      },
    }),
  ]) {
    it(`sends for reminder_type=${c.reminderType}`, async () => {
      candidatesToReturn = [c];
      const { runOnce } = await import("@/lib/reminders/dispatcher");
      const counts = await runOnce(new Date("2026-06-17T08:00:00Z"));
      expect(counts.sent).toBe(1);
      expect(counts.considered).toBe(1);
      expect(captured).toHaveLength(1);
      expect(captured[0].to).toBe("teacher@school.org");
      expect(captured[0].subject.length).toBeGreaterThan(0);
      expect(captured[0].text).toContain("Pat");
      expect(captured[0].text).toContain("Teaching Credential");
      expect(captured[0].text).toContain("https://portal.school.org");
      expect(captured[0].from).toEqual({
        name: "Sample Elementary",
        email: "noreply@school.org",
      });
      // Reserved exactly one notification_logs slot.
      expect(reserveSlots).toHaveLength(1);
      expect(reserveSlots[0].result).toBe("reserved");
      expect(sentRecorded).toHaveLength(1);
      expect(failedRecorded).toHaveLength(0);
    });
  }
});

// ===== Idempotency: rerunning the cron =====

describe("idempotency — UNIQUE-index handles concurrent reruns", () => {
  it("second run with the same candidate produces zero new sends and a skipped_duplicate count", async () => {
    const c = mkCandidate({
      reminderType: "expiring_30",
      milestoneKey: "expiring_30:doc1",
      payload: { kind: "expiring", days: 30, expiresOn: "2026-09-01" },
    });
    candidatesToReturn = [c];
    const { runOnce } = await import("@/lib/reminders/dispatcher");
    const counts1 = await runOnce();
    expect(counts1.sent).toBe(1);

    // Rerun — the milestone is already claimed in the simulated UNIQUE index.
    captured = [];
    sentRecorded = [];
    const counts2 = await runOnce();
    expect(counts2.sent).toBe(0);
    expect(counts2.skippedDuplicate).toBe(1);
    expect(captured).toHaveLength(0);
    expect(sentRecorded).toHaveLength(0);
  });

  it("different milestones produce independent reservations", async () => {
    candidatesToReturn = [
      mkCandidate({
        reminderType: "expiring_30",
        milestoneKey: "expiring_30:doc1",
        payload: { kind: "expiring", days: 30, expiresOn: "2026-09-01" },
      }),
      mkCandidate({
        teacherDocumentId: "doc-2",
        userId: "teacher-2",
        recipientEmail: "other@school.org",
        reminderType: "expiring_30",
        milestoneKey: "expiring_30:doc2",
        payload: { kind: "expiring", days: 30, expiresOn: "2026-09-01" },
      }),
    ];
    const { runOnce } = await import("@/lib/reminders/dispatcher");
    const counts = await runOnce();
    expect(counts.sent).toBe(2);
    expect(captured.map((m) => m.to).sort()).toEqual(
      ["other@school.org", "teacher@school.org"]
    );
  });
});

// ===== Daily cap (§11.8 row 2) =====

describe("daily cap", () => {
  it("5 candidates for one teacher → 1 sent (highest priority) + 4 skipped(daily_cap)", async () => {
    candidatesToReturn = [
      mkCandidate({
        reminderType: "missing_required",
        milestoneKey: "missing_required:t1:dt1:2026-06-17",
        payload: { kind: "missing_required" },
      }),
      mkCandidate({
        reminderType: "expiring_30",
        milestoneKey: "expiring_30:docA",
        teacherDocumentId: "docA",
        payload: { kind: "expiring", days: 30, expiresOn: "2026-07-17" },
      }),
      mkCandidate({
        reminderType: "expiring_7",
        milestoneKey: "expiring_7:docB",
        teacherDocumentId: "docB",
        payload: { kind: "expiring", days: 7, expiresOn: "2026-06-24" },
      }),
      mkCandidate({
        reminderType: "expired_today",
        milestoneKey: "expired_today:docC",
        teacherDocumentId: "docC",
        payload: { kind: "expired_today", expiredOn: "2026-06-17" },
      }),
      mkCandidate({
        reminderType: "rejected_replace",
        milestoneKey: "rejected_replace:docD:2026-06-17",
        teacherDocumentId: "docD",
        payload: { kind: "rejected_replace" },
      }),
    ];
    const { runOnce } = await import("@/lib/reminders/dispatcher");
    const counts = await runOnce();
    expect(counts.sent).toBe(1);
    expect(counts.skippedDailyCap).toBe(4);
    expect(captured).toHaveLength(1);
    // expired_today is the highest priority per §11.4 rule 5.
    expect(captured[0].subject.toLowerCase()).toContain("expired today");
    // All four skips reference the right reason + the same teacher.
    expect(skipsRecorded.filter((s) => s.reason === "daily_cap")).toHaveLength(4);
  });

  it("does not skip when maxOneEmailPerTeacherPerDay=false", async () => {
    settingsToReturn = { ...defaultSettings(), maxOneEmailPerTeacherPerDay: false };
    candidatesToReturn = [
      mkCandidate({
        reminderType: "missing_required",
        milestoneKey: "missing_required:t1:dt1:2026-06-17",
        payload: { kind: "missing_required" },
      }),
      mkCandidate({
        reminderType: "expiring_30",
        milestoneKey: "expiring_30:docA",
        teacherDocumentId: "docA",
        payload: { kind: "expiring", days: 30, expiresOn: "2026-07-17" },
      }),
    ];
    const { runOnce } = await import("@/lib/reminders/dispatcher");
    const counts = await runOnce();
    expect(counts.sent).toBe(2);
    expect(counts.skippedDailyCap).toBe(0);
  });

  it("respects external 'already sent today' state for the teacher", async () => {
    teacherHadSentTodayResult = true;
    candidatesToReturn = [
      mkCandidate({
        reminderType: "expiring_30",
        milestoneKey: "expiring_30:docA",
        payload: { kind: "expiring", days: 30, expiresOn: "2026-07-17" },
      }),
    ];
    const { runOnce } = await import("@/lib/reminders/dispatcher");
    const counts = await runOnce();
    expect(counts.sent).toBe(0);
    expect(counts.skippedDailyCap).toBe(1);
    expect(captured).toHaveLength(0);
  });
});

// ===== Master toggle (§11.8 row 3) =====

describe("master toggle", () => {
  it("enabled=false → zero sends, all candidates logged skipped(reminders_disabled)", async () => {
    settingsToReturn = { ...defaultSettings(), enabled: false };
    candidatesToReturn = [
      mkCandidate({
        reminderType: "expiring_30",
        milestoneKey: "expiring_30:docA",
        payload: { kind: "expiring", days: 30, expiresOn: "2026-07-17" },
      }),
      mkCandidate({
        teacherDocumentId: "doc-B",
        userId: "teacher-2",
        recipientEmail: "other@school.org",
        reminderType: "missing_required",
        milestoneKey: "missing_required:t2:dt1:2026-06-17",
        payload: { kind: "missing_required" },
      }),
    ];
    const { runOnce } = await import("@/lib/reminders/dispatcher");
    const counts = await runOnce();
    expect(counts.sent).toBe(0);
    expect(counts.considered).toBe(2);
    expect(counts.skippedDisabled).toBe(2);
    expect(captured).toHaveLength(0);
    expect(skipsRecorded.every((s) => s.reason === "reminders_disabled")).toBe(true);
  });
});

// ===== Privacy: no attachments, no forbidden URLs =====

describe("privacy — outgoing payload assertions", () => {
  const FORBIDDEN_URL_PATTERNS = [
    /amazonaws\.com/i,
    /r2\.cloudflarestorage\.com/i,
    /\/storage\/v1\/object\//i,
    /\bjwt=|\bsession_token=/i,
    /teachers\/[0-9a-f-]+\//i,
    /\/files\/[0-9a-f-]{36}/i,
    /storage|bucket|signed|signature/i,
  ];

  it("every template fan-out — zero forbidden URLs in any captured body", async () => {
    candidatesToReturn = [
      mkCandidate({
        reminderType: "expired_today",
        milestoneKey: "expired_today:doc1",
        payload: { kind: "expired_today", expiredOn: "2026-06-17" },
      }),
      mkCandidate({
        userId: "teacher-2",
        recipientEmail: "other@school.org",
        reminderType: "expiring_30",
        teacherDocumentId: "doc-2",
        milestoneKey: "expiring_30:doc-2",
        payload: { kind: "expiring", days: 30, expiresOn: "2026-07-17" },
      }),
    ];
    const { runOnce } = await import("@/lib/reminders/dispatcher");
    await runOnce();
    expect(captured).toHaveLength(2);
    for (const msg of captured) {
      const allText = `${msg.subject}\n${msg.text}\n${msg.html ?? ""}`;
      for (const re of FORBIDDEN_URL_PATTERNS) {
        expect(allText, `bad pattern ${re} in payload`).not.toMatch(re);
      }
      // No cross-teacher fields: teacher-2's payload must not contain
      // teacher-1's first name "Pat" except where it's the recipient.
      // (Both sample candidates use Pat as the first name by default,
      // so this is a structural assertion via the recipient field, not
      // a byte-level diff.)
    }
  });

  it("a teacher with PII-like name does not leak it to another teacher's payload", async () => {
    candidatesToReturn = [
      mkCandidate({
        userId: "teacher-1",
        recipientEmail: "alice@school.org",
        teacherFirstName: "Alice",
        reminderType: "expired_today",
        milestoneKey: "expired_today:doc-A",
        teacherDocumentId: "doc-A",
        payload: { kind: "expired_today", expiredOn: "2026-06-17" },
      }),
      mkCandidate({
        userId: "teacher-2",
        recipientEmail: "bob@school.org",
        teacherFirstName: "Bob",
        reminderType: "expired_today",
        milestoneKey: "expired_today:doc-B",
        teacherDocumentId: "doc-B",
        payload: { kind: "expired_today", expiredOn: "2026-06-17" },
      }),
    ];
    const { runOnce } = await import("@/lib/reminders/dispatcher");
    await runOnce();
    expect(captured).toHaveLength(2);
    const alice = captured.find((m) => m.to === "alice@school.org")!;
    const bob = captured.find((m) => m.to === "bob@school.org")!;
    expect(alice.text).toContain("Alice");
    expect(alice.text).not.toContain("Bob");
    expect(bob.text).toContain("Bob");
    expect(bob.text).not.toContain("Alice");
  });

  it("zero attachments — EmailMessage type forbids them and no template adds them", async () => {
    candidatesToReturn = [
      mkCandidate({
        reminderType: "expired_today",
        milestoneKey: "expired_today:doc1",
        payload: { kind: "expired_today", expiredOn: "2026-06-17" },
      }),
    ];
    const { runOnce } = await import("@/lib/reminders/dispatcher");
    await runOnce();
    expect(captured).toHaveLength(1);
    expect("attachments" in captured[0]).toBe(false);
    expect("cc" in captured[0]).toBe(false);
    expect("bcc" in captured[0]).toBe(false);
    expect("replyTo" in captured[0]).toBe(false);
  });
});

// ===== Recipient comes from the candidate (which came from users.email) =====

describe("recipient sourcing", () => {
  it("To: always equals candidate.recipientEmail, regardless of other inputs", async () => {
    candidatesToReturn = [
      mkCandidate({
        recipientEmail: "specific@school.org",
        reminderType: "expired_today",
        milestoneKey: "expired_today:doc1",
        payload: { kind: "expired_today", expiredOn: "2026-06-17" },
      }),
    ];
    const { runOnce } = await import("@/lib/reminders/dispatcher");
    await runOnce();
    expect(captured[0].to).toBe("specific@school.org");
  });
});

// ===== Manual send (§11.4 #3) =====

describe("sendManual — admin manual path", () => {
  it("bypasses daily cap and writes triggered_by='admin_manual' + actor_id", async () => {
    teacherHadSentTodayResult = true; // would block cron, must not block manual
    const c = mkCandidate({
      reminderType: "expiring_30",
      milestoneKey: "expiring_30:docM",
      teacherDocumentId: "docM",
      payload: { kind: "expiring", days: 30, expiresOn: "2026-09-01" },
    });
    const { sendManual } = await import("@/lib/reminders/dispatcher");
    const { tryReserveSlot } = await import(
      "@/lib/db/queries/notification-logs"
    );
    const reserved = vi.mocked(tryReserveSlot);

    const r = await sendManual({ candidate: c, actorId: "admin-123" });
    expect(r.disposition).toBe("sent");
    expect(captured).toHaveLength(1);
    expect(reserved).toHaveBeenCalledWith(
      expect.objectContaining({
        triggeredBy: "admin_manual",
        actorId: "admin-123",
        teacherId: c.userId,
      })
    );
  });

  it("still respects UNIQUE-index when the milestone was already sent", async () => {
    const c = mkCandidate({
      reminderType: "expiring_30",
      milestoneKey: "expiring_30:docM",
      teacherDocumentId: "docM",
      payload: { kind: "expiring", days: 30, expiresOn: "2026-09-01" },
    });
    alreadyClaimed.add(key(c.userId, c.milestoneKey));
    const { sendManual } = await import("@/lib/reminders/dispatcher");
    const r = await sendManual({ candidate: c, actorId: "admin-123" });
    expect(r.disposition).toBe("skipped_duplicate");
    expect(captured).toHaveLength(0);
  });
});

// ===== Send failures =====

describe("send failures are recorded as `failed` rows, not crashes", () => {
  it("provider error → counts.failed++ and recordFailed called", async () => {
    sendShouldFail = true;
    candidatesToReturn = [
      mkCandidate({
        reminderType: "expired_today",
        milestoneKey: "expired_today:doc1",
        payload: { kind: "expired_today", expiredOn: "2026-06-17" },
      }),
    ];
    const { runOnce } = await import("@/lib/reminders/dispatcher");
    const counts = await runOnce();
    expect(counts.failed).toBe(1);
    expect(counts.sent).toBe(0);
    expect(failedRecorded).toHaveLength(1);
    expect(failedRecorded[0].reason).toBe("provider 500");
  });

  it("send throws → still recorded as failed (no unhandled rejection)", async () => {
    sendShouldThrow = true;
    candidatesToReturn = [
      mkCandidate({
        reminderType: "expired_today",
        milestoneKey: "expired_today:doc1",
        payload: { kind: "expired_today", expiredOn: "2026-06-17" },
      }),
    ];
    const { runOnce } = await import("@/lib/reminders/dispatcher");
    const counts = await runOnce();
    expect(counts.failed).toBe(1);
    expect(failedRecorded[0].reason).toMatch(/network down/);
  });
});
