import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- mock the db client used by queries/teacher-documents.ts ---
//
// We don't want to talk to a real Postgres. The query module uses Drizzle's
// chainable builder API; the simplest mock is a recorder that returns the
// rows we want for the next call and remembers what was inserted.

type Row = Record<string, unknown>;

const queue: Row[][] = [];
const inserts: Row[] = [];

/** Push the next "row set" the next select call should return. */
function nextSelect(rows: Row[]) {
  queue.push(rows);
}

vi.mock("@/lib/db/client", () => {
  const select = vi.fn(() => {
    const rows = queue.shift() ?? [];
    // chainable: select().from().where().limit() / .orderBy() etc.
    const chain: Record<string, unknown> = {};
    const thenable = {
      then: (resolve: (v: Row[]) => unknown) => resolve(rows),
    };
    const ret: Record<string, unknown> = {
      from: () => ret,
      where: () => ret,
      orderBy: () => ret,
      limit: () => ret,
      innerJoin: () => ret,
      ...thenable,
    };
    Object.assign(chain, ret);
    return ret;
  });

  const insert = vi.fn(() => ({
    values: (v: Row) => ({
      returning: async () => {
        inserts.push(v);
        return [{ id: "inserted-row-id", ...v }];
      },
    }),
  }));

  const update = vi.fn(() => ({
    set: () => ({
      where: () => ({
        returning: async () => [],
      }),
    }),
  }));

  // Phase 4: insertMyDocument now runs inside a transaction so the
  // supersession link can ride on the same unit-of-work.
  const transaction = vi.fn(
    async (fn: (tx: { select: typeof select; insert: typeof insert; update: typeof update }) => Promise<unknown>) =>
      fn({ select, insert, update })
  );

  return { db: { select, insert, update, transaction } };
});

import {
  getMyDocumentById,
  insertMyDocument,
  listMyDocuments,
} from "@/lib/db/queries/teacher-documents";
import type { SessionUser } from "@/lib/auth/guards";

const teacherA: SessionUser = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "a@example.com",
  name: "Teacher A",
  role: "teacher",
};

const teacherB: SessionUser = {
  id: "22222222-2222-2222-2222-222222222222",
  email: "b@example.com",
  name: "Teacher B",
  role: "teacher",
};

const admin: SessionUser = {
  id: "33333333-3333-3333-3333-333333333333",
  email: "admin@example.com",
  name: "Admin",
  role: "admin",
};

beforeEach(() => {
  queue.length = 0;
  inserts.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("teacher-documents permissions", () => {
  it("getMyDocumentById returns null when the doc belongs to another teacher", async () => {
    // Simulate: the WHERE clause filters out non-owned rows, so the mock
    // returns an empty set when called on behalf of teacherB.
    nextSelect([]);
    const got = await getMyDocumentById(
      teacherB,
      "deadbeef-dead-beef-dead-beefdeadbeef"
    );
    expect(got).toBeNull();
  });

  it("getMyDocumentById returns the row when the teacher owns it", async () => {
    nextSelect([
      {
        id: "deadbeef-dead-beef-dead-beefdeadbeef",
        userId: teacherA.id,
        documentTypeId: "type-1",
        storageKey: "teachers/A/type-1/abc.pdf",
        status: "pending",
      },
    ]);
    const got = await getMyDocumentById(
      teacherA,
      "deadbeef-dead-beef-dead-beefdeadbeef"
    );
    expect(got).not.toBeNull();
    expect(got?.userId).toBe(teacherA.id);
  });

  it("insertMyDocument forces user_id = currentUser.id regardless of any other context", async () => {
    await insertMyDocument(teacherA, {
      documentTypeId: "type-1",
      storageKey: "teachers/A/type-1/abc.pdf",
      originalFilename: "cpr.pdf",
      mimeType: "application/pdf",
      sizeBytes: 123,
      sha256: "0".repeat(64),
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].userId).toBe(teacherA.id);
  });

  it.each([
    ["getMyDocumentById", () => getMyDocumentById(admin, "id")],
    ["listMyDocuments", () => listMyDocuments(admin)],
    [
      "insertMyDocument",
      () =>
        insertMyDocument(admin, {
          documentTypeId: "t",
          storageKey: "k",
          originalFilename: "n",
          mimeType: "application/pdf",
          sizeBytes: 1,
          sha256: "x",
        }),
    ],
  ])("%s rejects an admin caller (teacher role required)", async (_name, call) => {
    await expect(call()).rejects.toThrow(/teacher role required/);
  });
});
