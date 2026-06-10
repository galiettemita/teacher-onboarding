/**
 * Reminder #6 (§11.1 row 6) — admin-facing alert when a document has
 * been in `pending` for longer than `pending_review_days_before_admin_alert`.
 *
 * Sent to the admin, not the teacher. Still privacy-safe: it names the
 * teacher by first name only (matches §11.3 spirit even though the
 * recipient is staff), references the doc type by `name`, and links
 * only to the portal.
 */

import { escapeHtml } from "../sanitize";
import {
  type AdminAlertCtx,
  type RenderedEmail,
  renderHtmlShell,
  renderTextShell,
} from "./base";

export function render(ctx: AdminAlertCtx): RenderedEmail {
  const subject = `Review needed: ${ctx.documentType.name} pending ${ctx.daysPending} days`;

  const text = renderTextShell(
    [
      `Hi ${ctx.admin.firstName},`,
      `${ctx.teacherDisplay}'s ${ctx.documentType.name} has been pending review for ${ctx.daysPending} days. Please log in to the portal to approve or reject it.`,
      `Log in: ${ctx.settings.portalUrl}`,
    ],
    ctx.settings
  );

  const html = renderHtmlShell(
    `
    <p>Hi ${escapeHtml(ctx.admin.firstName)},</p>
    <p>${escapeHtml(ctx.teacherDisplay)}'s <strong>${escapeHtml(
      ctx.documentType.name
    )}</strong> has been pending review for ${ctx.daysPending} days. Please log in to the portal to approve or reject it.</p>
    <p><a href="${escapeHtml(ctx.settings.portalUrl)}">Log in to the portal</a></p>`,
    ctx.settings
  );

  return { subject, text, html };
}
