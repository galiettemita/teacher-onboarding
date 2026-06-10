import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  NOTIFICATION_LOG_DEFAULT_PAGE_SIZE,
  NOTIFICATION_LOG_MAX_PAGE_SIZE,
  listNotificationLogs,
  type NotificationLogFilters,
} from "@/lib/db/queries/notification-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_STATUS = new Set(["queued", "sent", "failed", "skipped"]);

function parseInt32(raw: string | null, def: number, min: number, max: number) {
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * GET /api/admin/reminders/logs
 *
 * Paginated notification_logs viewer. Same shape as Phase 5's audit
 * viewer.
 *
 * Query params: teacherId, status, reminderType, since, until, page,
 * pageSize.
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
  const teacherId = url.searchParams.get("teacherId");
  if (teacherId && !UUID_RE.test(teacherId)) {
    return NextResponse.json({ error: "Invalid teacherId" }, { status: 400 });
  }
  const status = url.searchParams.get("status");
  if (status && !ALLOWED_STATUS.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const filters: NotificationLogFilters = {
    teacherId,
    status: status as NotificationLogFilters["status"],
    reminderType: url.searchParams.get("reminderType"),
    since: parseDate(url.searchParams.get("since")),
    until: parseDate(url.searchParams.get("until")),
  };

  const page = parseInt32(url.searchParams.get("page"), 1, 1, 1_000_000);
  const pageSize = parseInt32(
    url.searchParams.get("pageSize"),
    NOTIFICATION_LOG_DEFAULT_PAGE_SIZE,
    1,
    NOTIFICATION_LOG_MAX_PAGE_SIZE
  );

  const result = await listNotificationLogs(
    { role: session.user.role },
    filters,
    { page, pageSize }
  );
  return NextResponse.json(result, { status: 200 });
}
