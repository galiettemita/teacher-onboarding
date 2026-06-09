import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- shared fakes ---------------------------------------------------------

const docTypeRow = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  name: "CPR",
  description: "CPR cert",
  required: true,
  renewalMonths: 24,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const selectRows: unknown[][] = [];
const inserts: { table: string; values: Record<string, unknown> }[] = [];
const storagePuts: { key: string; body: Buffer; contentType: string }[] = [];
let storagePutShouldFail = false;
let dbInsertShouldFail = false;

// Session is set per-test via setSession()
let sessionUser: { id: string; email: string; name: string; role: string } | null = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "teacher@example.com",
  name: "Teacher",
  role: "teacher",
};
function setSession(u: typeof sessionUser) {
  sessionUser = u;
}

vi.mock("@/lib/auth/config", () => ({
  auth: async () => (sessionUser ? { user: sessionUser } : null),
}));

vi.mock("@/lib/db/client", () => {
  // tag each insert with its target table by inspecting the args passed in.
  const insert = vi.fn((tableRef: { _: { name?: string } } | unknown) => {
    const tableName =
      typeof tableRef === "object" && tableRef !== null
        ? // drizzle table objects expose a Symbol-tagged name; fall back to a string
          // representation we extract below
          extractTableName(tableRef as object)
        : "unknown";
    return {
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          if (dbInsertShouldFail) throw new Error("simulated db failure");
          const row = { id: "new-doc-id", ...v };
          inserts.push({ table: tableName, values: row });
          return [row];
        },
      }),
    };
  });

  const select = vi.fn(() => {
    const rows = selectRows.shift() ?? [];
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      innerJoin: () => chain,
      then: (resolve: (v: unknown[]) => unknown) => resolve(rows),
    };
    return chain;
  });

  // Phase 4 (Agent 4) wrapped insertMyDocument in a transaction so the
  // new-doc insert and the supersession update happen atomically. Mock
  // `db.transaction` by passing a tx-shaped handle with the same select/
  // insert/update helpers — supersession's previous-row select returns
  // empty (no superseded link) and update is a no-op.
  const update = vi.fn(() => ({
    set: () => ({
      where: () => ({
        returning: async () => [],
      }),
    }),
  }));
  const transaction = vi.fn(
    async (fn: (tx: { select: typeof select; insert: typeof insert; update: typeof update }) => Promise<unknown>) =>
      fn({ select, insert, update })
  );

  return { db: { select, insert, update, transaction } };
});

vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>(
    "@/lib/storage"
  );
  return {
    ...actual,
    getStorage: () => ({
      id: "local",
      put: async (key: string, body: Buffer, contentType: string) => {
        if (storagePutShouldFail) throw new Error("simulated storage failure");
        storagePuts.push({ key, body, contentType });
      },
      get: async () => ({ body: Buffer.from(""), contentType: "" }),
      exists: async () => true,
      remove: async () => {},
    }),
  };
});

vi.mock("@/lib/audit/log", () => ({
  auditLog: vi.fn(async (input: Record<string, unknown>) => {
    inserts.push({ table: "audit_logs", values: input });
  }),
}));

// --- helpers --------------------------------------------------------------

function makePdf(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<<>>endobj\nxref\n0 1\n0000000000 65535 f \ntrailer<<>>\nstartxref\n9\n%%EOF\n"
  );
}

function extractTableName(obj: object): string {
  // Drizzle stores the table name on a Symbol-keyed slot. Walk symbols and
  // also look at the `[Name]` field commonly inspected by drizzle helpers.
  for (const sym of Object.getOwnPropertySymbols(obj)) {
    const v = (obj as Record<symbol, unknown>)[sym];
    if (typeof v === "string" && v.length > 0 && v.length < 100) return v;
    if (
      v &&
      typeof v === "object" &&
      "name" in (v as object) &&
      typeof (v as { name: unknown }).name === "string"
    ) {
      return (v as { name: string }).name;
    }
  }
  return "unknown";
}

function makeMultipartRequest(
  parts: { name: string; value: string | Blob; filename?: string }[]
): Request {
  const fd = new FormData();
  for (const p of parts) {
    if (typeof p.value === "string") fd.set(p.name, p.value);
    else fd.set(p.name, p.value, p.filename);
  }
  return new Request("http://localhost/api/upload", {
    method: "POST",
    body: fd,
  });
}

