import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  documentTypes,
  teacherDocuments,
  type DocumentType,
  type TeacherDocument,
} from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/guards";
import { linkSupersession } from "@/lib/expiry/supersession";

/**
 * All teacher-document queries take `currentUser` and filter by it. There is
 * no overload that doesn't take a user. This is the single chokepoint for
 * row-level ownership — middleware + role guards handle route gating, but
 * data access enforces "you only see your own rows" as a second wall.
 *
 * Functions throw `Error("forbidden: teacher role required")` if the caller
 * is not a teacher. Callers in admin code use their own query module
 * (Agent 3's lane) — they must not reach for these helpers.
 */

function assertTeacher(user: SessionUser): void {
  if (user.role !== "teacher") {
    throw new Error("forbidden: teacher role required");
  }
}

/** Number of days before `expires_at` that we surface "expiring soon" in the UI. */
export const EXPIRING_SOON_DAYS = 30;

export type UiStatus =
  | "missing"
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "expiring_soon";

export type DocumentTypeWithStatus = {
  documentType: DocumentType;
  currentDoc: TeacherDocument | null;
  uiStatus: UiStatus;
};

/**
 * Derive the user-facing status from the most-recent non-superseded row for
 * a given document type. Pure function so it can be unit-tested without a DB.
 *
 *  - No row → `missing`
 *  - DB `approved` with `expires_at` within EXPIRING_SOON_DAYS → `expiring_soon`
 *  - Otherwise pass the DB status through (it's already one of pending /
 *    approved / rejected / expired).
 */
export function deriveUiStatus(
  doc: TeacherDocument | null,
  now: Date = new Date()
): UiStatus {
  if (!doc) return "missing";
  if (doc.status === "approved" && doc.expiresAt) {
    const msUntilExpiry = doc.expiresAt.getTime() - now.getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    if (msUntilExpiry > 0 && msUntilExpiry <= EXPIRING_SOON_DAYS * dayMs) {
      return "expiring_soon";
    }
  }
  return doc.status as UiStatus;
}

/**
 * For each active `document_type`, return the teacher's most recent
 * non-superseded row (if any) and the derived UI status. Used by the
 * teacher dashboard.
 */
export async function listMyDocumentTypesWithStatus(
  currentUser: SessionUser
): Promise<DocumentTypeWithStatus[]> {
  assertTeacher(currentUser);

  const types = await db
    .select()
    .from(documentTypes)
    .where(eq(documentTypes.active, true))
    .orderBy(documentTypes.name);

  // Fetch all of this teacher's non-superseded rows in one query.
  const rows = await db
    .select()
    .from(teacherDocuments)
    .where(
      and(
        eq(teacherDocuments.userId, currentUser.id),
        isNull(teacherDocuments.supersededBy)
      )
    )
    .orderBy(desc(teacherDocuments.uploadedAt));

  // Most-recent-per-type (rows already in DESC uploadedAt order).
  const latestByType = new Map<string, TeacherDocument>();
  for (const r of rows) {
    if (!latestByType.has(r.documentTypeId)) {
      latestByType.set(r.documentTypeId, r);
    }
  }

  const now = new Date();
  return types.map((dt) => {
    const currentDoc = latestByType.get(dt.id) ?? null;
    return {
      documentType: dt,
      currentDoc,
      uiStatus: deriveUiStatus(currentDoc, now),
    };
  });
}

/**
 * Return every document this teacher has uploaded (including superseded
 * rows), most-recent first. Powers the documents history page.
 */
export async function listMyDocuments(
  currentUser: SessionUser
): Promise<TeacherDocument[]> {
  assertTeacher(currentUser);
  return db
    .select()
    .from(teacherDocuments)
    .where(eq(teacherDocuments.userId, currentUser.id))
    .orderBy(desc(teacherDocuments.uploadedAt));
}

export type TeacherDocumentWithType = TeacherDocument & {
  documentTypeName: string;
};

/**
 * Same as `listMyDocuments` but joined with the document type name. The UI
 * needs the human-readable type for the table — splitting the query keeps
 * the simpler version available for callers that only need the row.
 */
export async function listMyDocumentsWithType(
  currentUser: SessionUser
): Promise<TeacherDocumentWithType[]> {
  assertTeacher(currentUser);
  const rows = await db
    .select({
      doc: teacherDocuments,
      typeName: documentTypes.name,
    })
    .from(teacherDocuments)
    .innerJoin(documentTypes, eq(documentTypes.id, teacherDocuments.documentTypeId))
    .where(eq(teacherDocuments.userId, currentUser.id))
    .orderBy(desc(teacherDocuments.uploadedAt));
  return rows.map((r) => ({ ...r.doc, documentTypeName: r.typeName }));
}

/**
 * Fetch a single document by id, but only if it belongs to the caller.
 * Returns `null` for both "not found" and "belongs to another teacher" —
 * we don't leak existence to non-owners.
 */
export async function getMyDocumentById(
  currentUser: SessionUser,
  id: string
): Promise<TeacherDocument | null> {
  assertTeacher(currentUser);
  const [row] = await db
    .select()
    .from(teacherDocuments)
    .where(
      and(eq(teacherDocuments.id, id), eq(teacherDocuments.userId, currentUser.id))
    )
    .limit(1);
  return row ?? null;
}

export type InsertMyDocumentInput = {
  documentTypeId: string;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
};

/**
 * Insert a new teacher_documents row for the caller. `user_id` is forced
 * to `currentUser.id` regardless of any input — callers cannot upload on
 * behalf of another teacher even if they pass a different id by accident.
 * Status defaults to `pending` via the schema.
 *
 * Renewal supersession (Phase 4): if a previous non-superseded
 * approved/expired/rejected row exists for the same (user, doctype), it is
 * linked via `superseded_by = new.id` in the same transaction. Pending
 * previous rows are left alone — admins may still review them.
 */
export async function insertMyDocument(
  currentUser: SessionUser,
  input: InsertMyDocumentInput
): Promise<TeacherDocument> {
  assertTeacher(currentUser);
  return db.transaction(async (tx) => {
    const [previous] = await tx
      .select({ id: teacherDocuments.id })
      .from(teacherDocuments)
      .where(
        and(
          eq(teacherDocuments.userId, currentUser.id),
          eq(teacherDocuments.documentTypeId, input.documentTypeId),
          isNull(teacherDocuments.supersededBy),
          inArray(teacherDocuments.status, ["approved", "expired", "rejected"])
        )
      )
      .orderBy(desc(teacherDocuments.uploadedAt))
      .limit(1);
    const [row] = await tx
      .insert(teacherDocuments)
      .values({
        userId: currentUser.id,
        documentTypeId: input.documentTypeId,
        storageKey: input.storageKey,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
      })
      .returning();
    if (previous) await linkSupersession(row.id, previous.id, tx);
    return row;
  });
}

/**
 * Admin / route-internal lookup. Does NOT enforce ownership — only used by
 * `GET /api/files/[id]` which performs its own owner-or-admin check.
 * Kept here so all teacher_documents reads live in one file.
 */
export async function getDocumentByIdUnscoped(
  id: string
): Promise<TeacherDocument | null> {
  const [row] = await db
    .select()
    .from(teacherDocuments)
    .where(eq(teacherDocuments.id, id))
    .limit(1);
  return row ?? null;
}
