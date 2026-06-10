import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { inviteTeacher } from "@/lib/db/queries/admin-teachers";
import { getReminderSettings } from "@/lib/db/queries/reminder-settings";
import { inviteEmailDeliveryEnabled, sendEmail } from "@/lib/email/send";
import { renderTeacherInvite } from "@/lib/email/templates/teacher-invite";
import { errorResponse } from "@/lib/api/errors";

/**
 * POST /api/admin/teachers — admin-creates-teacher invite flow.
 *
 * See PROJECT_CONTEXT §5.6. Body shape:
 *   { email, name, phone?, hireDate?, gradeLevel? }
 *
 * Creates the user + teacher_profiles row + audit entry, generates a temporary
 * password, and sends the invite when a real email provider is configured.
 * Local/console email environments return the one-time credential so the admin
 * can share it out-of-band without writing it to logs.
 */
const Body = z.object({
  email: z.string().email().max(254),
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(50).optional(),
  hireDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "hireDate must be YYYY-MM-DD")
    .optional(),
  gradeLevel: z.string().trim().max(50).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await inviteTeacher(
      { id: session.user.id, role: session.user.role },
      {
        email: parsed.data.email,
        name: parsed.data.name,
        phone: parsed.data.phone ?? null,
        hireDate: parsed.data.hireDate ?? null,
        gradeLevel: parsed.data.gradeLevel ?? null,
      }
    );
    const settings = await getReminderSettings();
    let inviteEmailSent = false;
    let inviteEmailError: string | null = null;

    try {
      if (inviteEmailDeliveryEnabled()) {
        const rendered = renderTeacherInvite({
          teacher: { firstName: result.name.split(/\s+/)[0] || result.name },
          settings: {
            schoolName: settings.senderName,
            portalUrl: settings.portalUrl,
          },
          temporaryPassword: result.temporaryPassword,
        });
        const sendResult = await sendEmail({
          to: result.email,
          from: { name: settings.senderName, email: settings.senderEmail },
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        });
        inviteEmailSent = sendResult.ok;
        inviteEmailError = sendResult.ok ? null : sendResult.error ?? "Invite email could not be sent.";
      }
    } catch (err) {
      inviteEmailError = err instanceof Error ? err.message : "Invite email could not be sent.";
    }

    return NextResponse.json(
      {
        id: result.id,
        email: result.email,
        loginUrl: settings.portalUrl,
        inviteEmailSent,
        inviteEmailError,
        temporaryPassword: inviteEmailSent ? undefined : result.temporaryPassword,
      },
      { status: 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
