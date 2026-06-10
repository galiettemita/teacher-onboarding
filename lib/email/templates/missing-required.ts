/**
 * Reminder #1 (PROJECT_CONTEXT §11.1 row 1):
 *   "You still have missing required documents."
 *
 * Sent on a `missing_doc_reminder_interval_days` cadence (default 14) when
 * the teacher has no current row for an active, required `document_type`.
 *
 * Privacy invariants this template upholds (§11.3):
 *  - References doc type by `name` only.
 *  - Single CTA = `settings.portalUrl`. No deep links, no tokens.
 *  - No attachments, no storage URLs.
 *  - Footer per §11.3 #10.
 */

import { escapeHtml } from "../sanitize";
import {
  type BaseCtx,
  type RenderedEmail,
  renderHtmlShell,
  renderTextShell,
} from "./base";

export function render(ctx: BaseCtx): RenderedEmail {
  const subject = `Action needed: ${ctx.documentType.name} is missing`;

  const text = renderTextShell(
    [
      `Hi ${ctx.teacher.firstName},`,
      `Our records show we don't yet have your ${ctx.documentType.name} on file. To stay on track with onboarding, please log in to the portal and upload it when you have a moment.`,
      `Log in: ${ctx.settings.portalUrl}`,
      `Thank you!`,
    ],
    ctx.settings
  );

  const html = renderHtmlShell(
    `
    <p>Hi ${escapeHtml(ctx.teacher.firstName)},</p>
    <p>Our records show we don't yet have your <strong>${escapeHtml(
      ctx.documentType.name
    )}</strong> on file. To stay on track with onboarding, please log in to the portal and upload it when you have a moment.</p>
    <p><a href="${escapeHtml(ctx.settings.portalUrl)}">Log in to the portal</a></p>
    <p>Thank you!</p>`,
    ctx.settings
  );

  return { subject, text, html };
}
