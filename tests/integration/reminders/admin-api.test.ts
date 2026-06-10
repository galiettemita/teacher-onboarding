import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Admin API integration tests for the reminders routes.
 *
 * Critical security property tested: the manual-send route NEVER
 * accepts an email address from the caller. The recipient is always
 * looked up server-side from `users.email` of the supplied teacherId.
 *
 * Defence in depth: every route is also tested with a teacher session
 * (must 403) and an anonymous session (must 401), even though
 * middleware would normally reject both before they reach the handler
 * (REVIEWER_NOTES.md §3).
 */

// ----- Mocks -----
let currentSession: { user: { id: string; role: string; email?: string; name?: string } } | null = null;
let teacherRow: { id: string; email: string; name: string; role: string } | null = null;
let docTypeRow: { id: string; name: string; active: boolean } | null = null;
let existingDocCount = 0;
let sendManualCalls: Array<{ candidate: unknown; actorId: string }> = [];
let auditCalls: Array<Record<string, unknown>> = [];
let settingsUpdateCalls: Array<{ actor: { id: string; role: string }; patch: Record<string, unknown> }> = [];
let getSettingsResult: Record<string, unknown> = {
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

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(async () => currentSession),
}));

vi.mock("@/lib/db/client", () => {
  // Minimal builder: returns rows based on what the route is asking for.
  // We disambiguate by inspecting `from(...)` calls via a stack.
  const select = vi.fn(() => {
    let queryKind: "teacher" | "doc" | "dt" | "existing" | "unknown" = "unknown";
    const chain: Record<string, unknown> = {
      from: (table: { _: { name?: string } } | unknown) => {
        // postgres-js drizzle doesn't expose table names trivially;
        // we tag based on the column shape passed to `select`. Instead
        // we set queryKind based on join order: callers in this test
        // can't disambiguate, so we just return whatever's been
        // seeded for the next call (in order). See below.
        void table;
        return chain;
      },
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(rowsForNextCall(queryKind)),
      orderBy: () => chain,
      then: (resolve: (v: unknown[]) => unknown) =>
        resolve(rowsForNextCall(queryKind)),
    };
    return chain;
  });
  return { db: { select, insert: vi.fn(), update: vi.fn() } };
});

// Round-robin: in the manual route, the order of selects per call is
// (teacher) → optional (doc+dt join) → optional (dt or existing doc check).
let nextRows: unknown[][] = [];
function rowsForNextCall(_kind: string): unknown[] {
  void _kind;
  if (nextRows.length === 0) return [];
  return nextRows.shift() ?? [];
}

vi.mock("@/lib/db/queries/reminder-settings", () => ({
  getReminderSettings: vi.fn(async () => getSettingsResult),
  updateReminderSettings: vi.fn(async (actor: { id: string; role: string }, patch: Record<string, unknown>) => {
    settingsUpdateCalls.push({ actor, patch });
    return { ...getSettingsResult, ...patch };
  }),
  REMINDER_SETTINGS_ID: "00000000-0000-0000-0000-000000000001",
  DEFAULT_REMINDER_SETTINGS: getSettingsResult,
}));

vi.mock("@/lib/reminders/dispatcher", () => ({
  sendManual: vi.fn(async (opts: { candidate: unknown; actorId: string }) => {
    sendManualCalls.push(opts);
    return { disposition: "sent" as const };
  }),
}));

vi.mock("@/lib/audit/log", () => ({
  auditLog: vi.fn(async (input: Record<string, unknown>) => {
    auditCalls.push(input);
  }),
}));

