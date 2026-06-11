import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const admin = { role: "admin" as const };
const NOW = new Date("2026-06-11T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function alertRow(over: {
  id: string;
  status: string;
  expiresInDays: number | null;
  teacherId: string;
  teacherName: string;
}) {
  return {
    doc: {
      id: over.id,
      documentTypeId: "dt-1",
      status: over.status,
      uploadedAt: new Date(NOW.getTime() - 700 * DAY),
      expiresAt:
        over.expiresInDays === null ? null : new Date(NOW.getTime() + over.expiresInDays * DAY),
    },
    typeName: "Medical Form",
    category: "medical",
    teacherId: over.teacherId,
    teacherName: over.teacherName,
    teacherEmail: `${over.teacherName}@x.com`,
  };
}

beforeEach(() => {
  selectQueue.length = 0;
});
afterEach(() => vi.clearAllMocks());

describe("listExpirationAlerts", () => {
  it("surfaces expired and expiring-soon, excludes healthy docs (tests 13, 14, 15)", async () => {
    const { listExpirationAlerts } = await import("@/lib/db/queries/expiration");
    selectQueue.push([
      alertRow({ id: "expired-doc", status: "approved", expiresInDays: -5, teacherId: "ta", teacherName: "Ann" }),
      alertRow({ id: "soon-doc", status: "approved", expiresInDays: 10, teacherId: "tb", teacherName: "Bob" }),
      alertRow({ id: "healthy-doc", status: "approved", expiresInDays: 200, teacherId: "tc", teacherName: "Cal" }),
      alertRow({ id: "marked-expired", status: "expired", expiresInDays: -40, teacherId: "td", teacherName: "Dee" }),
    ]);

    const alerts = await listExpirationAlerts(admin, NOW);
    const ids = alerts.map((a) => a.documentId);

    // healthy doc (200 days out) is excluded.
    expect(ids).not.toContain("healthy-doc");
    // expired + expiring-soon are present, each tied to the correct teacher.
    expect(ids).toContain("expired-doc");
    expect(ids).toContain("soon-doc");
    expect(ids).toContain("marked-expired");

    const expired = alerts.filter((a) => a.state === "expired");
    const soon = alerts.filter((a) => a.state === "expiring_soon");
    expect(expired.map((a) => a.documentId).sort()).toEqual(["expired-doc", "marked-expired"]);
    expect(soon.map((a) => a.documentId)).toEqual(["soon-doc"]);

    // Each alert carries its own teacher — no cross-contamination (test 15).
    const byId = Object.fromEntries(alerts.map((a) => [a.documentId, a]));
    expect(byId["soon-doc"].teacherName).toBe("Bob");
    expect(byId["expired-doc"].teacherName).toBe("Ann");

    // Days remaining / overdue computed.
    expect(byId["soon-doc"].daysRemaining).toBe(10);
    expect(byId["expired-doc"].daysRemaining).toBe(-5);
  });

  it("rejects non-admins (server-side guard)", async () => {
    const { listExpirationAlerts } = await import("@/lib/db/queries/expiration");
    await expect(
      listExpirationAlerts({ role: "teacher" }, NOW)
    ).rejects.toThrow(/admin/i);
  });
});
