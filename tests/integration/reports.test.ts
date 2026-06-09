import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reports route tests. The CSV builder is exercised separately
 * (tests/unit/csv.test.ts); here we mock the query helpers and assert
 * the route's contract:
 *   - admin-only (401 / 403)
 *   - type=completion → CSV with the right header columns and one row
 *     per teacher
 *   - type=expiry → CSV with the right header columns and one row per
 *     approved doc, expiring-soon flag wired through
 *   - audit row written on success
 *   - bad type → 400
 *   - sensitive headers attached
 */

const adminId = "33333333-3333-3333-3333-333333333333";

type Session = { user: { id: string; role: "admin" | "teacher"; email?: string; name?: string } } | null;
let session: Session = null;
function setSession(s: Session) {
  session = s;
}

vi.mock("@/lib/auth/config", () => ({
  auth: async () => session,
}));

const auditCalls: { action: string; metadata: unknown }[] = [];
vi.mock("@/lib/audit/log", () => ({
  auditLog: vi.fn(async (input: { action: string; metadata: unknown }) => {
    auditCalls.push({ action: input.action, metadata: input.metadata });
  }),
}));

const completionRows = [
  {
    userId: "u1",
    email: "a@example.com",
    name: "Alice",
    approvedRequired: 2,
    totalRequired: 3,
    completionPct: 66,
    pendingCount: 1,
    expiredCount: 0,
    expiringSoonCount: 1,
  },
  {
    userId: "u2",
    email: "b@example.com",
    name: "Bob, Jr.",
    approvedRequired: 3,
    totalRequired: 3,
    completionPct: 100,
    pendingCount: 0,
    expiredCount: 1,
    expiringSoonCount: 0,
  },
];

const expiryRows = [
  {
    documentId: "d1",
    userId: "u1",
    email: "a@example.com",
    teacherName: "Alice",
    documentType: "CPR",
    expiresAt: new Date("2027-01-15T00:00:00Z"),
    expiringSoon: true,
  },
  {
    documentId: "d2",
    userId: "u2",
    email: "b@example.com",
    teacherName: "Bob",
    documentType: "Background check",
    expiresAt: new Date("2028-06-01T00:00:00Z"),
    expiringSoon: false,
  },
];

vi.mock("@/lib/reports/queries", () => ({
  getCompletionReport: async () => completionRows,
  getExpiryReport: async () => expiryRows,
}));

beforeEach(() => {
  setSession(null);
  auditCalls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callGet(url: string): Promise<Response> {
  const { GET } = await import("@/app/api/admin/reports/route");
  return GET(new Request(url));
}

describe("GET /api/admin/reports", () => {
  it("anonymous → 401", async () => {
    const res = await callGet("http://localhost/api/admin/reports?type=completion");
    expect(res.status).toBe(401);
  });

  it("teacher → 403", async () => {
    setSession({ user: { id: "t1", role: "teacher" } });
    const res = await callGet("http://localhost/api/admin/reports?type=completion");
    expect(res.status).toBe(403);
  });

  it("missing type → 400", async () => {
    setSession({ user: { id: adminId, role: "admin" } });
    const res = await callGet("http://localhost/api/admin/reports");
    expect(res.status).toBe(400);
  });

  it("invalid type → 400", async () => {
    setSession({ user: { id: adminId, role: "admin" } });
    const res = await callGet("http://localhost/api/admin/reports?type=cookies");
    expect(res.status).toBe(400);
  });

  it("type=completion: 200 CSV with expected columns + audit row", async () => {
    setSession({ user: { id: adminId, role: "admin" } });
    const res = await callGet("http://localhost/api/admin/reports?type=completion");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/attachment; filename="onboarding-completion-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    // The Response body starts with a UTF-8 BOM (EF BB BF). `res.text()`
    // decodes UTF-8 and strips the BOM by default, so verify via raw bytes.
    const raw = new Uint8Array(await res.clone().arrayBuffer());
    expect([raw[0], raw[1], raw[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const body = await res.text();
    const lines = body.split("\r\n");
    expect(lines[0]).toBe(
      "user_id,email,name,approved_required,total_required,completion_pct,pending_count,expired_count,expiring_soon_count"
    );
    expect(lines[1]).toBe("u1,a@example.com,Alice,2,3,66,1,0,1");
    // Embedded comma in name → quoted
    expect(lines[2]).toBe('u2,b@example.com,"Bob, Jr.",3,3,100,0,1,0');

    // Audit row
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe("report.export");
    expect(auditCalls[0].metadata).toMatchObject({ type: "completion", rowCount: 2 });
  });

  it("type=expiry: 200 CSV with expected columns + audit row", async () => {
    setSession({ user: { id: adminId, role: "admin" } });
    const res = await callGet("http://localhost/api/admin/reports?type=expiry");
    expect(res.status).toBe(200);

    const body = await res.text();
    const lines = body.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe(
      "document_id,user_id,email,teacher_name,document_type,expires_at,expiring_soon"
    );
    expect(lines[1]).toBe(
      "d1,u1,a@example.com,Alice,CPR,2027-01-15T00:00:00.000Z,true"
    );
    expect(lines[2]).toBe(
      "d2,u2,b@example.com,Bob,Background check,2028-06-01T00:00:00.000Z,false"
    );

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe("report.export");
    expect(auditCalls[0].metadata).toMatchObject({ type: "expiry", rowCount: 2 });
  });
});

describe("CSV row counts match the underlying data", () => {
  it("completion: one row per teacher record", async () => {
    setSession({ user: { id: adminId, role: "admin" } });
    const res = await callGet("http://localhost/api/admin/reports?type=completion");
    const body = await res.text();
    // header + 2 data rows + trailing empty line from terminal CRLF
    const lines = body.replace(/^\uFEFF/, "").split("\r\n");
    const dataLines = lines.slice(1).filter((l) => l.length > 0);
    expect(dataLines.length).toBe(completionRows.length);
  });

  it("expiry: one row per approved doc", async () => {
    setSession({ user: { id: adminId, role: "admin" } });
    const res = await callGet("http://localhost/api/admin/reports?type=expiry");
    const body = await res.text();
    const lines = body.replace(/^\uFEFF/, "").split("\r\n");
    const dataLines = lines.slice(1).filter((l) => l.length > 0);
    expect(dataLines.length).toBe(expiryRows.length);
  });
});
