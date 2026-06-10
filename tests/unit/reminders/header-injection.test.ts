import { describe, expect, it } from "vitest";
import {
  HeaderInjectionError,
  buildFromHeader,
  escapeHtml,
  sanitizeDisplayName,
  sanitizeHtmlBody,
  sanitizeRecipient,
  sanitizeSubject,
  sanitizeTextBody,
  MAX_EMAIL_LENGTH,
  MAX_SUBJECT_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_TEXT_BODY_LENGTH,
  MAX_HTML_BODY_LENGTH,
} from "@/lib/email/sanitize";

/**
 * Boundary-of-the-sanitiser tests. These guard the only choke point
 * between caller-supplied data and the outbound email payload, so the
 * coverage is intentionally aggressive — every known header-injection
 * vector gets a shot.
 */

describe("sanitizeRecipient", () => {
  it("returns a lowercased, trimmed plain address", () => {
    expect(sanitizeRecipient("  Pat@SCHOOL.org  ")).toBe("pat@school.org");
  });

  it("rejects empty / nullish", () => {
    expect(() => sanitizeRecipient("")).toThrow(HeaderInjectionError);
    expect(() => sanitizeRecipient("   ")).toThrow(HeaderInjectionError);
    expect(() => sanitizeRecipient(null)).toThrow(HeaderInjectionError);
    expect(() => sanitizeRecipient(undefined)).toThrow(HeaderInjectionError);
  });

  it("rejects CR/LF (the classic injection vector)", () => {
    expect(() => sanitizeRecipient("a@x.com\nBcc: e@v.x")).toThrow(
      HeaderInjectionError
    );
    expect(() => sanitizeRecipient("a@x.com\r\nBcc: e@v.x")).toThrow(
      HeaderInjectionError
    );
    expect(() => sanitizeRecipient("a@x.com\rBcc: e@v.x")).toThrow(
      HeaderInjectionError
    );
  });

  it("rejects URL-encoded CR/LF (caller's job to decode but defence in depth)", () => {
    // %0A is the URL-encoded \n; we DO NOT decode, but the post-decode
    // attacker still has to get past us. Verify the raw literal of
    // an attempted bypass that already includes the decoded byte:
    const decoded = "a@x.com" + decodeURIComponent("%0A") + "Bcc: e@v.x";
    expect(() => sanitizeRecipient(decoded)).toThrow(HeaderInjectionError);
  });

  it("rejects multi-address lists", () => {
    expect(() => sanitizeRecipient("a@x.com, b@x.com")).toThrow(
      HeaderInjectionError
    );
    expect(() => sanitizeRecipient("a@x.com;b@x.com")).toThrow(
      HeaderInjectionError
    );
  });

  it("rejects display-name-shaped addresses (`Name <a@x.com>`)", () => {
    expect(() => sanitizeRecipient("Name <a@x.com>")).toThrow(
      HeaderInjectionError
    );
  });

  it("rejects oversized inputs", () => {
    const huge = "a".repeat(MAX_EMAIL_LENGTH + 1) + "@x.com";
    expect(() => sanitizeRecipient(huge)).toThrow(HeaderInjectionError);
  });

  it("rejects raw control bytes (NUL, BEL, VT, etc.)", () => {
    expect(() => sanitizeRecipient("a\x00@x.com")).toThrow(HeaderInjectionError);
    expect(() => sanitizeRecipient("a\x07@x.com")).toThrow(HeaderInjectionError);
    expect(() => sanitizeRecipient("a@x.com\x7f")).toThrow(HeaderInjectionError);
  });
});

describe("sanitizeSubject", () => {
  it("accepts a normal subject", () => {
    expect(sanitizeSubject("Heads up: your credential expires soon")).toBe(
      "Heads up: your credential expires soon"
    );
  });

  it("rejects newlines (header injection)", () => {
    expect(() =>
      sanitizeSubject("hello\r\nBcc: e@v.x")
    ).toThrow(HeaderInjectionError);
    expect(() => sanitizeSubject("a\nb")).toThrow(HeaderInjectionError);
  });

  it("rejects oversized", () => {
    expect(() => sanitizeSubject("x".repeat(MAX_SUBJECT_LENGTH + 1))).toThrow();
  });

  it("rejects control characters", () => {
    expect(() => sanitizeSubject("hi\x00there")).toThrow(HeaderInjectionError);
  });
});

describe("sanitizeDisplayName", () => {
  it("accepts a normal name", () => {
    expect(sanitizeDisplayName("Onboarding Portal")).toBe("Onboarding Portal");
  });

  it("rejects angle brackets (would smuggle the address)", () => {
    expect(() =>
      sanitizeDisplayName("Sneaky <evil@v.x")
    ).toThrow(HeaderInjectionError);
    expect(() => sanitizeDisplayName('"quoted"')).toThrow(HeaderInjectionError);
  });

  it("rejects newlines", () => {
    expect(() => sanitizeDisplayName("Name\nBcc: e@v.x")).toThrow(
      HeaderInjectionError
    );
  });

  it("rejects oversized", () => {
    expect(() =>
      sanitizeDisplayName("x".repeat(MAX_DISPLAY_NAME_LENGTH + 1))
    ).toThrow();
  });
});

describe("buildFromHeader", () => {
  it("joins a sanitised name and address", () => {
    expect(buildFromHeader("Onboarding Portal", "noreply@school.org")).toBe(
      "Onboarding Portal <noreply@school.org>"
    );
  });

  it("rejects attempted name injection of a second address", () => {
    expect(() =>
      buildFromHeader("name <evil@v.x", "noreply@school.org")
    ).toThrow(HeaderInjectionError);
  });
});

describe("sanitizeTextBody", () => {
  it("permits the useful whitespace (\\n, \\r, \\t)", () => {
    const body = "line 1\nline 2\r\nline 3\twith tab";
    expect(sanitizeTextBody(body)).toBe(body);
  });

  it("rejects control bytes that aren't whitespace", () => {
    expect(() => sanitizeTextBody("hi\x00")).toThrow(HeaderInjectionError);
    expect(() => sanitizeTextBody("hi\x1f")).toThrow(HeaderInjectionError);
  });

  it("rejects oversized text bodies", () => {
    expect(() => sanitizeTextBody("x".repeat(MAX_TEXT_BODY_LENGTH + 1))).toThrow();
  });
});

describe("sanitizeHtmlBody", () => {
  it("returns undefined when input is undefined/empty", () => {
    expect(sanitizeHtmlBody(undefined)).toBeUndefined();
    expect(sanitizeHtmlBody(null)).toBeUndefined();
    expect(sanitizeHtmlBody("")).toBeUndefined();
  });

  it("permits common markup", () => {
    const html = "<p>hi</p><a href='https://x'>link</a>";
    expect(sanitizeHtmlBody(html)).toBe(html);
  });

  it("rejects control bytes", () => {
    expect(() => sanitizeHtmlBody("<p>hi\x00</p>")).toThrow(HeaderInjectionError);
  });

  it("rejects oversized", () => {
    expect(() => sanitizeHtmlBody("x".repeat(MAX_HTML_BODY_LENGTH + 1))).toThrow();
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML special chars", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;"
    );
  });

  it("ampersands escape FIRST so other escapes aren't double-encoded", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});
