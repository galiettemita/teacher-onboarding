import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  documentTypes,
  teacherDocuments,
  users,
  type TeacherDocument,
  type DocumentType,
} from "@/lib/db/schema";
import { listAllTeachers, type TeacherListRow } from "@/lib/db/queries/admin-teachers";
import { isExpiringSoon } from "@/lib/expiry/status";

/**
 * Aggregate stats for the completion report — one row per teacher.
 *
 *   - completionPct: derived from the same logic used by the admin
 *                    teachers list (approved required / total required).
 *   - expiredCount:  current (non-superseded) docs with status='expired'
 *                    OR approved-past-due.
 *   - expiringSoonCount: approved docs whose expires_at is within
 *                    the default window (30 days).
 */
export interface CompletionReportRow {
  userId: string;
  email: string;
  name: string;
  approvedRequired: number;
  totalRequired: number;
  completionPct: number;
  pendingCount: number;
  expiredCount: number;
  expiringSoonCount: number;
}

/**
 * Build the completion report. Delegates teacher listing + completion
 * math to listAllTeachers; layers in expiring-soon counts derived from
 * the same current-doc snapshot.
 */
export async function getCompletionReport(currentAdmin: {
  role: string;
}): Promise<CompletionReportRow[]> {
  const teachers: TeacherListRow[] = await listAllTeachers(currentAdmin, {
    completionState: "all",
  });

  const userIds = teachers.map((t) => t.user.id);
  // Current (non-superseded) docs for the expiring-soon calculation. Reuse
  // a single query instead of repeating per teacher.
  const docs: TeacherDocument[] = userIds.length
    ? await db
        .select()
        .from(teacherDocuments)
        .where(
          and(
            inArray(teacherDocuments.userId, userIds),
            isNull(teacherDocuments.supersededBy)
          )
        )
    : [];

  const expiringByUser = new Map<string, number>();
  for (const d of docs) {
    if (!isExpiringSoon(d)) continue;
    expiringByUser.set(d.userId, (expiringByUser.get(d.userId) ?? 0) + 1);
  }

  return teachers.map((t) => ({
    userId: t.user.id,
    email: t.user.email,
    name: t.user.name,
    approvedRequired: t.completion.approvedRequired,
    totalRequired: t.completion.totalRequired,
    completionPct: t.completion.pct,
    pendingCount: t.pendingCount,
    expiredCount: t.expiredCount,
    expiringSoonCount: expiringByUser.get(t.user.id) ?? 0,
  }));
}

export interface ExpiryReportRow {
  documentId: string;
  userId: string;
  email: string;
  teacherName: string;
  documentType: string;
  expiresAt: Date | null;
  expiringSoon: boolean;
}

/**
 * Every approved document with its expiry date and an "expiring soon"
 * flag. We deliberately include both not-yet-expiring and
 * expiring-soon rows — the consumer (secretary) wants the full audit
 * trail in one file.
 *
 * Joins teacher_documents → users + document_types so the CSV is
 * human-readable without a second lookup.
 */
export async function getExpiryReport(currentAdmin: {
  role: string;
}): Promise<ExpiryReportRow[]> {
  // Defensive role check (admin-teachers also asserts, but we'll be
  // called before that in tests with a minimal shape).
  if (currentAdmin.role !== "admin") {
    throw new Error("admin role required");
  }

  const rows = await db
    .select({
      document: teacherDocuments,
      teacher: users,
      docType: documentTypes,
    })
    .from(teacherDocuments)
    .innerJoin(users, eq(users.id, teacherDocuments.userId))
    .innerJoin(documentTypes, eq(documentTypes.id, teacherDocuments.documentTypeId))
    .where(
      and(
        eq(teacherDocuments.status, "approved"),
        isNull(teacherDocuments.supersededBy)
      )
    )
    .orderBy(asc(teacherDocuments.expiresAt));

  return rows.map(({ document, teacher, docType }: {
    document: TeacherDocument;
    teacher: { id: string; email: string; name: string };
    docType: DocumentType;
  }) => ({
    documentId: document.id,
    userId: teacher.id,
    email: teacher.email,
    teacherName: teacher.name,
    documentType: docType.name,
    expiresAt: document.expiresAt,
    expiringSoon: isExpiringSoon(document),
  }));
}
