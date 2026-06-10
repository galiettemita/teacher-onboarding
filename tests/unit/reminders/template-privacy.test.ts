import { describe, expect, it } from "vitest";
import {
  renderAllPreviews,
  renderTeacherTemplate,
  type TeacherTemplateType,
} from "@/lib/email/templates";
import {
  SAMPLE_DOC_TYPE,
  SAMPLE_SETTINGS,
  SAMPLE_TEACHER,
} from "@/lib/email/templates/base";

/**
 * Privacy invariants every template must uphold (§11.3). We assert
 * against the RENDERED OUTPUT — not against internal helpers — because
 * what matters is what would end up in the mailbox.
 *
 * Mirrors the §11.8 "privacy: no attachments / no cross-teacher data"
 * test entries, but at the template layer where each type can be
 * exhaustively covered against the sample context.
 */

const FORBIDDEN_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // Storage keys / signed URLs / file IDs (§11.3 #2, #3).
  { name: "s3 url", re: /https?:\/\/[^"'\s<>]*amazonaws\.com/i },
  { name: "r2 url", re: /https?:\/\/[^"'\s<>]*r2\.cloudflarestorage\.com/i },
  { name: "supabase storage path", re: /\/storage\/v1\/object\//i },
  { name: "signed url query", re: /[?&](X-Amz-Signature|sig|token)=/ },
  { name: "storage key prefix", re: /teachers\/[0-9a-f-]+\//i },
  { name: "file id-looking UUID path", re: /\/files\/[0-9a-f-]{36}/i },
  // Auth bypass tokens (§11.3 #7).
  { name: "auth token", re: /\bjwt=|\bsession_token=|\bauthorization=/i },
];

const ALLOWED_URL = SAMPLE_SETTINGS.portalUrl;

function assertPrivacySafe(label: string, body: string) {
  for (const { name, re } of FORBIDDEN_PATTERNS) {
    expect(body.match(re), `${label} contained forbidden ${name}`).toBeNull();
  }
  // The ONLY http(s):// in the email is the portal URL.
  const urls = body.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  for (const url of urls) {
    expect(url, `${label} contained an unexpected URL: ${url}`).toBe(ALLOWED_URL);
  }
}

describe("template privacy — every teacher template", () => {
  for (const preview of renderAllPreviews()) {
    it(`${preview.type} (${preview.audience}) — text body is privacy-safe`, () => {
      assertPrivacySafe(`${preview.type}.text`, preview.rendered.text);
    });
    it(`${preview.type} (${preview.audience}) — html body is privacy-safe`, () => {
      assertPrivacySafe(`${preview.type}.html`, preview.rendered.html);
    });
    it(`${preview.type} (${preview.audience}) — subject is plain-text and short`, () => {
      expect(preview.rendered.subject).not.toMatch(/[\r\n]/);
      expect(preview.rendered.subject.length).toBeLessThan(200);
      expect(preview.rendered.subject.length).toBeGreaterThan(0);
    });
    it(`${preview.type} — text body uses §11.3 #10 footer`, () => {
      expect(preview.rendered.text).toContain(SAMPLE_SETTINGS.schoolName);
      expect(preview.rendered.text).toContain("received this in error");
      expect(preview.rendered.text).toContain(SAMPLE_SETTINGS.portalUrl);
    });
  }
});

describe("template HTML safety", () => {
  it("escapes <script> in the teacher's first name (XSS in the mail client)", () => {
    const ctx = {
      teacher: { firstName: "<script>alert(1)</script>" },
      documentType: SAMPLE_DOC_TYPE,
      settings: SAMPLE_SETTINGS,
    };
    const out = renderTeacherTemplate(
      "missing_required" satisfies TeacherTemplateType,
      ctx
    );
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    // Text body intentionally does NOT need HTML escaping — it's plain text.
    expect(out.text).toContain("<script>alert(1)</script>");
  });

  it("escapes special chars in the document type name", () => {
    const out = renderTeacherTemplate("expiring_30", {
      teacher: SAMPLE_TEACHER,
      documentType: { name: "Cred & <stuff>" },
      settings: SAMPLE_SETTINGS,
      expiresOn: "2026-09-01",
    });
    expect(out.html).toContain("Cred &amp; &lt;stuff&gt;");
    expect(out.html).not.toContain("<stuff>");
  });

  it("never has an <img> tag (no external image hosts per §11.3 #8)", () => {
    for (const preview of renderAllPreviews()) {
      expect(preview.rendered.html.toLowerCase()).not.toContain("<img");
    }
  });

  it("never references attachments", () => {
    for (const preview of renderAllPreviews()) {
      expect(preview.rendered.text.toLowerCase()).not.toContain("attached");
      expect(preview.rendered.text.toLowerCase()).not.toContain("attachment");
      expect(preview.rendered.html.toLowerCase()).not.toContain("attached");
      expect(preview.rendered.html.toLowerCase()).not.toContain("attachment");
    }
  });
});
