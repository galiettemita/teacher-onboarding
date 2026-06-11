/**
 * HTML-escaping for values interpolated into invitation templates.
 *
 * Pure, no I/O. Use whenever a template embeds dynamic text (e.g. the
 * teacher's first name) so it can't break out of the surrounding markup.
 */

/**
 * Minimal HTML-escape. Order matters: `&` must come first.
 */
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
