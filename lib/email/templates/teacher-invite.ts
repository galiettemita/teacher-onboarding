import { escapeHtml } from "../sanitize";
import {
  type RenderedEmail,
  renderHtmlShell,
  renderTextShell,
} from "./base";

export interface TeacherInviteCtx {
  teacher: { firstName: string };
  settings: {
    schoolName: string;
    portalUrl: string;
  };
  temporaryPassword: string;
}

export function renderTeacherInvite(ctx: TeacherInviteCtx): RenderedEmail {
  const subject = `You're invited to ${ctx.settings.schoolName}'s onboarding portal`;
  const loginUrl = ctx.settings.portalUrl;

  const text = renderTextShell(
    [
      `Hi ${ctx.teacher.firstName},`,
      `${ctx.settings.schoolName} created your teacher onboarding account. Use the temporary password below to sign in.`,
      `Log in: ${loginUrl}`,
      `Temporary password: ${ctx.temporaryPassword}`,
      `For security, the portal will ask you to create your own password before you can upload onboarding documents.`,
      `Keep this password private. If you did not expect this invitation, contact your school administrator.`,
    ],
    ctx.settings
  );

  const html = renderHtmlShell(
    `
    <p>Hi ${escapeHtml(ctx.teacher.firstName)},</p>
    <p>${escapeHtml(
      ctx.settings.schoolName
    )} created your teacher onboarding account. Use the temporary password below to sign in.</p>
    <p><a href="${escapeHtml(loginUrl)}">Log in to the portal</a></p>
    <p><strong>Temporary password:</strong> <code>${escapeHtml(
      ctx.temporaryPassword
    )}</code></p>
    <p>For security, the portal will ask you to create your own password before you can upload onboarding documents.</p>
    <p>Keep this password private. If you did not expect this invitation, contact your school administrator.</p>`,
    ctx.settings
  );

  return { subject, text, html };
}
