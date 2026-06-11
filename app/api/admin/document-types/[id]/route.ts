import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import {
  deactivateDocumentType,
  updateDocumentType,
} from "@/lib/db/queries/document-types";
import { errorResponse } from "@/lib/api/errors";

const Body = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  required: z.boolean(),
  renewalMonths: z.number().int().min(0).max(120),
  applicability: z
    .enum(["all_staff", "new_first_year_only", "returning_staff_only"])
    .optional(),
  category: z.enum(["medical", "training", "general", "other"]).optional(),
});

async function requireAdminSession() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.user.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin: { id: session.user.id, role: session.user.role } };
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminSession();
  if ("error" in gate) return gate.error;

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
    const row = await updateDocumentType(gate.admin, id, {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      required: parsed.data.required,
      renewalMonths: parsed.data.renewalMonths,
      applicability: parsed.data.applicability,
      category: parsed.data.category,
    });
    return NextResponse.json(row, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * DELETE deactivates (soft-delete). Never hard-delete: history relies on
 * the type still resolving for old teacher_documents rows.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminSession();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;

  try {
    const row = await deactivateDocumentType(gate.admin, id);
    return NextResponse.json(row, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
