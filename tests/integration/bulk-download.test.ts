import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bulk download: ZIP assembly (buildTeacherDocumentsZip) + route authorization.
 * db client + storage adapter are mocked.
 */

type Row = Record<string, unknown>;
const selectQueue: Row[][] = [];
const storageFiles = new Map<string, Buffer>();

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
  const insert = vi.fn(() => ({ values: async () => undefined }));
  return { db: { select, insert } };
});

vi.mock("@/lib/storage", () => ({
  getStorage: () => ({
    id: "local",
    async get(key: string) {
      const f = storageFiles.get(key);
      if (!f) throw new Error("missing");
      return { body: f, contentType: "application/pdf" };
    },
  }),
}));

const admin = { role: "admin" as const };
const teacher = { id: "u-1", name: "Jane Doe", email: "jane@x.com", role: "teacher" };

beforeEach(() => {
  selectQueue.length = 0;
  storageFiles.clear();
});
afterEach(() => vi.clearAllMocks());

function zipText(zip: Buffer): string {
  // Store method is uncompressed → filenames + small text payloads appear verbatim.
  return zip.toString("latin1");
}

/** Entry names from the central directory (the real archive paths). */
function entryNames(zip: Buffer): string[] {
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    names.push(zip.subarray(p + 46, p + 46 + nameLen).toString("utf8"));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

describe("buildTeacherDocumentsZip", () => {
  it("includes files + a manifest, sanitizes names, and skips missing files (tests 21, 24, 25, 26, 27)", async () => {
    const { buildTeacherDocumentsZip } = await import("@/lib/db/queries/bulk-download");

    storageFiles.set("teachers/u-1/dt-1/aaa.pdf", Buffer.from("%PDF-1.4 present-file %%EOF"));
    // second file intentionally NOT in storage → should be skipped, not crash.

    selectQueue.push([teacher]); // users lookup
    selectQueue.push([{ userId: "u-1", staffStatus: "returning" }]); // profile
    selectQueue.push([
      {
        doc: {
          id: "doc-present",
          status: "approved",
          storageKey: "teachers/u-1/dt-1/aaa.pdf",
          originalFilename: "../../etc/passwd.pdf",
          uploadedAt: new Date("2026-01-02T00:00:00Z"),
          expiresAt: new Date("2028-01-02T00:00:00Z"),
        },
        typeName: "Medical Form",
      },
      {
        doc: {
          id: "doc-missing",
          status: "approved",
          storageKey: "teachers/u-1/dt-1/missing.pdf",
          originalFilename: "lost.pdf",
          uploadedAt: new Date("2026-02-02T00:00:00Z"),
          expiresAt: null,
        },
        typeName: "Background Check",
      },
    ]);

    const result = await buildTeacherDocumentsZip(admin, "u-1");
    const text = zipText(result.zip);

    expect(result.fileCount).toBe(2);
    expect(result.skippedCount).toBe(1);

    // Manifest present (test 25).
    expect(text).toContain("Jane-Doe/manifest.csv");
    expect(text).toContain("teacher_name,teacher_email");
    expect(text).toContain("jane@x.com");

    // Present file's bytes are in the archive (test 24/21).
    expect(text).toContain("present-file");

    // Archive entry paths are sanitized — no traversal escapes the teacher
    // folder, even though the original filename was "../../etc/passwd.pdf" (test 26).
    const names = entryNames(result.zip);
    expect(names).toContain("Jane-Doe/MedicalForm/2026-01-02-approved-passwd.pdf");
    for (const n of names) {
      expect(n.includes("..")).toBe(false);
      expect(n.startsWith("/")).toBe(false);
      expect(n).not.toContain("etc/passwd");
    }
    // The manifest still records the true original filename for the admin's records.
    expect(text).toContain("../../etc/passwd.pdf");

    // Missing file recorded, not fatal (test 27).
    expect(text).toContain("FILE MISSING IN STORAGE");

    // The archive is a valid ZIP (EOCD signature present).
    expect(result.zip.readUInt32LE(0)).toBe(0x04034b50);
  });

  it("rejects a non-admin caller (server-side guard)", async () => {
    const { buildTeacherDocumentsZip } = await import("@/lib/db/queries/bulk-download");
    await expect(
      buildTeacherDocumentsZip({ role: "teacher" }, "u-1")
    ).rejects.toThrow(/admin/i);
  });
});

// ---- route authorization (tests 22, 23) ---------------------------------

let session: { user: { id: string; role: string } } | null = null;
vi.mock("@/lib/auth/config", () => ({ auth: async () => session }));

async function callDownload(role: "admin" | "teacher" | null): Promise<Response> {
  session = role ? { user: { id: "x", role } } : null;
  const mod = await import("@/app/api/admin/teachers/[id]/download/route");
  return mod.GET(
    new Request("http://localhost/api/admin/teachers/00000000-0000-0000-0000-000000000001/download"),
    { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) }
  );
}

describe("GET /api/admin/teachers/[id]/download auth gate", () => {
  it("anonymous → 401 (test: unauthenticated cannot use the route)", async () => {
    expect((await callDownload(null)).status).toBe(401);
  });
  it("teacher → 403 (non-admin cannot bulk download — tests 22, 23)", async () => {
    expect((await callDownload("teacher")).status).toBe(403);
  });
});
