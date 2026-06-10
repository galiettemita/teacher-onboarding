import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { listRecentJobRuns, REMINDER_JOB_NAME } from "@/lib/db/queries/job-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reminders/job-runs
 *
 * Last N reminder_dispatch runs. Defaults to job_name=reminder_dispatch
 * but accepts ?jobName= for the expiry sweep too if we ever surface
 * both in the same UI.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const jobName = url.searchParams.get("jobName") ?? REMINDER_JOB_NAME;
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
  const rows = await listRecentJobRuns(
    { role: session.user.role },
    jobName,
    limit
  );
  return NextResponse.json({ rows }, { status: 200 });
}
