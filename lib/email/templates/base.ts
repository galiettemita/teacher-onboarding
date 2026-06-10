/**
 * Shared template scaffolding.
 *
 * Each reminder type owns a file in this directory that exports
 * `subject(ctx)`, `text(ctx)`, and `html(ctx)`. They share two
 * primitives:
 *
 *  - Context types: strict shapes that admit ONLY the fields a template
 *    is allowed to see. The type system enforces the §11.3 privacy rules
 *    (no storage keys, no file IDs, no cross-teacher data) — if a
 *    template asks for `storageKey`, the type signature won't compile.
 *
 *  - `renderFooter`: the mandatory §11.3 rule 10 footer (school name,
 *    "received in error" line, portal URL as plain text).
 *
 * Templates are pure functions. No DB, no I/O. Tests render them
 * against fixed contexts and assert byte-level equality + privacy
 * invariants.
 */

import { escapeHtml } from "../sanitize";

/**
 * The MINIMUM a teacher-facing reminder needs to know about its
 * recipient. First name only — no email (the dispatcher pulls that from
 * `users.email`), no phone, no profile fields.
 */
export interface TeacherCtx {
  firstName: string;
}

/**
 * The MINIMUM a reminder needs to know about a document. The public
 * `name` only — never the storage key, original filename, mime type, or
 * any field that maps to a file.
 */
export interface DocumentTypeCtx {
  name: string;
}

/**
 * The settings a template reads. Only the sender display fields and the
 * portal URL — never the API key, never the master toggle, etc.
 */
export interface SettingsCtx {
  schoolName: string;
  portalUrl: string;
}

/** Base context shared by every teacher-facing template. */
export interface BaseCtx {
  teacher: TeacherCtx;
  documentType: DocumentTypeCtx;
  settings: SettingsCtx;
}

/** Used by expiring/expired-recurring templates. */
export interface ExpiryCtx extends BaseCtx {
  /** Pre-formatted `YYYY-MM-DD` in the school's nominal timezone. */
  expiresOn: string;
}

/** Used by expired_today template. */
export interface ExpiredCtx extends BaseCtx {
  expiredOn: string;
}

/** Used by expired_recurring. */
export interface ExpiredRecurringCtx extends BaseCtx {
  expiredOn: string;
  /** Days since expiration, for cadence wording. */
  daysOverdue: number;
}

/** Used by the admin-alert template. The admin is a teacher in the
 * `users` table; we treat their `firstName` the same way. */
export interface AdminAlertCtx {
  admin: TeacherCtx;
  teacherDisplay: string; // teacher's first name only — never email, never full PII
  documentType: DocumentTypeCtx;
  daysPending: number;
  settings: SettingsCtx;
}

/**
 * A single rendered email. Templates return one of these; the
 * dispatcher hands it to `sendEmail`.
 */
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * §11.3 rule 10 footer for plain-text. Always identical shape so the
 * smoke script and tests can match on it.
 */
export function renderTextFooter(settings: SettingsCtx): string {
  return [
    "",
    "—",
    settings.schoolName,
    "If you received this in error, please ignore the message.",
    `Portal: ${settings.portalUrl}`,
  ].join("\n");
}

/** §11.3 rule 10 footer for HTML. */
export function renderHtmlFooter(settings: SettingsCtx): string {
  const school = escapeHtml(settings.schoolName);
  const portal = escapeHtml(settings.portalUrl);
  return `
    <hr style="border:none;border-top:1px solid #ccc;margin:24px 0">
    <p style="color:#666;font-size:12px;line-height:1.5">
      ${school}<br>
      If you received this in error, please ignore the message.<br>
      Portal: <span style="color:#666">${portal}</span>
    </p>`;
}

/**
 * Wrap the body fragments in a complete HTML document. No external
 * resources (no `<link>`, no `<img src=…>`) — §11.3 rule 8 forbids
 * tracking pixels and external hosts.
 */
export function renderHtmlShell(bodyFragment: string, settings: SettingsCtx): string {
  return [
    "<!doctype html>",
    '<html lang="en"><body style="font-family:system-ui,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:16px">',
    bodyFragment,
    renderHtmlFooter(settings),
    "</body></html>",
  ].join("");
}

/**
 * Plain-text body assembly. Each line in `lines` is a paragraph; we
 * join with double newlines, then append the footer.
 */
export function renderTextShell(lines: string[], settings: SettingsCtx): string {
  return lines.join("\n\n") + renderTextFooter(settings);
}

/**
 * Sample contexts for the `/admin/reminders/preview` page. Same shape
 * the dispatcher uses at runtime; values are fictional but never empty
 * (so the preview matches real-world layout). These constants live next
 * to the template machinery rather than in the preview route so a new
 * reminder type can't be added without also adding a preview sample.
 */
export const SAMPLE_TEACHER: TeacherCtx = { firstName: "Pat" };
export const SAMPLE_DOC_TYPE: DocumentTypeCtx = { name: "Teaching Credential" };
export const SAMPLE_SETTINGS: SettingsCtx = {
  schoolName: "Sample Elementary School",
  portalUrl: "https://onboarding.example.org",
};
