import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

/**
 * GET /api/files/[id] — the ONLY path to a stored file. Phase 2 will:
 *  1. Verify session (this stub already does that).
 *  2. Load the teacher_documents row by id.
 *  3. Allow if owner OR role === 'admin'. Else 403.
 *  4. Stream from storage adapter with Content-Disposition: attachment,
 *     Cache-Control: private, no-store, X-Content-Type-Options: nosniff.
 *  5. Write a file.download audit_logs row.
 *
 * Never expose storage URLs to the client. Never accept a key from the client.
 */
export async function GET(
  _req: Request,
  _ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Not Implemented", phase: "Phase 2" },
    { status: 501 }
  );
}