beforeEach(() => {
  currentSession = { user: { id: "admin-1", role: "admin", email: "admin@school.org" } };
  teacherRow = {
    id: "11111111-1111-1111-1111-111111111111",
    email: "teacher@school.org",
    name: "Pat Smith",
    role: "teacher",
  };
  docTypeRow = {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Teaching Credential",
    active: true,
  };
  existingDocCount = 0;
  sendManualCalls = [];
  auditCalls = [];
  settingsUpdateCalls = [];
  nextRows = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

// ===== Settings GET / PATCH =====

describe("GET /api/admin/reminders/settings", () => {
  it("anonymous → 401", async () => {
    currentSession = null;
    const { GET } = await import("@/app/api/admin/reminders/settings/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("teacher → 403", async () => {
    currentSession = { user: { id: "t1", role: "teacher" } };
    const { GET } = await import("@/app/api/admin/reminders/settings/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("admin → 200 with settings", async () => {
    const { GET } = await import("@/app/api/admin/reminders/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(body.enabled).toBe(true);
  });
});

describe("PATCH /api/admin/reminders/settings", () => {
  function req(body: unknown) {
    return new Request("http://localhost/api/admin/reminders/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("anonymous → 401, no update call", async () => {
    currentSession = null;
    const { PATCH } = await import("@/app/api/admin/reminders/settings/route");
    const res = await PATCH(req({ enabled: false }));
    expect(res.status).toBe(401);
    expect(settingsUpdateCalls).toHaveLength(0);
  });

  it("teacher → 403", async () => {
    currentSession = { user: { id: "t1", role: "teacher" } };
    const { PATCH } = await import("@/app/api/admin/reminders/settings/route");
    const res = await PATCH(req({ enabled: false }));
    expect(res.status).toBe(403);
    expect(settingsUpdateCalls).toHaveLength(0);
  });

  it("admin + empty patch → 400", async () => {
    const { PATCH } = await import("@/app/api/admin/reminders/settings/route");
    const res = await PATCH(req({}));
    expect(res.status).toBe(400);
    expect(settingsUpdateCalls).toHaveLength(0);
  });

  it("admin + extra unknown field → 400 (strict zod)", async () => {
    const { PATCH } = await import("@/app/api/admin/reminders/settings/route");
    const res = await PATCH(req({ enabled: false, mwahaha: 1 }));
    expect(res.status).toBe(400);
    expect(settingsUpdateCalls).toHaveLength(0);
  });

  it("admin + bad senderEmail → 400", async () => {
    const { PATCH } = await import("@/app/api/admin/reminders/settings/route");
    const res = await PATCH(req({ senderEmail: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(settingsUpdateCalls).toHaveLength(0);
  });

  it("admin + valid patch → 200, calls updateReminderSettings", async () => {
    const { PATCH } = await import("@/app/api/admin/reminders/settings/route");
    const res = await PATCH(req({ enabled: false }));
    expect(res.status).toBe(200);
    expect(settingsUpdateCalls).toHaveLength(1);
    expect(settingsUpdateCalls[0].actor.id).toBe("admin-1");
    expect(settingsUpdateCalls[0].patch).toEqual({ enabled: false });
  });
});

// ===== Preview =====

describe("GET /api/admin/reminders/preview", () => {
  it("admin → returns all previews", async () => {
    const { GET } = await import("@/app/api/admin/reminders/preview/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.previews)).toBe(true);
    expect(body.previews.length).toBeGreaterThanOrEqual(10);
    const types = body.previews.map((p: { type: string }) => p.type).sort();
    expect(types).toContain("missing_required");
    expect(types).toContain("expiring_30");
    expect(types).toContain("expired_recurring");
    expect(types).toContain("pending_admin_alert");
  });

  it("teacher → 403", async () => {
    currentSession = { user: { id: "t1", role: "teacher" } };
    const { GET } = await import("@/app/api/admin/reminders/preview/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });
});

// ===== Manual send — security-critical =====

describe("POST /api/admin/reminders/manual — recipient sourcing", () => {
  function req(body: unknown) {
    return new Request("http://localhost/api/admin/reminders/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("anonymous → 401, no send", async () => {
    currentSession = null;
    const { POST } = await import("@/app/api/admin/reminders/manual/route");
    const res = await POST(req({}));
    expect(res.status).toBe(401);
    expect(sendManualCalls).toHaveLength(0);
  });

  it("teacher → 403, no send", async () => {
    currentSession = { user: { id: "t1", role: "teacher" } };
    const { POST } = await import("@/app/api/admin/reminders/manual/route");
    const res = await POST(req({}));
    expect(res.status).toBe(403);
    expect(sendManualCalls).toHaveLength(0);
  });

  it("invalid body shape → 400", async () => {
    const { POST } = await import("@/app/api/admin/reminders/manual/route");
    const res = await POST(req({ teacherId: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect(sendManualCalls).toHaveLength(0);
  });

  it("rejects extra `email` field in body (strict zod)", async () => {
    const { POST } = await import("@/app/api/admin/reminders/manual/route");
    const res = await POST(
      req({
        teacherId: teacherRow!.id,
        reminderType: "missing_required",
        documentTypeId: docTypeRow!.id,
        email: "attacker@evil.example",
      })
    );
    expect(res.status).toBe(400);
    expect(sendManualCalls).toHaveLength(0);
  });

  it("missing_required: To: comes from users.email of teacherId, NOT from body", async () => {
    // Manual route does: 1) teacher SELECT → 2) doc-type SELECT → 3) existing-doc SELECT.
    nextRows = [
      [teacherRow], // teacher lookup
      [docTypeRow], // doc-type lookup
      [], // existing-doc check (no rows = missing)
    ];

    const { POST } = await import("@/app/api/admin/reminders/manual/route");
    const res = await POST(
      req({
        teacherId: teacherRow!.id,
        reminderType: "missing_required",
        documentTypeId: docTypeRow!.id,
      })
    );
    expect(res.status).toBe(200);
    expect(sendManualCalls).toHaveLength(1);
    const c = sendManualCalls[0].candidate as { recipientEmail: string; userId: string };
    expect(c.recipientEmail).toBe("teacher@school.org");
    expect(c.userId).toBe(teacherRow!.id);
  });

  it("404 when teacher does not exist", async () => {
    nextRows = [[]]; // teacher lookup → no rows
    const { POST } = await import("@/app/api/admin/reminders/manual/route");
    const res = await POST(
      req({
        teacherId: "00000000-0000-0000-0000-000000000999",
        reminderType: "missing_required",
        documentTypeId: docTypeRow!.id,
      })
    );
    expect(res.status).toBe(404);
    expect(sendManualCalls).toHaveLength(0);
  });

  it("400 when target user is an admin (not a teacher)", async () => {
    nextRows = [
      [{ ...teacherRow!, role: "admin" }],
    ];
    const { POST } = await import("@/app/api/admin/reminders/manual/route");
    const res = await POST(
      req({
        teacherId: teacherRow!.id,
        reminderType: "missing_required",
        documentTypeId: docTypeRow!.id,
      })
    );
    expect(res.status).toBe(400);
    expect(sendManualCalls).toHaveLength(0);
  });

  it("400 when teacher already has the doc (missing_required no longer applies)", async () => {
    nextRows = [
      [teacherRow],
      [docTypeRow],
      [{ id: "existing-doc" }], // existing-doc check has a row
    ];
    void existingDocCount; // reserved for future expansion
    const { POST } = await import("@/app/api/admin/reminders/manual/route");
    const res = await POST(
      req({
        teacherId: teacherRow!.id,
        reminderType: "missing_required",
        documentTypeId: docTypeRow!.id,
      })
    );
    expect(res.status).toBe(400);
    expect(sendManualCalls).toHaveLength(0);
  });

  it("writes a reminders.manual_send audit row with the disposition", async () => {
    nextRows = [
      [teacherRow],
      [docTypeRow],
      [],
    ];
    const { POST } = await import("@/app/api/admin/reminders/manual/route");
    await POST(
      req({
        teacherId: teacherRow!.id,
        reminderType: "missing_required",
        documentTypeId: docTypeRow!.id,
      })
    );
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      actorId: "admin-1",
      action: "reminders.manual_send",
      targetType: "user",
      targetId: teacherRow!.id,
    });
    expect(auditCalls[0].metadata).toMatchObject({
      reminderType: "missing_required",
      disposition: "sent",
    });
  });
});
