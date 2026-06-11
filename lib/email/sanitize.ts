/**
 * Email header & content sanitisation.
 *
 * Threat model (mirrors docs/SECURITY.md row 13 added by Phase 6):
 *
 *   Email header injection (CWE-93). Any caller-supplied value that lands
 *   in a header (To, Subject, From display name) or in the SMTP body must
 *   not be able to inject extra headers, additional recipients, or break
 *   out of the MIME envelope. The classic vector is a CR/LF in a
 *   user-controlled field; on a vulnerable transport the bytes after the
 *   newline are interpreted as a new header line:
 *
 *     Subject: hello\r\nBcc: attacker@evil.example
 *
 *   We always pass values through a hosted REST API (Resend), so the
 *   classic SMTP path is closed, but the API itself accepts a `subject`
 *   string and a `from` string we build. Resend (and any sane provider)
 *   strips control chars, but we MUST NOT rely on that — we sanitise on
 *   our side and reject anything suspicious. Belt + braces.
 *
 *   For the `to` field we go further: only an exact RFC-5321-shaped
 *   address is accepted, no display name, no comma-separated lists.
 *   Multi-recipient sends are forbidden by the dispatcher contract
 *   (PROJECT_CONTEXT §11.3 rule 4); rejecting commas defends that here.
 *
 * Everything in this module is pure — no I/O, no state — so it's cheap
 * to call on every send and trivial to unit-test.
 */

/** Hard caps. Generous enough for real values, tight enough to block abuse. */
export const MAX_EMAIL_LENGTH = 254; // RFC 5321 §4.5.3.1.3
export const MAX_SUBJECT_LENGTH = 200; // emails with longer subjects are spam
export const MAX_DISPLAY_NAME_LENGTH = 100;
export const MAX_TEXT_BODY_LENGTH = 50_000;
export const MAX_HTML_BODY_LENGTH = 100_000;

/**
 * Anything in the C0 control range OR DEL except space (0x20) and the
 * useful body whitespace (\t 0x09, \n 0x0A, \r 0x0D). Headers must not
 * contain ANY of these; bodies must not contain anything outside the
 * useful three.
 */
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u;
const HAS_NEWLINE_RE = /[\r\n]/u;

/**
 * Mostly-permissive email regex. We're not validating reachability — the
 * provider will bounce a bad address — we're rejecting shapes that could
 * smuggle a header. Disallows: whitespace, control chars, comma (list
 * separator), semicolon (some clients accept), and angle brackets
 * (display-name-shaped addresses).
 */
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/u;

export class HeaderInjectionError extends Error {
  constructor(field: string, reason: string) {
    super(`Refusing to send: ${field} ${reason}`);
    this.name = "HeaderInjectionError";
  }
}

function rejectNewlines(field: string, value: string): void {
  if (HAS_NEWLINE_RE.test(value)) {
    throw new HeaderInjectionError(field, "contains newline characters");
  }
}

function rejectControlChars(field: string, value: string): void {
  if (CONTROL_CHARS_RE.test(value)) {
    throw new HeaderInjectionError(field, "contains control characters");
  }
}

/**
 * Validate a recipient address. Single address only — no `a@x.com,
 * b@x.com` lists, no `Name <a@x.com>` display-name form. The dispatcher
 * passes the teacher's `users.email` straight through, which is already
 * citext-lowercased; we additionally trim and lowercase here to be safe.
 *
 * Throws on anything that doesn't match.
 */
export function sanitizeRecipient(raw: string | null | undefined): string {
  if (!raw) throw new HeaderInjectionError("to", "is empty");
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new HeaderInjectionError("to", "is empty");
  if (trimmed.length > MAX_EMAIL_LENGTH) {
    throw new HeaderInjectionError("to", `exceeds ${MAX_EMAIL_LENGTH} chars`);
  }
  rejectNewlines("to", trimmed);
  rejectControlChars("to", trimmed);
  if (!EMAIL_RE.test(trimmed)) {
    throw new HeaderInjectionError("to", "is not a single plain email address");
  }
  return trimmed.toLowerCase();
}

