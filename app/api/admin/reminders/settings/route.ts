import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { errorResponse } from "@/lib/api/errors";
import {
  getReminderSettings,
  updateReminderSettings,
} from "@/lib/db/queries/reminder-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/reminders/settings
 *
 * GET: returns the singleton reminder_settings row.
 * PATCH: partial update. Writes one audit row via the queries layer
 *   (reminders.settings.update or reminders.toggle when only `enabled`
 *   changed). Re-checks admin role in the handler — middleware also
 *   gates this prefix but defence in depth per REVIEWER_NOTES §3.
 */

const PatchBody = z
  .object({
    enabled: z.boolean().optional(),
    senderName: z.string().trim().min(1).max(100).optional(),
    senderEmail: z.string().trim().email().max(254).optional(),
    portalUrl: z.string().trim().url().max(500).optional(),
    reminderDaysBeforeExpiration: z.array(z.number().int().min(1).max(365))
      .min(1)
      .max(20)
      .optional(),
    postExpirationIntervalDays: z.number().int().min(1).max(365).optional(),
    maxOneEmailPerTeacherPerDay: z.boolean().optional(),
    pendingReviewDaysBeforeAdminAlert: z
      .union([z.number().int().min(1).max(365), z.null()])
      .optional(),
    missingDocReminderIntervalDays: z.number().int().min(1).max(365).optional(),
    rejectedDocReminderIntervalDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

type Gate =
  | { error: Response; admin?: undefined }
  | { error?: undefined; admin: { id: string; role: string } };

async function requireAdminSession(): Promise<Gate> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (session.user.role !== "admin") {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { admin: { id: session.user.id, role: session.user.role } };
}

export async function GET(): Promise<Response> {
  const gate = await requireAdminSession();
  if (gate.error) return gate.error;
  try {
    const settings = await getReminderSettings();
    return NextResponse.json(settings, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  const gate = await requireAdminSession();
  if (gate.error) return gate.error;
  let parsed: z.infer<typeof PatchBody>;
  try {
    const raw = await req.json();
    parsed = PatchBody.parse(raw);
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid body", details: err instanceof Error ? err.message : "parse error" },
      { status: 400 }
    );
  }
  if (Object.keys(parsed).length === 0) {
    return NextResponse.json({ error: "Empty patch" }, { status: 400 });
  }
  try {
    const updated = await updateReminderSettings(gate.admin, parsed);
    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
