import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  documentTypes,
  teacherDocuments,
  users,
} from "@/lib/db/schema";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { deriveUiStatus } from "@/lib/expiry/status";

/**
 * Expiration visibility queries — the single source for "what is expired or
 * expiring soon" used by the admin alert center, the per-teacher admin view,
 * and the teacher-specific email draft.
 *
 * A row is in scope when its derived UI status is `expired` or `expiring_soon`.
 * We only consider the current (non-superseded) approved/expired rows: a
 * rejected or pending doc never "expires", and a superseded one was replaced.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ExpirationState = "expired" | "expiring_soon";

export interface ExpirationItem {
  documentId: string;
  documentTypeId: string;
  documentTypeName: string;
  uploadedAt: Date;
  expiresAt: Date | null;
  /** Positive = days until expiry; negative = days overdue. */
  daysRemaining: number | null;
  state: ExpirationState;
}

export interface TeacherExpirationAlert extends ExpirationItem {
  teacherId: string;
  teacherName: string;
  teacherEmail: string;
}

function assertAdmin(currentAdmin: { role: string }) {
  if (currentAdmin.role !== "admin") {
    throw new ForbiddenError("Admin role required");
  }
}

function daysRemaining(expiresAt: Date | null, now: Date): number | null {
  if (!expiresAt) return null;
  return Math.round((expiresAt.getTime() - now.getTime()) / MS_PER_DAY);
}

/**
 * Expired + expiring-soon items for a single teacher. Admin-scoped. Ordered
 * most-urgent first (expired before expiring-soon, then by soonest expiry).
 */
export async function getTeacherExpirationItems(
  currentAdmin: { role: string },
  teacherId: string,
  now: Date = new Date()
): Promise<ExpirationItem[]> {
  assertAdmin(currentAdmin);

  const [teacher] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, teacherId), eq(users.role, "teacher")))
    .limit(1);
  if (!teacher) throw new NotFoundError("Teacher not found");

  const rows = await db
    .select({
      doc: teacherDocuments,
      typeName: documentTypes.name,
    })
    .from(teacherDocuments)
    .innerJoin(documentTypes, eq(documentTypes.id, teacherDocuments.documentTypeId))
    .where(
      and(
        eq(teacherDocuments.userId, teacherId),
        isNull(teacherDocuments.supersededBy),
        inArray(teacherDocuments.status, ["approved", "expired"])
      )
    )
    .orderBy(desc(teacherDocuments.uploadedAt));

  const items: ExpirationItem[] = [];
  for (const r of rows) {
    const ui = deriveUiStatus(r.doc, { now });
    if (ui !== "expired" && ui !== "expiring_soon") continue;
    items.push({
      documentId: r.doc.id,
      documentTypeId: r.doc.documentTypeId,
      documentTypeName: r.typeName,
      uploadedAt: r.doc.uploadedAt,
      expiresAt: r.doc.expiresAt,
      daysRemaining: daysRemaining(r.doc.expiresAt, now),
      state: ui,
    });
  }
  return sortByUrgency(items);
}

/**
 * Every expired / expiring-soon document across all teachers, joined with the
 * teacher's name + email. Powers the admin expiration alert center.
 */
export async function listExpirationAlerts(
  currentAdmin: { role: string },
  now: Date = new Date()
): Promise<TeacherExpirationAlert[]> {
  assertAdmin(currentAdmin);

  const rows = await db
    .select({
      doc: teacherDocuments,
      typeName: documentTypes.name,
      teacherId: users.id,
      teacherName: users.name,
      teacherEmail: users.email,
    })
    .from(teacherDocuments)
    .innerJoin(documentTypes, eq(documentTypes.id, teacherDocuments.documentTypeId))
    .innerJoin(users, eq(users.id, teacherDocuments.userId))
    .where(
      and(
        eq(users.role, "teacher"),
        isNull(teacherDocuments.supersededBy),
        inArray(teacherDocuments.status, ["approved", "expired"])
      )
    )
    .orderBy(desc(teacherDocuments.uploadedAt));

  const alerts: TeacherExpirationAlert[] = [];
  for (const r of rows) {
    const ui = deriveUiStatus(r.doc, { now });
    if (ui !== "expired" && ui !== "expiring_soon") continue;
    alerts.push({
      documentId: r.doc.id,
      documentTypeId: r.doc.documentTypeId,
      documentTypeName: r.typeName,
      uploadedAt: r.doc.uploadedAt,
      expiresAt: r.doc.expiresAt,
      daysRemaining: daysRemaining(r.doc.expiresAt, now),
      state: ui,
      teacherId: r.teacherId,
      teacherName: r.teacherName,
      teacherEmail: r.teacherEmail,
    });
  }
  return sortByUrgency(alerts);
}

export interface ExpirationCounts {
  expired: number;
  expiringSoon: number;
}

/** Counts for the admin dashboard tile. */
export async function getExpirationCounts(
  currentAdmin: { role: string },
  now: Date = new Date()
): Promise<ExpirationCounts> {
  const alerts = await listExpirationAlerts(currentAdmin, now);
  return {
    expired: alerts.filter((a) => a.state === "expired").length,
    expiringSoon: alerts.filter((a) => a.state === "expiring_soon").length,
  };
}

/** Expired first (and by most overdue), then expiring-soon by soonest. */
function sortByUrgency<T extends ExpirationItem>(items: T[]): T[] {
  const rank = (s: ExpirationState) => (s === "expired" ? 0 : 1);
  return [...items].sort((a, b) => {
    if (rank(a.state) !== rank(b.state)) return rank(a.state) - rank(b.state);
    const ax = a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const bx = b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return ax - bx;
  });
}
