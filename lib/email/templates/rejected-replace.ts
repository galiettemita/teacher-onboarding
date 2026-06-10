/**
 * Reminder #2 (§11.1 row 2):
 *   "Your most recent submission was rejected — please upload a replacement."
 *
 * §11.3 rule 5: do NOT include the rejection reason. The portal shows it
 * after login. The email is intentionally generic ("an item needs
 * attention") so it can't leak PII embedded in a reason like
 * "name doesn't match passport for Jane Q. Public, DOB 1985-01-02".
 */

import { escapeHtml } from "../sanitize";
import {
  type BaseCtx,
  type RenderedEmail,
  renderHtmlShell,
  renderTextShell,
} from "./base";

export function render(ctx: BaseCtx): RenderedEmail {
  const subject = `Action needed: ${ctx.documentType.name} needs to be re-uploaded`;

  const text = renderTextShell(
    [
      `Hi ${ctx.teacher.firstName},`,
      `Your most recent ${ctx.documentType.name} submission needs another look. Please log in to the portal to see the details and upload a replacement.`,
      `Log in: ${ctx.settings.portalUrl}`,
      `Thank you!`,
    ],
    ctx.settings
  );

  const html = renderHtmlShell(
    `
    <p>Hi ${escapeHtml(ctx.teacher.firstName)},</p>
    <p>Your most recent <strong>${escapeHtml(
      ctx.documentType.name
    )}</strong> submission needs another look. Please log in to the portal to see the details and upload a replacement.</p>
    <p><a href="${escapeHtml(ctx.settings.portalUrl)}">Log in to the portal</a></p>
    <p>Thank you!</p>`,
    ctx.settings
  );

  return { subject, text, html };
}
