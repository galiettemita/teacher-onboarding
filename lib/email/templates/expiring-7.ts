/**
 * Reminder #3 — milestone "7 days before expiration". Last gentle nudge
 * before the doc transitions to expired.
 */

import { escapeHtml } from "../sanitize";
import {
  type ExpiryCtx,
  type RenderedEmail,
  renderHtmlShell,
  renderTextShell,
} from "./base";

export function render(ctx: ExpiryCtx): RenderedEmail {
  const subject = `Urgent: ${ctx.documentType.name} expires in 1 week (${ctx.expiresOn})`;

  const text = renderTextShell(
    [
      `Hi ${ctx.teacher.firstName},`,
      `Your ${ctx.documentType.name} expires on ${ctx.expiresOn} — only 1 week from now. Please upload your renewal today if you can; once the document expires, you'll see an "expired" badge on your dashboard until a new one is approved.`,
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
    )}</strong> — only 1 week from now. Please upload your renewal today if you can; once the document expires, you'll see an "expired" badge on your dashboard until a new one is approved.</p>
    <p><a href="${escapeHtml(ctx.settings.portalUrl)}">Log in to the portal</a></p>`,
    ctx.settings
  );

  return { subject, text, html };
}
