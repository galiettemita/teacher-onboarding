import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import type { SessionUser } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { documentTypes } from "@/lib/db/schema";
import { buildStorageKey, getStorage } from "@/lib/storage";
import {
  MAX_BYTES,
  sniffAndValidate,
  uploadFieldsSchema,
} from "@/lib/validation/file";
import { insertMyDocument } from "@/lib/db/queries/teacher-documents";
import { auditLog } from "@/lib/audit/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/upload`
 *
 * Order of operations (per AGENT 2 spec, mirrored from PROJECT_CONTEXT §4.6):
 *  1. session check → 401
 *  2. role === 'teacher' → 403 (admins do not upload)
 *  3. parse multipart, zod-validate `document_type_id`
 *  4. document_type exists + active → 400/404
 *  5. Content-Length sanity → 413
 *  6. stream into buffer with hard cap → 413 if exceeded
 *  7. magic-byte sniff → 415
 *  8. sha256
 *  9. server-built storage key (UUID-based)
 *  10. storage.put — if it fails, return 500 and do NOT insert a row
 *  11. insertMyDocument (status = 'pending' via schema default)
 *  12. audit log
 *  13. 201 { id }
 */
export async function POST(req: Request): Promise<Response> {
  // 1. auth
  const session = await auth();
  if (!session?.user?.id || !session.user.role) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user: SessionUser = {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
    role: session.user.role,
  };

  // 2. teacher only
  if (user.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 5. cheap Content-Length pre-check before reading the body
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (declaredLength > 0 && declaredLength > MAX_BYTES + 1024 * 1024) {
    // +1MB slack for multipart envelope overhead
    return NextResponse.json(
      { error: "Payload too large", maxBytes: MAX_BYTES },
      { status: 413 }
    );
  }

  // 6. parse multipart with a hard size cap.
  //    We use Request.formData() but verify file.size against the cap after
  //    reading, then re-stream the file into a capped buffer for sniffing.
  //    A genuinely abusive client that lies about Content-Length is bounded
  //    by Next.js's own body-size limit (1MB default for actions, but route
  //    handlers stream — the cap below is the authoritative one).
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Malformed multipart body" }, { status: 400 });
  }

  // 3. zod-validate the form fields
  const fields = uploadFieldsSchema.safeParse({
    document_type_id: form.get("document_type_id"),
  });
  if (!fields.success) {
    return NextResponse.json(
      { error: "Invalid form fields", issues: fields.error.issues },
      { status: 400 }
    );
  }
  const documentTypeId = fields.data.document_type_id;

  const fileEntry = form.get("file");
  if (!(fileEntry instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' part" }, { status: 400 });
  }

  // 4. document type must exist + be active
  const [docType] = await db
    .select()
    .from(documentTypes)
    .where(eq(documentTypes.id, documentTypeId))
    .limit(1);
  if (!docType) {
    return NextResponse.json({ error: "Unknown document_type_id" }, { status: 404 });
  }
  if (!docType.active) {
    return NextResponse.json({ error: "Document type is inactive" }, { status: 400 });
  }

  // 6 (cont.). enforce the hard cap on the file itself
  if (fileEntry.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File too large", maxBytes: MAX_BYTES },
      { status: 413 }
    );
  }

  // Stream into a buffer, killing it if it ever exceeds the cap. Belt-and-
  // suspenders against a lying `file.size`.
  const buffer = await readWithCap(fileEntry.stream(), MAX_BYTES);
  if (buffer === "exceeded") {
    return NextResponse.json(
      { error: "File too large", maxBytes: MAX_BYTES },
      { status: 413 }
    );
  }

  // 7. magic-byte sniff — never trust the client's content-type
  const sniff = await sniffAndValidate(buffer);
  if (!sniff.ok) {
    return NextResponse.json(
      { error: "Unsupported or corrupt file", reason: sniff.reason },
      { status: 415 }
    );
  }

  // 8. sha256
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  // 9. server-generated storage key. Client never picks the name.
  const storageKey = buildStorageKey({
    userId: user.id,
    documentTypeId,
    uuid: crypto.randomUUID(),
    ext: sniff.ext,
  });

  // 10. write to storage. Roll back by NOT inserting if put fails.
  try {
    await getStorage().put(storageKey, buffer, sniff.mime);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[upload] storage.put failed", err);
    return NextResponse.json({ error: "Storage write failed" }, { status: 500 });
  }

  // 11. DB row. If this fails we orphan a storage object — log it, return 500.
  let newDoc;
  try {
    newDoc = await insertMyDocument(user, {
      documentTypeId,
      storageKey,
      originalFilename: fileEntry.name || "upload",
      mimeType: sniff.mime,
      sizeBytes: buffer.length,
      sha256,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[upload] insertMyDocument failed; storage object orphaned", {
      storageKey,
      err,
    });
    return NextResponse.json({ error: "Database write failed" }, { status: 500 });
  }

  // 12. audit log. Any failure here must NOT roll back the upload — the row
  // and the storage object already landed, and the user has been waiting
  // long enough. Log to stderr instead.
  try {
    await auditLog({
      actorId: user.id,
      action: "document.upload",
      targetType: "teacher_document",
      targetId: newDoc.id,
      metadata: {
        mime: sniff.mime,
        sizeBytes: buffer.length,
        sha256,
        documentTypeId,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[upload] audit log failed", {
      documentId: newDoc.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // 13. done — never echo storage key to the client
  return NextResponse.json({ id: newDoc.id }, { status: 201 });
}

/**
 * Drain a `ReadableStream<Uint8Array>` into a single Buffer, aborting if the
 * total size would exceed `cap`. Returns the literal `'exceeded'` sentinel
 * instead of throwing so callers can map straight to 413.
 */
async function readWithCap(
  stream: ReadableStream<Uint8Array>,
  cap: number
): Promise<Buffer | "exceeded"> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel();
        return "exceeded";
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}
