import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLogs, users } from "@/lib/db/schema";

/**
 * Read-side queries for the audit log viewer (admin-only).
 *
 * The writer lives in lib/audit/log.ts and is unchanged. This module
 * only ever SELECTs. It joins to `users` so the viewer can show
 * actor email + name without a second roundtrip.
 */
export interface AuditFilters {
  actorId?: string | null;
  action?: string | null;
  targetType?: string | null;
  /** Inclusive lower bound (createdAt >= since). */
  since?: Date | null;
  /** Exclusive upper bound (createdAt < until). */
  until?: Date | null;
}

export interface AuditPageOpts {
  page?: number; // 1-indexed
  pageSize?: number;
}

export interface AuditRow {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

function buildConditions(filters: AuditFilters) {
  const parts = [] as ReturnType<typeof eq>[];
  if (filters.actorId) parts.push(eq(auditLogs.actorId, filters.actorId));
  if (filters.action) parts.push(eq(auditLogs.action, filters.action));
  if (filters.targetType) parts.push(eq(auditLogs.targetType, filters.targetType));
  if (filters.since) parts.push(gte(auditLogs.createdAt, filters.since));
  if (filters.until) parts.push(lt(auditLogs.createdAt, filters.until));
  return parts;
}

/**
 * Paginated list of audit rows joined with the actor's user row.
 * Caller is responsible for confirming the requester is an admin.
 */
export async function listAuditLog(
  filters: AuditFilters = {},
  opts: AuditPageOpts = {}
): Promise<AuditPage> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(opts.pageSize ?? DEFAULT_PAGE_SIZE))
  );

  const conditions = buildConditions(filters);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const baseQuery = db
    .select({
      id: auditLogs.id,
      actorId: auditLogs.actorId,
      actorEmail: users.email,
      actorName: users.name,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId));

  const rows = where
    ? await baseQuery
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize)
    : await baseQuery
        .orderBy(desc(auditLogs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

  const countQ = db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs);
  const [countRow] = where ? await countQ.where(where) : await countQ;
  const total = countRow?.count ?? 0;

  return {
    rows: rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actorEmail: r.actorEmail ?? null,
      actorName: r.actorName ?? null,
      action: r.action,
      targetType: r.targetType ?? null,
      targetId: r.targetId,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Distinct action values present in the log — used to populate the
 * filter dropdown in the viewer.
 */
export async function listDistinctActions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ action: auditLogs.action })
    .from(auditLogs)
    .orderBy(auditLogs.action);
  return rows.map((r) => r.action);
}
