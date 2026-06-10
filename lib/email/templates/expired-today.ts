/**
 * Reminder #4 (§11.1 row 4) — fires once when the document just
 * transitioned to `expired`.
 */

import { escapeHtml } from "../sanitize";
import {
  type ExpiredCtx,
  type RenderedEmail,
  renderHtmlShell,
  renderTextShell,
} from "./base";

export function render(ctx: ExpiredCtx): RenderedEmail {
  const subject = `Action needed: ${ctx.documentType.name} expired today`;

  const text = renderTextShell(
    [
      `Hi ${ctx.teacher.firstName},`,
      `Your ${ctx.documentType.name} expired on ${ctx.expiredOn}. Please log in to the portal and upload a renewal as soon as you can.`,
      `Log in: ${ctx.settings.portalUrl}`,
    ],
    ctx.settings
  );

  const html = renderHtmlShell(
    `
    <p>Hi ${escapeHtml(ctx.teacher.firstName)},</p>
    <p>Your <strong>${escapeHtml(
      ctx.documentType.name
    )}</strong> expired on <strong>${escapeHtml(
      ctx.expiredOn
    )}</strong>. Please log in to the portal and upload a renewal as soon as you can.</p>
    <p><a href="${escapeHtml(ctx.settings.portalUrl)}">Log in to the portal</a></p>`,
    ctx.settings
  );

  return { subject, text, html };
}
