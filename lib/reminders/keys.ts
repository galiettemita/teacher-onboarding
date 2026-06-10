/**
 * Milestone-key formatters.
 *
 * The `notification_logs.milestone_key` column is the idempotency
 * primitive. The schema has a UNIQUE index on
 * `(teacher_id, milestone_key)` (`notification_logs_milestone_uq`); the
 * dispatcher relies on it to make concurrent cron invocations safe
 * (PROJECT_CONTEXT §11.4).
 *
 * Formats (§11.4 rule 1):
 *   expiring_{N}:{teacher_document_id}                            — one-shot per milestone per doc
 *   expired_today:{teacher_document_id}                           — one-shot per doc
 *   expired_recurring:{teacher_document_id}:{YYYY-MM-DD}          — cadence bucket date
 *   missing_required:{user_id}:{document_type_id}:{YYYY-MM-DD}    — cadence bucket date
 *   rejected_replace:{teacher_document_id}:{YYYY-MM-DD}           — cadence bucket date
 *   pending_admin_alert:{teacher_document_id}                     — one-shot per pending doc
 *
 * All purely-formatting functions live here. Date math (what the
 * "cadence bucket" date IS for a given run-date) lives in
 * `milestones.ts`. Keeping them separate makes the key strings
 * trivially testable without faking dates.
 */

import { type ExpiringMilestoneDays } from "./types";

/**
 * Format a Date as `YYYY-MM-DD` in UTC. We use UTC to avoid the cadence
 * bucket shifting when the cron runs in different timezones; the school
 * doesn't care about hour-of-day, only date.
 */
export function toYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function keyExpiring(
  days: ExpiringMilestoneDays,
  teacherDocumentId: string
): string {
  return `expiring_${days}:${teacherDocumentId}`;
}

export function keyExpiredToday(teacherDocumentId: string): string {
  return `expired_today:${teacherDocumentId}`;
}

/**
 * Recurring "still expired" reminder. `bucketDate` is the start of the
 * current cadence window in YMD form (see `milestones.ts`
 * `bucketDateForCadence`). Two runs in the same window share a key →
 * UNIQUE blocks the second.
 */
export function keyExpiredRecurring(
  teacherDocumentId: string,
  bucketDate: Date | string
): string {
  const ymd = typeof bucketDate === "string" ? bucketDate : toYMD(bucketDate);
  return `expired_recurring:${teacherDocumentId}:${ymd}`;
}

export function keyMissingRequired(
  userId: string,
  documentTypeId: string,
  bucketDate: Date | string
): string {
  const ymd = typeof bucketDate === "string" ? bucketDate : toYMD(bucketDate);
  return `missing_required:${userId}:${documentTypeId}:${ymd}`;
}

export function keyRejectedReplace(
  teacherDocumentId: string,
  bucketDate: Date | string
): string {
  const ymd = typeof bucketDate === "string" ? bucketDate : toYMD(bucketDate);
  return `rejected_replace:${teacherDocumentId}:${ymd}`;
}

export function keyPendingAdminAlert(teacherDocumentId: string): string {
  return `pending_admin_alert:${teacherDocumentId}`;
}