/**
 * Validate a subject line. Newlines or control chars → reject. Length cap.
 * Returns the trimmed value (we don't lowercase or otherwise mangle —
 * subjects render to humans).
 */
export function sanitizeSubject(raw: string | null | undefined): string {
  if (!raw) throw new HeaderInjectionError("subject", "is empty");
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new HeaderInjectionError("subject", "is empty");
  if (trimmed.length > MAX_SUBJECT_LENGTH) {
    throw new HeaderInjectionError(
      "subject",
      `exceeds ${MAX_SUBJECT_LENGTH} chars`
    );
  }
  rejectNewlines("subject", trimmed);
  rejectControlChars("subject", trimmed);
  return trimmed;
}

/**
 * Validate a display name (the part before the angle brackets in `Name
 * <a@x.com>`). Header-injection rules + no `<`, `>`, or `"` so the caller
 * can safely build the From header by concatenation without quoting
 * gymnastics.
 */
export function sanitizeDisplayName(raw: string | null | undefined): string {
  if (!raw) throw new HeaderInjectionError("display name", "is empty");
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new HeaderInjectionError("display name", "is empty");
  }
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new HeaderInjectionError(
      "display name",
      `exceeds ${MAX_DISPLAY_NAME_LENGTH} chars`
    );
  }
  rejectNewlines("display name", trimmed);
  rejectControlChars("display name", trimmed);
  if (/[<>"]/u.test(trimmed)) {
    throw new HeaderInjectionError(
      "display name",
      "contains angle brackets or quotes"
    );
  }
  return trimmed;
}

/**
 * Build a `From:`-shaped string from a sender display name + email. Both
 * inputs go through their own sanitisers, so the output is safe to drop
 * into the provider's `from` field. We never accept a pre-built `from`
 * string from the caller.
 */
export function buildFromHeader(name: string, email: string): string {
  const cleanName = sanitizeDisplayName(name);
  const cleanEmail = sanitizeRecipient(email);
  return `${cleanName} <${cleanEmail}>`;
}

/**
 * Validate a plain-text body. Allows \r, \n, \t — everything else in the
 * C0/DEL range is rejected. We also cap length aggressively; outbound
 * emails are short by design.
 */
export function sanitizeTextBody(raw: string): string {
  if (typeof raw !== "string") {
    throw new HeaderInjectionError("text body", "is not a string");
  }
  if (raw.length > MAX_TEXT_BODY_LENGTH) {
    throw new HeaderInjectionError(
      "text body",
      `exceeds ${MAX_TEXT_BODY_LENGTH} chars`
    );
  }
  rejectControlChars("text body", raw);
  return raw;
}

/**
 * Validate an optional HTML body. Same control-char rejection as the
 * text body; bigger length cap because HTML is markup-heavy. We do NOT
 * sanitise HTML against XSS here — the email client renders it in its
 * own sandbox, and §11.3 forbids external image hosts. Templates are
 * authored in-tree so the markup is trusted; the only dynamic
 * interpolation is the teacher's name and the doc type name, which
 * templates HTML-escape themselves.
 */
export function sanitizeHtmlBody(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== "string") {
    throw new HeaderInjectionError("html body", "is not a string");
  }
  if (raw.length === 0) return undefined;
  if (raw.length > MAX_HTML_BODY_LENGTH) {
    throw new HeaderInjectionError(
      "html body",
      `exceeds ${MAX_HTML_BODY_LENGTH} chars`
    );
  }
  rejectControlChars("html body", raw);
  return raw;
}

/**
 * Minimal HTML-escape for values interpolated into HTML templates. Use
 * this whenever a template embeds dynamic text — teacher first name,
 * document type name. Order matters: `&` must come first.
 */
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
