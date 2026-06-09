import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { auditLog } from "@/lib/audit/log";
import { toCsv } from "@/lib/reports/csv";
import {
  getCompletionReport,
  getExpiryReport,
} from "@/lib/reports/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES = new Set(["completion", "expiry"]);

function csvFilename(type: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `onboarding-${type}-${stamp}.csv`;
}

function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * GET /api/admin/reports?type=completion|expiry
 *
 * Admin-only CSV exports. Writes one audit row per successful export
 * (`action='report.export'`, metadata carries the report type and row
 * count). Middleware already gates `/api/admin/**` to admins; we
 * re-check here as defense in depth.
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
  const type = url.searchParams.get("type");
  if (!type || !VALID_TYPES.has(type)) {
    return NextResponse.json(
      { error: "Invalid or missing `type`. Allowed: completion, expiry." },
      { status: 400 }
    );
  }

  const admin = { id: session.user.id, role: session.user.role };

  if (type === "completion") {
    const data = await getCompletionReport(admin);
    const csv = toCsv(
      [
        "user_id",
        "email",
        "name",
        "approved_required",
        "total_required",
        "completion_pct",
        "pending_count",
        "expired_count",
        "expiring_soon_count",
      ],
      data.map((r) => [
        r.userId,
        r.email,
        r.name,
        r.approvedRequired,
        r.totalRequired,
        r.completionPct,
        r.pendingCount,
        r.expiredCount,
        r.expiringSoonCount,
      ])
    );
    await auditLog({
      actorId: admin.id,
      action: "report.export",
      targetType: "user",
      targetId: null,
      metadata: { type, rowCount: data.length },
    });
    return csvResponse(csvFilename(type), csv);
  }

  // type === "expiry"
  const data = await getExpiryReport(admin);
  const csv = toCsv(
    [
      "document_id",
      "user_id",
      "email",
      "teacher_name",
      "document_type",
      "expires_at",
      "expiring_soon",
    ],
    data.map((r) => [
      r.documentId,
      r.userId,
      r.email,
      r.teacherName,
      r.documentType,
      r.expiresAt ? r.expiresAt.toISOString() : "",
      r.expiringSoon ? "true" : "false",
    ])
  );
  await auditLog({
    actorId: admin.id,
    action: "report.export",
    targetType: "document",
    targetId: null,
    metadata: { type, rowCount: data.length },
  });
  return csvResponse(csvFilename(type), csv);
}
