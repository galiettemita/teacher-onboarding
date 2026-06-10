import { describe, expect, it } from "vitest";
import {
  compareCandidates,
  groupByTeacher,
  priorityForType,
  sortByPriority,
  type PrioritisedCandidate,
} from "@/lib/reminders/priority";

const ORDER = [
  "expired_today",
  "expired_recurring",
  "expiring_7",
  "expiring_14",
  "expiring_30",
  "expiring_60",
  "expiring_90",
  "rejected_replace",
  "missing_required",
  "pending_admin_alert",
] as const;

describe("priorityForType — §11.4 rule 5", () => {
  it("matches the spec's exact ordering", () => {
    for (let i = 0; i < ORDER.length - 1; i++) {
      expect(priorityForType(ORDER[i])).toBeLessThan(
        priorityForType(ORDER[i + 1])
      );
    }
  });

  it("expired_today is the most urgent", () => {
    expect(priorityForType("expired_today")).toBe(0);
  });

  it("pending_admin_alert is the least urgent", () => {
    for (const t of ORDER.slice(0, -1)) {
      expect(priorityForType(t)).toBeLessThan(
        priorityForType("pending_admin_alert")
      );
    }
  });
});

function cand(
  reminderType: PrioritisedCandidate["reminderType"],
  userId = "u1",
  teacherDocumentId: string | null = "doc-A",
  documentTypeId: string | null = "dt-A"
): PrioritisedCandidate {
  return { reminderType, userId, teacherDocumentId, documentTypeId };
}

describe("sortByPriority", () => {
  it("orders the spec example correctly", () => {
    const shuffled: PrioritisedCandidate[] = [
      cand("missing_required"),
      cand("expiring_7"),
      cand("expired_today"),
      cand("expiring_90"),
      cand("rejected_replace"),
    ];
    const sorted = sortByPriority(shuffled).map((c) => c.reminderType);
    expect(sorted).toEqual([
      "expired_today",
      "expiring_7",
      "expiring_90",
      "rejected_replace",
      "missing_required",
    ]);
  });

  it("does not mutate the input", () => {
    const input = [cand("missing_required"), cand("expired_today")];
    const before = input.map((c) => c.reminderType);
    sortByPriority(input);
    expect(input.map((c) => c.reminderType)).toEqual(before);
  });
});

describe("compareCandidates — deterministic tiebreak", () => {
  it("ties broken by teacherDocumentId lex", () => {
    const a = cand("expiring_30", "u1", "doc-B");
    const b = cand("expiring_30", "u1", "doc-A");
    expect(compareCandidates(a, b)).toBeGreaterThan(0);
  });

  it("if teacherDocumentId equal, broken by documentTypeId", () => {
    const a = cand("expiring_30", "u1", "doc-A", "dt-B");
    const b = cand("expiring_30", "u1", "doc-A", "dt-A");
    expect(compareCandidates(a, b)).toBeGreaterThan(0);
  });

  it("if both equal, broken by userId", () => {
    const a = cand("expiring_30", "u2", "doc-A", "dt-A");
    const b = cand("expiring_30", "u1", "doc-A", "dt-A");
    expect(compareCandidates(a, b)).toBeGreaterThan(0);
  });

  it("treats null teacherDocumentId as empty for ordering — stable", () => {
    const a = cand("missing_required", "u1", null, "dt-A");
    const b = cand("missing_required", "u1", null, "dt-B");
    expect(compareCandidates(a, b)).toBeLessThan(0);
  });
});

describe("groupByTeacher", () => {
  it("groups by userId, and each group is priority-sorted", () => {
    const input: PrioritisedCandidate[] = [
      cand("missing_required", "u1"),
      cand("expired_today", "u2"),
      cand("expiring_7", "u1"),
      cand("expired_today", "u1"),
    ];
    const grouped = groupByTeacher(input);
    expect(grouped.size).toBe(2);
    expect(grouped.get("u1")!.map((c) => c.reminderType)).toEqual([
      "expired_today",
      "expiring_7",
      "missing_required",
    ]);
    expect(grouped.get("u2")!.map((c) => c.reminderType)).toEqual([
      "expired_today",
    ]);
  });
});
