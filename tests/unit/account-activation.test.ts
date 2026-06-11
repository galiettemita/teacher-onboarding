import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

/**
 * Activation + re-invite query logic. We mock the db client to capture the
 * UPDATE `set(...)` payloads and feed SELECT results, so we can assert the
 * exact state transitions without a database.
 */

type Row = Record<string, unknown>;

const selectRows: Row[][] = [];
let updateSet: Row | null = null;

function makeSelectChain() {
  const rows = selectRows.shift() ?? [];
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    then: (resolve: (v: Row[]) => unknown) => resolve(rows),
  };
  return chain;
}

const tx = {
  select: () => makeSelectChain(),
  update: () => ({
    set: (s: Row) => {
      updateSet = s;
      return { where: async () => {} };
    },
  }),
  insert: () => ({ values: async () => {} }),
};

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => makeSelectChain(),
    transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
  },
}));

vi.mock("@/lib/audit/log", () => ({ auditLog: vi.fn(async () => {}) }));

import { activateAccount } from "@/lib/db/queries/activation";
import { reinviteTeacher } from "@/lib/db/queries/admin-teachers";

const teacher = { id: "11111111-1111-1111-1111-111111111111", role: "teacher" };
const admin = { id: "22222222-2222-2222-2222-222222222222", role: "admin" };

beforeEach(() => {
  selectRows.length = 0;
  updateSet = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("activateAccount", () => {
  it("rejects a password shorter than the policy minimum", async () => {
    await expect(
      activateAccount(teacher, { newPassword: "short", confirmPassword: "short" })
    ).rejects.toThrow(/at least 12/);
    expect(updateSet).toBeNull();
  });

  it("rejects when the two passwords do not match", async () => {
    await expect(
      activateAccount(teacher, {
        newPassword: "a-good-long-password",
        confirmPassword: "a-different-password",
      })
    ).rejects.toThrow(/do not match/);
    expect(updateSet).toBeNull();
  });

  it("refuses to re-activate an already-activated account", async () => {
    selectRows.push([
      { id: teacher.id, mustChangePassword: false, passwordHash: await bcrypt.hash("whatever", 4) },
    ]);
    await expect(
      activateAccount(teacher, {
        newPassword: "a-good-long-password",
        confirmPassword: "a-good-long-password",
      })
    ).rejects.toThrow(/already activated/);
    expect(updateSet).toBeNull();
  });

  it("rejects reusing the temporary password", async () => {
    const tempHash = await bcrypt.hash("temporary-pass-123", 4);
    selectRows.push([{ id: teacher.id, mustChangePassword: true, passwordHash: tempHash }]);
    await expect(
      activateAccount(teacher, {
        newPassword: "temporary-pass-123",
        confirmPassword: "temporary-pass-123",
      })
    ).rejects.toThrow(/different from your temporary password/);
    expect(updateSet).toBeNull();
  });

  it("activates: sets a new hash, clears the gate, stamps activatedAt", async () => {
    const tempHash = await bcrypt.hash("temporary-pass-123", 4);
    selectRows.push([{ id: teacher.id, mustChangePassword: true, passwordHash: tempHash }]);

    const before = Date.now();
    await activateAccount(teacher, {
      newPassword: "brand-new-strong-password",
      confirmPassword: "brand-new-strong-password",
    });
    const after = Date.now();

    expect(updateSet).not.toBeNull();
    expect(updateSet?.mustChangePassword).toBe(false);
    expect(updateSet?.activatedAt).toBeInstanceOf(Date);
    expect((updateSet?.activatedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect((updateSet?.activatedAt as Date).getTime()).toBeLessThanOrEqual(after);

    // New hash differs from the temporary one, and the temporary password no
    // longer matches the stored hash.
    const newHash = updateSet?.passwordHash as string;
    expect(newHash).not.toBe(tempHash);
    expect(await bcrypt.compare("temporary-pass-123", newHash)).toBe(false);
    expect(await bcrypt.compare("brand-new-strong-password", newHash)).toBe(true);
  });
});

describe("reinviteTeacher", () => {
  it("refuses to re-invite an already-activated teacher", async () => {
    selectRows.push([
      { id: "t-1", email: "t@example.com", name: "T", role: "teacher", mustChangePassword: false },
    ]);
    await expect(reinviteTeacher(admin, "t-1")).rejects.toThrow(/already activated/);
    expect(updateSet).toBeNull();
  });

  it("regenerates the temp password and keeps the account pending activation", async () => {
    selectRows.push([
      { id: "t-1", email: "t@example.com", name: "T", role: "teacher", mustChangePassword: true },
    ]);

    const result = await reinviteTeacher(admin, "t-1");

    expect(updateSet?.mustChangePassword).toBe(true);
    expect(updateSet?.activatedAt).toBeNull();
    expect(typeof result.temporaryPassword).toBe("string");
    expect(result.temporaryPassword.length).toBeGreaterThan(16);
    // The stored hash matches the freshly issued temporary password.
    expect(await bcrypt.compare(result.temporaryPassword, updateSet?.passwordHash as string)).toBe(true);
  });
});
