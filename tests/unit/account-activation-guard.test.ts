import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email?: string; name?: string; role: "teacher" | "admin" } },
  mustChangePassword: false,
  userMissing: false,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("@/lib/auth/config", () => ({
  auth: async () => state.session,
}));

vi.mock("@/lib/db/queries/activation", () => ({
  getActivationStatus: async () =>
    state.userMissing ? null : { mustChangePassword: state.mustChangePassword },
}));

describe("account activation guard", () => {
  beforeEach(() => {
    state.session = {
      user: { id: "teacher-1", email: "teacher@example.com", name: "Teacher", role: "teacher" },
    };
    state.mustChangePassword = false;
    state.userMissing = false;
  });

  it("allows teachers who have activated their account", async () => {
    const { requireTeacherReady } = await import("@/lib/auth/guards");

    await expect(requireTeacherReady()).resolves.toMatchObject({
      id: "teacher-1",
      role: "teacher",
    });
  });

  it("redirects teachers who still need to activate their account", async () => {
    state.mustChangePassword = true;
    const { requireTeacherReady } = await import("@/lib/auth/guards");

    await expect(requireTeacherReady()).rejects.toThrow("NEXT_REDIRECT:/teacher/activate");
  });

  it("redirects to login when the session user no longer exists (deleted)", async () => {
    state.userMissing = true;
    const { requireTeacherReady } = await import("@/lib/auth/guards");

    await expect(requireTeacherReady()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
