import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { renderAllPreviews } from "@/lib/email/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reminders/preview
 *
 * Returns every template rendered against a fixed sample context.
 * No DB, no provider call. Powers the admin preview page so the
 * secretary can see exactly what each reminder will look like before
 * the cron sends one.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ previews: renderAllPreviews() }, { status: 200 });
}
