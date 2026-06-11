import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { updateTeacherProfile } from "@/lib/db/queries/admin-teachers";
import { errorResponse } from "@/lib/api/errors";

/**
 * PATCH /api/admin/teachers/[id] — admin edits a teacher's onboarding metadata
 * (staff status + dates + profile fields). Only ever touches teacher_profiles.
 */
const DateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .nullable()
  .optional();

const Body = z.object({
  staffStatus: z.enum(["new_first_year", "returning"]).optional(),
  hireDate: DateField,
  firstYearStartDate: DateField,
  phone: z.string().trim().max(50).nullable().optional(),
  gradeLevel: z.string().trim().max(50).nullable().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;

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
    const row = await updateTeacherProfile(
      { id: session.user.id, role: session.user.role },
      id,
      parsed.data
    );
    return NextResponse.json(row, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
