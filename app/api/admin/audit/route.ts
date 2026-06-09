import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  listAuditLog,
} from "@/lib/audit/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseInteger(raw: string | null, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * GET /api/admin/audit
 *
 * Query params:
 *   actorId, action, targetType, since (ISO), until (ISO), page, pageSize
 *
 * Admin-only. Middleware already enforces this; we re-check defensively.
 */
export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const actorId = url.searchParams.get("actorId");
  if (actorId && !UUID_RE.test(actorId)) {
    return NextResponse.json({ error: "Invalid actorId" }, { status: 400 });
  }

  const page = parseInteger(url.searchParams.get("page"), 1, 1, 1_000_000);
  const pageSize = parseInteger(
    url.searchParams.get("pageSize"),
    DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE
  );

  const result = await listAuditLog(
    {
      actorId,
      action: url.searchParams.get("action"),
      targetType: url.searchParams.get("targetType"),
      since: parseDate(url.searchParams.get("since")),
      until: parseDate(url.searchParams.get("until")),
    },
    { page, pageSize }
  );

  return NextResponse.json(result, { status: 200 });
}
