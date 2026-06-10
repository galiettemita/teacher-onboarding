/**
 * Reminder #5 (§11.1 row 5) — recurring reminder while a document is
 * expired and no replacement has been uploaded + approved. Fires on the
 * `post_expiration_interval_days` cadence (default 7).
 */

import { escapeHtml } from "../sanitize";
import {
  type ExpiredRecurringCtx,
  type RenderedEmail,
  renderHtmlShell,
  renderTextShell,
} from "./base";

export function render(ctx: ExpiredRecurringCtx): RenderedEmail {
  const subject = `Still expired: ${ctx.documentType.name} — please upload a renewal`;

  const text = renderTextShell(
    [
      `Hi ${ctx.teacher.firstName},`,
      `Your ${ctx.documentType.name} has been expired since ${ctx.expiredOn} (about ${ctx.daysOverdue} day${ctx.daysOverdue === 1 ? "" : "s"} ago). We don't yet see a replacement on file. Please log in to the portal and upload one when you can.`,
      `Log in: ${ctx.settings.portalUrl}`,
    ],
    ctx.settings
  );

  const html = renderHtmlShell(
    `
    <p>Hi ${escapeHtml(ctx.teacher.firstName)},</p>
    <p>Your <strong>${escapeHtml(
      ctx.documentType.name
    )}</strong> has been expired since <strong>${escapeHtml(
      ctx.expiredOn
    )}</strong> (about ${ctx.daysOverdue} day${
      ctx.daysOverdue === 1 ? "" : "s"
    } ago). We don't yet see a replacement on file. Please log in to the portal and upload one when you can.</p>
    <p><a href="${escapeHtml(ctx.settings.portalUrl)}">Log in to the portal</a></p>`,
    ctx.settings
  );

  return { subject, text, html };
}
