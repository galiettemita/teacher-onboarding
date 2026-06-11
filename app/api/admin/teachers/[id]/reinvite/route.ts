import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { reinviteTeacher } from "@/lib/db/queries/admin-teachers";
import { buildInvitation } from "@/lib/invitations";
import { errorResponse } from "@/lib/api/errors";

/**
 * POST /api/admin/teachers/[id]/reinvite — regenerate a teacher's temporary
 * password.
 *
 * For a teacher who has not yet activated their account. Generates a fresh
 * temporary password (invalidating any previous one), keeps the account pending
 * activation, and returns updated copyable invitation content. Refuses with 409
 * if the teacher has already activated.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const result = await reinviteTeacher(
      { id: session.user.id, role: session.user.role },
      id
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
      { status: 200 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
