import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

/**
 * POST /api/upload — Phase 2 will implement the full upload pipeline per
 * PROJECT_CONTEXT.md §4.6 (auth → size cap → stream → magic-byte sniff →
 * sha256 → storage put → DB insert pending → audit). For now we return 501
 * but keep the auth gate in place so the URL is stable.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Not Implemented", phase: "Phase 2" },
    { status: 501 }
  );
}
