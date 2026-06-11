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
  const rendered = renderTeacherInvite({
    teacher: { firstName: args.name.split(/\s+/)[0] || args.name },
    settings: { schoolName: settings.senderName, portalUrl: settings.portalUrl },
    temporaryPassword: args.temporaryPassword,
  });
  return {
    loginUrl: settings.portalUrl,
    temporaryPassword: args.temporaryPassword,
    invitation: { subject: rendered.subject, text: rendered.text },
  };
}
