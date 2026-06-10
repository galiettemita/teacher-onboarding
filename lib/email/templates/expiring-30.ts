/**
 * Reminder #3 — milestone "30 days before expiration". Tone gets more
 * direct here.
 */

import { escapeHtml } from "../sanitize";
import {
  type ExpiryCtx,
  type RenderedEmail,
  renderHtmlShell,
  renderTextShell,
} from "./base";

export function render(ctx: ExpiryCtx): RenderedEmail {
  const subject = `Renewal due soon: ${ctx.documentType.name} expires ${ctx.expiresOn}`;

  const text = renderTextShell(
    [
      `Hi ${ctx.teacher.firstName},`,
      `Your ${ctx.documentType.name} expires on ${ctx.expiresOn} — about 30 days from now. Please log in to the portal and upload your renewal soon.`,
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
    )}</strong> — about 30 days from now. Please log in to the portal and upload your renewal soon.</p>
    <p><a href="${escapeHtml(ctx.settings.portalUrl)}">Log in to the portal</a></p>`,
    ctx.settings
  );

  return { subject, text, html };
}
