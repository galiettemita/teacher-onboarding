import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- fakes ----------------------------------------------------------------

const DOC_ID = "deadbeef-dead-beef-dead-beefdeadbeef";
const STORAGE_KEY =
  "teachers/11111111-1111-1111-1111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/abcdef01-2345-6789-abcd-ef0123456789.pdf";
const BUCKET_NAME = "teacher-onboarding-private";
const SIGNED_URL =
  "https://example.supabase.co/storage/v1/object/sign/" +
  BUCKET_NAME +
  "/some/path?token=sig";

const ownerId = "11111111-1111-1111-1111-111111111111";
const otherTeacherId = "22222222-2222-2222-2222-222222222222";
const adminId = "33333333-3333-3333-3333-333333333333";

const docRow = {
  id: DOC_ID,
  userId: ownerId,
  documentTypeId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  storageKey: STORAGE_KEY,
  originalFilename: "../../etc/passwd.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1234,
  sha256: "0".repeat(64),
  status: "approved",
  uploadedAt: new Date(),
  reviewedAt: new Date(),
  reviewedBy: adminId,
  rejectionReason: null,
  expiresAt: null,
  supersededBy: null,
};

const FILE_BODY = Buffer.from("%PDF-1.4 fake bytes %%EOF");

let sessionUser: { id: string; email: string; name: string; role: string } | null = null;
function setSession(u: typeof sessionUser) {
  sessionUser = u;
}

let docToReturn: typeof docRow | null = docRow;
let storageGetShouldFail = false;
const auditCalls: { action: string; targetId: string | null }[] = [];

vi.mock("@/lib/auth/config", () => ({
  auth: async () => (sessionUser ? { user: sessionUser } : null),
}));

vi.mock("@/lib/db/queries/teacher-documents", () => ({
  getDocumentByIdUnscoped: async (id: string) =>
    docToReturn && docToReturn.id === id ? docToReturn : null,
}));

vi.mock("@/lib/db/queries/activation", () => ({
  getActivationStatus: async () => ({ mustChangePassword: false }),
}));

vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>(
    "@/lib/storage"
  );
  return {
    ...actual,
    getStorage: () => ({
      id: "local",
      put: async () => {},
      get: async () => {
        if (storageGetShouldFail) throw new Error("missing");
        return { body: FILE_BODY, contentType: "application/pdf" };
      },
      exists: async () => true,
      remove: async () => {},
    }),
  };
});

vi.mock("@/lib/audit/log", () => ({
  auditLog: vi.fn(async (input: { action: string; targetId: string | null }) => {
    auditCalls.push({ action: input.action, targetId: input.targetId });
  }),
}));

// --- helpers --------------------------------------------------------------

async function callGet(id: string): Promise<Response> {
  const { GET } = await import("@/app/api/files/[id]/route");
  const req = new Request(`http://localhost/api/files/${id}`);
  return GET(req, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  sessionUser = null;
  docToReturn = docRow;
  storageGetShouldFail = false;
  auditCalls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- tests ----------------------------------------------------------------

describe("GET /api/files/[id]", () => {
  it("anonymous → 401", async () => {
    const res = await callGet(DOC_ID);
    expect(res.status).toBe(401);
    expect(auditCalls).toHaveLength(0);
  });

  it("owner → 200 with bytes and required headers", async () => {
    setSession({ id: ownerId, email: "t@example.com", name: "T", role: "teacher" });
    const res = await callGet(DOC_ID);
    expect(res.status).toBe(200);

    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/^attachment;\s*filename="/);
    // Sanitized: no traversal, no slashes.
    expect(cd).not.toMatch(/\.\./);
    expect(cd).not.toMatch(/[\\/]/);

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(FILE_BODY)).toBe(true);

    // Audit row written for the download.
    expect(auditCalls).toContainEqual({ action: "file.download", targetId: DOC_ID });
  });

  it("other teacher → 403, no bytes, no audit row", async () => {
    setSession({
      id: otherTeacherId,
      email: "b@example.com",
      name: "B",
      role: "teacher",
    });
    const res = await callGet(DOC_ID);
    expect(res.status).toBe(403);
    expect(
      auditCalls.find((a) => a.action === "file.download")
    ).toBeUndefined();
  });

  it("admin → 200 (admin path is intentional)", async () => {
    setSession({ id: adminId, email: "a@example.com", name: "A", role: "admin" });
    const res = await callGet(DOC_ID);
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(FILE_BODY)).toBe(true);
    expect(auditCalls).toContainEqual({ action: "file.download", targetId: DOC_ID });
  });

  it("missing doc id → 404", async () => {
    setSession({ id: ownerId, email: "t@example.com", name: "T", role: "teacher" });
    docToReturn = null;
    const res = await callGet(DOC_ID);
    expect(res.status).toBe(404);
  });

  it("storage object gone → 404 and writes a file.missing audit row", async () => {
    setSession({ id: ownerId, email: "t@example.com", name: "T", role: "teacher" });
    storageGetShouldFail = true;
    const res = await callGet(DOC_ID);
    expect(res.status).toBe(404);
    expect(auditCalls).toContainEqual({ action: "file.missing", targetId: DOC_ID });
    // And no successful download audit row.
    expect(
      auditCalls.find((a) => a.action === "file.download")
    ).toBeUndefined();
  });

  it("non-uuid id → 404 (no DB hit, no info leak)", async () => {
    setSession({ id: ownerId, email: "t@example.com", name: "T", role: "teacher" });
    const res = await callGet("not-a-uuid");
    expect(res.status).toBe(404);
  });

  it("response body contains zero storage URLs / bucket names / storage_key on every status path", async () => {
    const forbiddenSubstrings = [
      "supabase",
      BUCKET_NAME,
      STORAGE_KEY,
      "storage_key",
      "storageKey",
      "sign", // would catch "signed_url"
    ];

    async function bodyAsText(res: Response): Promise<string> {
      // For binary OK bodies, base64 the bytes so even an accidental
      // ASCII-encoded URL would surface.
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.toString("utf8") + " | b64:" + buf.toString("base64");
    }

    // Anonymous (401)
    sessionUser = null;
    let body = await bodyAsText(await callGet(DOC_ID));
    for (const sub of forbiddenSubstrings) expect(body.toLowerCase()).not.toContain(sub.toLowerCase());

    // Other teacher (403)
    setSession({
      id: otherTeacherId,
      email: "b@example.com",
      name: "B",
      role: "teacher",
    });
    body = await bodyAsText(await callGet(DOC_ID));
    for (const sub of forbiddenSubstrings) expect(body.toLowerCase()).not.toContain(sub.toLowerCase());

    // Owner (200)
    setSession({ id: ownerId, email: "t@example.com", name: "T", role: "teacher" });
    body = await bodyAsText(await callGet(DOC_ID));
    // The OK body is the raw file bytes (our `%PDF-1.4 fake bytes %%EOF`),
    // which doesn't contain any of those substrings.
    for (const sub of forbiddenSubstrings) expect(body.toLowerCase()).not.toContain(sub.toLowerCase());

    // No header leaks the signed URL either.
    // Round-trip a fresh response to inspect headers in isolation.
    setSession({ id: ownerId, email: "t@example.com", name: "T", role: "teacher" });
    const res = await callGet(DOC_ID);
    const headerStr = JSON.stringify([...res.headers.entries()]);
    for (const sub of forbiddenSubstrings) {
      expect(headerStr.toLowerCase()).not.toContain(sub.toLowerCase());
    }
    expect(SIGNED_URL).toBeTruthy(); // referenced to silence lint
  });
});
