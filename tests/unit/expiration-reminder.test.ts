import { afterEach, describe, expect, it, vi } from "vitest";
import { renderExpirationReminder } from "@/lib/email/templates/expiration-reminder";

vi.mock("@/lib/db/queries/email-settings", () => ({
  getEmailSettings: vi.fn(async () => ({
    id: "settings",
    senderName: "Maple Elementary",
    senderEmail: "noreply@example.com",
    portalUrl: "https://portal.example.com",
  })),
}));

const settings = { schoolName: "Maple Elementary", portalUrl: "https://portal.example.com" };

afterEach(() => vi.clearAllMocks());

describe("renderExpirationReminder (pure template)", () => {
  it("includes the teacher's name, document names and expiry dates (tests 16, 17)", () => {
    const out = renderExpirationReminder({
      teacher: { name: "Jane Doe" },
      settings,
      documents: [
        { name: "Medical Form", expiresOn: "August 12, 2026", expired: false },
        { name: "CPR Certificate", expiresOn: "January 3, 2026", expired: true },
      ],
    });
    expect(out.subject).toBe("Onboarding Document Renewal Reminder");
    expect(out.text).toContain("Hi Jane Doe,");
    expect(out.text).toContain("Medical Form — expires on August 12, 2026");
    expect(out.text).toContain("CPR Certificate — expired on January 3, 2026");
    expect(out.text).toContain("Maple Elementary");
  });

  it("only lists the documents it was given (no other teacher's docs — test 18)", () => {
    const out = renderExpirationReminder({
      teacher: { name: "Jane Doe" },
      settings,
      documents: [{ name: "Medical Form", expiresOn: "August 12, 2026", expired: false }],
    });
    expect(out.text).toContain("Medical Form");
    expect(out.text).not.toContain("CPR Certificate");
    expect(out.text).not.toContain("Background Check");
  });

  it("escapes HTML in the html body (no injection)", () => {
    const out = renderExpirationReminder({
      teacher: { name: "<script>x</script>" },
      settings,
      documents: [{ name: "<b>doc</b>", expiresOn: "2026", expired: false }],
    });
    expect(out.html).not.toContain("<script>x</script>");
    expect(out.html).toContain("&lt;script&gt;");
  });
});

describe("buildExpirationDraft (test 19, 20)", () => {
  it("returns null when there are no expiring/expired docs (test 19)", async () => {
    const { buildExpirationDraft } = await import("@/lib/email/expiration-draft");
    const draft = await buildExpirationDraft({ teacherName: "Jane", items: [] });
    expect(draft).toBeNull();
  });

  it("builds a draft (subject + text) and never sends it (test 20)", async () => {
    const { buildExpirationDraft } = await import("@/lib/email/expiration-draft");
    const draft = await buildExpirationDraft({
      teacherName: "Jane Doe",
      items: [
        {
          documentId: "d1",
          documentTypeId: "t1",
          documentTypeName: "Medical Form",
          uploadedAt: new Date("2024-08-12T00:00:00Z"),
          expiresAt: new Date("2026-08-12T00:00:00Z"),
          daysRemaining: 30,
          state: "expiring_soon",
        },
      ],
    });
    expect(draft).not.toBeNull();
    expect(draft!.subject).toBe("Onboarding Document Renewal Reminder");
    expect(draft!.text).toContain("Medical Form — expires on August 12, 2026");
    // The draft is a plain data object — there is no send capability.
    expect(Object.keys(draft!).sort()).toEqual(["subject", "text"]);
  });
});
