/**
 * Reminder #3 — milestone "14 days before expiration".
 */

import { escapeHtml } from "../sanitize";
import {
  type ExpiryCtx,
  type RenderedEmail,
  renderHtmlShell,
  renderTextShell,
} from "./base";

export function render(ctx: ExpiryCtx): RenderedEmail {
  const subject = `Action needed: ${ctx.documentType.name} expires in 2 weeks (${ctx.expiresOn})`;

  const text = renderTextShell(
    [
      `Hi ${ctx.teacher.firstName},`,
      `Your ${ctx.documentType.name} expires on ${ctx.expiresOn} — only 2 weeks away. To avoid a lapse, please upload your renewal as soon as possible.`,
      `Log in: ${ctx.settings.portalUrl}`,
    ],
    ctx.settings
  );

  const html = renderHtmlShell(
    `
    <p>Hi ${escapeHtml(ctx.teacher.firstName)},</p>
    <p>Your <strong>${escapeHtml(
      ctx.documentType.name
    )}</strong> expires on <strong>${escapeHtml(
      ctx.expiresOn
    )}</strong> — only 2 weeks away. To avoid a lapse, please upload your renewal as soon as possible.</p>
    <p><a href="${escapeHtml(ctx.settings.portalUrl)}">Log in to the portal</a></p>`,
    ctx.settings
  );

  return { subject, text, html };
}
