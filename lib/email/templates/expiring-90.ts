/**
 * Reminder #3 (§11.1 row 3) — milestone "90 days before expiration".
 *
 * Friendly heads-up tone. The 90-day milestone is the gentlest in the
 * series; we don't say "urgent" or "soon."
 */

import { escapeHtml } from "../sanitize";
import {
  type ExpiryCtx,
  type RenderedEmail,
  renderHtmlShell,
  renderTextShell,
} from "./base";

export function render(ctx: ExpiryCtx): RenderedEmail {
  const subject = `Heads up: ${ctx.documentType.name} expires ${ctx.expiresOn}`;

  const text = renderTextShell(
    [
      `Hi ${ctx.teacher.firstName},`,
      `Just a friendly heads-up: your ${ctx.documentType.name} expires on ${ctx.expiresOn}. That's about 90 days out — plenty of time, but a good moment to start planning the renewal.`,
      `You can upload the replacement at any time before the expiration date by logging in to the portal.`,
      `Log in: ${ctx.settings.portalUrl}`,
    ],
    ctx.settings
  );

  const html = renderHtmlShell(
    `
    <p>Hi ${escapeHtml(ctx.teacher.firstName)},</p>
    <p>Just a friendly heads-up: your <strong>${escapeHtml(
      ctx.documentType.name
    )}</strong> expires on <strong>${escapeHtml(
      ctx.expiresOn
    )}</strong>. That's about 90 days out — plenty of time, but a good moment to start planning the renewal.</p>
    <p>You can upload the replacement at any time before the expiration date by logging in to the portal.</p>
    <p><a href="${escapeHtml(ctx.settings.portalUrl)}">Log in to the portal</a></p>`,
    ctx.settings
  );

  return { subject, text, html };
}
