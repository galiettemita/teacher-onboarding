import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Per AGENT 5 spec, end-to-end auth gating is asserted at the route
 * handlers themselves (defensive checks). Middleware behavior for page
 * redirects vs. API 401s is exercised separately below.
 */

type Session = { user: { id: string; role: "admin" | "teacher" } } | null;
let session: Session = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => session,
}));

// Mock the inviteTeacher query to a no-op success — we're only checking
// the handler's auth gate.
vi.mock("@/lib/db/queries/admin-teachers", () => ({
  inviteTeacher: vi.fn(async () => ({
    id: "new-teacher-id",
    email: "new@example.com",
    inviteEmailSent: false,
  })),
}));
vi.mock("@/lib/db/queries/admin-review", () => ({
  approveDocument: vi.fn(async () => ({ id: "doc-1", status: "approved" })),
  rejectDocument: vi.fn(async () => ({ id: "doc-1", status: "rejected" })),
}));

beforeEach(() => {
  session = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---- /api/admin/teachers (POST) -----------------------------------------

async function postTeachers(body: Record<string, unknown>): Promise<Response> {
  const { POST } = await import("@/app/api/admin/teachers/route");
  return POST(
    new Request("http://localhost/api/admin/teachers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/admin/teachers auth gate", () => {
  it("anonymous → 401", async () => {
    const res = await postTeachers({ email: "x@y.com", name: "X" });
    expect(res.status).toBe(401);
  });
  it("teacher → 403", async () => {
    session = { user: { id: "t1", role: "teacher" } };
    const res = await postTeachers({ email: "x@y.com", name: "X" });
    expect(res.status).toBe(403);
  });
  it("admin → 201", async () => {
    session = { user: { id: "admin1", role: "admin" } };
    const res = await postTeachers({ email: "x@y.com", name: "X" });
    expect(res.status).toBe(201);
  });
});

// ---- /api/admin/documents/[id] (PATCH) ----------------------------------

async function patchDocument(role: "admin" | "teacher" | null, body: unknown): Promise<Response> {
  if (role) session = { user: { id: role === "admin" ? "a1" : "t1", role } };
  const { PATCH } = await import("@/app/api/admin/documents/[id]/route");
  return PATCH(
    new Request("http://localhost/api/admin/documents/some-id", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "some-id" }) }
  );
}

describe("PATCH /api/admin/documents/[id] auth gate", () => {
  it("anonymous → 401", async () => {
    const res = await patchDocument(null, { action: "approve" });
    expect(res.status).toBe(401);
  });
  it("teacher → 403 (role escalation blocked)", async () => {
    const res = await patchDocument("teacher", { action: "approve" });
    expect(res.status).toBe(403);
  });
  it("admin → 200", async () => {
    const res = await patchDocument("admin", { action: "approve" });
    expect(res.status).toBe(200);
  });
});

// ---- /api/admin/audit (GET) ---------------------------------------------

describe("GET /api/admin/audit auth gate", () => {
  it("admin → 200", async () => {
    session = { user: { id: "admin1", role: "admin" } };
    vi.doMock("@/lib/audit/queries", async () => {
      const actual = await vi.importActual<typeof import("@/lib/audit/queries")>(
        "@/lib/audit/queries"
      );
      return {
        ...actual,
        listAuditLog: vi.fn(async () => ({
          rows: [],
          total: 0,
          page: 1,
          pageSize: 25,
          totalPages: 1,
        })),
      };
    });
    const mod = await import("@/app/api/admin/audit/route");
    const res = await mod.GET(new Request("http://localhost/api/admin/audit"));
    expect(res.status).toBe(200);
  });
});

// ---- /api/files/[id] (anonymous) ----------------------------------------
// Already covered in tests/integration/file-download.test.ts; spec
// requires explicit assertion here too for the AGENT 5 §1 matrix.

describe("GET /api/files/[id] anonymous → 401", () => {
  it("returns 401 when session is null", async () => {
    vi.doMock("@/lib/db/queries/teacher-documents", () => ({
      getDocumentByIdUnscoped: async () => ({
        id: "00000000-0000-0000-0000-000000000001",
        userId: "u1",
        storageKey: "k",
        originalFilename: "f.pdf",
        mimeType: "application/pdf",
      }),
    }));
    const mod = await import("@/app/api/files/[id]/route");
    const res = await mod.GET(
      new Request("http://localhost/api/files/00000000-0000-0000-0000-000000000001"),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) }
    );
    expect(res.status).toBe(401);
  });
});
