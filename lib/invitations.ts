import { getEmailSettings } from "@/lib/db/queries/email-settings";
import { renderTeacherInvite } from "@/lib/email/templates/teacher-invite";

/**
 * Invitation content the admin copies and sends to a teacher out-of-band.
 *
 * The application sends no email itself — there is no outbound mail
 * infrastructure. The admin invites a teacher, the server returns the login
 * URL, the one-time temporary password, and a ready-to-send message, and the
 * admin delivers it however they like.
 */
export interface InvitationContent {
  loginUrl: string;
  temporaryPassword: string;
  invitation: { subject: string; text: string };
}

export async function buildInvitation(args: {
  name: string;
  temporaryPassword: string;
}): Promise<InvitationContent> {
  const settings = await getEmailSettings();
  // Point teachers at the deployment's real public origin. AUTH_URL is the
  // canonical origin Auth.js already uses for callbacks; prefer it over the
  // `email_settings.portal_url` default (which has no editor UI and otherwise
  // stays at the dev localhost value in production).
  const origin = (process.env.AUTH_URL ?? settings.portalUrl ?? "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "");
  const loginUrl = `${origin}/login`;

  const rendered = renderTeacherInvite({
    teacher: { firstName: args.name.split(/\s+/)[0] || args.name },
    settings: { schoolName: settings.senderName, portalUrl: loginUrl },
    temporaryPassword: args.temporaryPassword,
  });
  return {
    loginUrl,
    temporaryPassword: args.temporaryPassword,
    invitation: { subject: rendered.subject, text: rendered.text },
  };
}
