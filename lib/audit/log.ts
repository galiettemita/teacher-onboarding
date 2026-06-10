import { db } from "@/lib/db/client";
import { auditLogs } from "@/lib/db/schema";

/**
 * Single entry point for writing rows to `audit_logs`.
 *
 * Every admin mutation and every file download MUST go through this helper.
 * Never inline a SQL insert into `audit_logs` elsewhere. See PROJECT_CONTEXT
 * §5.5 (server-side enforcement) and the iron rule in §10.
 *
 * Notes:
 *  - `actorId` may be null for system actions (e.g. cron-driven expiry). For
 *    admin-initiated actions it must be the admin's user id.
 *  - `metadata` is stored as JSONB. Callers are responsible for sanitising
 *    PII per the §11.3 privacy rules before passing it in.
 *  - This function never throws on serialisation issues — the DB will reject
 *    a bad payload and the surrounding transaction will roll back.
 */
export type AuditAction =
  | "document.upload"
  | "document.approve"
  | "document.reject"
  | "doc_type.create"
  | "doc_type.update"
  | "doc_type.deactivate"
  | "user.invite"
  | "file.download"
  | "file.missing"
  | "report.export"
  // Phase 6 — automated email reminders (§11.5 last paragraph).
  // Every admin mutation on reminders writes one of these.
  | "reminders.settings.update"
  | "reminders.toggle"
  | "reminders.manual_send";

export type AuditTargetType =
  | "document"
  | "doc_type"
  | "user"
  | "file"
  | "teacher_document"
  // Phase 6 audit targets.
  | "reminder_settings"
  | "notification_log";

export interface AuditLogInput {
  actorId: string | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | null;
  metadata?: Record<string, unknown>;
}

export async function auditLog(input: AuditLogInput): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata ?? {},
  });
}
