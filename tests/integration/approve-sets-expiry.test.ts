import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `approveDocument` must write `expires_at = reviewed_at +
 * docType.renewal_months months`. We mock the db client to capture the
 * `set(...)` payload of the UPDATE that flips status → 'approved'.
 */

type Row = Record<string, unknown>;

const selectRows: Row[][] = [];
let updateSetPayload: Row | null = null;
let updateReturning: Row | null = null;

vi.mock("@/lib/db/client", () => {
  const select = vi.fn(() => {
    const rows = selectRows.shift() ?? [];
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (v: Row[]) => unknown) => resolve(rows),
    };
    return chain;
  });
  const update = vi.fn(() => ({
    set: (s: Row) => {
      updateSetPayload = s;
      return {
        where: () => ({
          returning: async () => [updateReturning ?? { id: "doc-1", ...s }],
        }),
      };
    },
  }));
  return { db: { select, update } };
});

vi.mock("@/lib/audit/log", () => ({
  auditLog: vi.fn(async () => {}),
}));

import { approveDocument } from "@/lib/db/queries/admin-review";

const admin = { id: "33333333-3333-3333-3333-333333333333", role: "admin" };

beforeEach(() => {
  selectRows.length = 0;
  updateSetPayload = null;
  updateReturning = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("approveDocument sets expires_at", () => {
  it("approval sets expires_at = reviewedAt + 24 months by default", async () => {
    selectRows.push([
      {
        id: "doc-1",
        status: "pending",
        documentTypeId: "dt-1",
        userId: "u-1",
      },
    ]);
    selectRows.push([{ id: "dt-1", renewalMonths: 24 }]);

    const before = Date.now();
    await approveDocument(admin, "doc-1");
    const after = Date.now();

    expect(updateSetPayload).not.toBeNull();
    expect(updateSetPayload?.status).toBe("approved");
    expect(updateSetPayload?.reviewedAt).toBeInstanceOf(Date);
    const reviewedAt = updateSetPayload?.reviewedAt as Date;
    expect(reviewedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(reviewedAt.getTime()).toBeLessThanOrEqual(after);

    const expires = updateSetPayload?.expiresAt as Date;
    expect(expires).toBeInstanceOf(Date);
    // 24 months after reviewedAt — UTC month math.
    const expected = new Date(
      Date.UTC(
        reviewedAt.getUTCFullYear() + 2,
        reviewedAt.getUTCMonth(),
        reviewedAt.getUTCDate(),
        reviewedAt.getUTCHours(),
        reviewedAt.getUTCMinutes(),
        reviewedAt.getUTCSeconds(),
        reviewedAt.getUTCMilliseconds()
      )
    );
    expect(expires.toISOString()).toBe(expected.toISOString());
  });

  it("respects a custom renewalMonths value (e.g. 12)", async () => {
    selectRows.push([
      {
        id: "doc-2",
        status: "pending",
        documentTypeId: "dt-2",
        userId: "u-1",
      },
    ]);
    selectRows.push([{ id: "dt-2", renewalMonths: 12 }]);

    await approveDocument(admin, "doc-2");

    const reviewedAt = updateSetPayload?.reviewedAt as Date;
    const expires = updateSetPayload?.expiresAt as Date;
    const expected = new Date(
      Date.UTC(
        reviewedAt.getUTCFullYear() + 1,
        reviewedAt.getUTCMonth(),
        reviewedAt.getUTCDate(),
        reviewedAt.getUTCHours(),
        reviewedAt.getUTCMinutes(),
        reviewedAt.getUTCSeconds(),
        reviewedAt.getUTCMilliseconds()
      )
    );
    expect(expires.toISOString()).toBe(expected.toISOString());
  });
});
