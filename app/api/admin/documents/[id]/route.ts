import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { approveDocument, rejectDocument } from "@/lib/db/queries/admin-review";
import { errorResponse } from "@/lib/api/errors";

/**
 * PATCH /api/admin/documents/[id]
 *
 * Body: { action: 'approve' | 'reject', reason?: string }
 *
 * Middleware already gates this route to role='admin'. We re-check here as
 * defense in depth — if middleware ever regresses or a route is hit via an
 * unexpected path, we still refuse.
 */
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().min(1) }),
]);

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
    // Most common failure: rejecting with a blank reason. The discriminated
    // union encodes "reject requires reason"; we surface that as 400.
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const admin = { id: session.user.id, role: session.user.role };

  try {
    const updated =
      parsed.data.action === "approve"
        ? await approveDocument(admin, id)
        : await rejectDocument(admin, id, parsed.data.reason);
    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
