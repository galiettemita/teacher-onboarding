import { describe, expect, it } from "vitest";
import { renderTeacherInvite } from "@/lib/email/templates/teacher-invite";

const ctx = {
  teacher: { firstName: "Pat" },
  settings: {
    schoolName: "Sample Elementary School",
    portalUrl: "https://onboarding.example.org/login",
  },
  temporaryPassword: "temporary-test-password",
};

describe("teacher invite email", () => {
  it("includes the login URL and temporary password", () => {
    const rendered = renderTeacherInvite(ctx);

    expect(rendered.subject).toContain("Sample Elementary School");
    expect(rendered.text).toContain("https://onboarding.example.org/login");
    expect(rendered.text).toContain("temporary-test-password");
    expect(rendered.html).toContain("https://onboarding.example.org/login");
    expect(rendered.html).toContain("temporary-test-password");
  });

  it("escapes teacher and password values in HTML", () => {
    const rendered = renderTeacherInvite({
      ...ctx,
      teacher: { firstName: "<script>alert(1)</script>" },
      temporaryPassword: "<temporary>&password",
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("<temporary>");
    expect(rendered.html).toContain("&lt;temporary&gt;&amp;password");
  });
});
