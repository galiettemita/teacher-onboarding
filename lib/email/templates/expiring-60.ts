/**
 * Reminder #3 — milestone "60 days before expiration".
 */

import { escapeHtml } from "../sanitize";
import {
  type ExpiryCtx,
  type RenderedEmail,
  renderHtmlShell,
  renderTextShell,
} from "./base";

export function render(ctx: ExpiryCtx): RenderedEmail {
  const subject = `Reminder: ${ctx.documentType.name} expires ${ctx.expiresOn}`;

  const text = renderTextShell(
    [
      `Hi ${ctx.teacher.firstName},`,
      `A reminder that your ${ctx.documentType.name} expires on ${ctx.expiresOn} — about 60 days from now. If you're already working on the renewal, great; if not, this is a good time to start.`,
      `Upload the replacement any time by logging in to the portal.`,
      `Log in: ${ctx.settings.portalUrl}`,
    ],
    ctx.settings
  );

  const html = renderHtmlShell(
    `
    <p>Hi ${escapeHtml(ctx.teacher.firstName)},</p>
    <p>A reminder that your <strong>${escapeHtml(
      ctx.documentType.name
    )}</strong> expires on <strong>${escapeHtml(
      ctx.expiresOn
    )}</strong> — about 60 days from now. If you're already working on the renewal, great; if not, this is a good time to start.</p>
    <p>Upload the replacement any time by logging in to the portal.</p>
    <p><a href="${escapeHtml(ctx.settings.portalUrl)}">Log in to the portal</a></p>`,
    ctx.settings
  );

  return { subject, text, html };
}
