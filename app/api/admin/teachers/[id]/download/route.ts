import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { buildTeacherDocumentsZip } from "@/lib/db/queries/bulk-download";
import { auditLog } from "@/lib/audit/log";
import { errorResponse } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/teachers/[id]/download` — admin-only bulk download of every
 * uploaded document for one teacher as a single ZIP (with a manifest.csv).
 *
 *  1. session → 401
 *  2. admin role → else 403 (server-side; the UI link is cosmetic)
 *  3. build the ZIP through the private storage adapter (no public URLs)
 *  4. audit `teacher.bulk_download`
 *  5. stream the archive with Content-Disposition: attachment
 *
 * Note: `/api/admin/**` is already gated to admins in middleware; this handler
 * re-checks the role anyway (defense in depth) and never trusts the client.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await buildTeacherDocumentsZip(
      { role: session.user.role },
      id
    );

    await auditLog({
      actorId: session.user.id,
      action: "teacher.bulk_download",
      targetType: "user",
      targetId: id,
      metadata: {
        fileCount: result.fileCount,
        skippedCount: result.skippedCount,
      },
    });

    const safeName = `${result.baseName}.zip`.replace(/[^A-Za-z0-9._-]+/g, "");
    const ab = new ArrayBuffer(result.zip.byteLength);
    new Uint8Array(ab).set(result.zip);
    return new Response(ab, {
      status: 200,
      headers: new Headers({
        "Content-Type": "application/zip",
        "Content-Length": String(result.zip.byteLength),
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
