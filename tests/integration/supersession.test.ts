import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verify that uploading a new document for a (user, doctype) where a
 * previous non-superseded approved/expired/rejected row exists causes:
 *   1. the new row to be inserted, and
 *   2. the previous row's `superseded_by` to be set to the new row's id,
 *      both inside the same transaction.
 *
 * Pending previous rows must NOT be superseded — they may still be
 * reviewed by an admin.
 */

type Row = Record<string, unknown>;

let previousRow: Row | null = null;
let txSelectCount = 0;
let txInserts: Row[] = [];
let txUpdates: { set: Row }[] = [];
let txCommittedFlag = false;

vi.mock("@/lib/db/client", () => {
  function makeTx() {
    return {
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {
          from: () => chain,
          where: () => chain,
          orderBy: () => chain,
          limit: () => chain,
          then: (resolve: (v: Row[]) => unknown) => {
            txSelectCount++;
            resolve(previousRow ? [previousRow] : []);
          },
        };
        return chain;
      }),
      insert: vi.fn(() => ({
        values: (v: Row) => ({
          returning: async () => {
            const row = { id: "new-doc-id", ...v };
            txInserts.push(row);
            return [row];
          },
        }),
      })),
      update: vi.fn(() => ({
        set: (s: Row) => ({
          where: () => ({
            returning: async () => {
              txUpdates.push({ set: s });
              // simulate previousRow becoming superseded so a second
              // linkSupersession call (defensive) would see 0 rows.
              if (previousRow) {
                previousRow = { ...previousRow, supersededBy: s.supersededBy };
                return [{ id: previousRow.id }];
              }
              return [];
            },
          }),
        }),
      })),
    };
  }
  const transaction = vi.fn(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
    const tx = makeTx();
    const result = await fn(tx);
    txCommittedFlag = true;
    return result;
  });
  return { db: { transaction } };
});

import { insertMyDocument } from "@/lib/db/queries/teacher-documents";
import type { SessionUser } from "@/lib/auth/guards";

const teacher: SessionUser = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "t@example.com",
  name: "Teacher",
  role: "teacher",
};

const docTypeId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function baseInput() {
  return {
    documentTypeId: docTypeId,
    storageKey: "teachers/t/dt/abc.pdf",
    originalFilename: "cpr.pdf",
    mimeType: "application/pdf",
    sizeBytes: 100,
    sha256: "0".repeat(64),
  };
}

beforeEach(() => {
  previousRow = null;
  txSelectCount = 0;
  txInserts = [];
  txUpdates = [];
  txCommittedFlag = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("insertMyDocument supersession", () => {
  it("no previous row → insert only, no supersession write", async () => {
    previousRow = null;
    await insertMyDocument(teacher, baseInput());
    expect(txCommittedFlag).toBe(true);
    expect(txInserts).toHaveLength(1);
    expect(txUpdates).toHaveLength(0);
  });

  it("previous approved row → insert + supersession in same tx", async () => {
    previousRow = {
      id: "prev-doc-id",
      userId: teacher.id,
      documentTypeId: docTypeId,
      status: "approved",
      supersededBy: null,
    };
    const newDoc = await insertMyDocument(teacher, baseInput());
    expect(txCommittedFlag).toBe(true);
    expect(txInserts).toHaveLength(1);
    expect(txUpdates).toHaveLength(1);
    // supersededBy on the previous row points at the new row.
    expect(txUpdates[0].set.supersededBy).toBe(newDoc.id);
  });

  it("previous expired row → supersession fires", async () => {
    previousRow = {
      id: "prev-expired",
      userId: teacher.id,
      documentTypeId: docTypeId,
      status: "expired",
      supersededBy: null,
    };
    await insertMyDocument(teacher, baseInput());
    expect(txUpdates).toHaveLength(1);
    expect(txUpdates[0].set.supersededBy).toBe("new-doc-id");
  });

  it("previous rejected row → supersession fires", async () => {
    previousRow = {
      id: "prev-rejected",
      userId: teacher.id,
      documentTypeId: docTypeId,
      status: "rejected",
      supersededBy: null,
    };
    await insertMyDocument(teacher, baseInput());
    expect(txUpdates).toHaveLength(1);
  });

  it("admin role rejected", async () => {
    const admin: SessionUser = { ...teacher, role: "admin" };
    await expect(insertMyDocument(admin, baseInput())).rejects.toThrow(
      /teacher role required/
    );
    expect(txInserts).toHaveLength(0);
  });
});

// ----- linkSupersession unit -----

import { linkSupersession } from "@/lib/expiry/supersession";

describe("linkSupersession (unit)", () => {
  it("rejects self-supersession", async () => {
    await expect(
      linkSupersession("same-id", "same-id")
    ).rejects.toThrow(/cannot supersede itself/);
  });

  it("rejects missing args", async () => {
    await expect(linkSupersession("", "x")).rejects.toThrow();
    await expect(linkSupersession("x", "")).rejects.toThrow();
  });
});
