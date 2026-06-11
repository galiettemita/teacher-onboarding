import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { inviteTeacher } from "@/lib/db/queries/admin-teachers";
import { buildInvitation } from "@/lib/invitations";
import { errorResponse } from "@/lib/api/errors";

/**
 * POST /api/admin/teachers — admin-creates-teacher invite flow.
 *
 * Body shape: { email, name, phone?, hireDate?, gradeLevel? }
 *
 * Transactionally creates the user (pending activation) + teacher_profiles row
 * + audit entry and generates a one-time temporary password. The application
 * sends no email; the response carries the login URL, the temporary password,
 * and a ready-to-send invitation message for the admin to deliver out-of-band.
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

    const content = await buildInvitation({
      name: result.name,
      temporaryPassword: result.temporaryPassword,
    });

    return NextResponse.json(
      {
        id: result.id,
        email: result.email,
        name: result.name,
        ...content,
      },
      { status: 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
