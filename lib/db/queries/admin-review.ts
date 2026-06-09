import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  teacherDocuments,
  documentTypes,
  type TeacherDocument,
} from "@/lib/db/schema";
import { auditLog } from "@/lib/audit/log";
import { setExpiryOnApproval } from "@/lib/expiry";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

function assertAdmin(currentAdmin: { role: string }) {
  if (currentAdmin.role !== "admin") {
    throw new ForbiddenError("Admin role required");
  }
}

async function loadDoc(docId: string): Promise<TeacherDocument> {
  const [row] = await db
    .select()
    .from(teacherDocuments)
    .where(eq(teacherDocuments.id, docId))
    .limit(1);
  if (!row) throw new NotFoundError("Document not found");
  return row;
}

/**
 * Approve a pending document.
 *
 * State machine: pending -> approved. Any other source state is rejected
 * with ConflictError (409). Approving an already-approved doc is also a
 * conflict (terminal write — we want loud failure rather than a silent no-op).
 *
 * Expiry: `expires_at = reviewed_at + docType.renewal_months months` via
 * `setExpiryOnApproval` (see lib/expiry). The daily cron flips approved
 * past-due rows to `expired`; this query is the only place that sets
 * `expires_at` in the happy path.
 *
 * One-time documents (`renewal_months === 0`) get `expires_at = null` —
 * a degree or background-check certificate never expires, so the cron
 * must never sweep it. The pure-math helper is intentionally NOT called
 * for those rows.
 */
export async function approveDocument(
  currentAdmin: { id: string; role: string },
  docId: string
): Promise<TeacherDocument> {
  assertAdmin(currentAdmin);

  const doc = await loadDoc(docId);

  if (doc.status === "approved") {
    throw new ConflictError("Document is already approved");
  }
  if (doc.status !== "pending") {
    // rejected/expired are terminal — teacher must upload a replacement.
    throw new ConflictError(
      `Cannot approve a document with status='${doc.status}'`
    );
  }

  const [docType] = await db
    .select()
    .from(documentTypes)
    .where(eq(documentTypes.id, doc.documentTypeId))
    .limit(1);

  const now = new Date();
  const expiresAt =
    docType && docType.renewalMonths > 0
      ? setExpiryOnApproval({ reviewedAt: now }, docType)
      : null;
  const [updated] = await db
    .update(teacherDocuments)
    .set({
      status: "approved",
      reviewedAt: now,
      reviewedBy: currentAdmin.id,
      rejectionReason: null,
      expiresAt,
    })
    .where(eq(teacherDocuments.id, doc.id))
    .returning();

  await auditLog({
    actorId: currentAdmin.id,
    action: "document.approve",
    targetType: "document",
    targetId: doc.id,
    metadata: {
      documentTypeId: doc.documentTypeId,
      teacherId: doc.userId,
    },
  });

  return updated;
}

/**
 * Reject a pending document. Requires a non-empty reason.
 *
 * State machine: pending -> rejected. Any other source state (approved,
 * rejected, expired) is a 409. The teacher must upload a new row to
 * supersede a rejected doc — we never undo a rejection by editing this row.
 */
export async function rejectDocument(
  currentAdmin: { id: string; role: string },
  docId: string,
  reason: string
): Promise<TeacherDocument> {
  assertAdmin(currentAdmin);

  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new ValidationError("rejection reason is required");
  }

  const doc = await loadDoc(docId);

  if (doc.status === "rejected") {
    throw new ConflictError("Document is already rejected");
  }
  if (doc.status !== "pending") {
    throw new ConflictError(
      `Cannot reject a document with status='${doc.status}'`
    );
  }

  const trimmed = reason.trim();
  const now = new Date();
  const [updated] = await db
    .update(teacherDocuments)
    .set({
      status: "rejected",
      reviewedAt: now,
      reviewedBy: currentAdmin.id,
      rejectionReason: trimmed,
    })
    .where(eq(teacherDocuments.id, doc.id))
    .returning();

  await auditLog({
    actorId: currentAdmin.id,
    action: "document.reject",
    targetType: "document",
    targetId: doc.id,
    metadata: {
      documentTypeId: doc.documentTypeId,
      teacherId: doc.userId,
      // reason is stored verbatim from admin; the rejection_reason column
      // is the canonical store, this metadata copy is for audit-trail lookup.
      reason: trimmed.slice(0, 500),
    },
  });

  return updated;
}
