import { escapeHtml } from "../sanitize";
import {
  type RenderedEmail,
  type SettingsCtx,
  renderHtmlShell,
  renderTextShell,
} from "./base";

/**
 * Teacher-specific onboarding renewal reminder.
 *
 * Pure function. The admin generates a copyable draft for a single teacher
 * that lists ONLY that teacher's expired / expiring-soon documents. The portal
 * does NOT send this — it produces a draft the admin reviews and sends out of
 * band, matching the existing email-free invitation flow.
 *
 * When `documents` is empty, callers should not render a draft at all (the UI
 * shows "no reminder needed"). We still return a well-formed message defensively.
 */
export interface ExpirationReminderDocument {
  name: string;
  /** Already-formatted, human-readable expiration date, e.g. "August 12, 2026". */
  expiresOn: string;
  /** Whether the document is already expired vs expiring soon. */
  expired: boolean;
}

export interface ExpirationReminderCtx {
  teacher: { name: string };
  settings: SettingsCtx;
  documents: ExpirationReminderDocument[];
}

function line(d: ExpirationReminderDocument): string {
  const verb = d.expired ? "expired on" : "expires on";
  return `${d.name} — ${verb} ${d.expiresOn}`;
}

export function renderExpirationReminder(ctx: ExpirationReminderCtx): RenderedEmail {
  const subject = "Onboarding Document Renewal Reminder";
  const loginUrl = ctx.settings.portalUrl;

  const textLines = [
    `Hi ${ctx.teacher.name},`,
    "Our records show that the following onboarding documents are expired or expiring soon:",
    ctx.documents.map((d) => `- ${line(d)}`).join("\n"),
    `Please upload updated copies through the onboarding portal when you have a chance: ${loginUrl}`,
    `Thank you,\n${ctx.settings.schoolName}`,
  ];

  const text = renderTextShell(textLines, ctx.settings);

  const listHtml = ctx.documents
    .map(
      (d) =>
        `<li>${escapeHtml(d.name)} — ${
          d.expired ? "expired on" : "expires on"
        } ${escapeHtml(d.expiresOn)}</li>`
    )
    .join("");

  const html = renderHtmlShell(
    `
    <p>Hi ${escapeHtml(ctx.teacher.name)},</p>
    <p>Our records show that the following onboarding documents are expired or expiring soon:</p>
    <ul>${listHtml}</ul>
    <p>Please upload updated copies through the <a href="${escapeHtml(
      loginUrl
    )}">onboarding portal</a> when you have a chance.</p>
    <p>Thank you,<br>${escapeHtml(ctx.settings.schoolName)}</p>`,
    ctx.settings
  );

  return { subject, text, html };
}
