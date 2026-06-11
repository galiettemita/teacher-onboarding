/**
 * Shared email-template scaffolding.
 *
 * Outbound email templates own a file in this directory that exports a
 * `render(ctx)` returning a `RenderedEmail`. They share two primitives:
 *
 *  - `SettingsCtx`: a strict shape that admits ONLY the sender display
 *    fields and the portal URL a template is allowed to see — never an
 *    API key or any secret.
 *
 *  - the footer/shell helpers: the mandatory privacy footer (school name,
 *    "received in error" line, portal URL as plain text) and the document
 *    shell with no external resources.
 *
 * Templates are pure functions. No DB, no I/O. Tests render them against
 * fixed contexts and assert byte-level equality + privacy invariants.
 */

import { escapeHtml } from "../sanitize";

/**
 * The settings a template reads. Only the sender display fields and the
 * portal URL — never the API key or any secret.
 */
export interface SettingsCtx {
  schoolName: string;
  portalUrl: string;
}

/**
 * A single rendered email. Templates return one of these; the caller
 * hands it to `sendEmail`.
 */
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Plain-text footer. Always identical shape so tests can match on it.
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

/** HTML footer. */
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
 * resources (no `<link>`, no `<img src=…>`) — never any tracking pixels
 * or external hosts.
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