beforeEach(() => {
  selectRows.length = 0;
  inserts.length = 0;
  storagePuts.length = 0;
  storagePutShouldFail = false;
  dbInsertShouldFail = false;
  setSession({
    id: "11111111-1111-1111-1111-111111111111",
    email: "teacher@example.com",
    name: "Teacher",
    role: "teacher",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- tests ----------------------------------------------------------------

describe("POST /api/upload", () => {
  it("happy path: 201, writes storage object, DB row, and audit log", async () => {
    // queue: the route's first select queries `documentTypes`
    selectRows.push([docTypeRow]);

    const pdf = makePdf();
    const blob = new Blob([new Uint8Array(pdf)], { type: "application/pdf" });
    const req = makeMultipartRequest([
      { name: "document_type_id", value: docTypeRow.id },
      { name: "file", value: blob, filename: "cpr.pdf" },
    ]);

    const { POST } = await import("@/app/api/upload/route");
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { id: string };
    expect(json.id).toBe("new-doc-id");

    // Storage write happened with a server-built key (never the original name).
    expect(storagePuts).toHaveLength(1);
    expect(storagePuts[0].key).toMatch(
      /^teachers\/11111111-1111-1111-1111-111111111111\/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\/[0-9a-f-]{36}\.pdf$/
    );
    expect(storagePuts[0].contentType).toBe("application/pdf");

    // DB insert for teacher_documents, audit log entry, both present.
    const docInserts = inserts.filter((i) => i.table !== "audit_logs");
    expect(docInserts).toHaveLength(1);
    expect(docInserts[0].values.userId).toBe(sessionUser?.id);
    expect(docInserts[0].values.storageKey).toBe(storagePuts[0].key);

    const audits = inserts.filter((i) => i.table === "audit_logs");
    expect(audits).toHaveLength(1);
    expect(audits[0].values.action).toBe("document.upload");
    expect(audits[0].values.targetType).toBe("teacher_document");
  });

  it("401 when no session", async () => {
    setSession(null);
    const req = makeMultipartRequest([
      { name: "document_type_id", value: docTypeRow.id },
      {
        name: "file",
        value: new Blob([new Uint8Array(makePdf())], { type: "application/pdf" }),
        filename: "cpr.pdf",
      },
    ]);
    const { POST } = await import("@/app/api/upload/route");
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("403 when an admin tries to upload (admins don't upload)", async () => {
    setSession({
      id: "33333333-3333-3333-3333-333333333333",
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
    });
    const req = makeMultipartRequest([
      { name: "document_type_id", value: docTypeRow.id },
      {
        name: "file",
        value: new Blob([new Uint8Array(makePdf())], { type: "application/pdf" }),
        filename: "cpr.pdf",
      },
    ]);
    const { POST } = await import("@/app/api/upload/route");
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("413 when the file exceeds the 10 MB cap", async () => {
    selectRows.push([docTypeRow]);
    const tooBig = Buffer.alloc(10 * 1024 * 1024 + 1, 0x42);
    const req = makeMultipartRequest([
      { name: "document_type_id", value: docTypeRow.id },
      {
        name: "file",
        value: new Blob([new Uint8Array(tooBig)], { type: "application/pdf" }),
        filename: "big.pdf",
      },
    ]);
    const { POST } = await import("@/app/api/upload/route");
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(storagePuts).toHaveLength(0);
  });

  it("415 when the bytes are not a PDF/JPEG/PNG (e.g. .exe renamed .pdf)", async () => {
    selectRows.push([docTypeRow]);
    const exe = Buffer.alloc(64);
    exe.write("MZ", 0, "ascii");
    const req = makeMultipartRequest([
      { name: "document_type_id", value: docTypeRow.id },
      {
        name: "file",
        value: new Blob([new Uint8Array(exe)], { type: "application/pdf" }),
        filename: "totally_a.pdf",
      },
    ]);
    const { POST } = await import("@/app/api/upload/route");
    const res = await POST(req);
    expect(res.status).toBe(415);
    expect(storagePuts).toHaveLength(0);
    expect(inserts.filter((i) => i.table !== "audit_logs")).toHaveLength(0);
  });

  it("rolls back DB write when storage put fails (no orphan row)", async () => {
    selectRows.push([docTypeRow]);
    storagePutShouldFail = true;
    const req = makeMultipartRequest([
      { name: "document_type_id", value: docTypeRow.id },
      {
        name: "file",
        value: new Blob([new Uint8Array(makePdf())], { type: "application/pdf" }),
        filename: "cpr.pdf",
      },
    ]);
    const { POST } = await import("@/app/api/upload/route");
    const res = await POST(req);
    expect(res.status).toBe(500);
    // No teacher_document insert. No audit row either.
    expect(inserts).toHaveLength(0);
  });

  it("404 when the document_type_id refers to an unknown type", async () => {
    selectRows.push([]); // no row returned for documentTypes lookup
    const req = makeMultipartRequest([
      { name: "document_type_id", value: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
      {
        name: "file",
        value: new Blob([new Uint8Array(makePdf())], { type: "application/pdf" }),
        filename: "cpr.pdf",
      },
    ]);
    const { POST } = await import("@/app/api/upload/route");
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("400 when document_type_id is missing / not a uuid", async () => {
    const req = makeMultipartRequest([
      { name: "document_type_id", value: "not-a-uuid" },
      {
        name: "file",
        value: new Blob([new Uint8Array(makePdf())], { type: "application/pdf" }),
        filename: "cpr.pdf",
      },
    ]);
    const { POST } = await import("@/app/api/upload/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
