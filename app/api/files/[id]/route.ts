import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getStorage } from "@/lib/storage";
import { sanitizeFilename } from "@/lib/validation/file";
import { getDocumentByIdUnscoped } from "@/lib/db/queries/teacher-documents";
import { getActivationStatus } from "@/lib/db/queries/activation";
import { auditLog } from "@/lib/audit/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/files/[id]` — the ONLY public path to a stored file.
 *
 *  1. session → 401
 *  2. load doc → 404 if missing
 *  3. owner OR admin → else 403
 *  4. storage.get(key) → 404 + audit `file.missing` if gone
 *  5. headers: Content-Type, Content-Disposition: attachment;
 *     Cache-Control: private, no-store, X-Content-Type-Options: nosniff
 *  6. audit `file.download`
 *  7. send the body
 *
 * The response NEVER contains the storage key, bucket name, or a signed URL.
 * Bytes always flow through this handler.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  // 1. auth
  const session = await auth();
  if (!session?.user?.id || !session.user.role) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const role = session.user.role;
  if (role === "teacher") {
    const activation = await getActivationStatus(userId);
    if (activation.mustChangePassword) {
      return NextResponse.json(
        { error: "Account activation required", activateUrl: "/teacher/activate" },
        { status: 403 }
      );
    }
  }

  const { id } = await ctx.params;

  // Validate the id shape before touching the DB. Anything other than a
  // UUID is a 404 (don't leak whether the route exists).
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 2. load doc
  const doc = await getDocumentByIdUnscoped(id);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 3. owner OR admin
  if (doc.userId !== userId && role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 4. storage read
  let body: Buffer;
  try {
    const got = await getStorage().get(doc.storageKey);
    body = got.body;
  } catch {
    await auditLog({
      actorId: userId,
      action: "file.missing",
      targetType: "teacher_document",
      targetId: doc.id,
      metadata: { byRole: role },
    });
    return NextResponse.json({ error: "File missing in storage" }, { status: 404 });
  }

  // 6. audit (before sending — if we crash mid-stream the row is still useful)
  await auditLog({
    actorId: userId,
    action: "file.download",
    targetType: "teacher_document",
    targetId: doc.id,
    metadata: { byRole: role },
  });

  // 5. headers
  const safeName = sanitizeFilename(doc.originalFilename);
  const headers = new Headers({
    "Content-Type": doc.mimeType,
    "Content-Length": String(body.byteLength),
    "Content-Disposition": `attachment; filename="${safeName}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });

  // 7. send the bytes. Copy into a fresh ArrayBuffer-backed Uint8Array so
  // the DOM `BodyInit` type (which doesn't accept SharedArrayBuffer-backed
  // views) is happy. No storage key, signed URL, or bucket name leaks into
  // the response.
  const ab = new ArrayBuffer(body.byteLength);
  new Uint8Array(ab).set(body);
  return new Response(ab, { status: 200, headers });
}
