import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Session = { user: { id: string; role: "admin" | "teacher" } } | null;
let session: Session = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => session,
}));

const lastCall: { filters: unknown; opts: unknown }[] = [];
const fakePage = {
  rows: [
    {
      id: "log1",
      actorId: "admin1",
      actorEmail: "admin@example.com",
      actorName: "Admin",
      action: "document.approve",
      targetType: "teacher_document",
      targetId: "doc1",
      metadata: { byRole: "admin" },
      createdAt: new Date("2026-05-01T12:00:00Z"),
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
  totalPages: 1,
};

vi.mock("@/lib/audit/queries", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit/queries")>(
    "@/lib/audit/queries"
  );
  return {
    ...actual,
    listAuditLog: vi.fn(async (filters: unknown, opts: unknown) => {
      lastCall.push({ filters, opts });
      return fakePage;
    }),
  };
});

beforeEach(() => {
  session = null;
  lastCall.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callGet(url: string): Promise<Response> {
  const { GET } = await import("@/app/api/admin/audit/route");
  return GET(new Request(url));
}

describe("GET /api/admin/audit", () => {
  it("anonymous → 401", async () => {
    const res = await callGet("http://localhost/api/admin/audit");
    expect(res.status).toBe(401);
  });

  it("teacher → 403", async () => {
    session = { user: { id: "t1", role: "teacher" } };
    const res = await callGet("http://localhost/api/admin/audit");
    expect(res.status).toBe(403);
  });

  it("admin → 200 with paginated payload", async () => {
    session = { user: { id: "admin1", role: "admin" } };
    const res = await callGet("http://localhost/api/admin/audit");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.totalPages).toBe(1);
  });

  it("forwards filters and pagination", async () => {
    session = { user: { id: "admin1", role: "admin" } };
    const url =
      "http://localhost/api/admin/audit" +
      "?actorId=33333333-3333-3333-3333-333333333333" +
      "&action=document.approve" +
      "&targetType=teacher_document" +
      "&since=2026-01-01T00:00:00Z" +
      "&until=2026-12-31T00:00:00Z" +
      "&page=2&pageSize=50";
    const res = await callGet(url);
    expect(res.status).toBe(200);
    expect(lastCall).toHaveLength(1);
    const { filters, opts } = lastCall[0] as {
      filters: Record<string, unknown>;
      opts: Record<string, unknown>;
    };
    expect(filters.actorId).toBe("33333333-3333-3333-3333-333333333333");
    expect(filters.action).toBe("document.approve");
    expect(filters.targetType).toBe("teacher_document");
    expect(filters.since).toBeInstanceOf(Date);
    expect(filters.until).toBeInstanceOf(Date);
    expect(opts.page).toBe(2);
    expect(opts.pageSize).toBe(50);
  });

  it("rejects bad actorId UUID format with 400", async () => {
    session = { user: { id: "admin1", role: "admin" } };
    const res = await callGet("http://localhost/api/admin/audit?actorId=nope");
    expect(res.status).toBe(400);
  });

  it("clamps pageSize to MAX_PAGE_SIZE", async () => {
    session = { user: { id: "admin1", role: "admin" } };
    await callGet("http://localhost/api/admin/audit?pageSize=10000");
    const { opts } = lastCall[0] as { opts: { pageSize: number } };
    expect(opts.pageSize).toBeLessThanOrEqual(100);
  });

  it("defaults page=1 and pageSize=25 when not provided", async () => {
    session = { user: { id: "admin1", role: "admin" } };
    await callGet("http://localhost/api/admin/audit");
    const { opts } = lastCall[0] as { opts: { page: number; pageSize: number } };
    expect(opts.page).toBe(1);
    expect(opts.pageSize).toBe(25);
  });
});
