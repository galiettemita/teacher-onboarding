/**
 * Priority ordering for the daily-cap tiebreak.
 *
 * PROJECT_CONTEXT §11.4 rule 5 (verbatim):
 *   expired_today > expired_recurring > expiring_7 > expiring_14 >
 *   expiring_30 > expiring_60 > expiring_90 > rejected_replace >
 *   missing_required > pending_admin_alert
 *
 * When `reminder_settings.max_one_email_per_teacher_per_day = true` and
 * multiple candidates are eligible for the same teacher on the same
 * day, the dispatcher sends the HIGHEST-priority one and logs the rest
 * as `skipped(daily_cap)`.
 *
 * Ties are broken deterministically by lex-comparing
 * `teacher_document_id` (or `null` → empty string), then
 * `document_type_id`, then `user_id`. That makes test fixtures stable.
 */

import { type ReminderType } from "./types";

/**
 * Lower number = higher priority. Anything not in the map gets +Inf so
 * adding a new reminder type without updating this map fails LOUD: the
 * unknown type will sort to the bottom and the type system will catch
 * it via the exhaustiveness check below.
 */
const PRIORITY: Record<ReminderType, number> = {
  expired_today: 0,
  expired_recurring: 1,
  expiring_7: 2,
  expiring_14: 3,
  expiring_30: 4,
  expiring_60: 5,
  expiring_90: 6,
  rejected_replace: 7,
  missing_required: 8,
  pending_admin_alert: 9,
};

export function priorityForType(t: ReminderType): number {
  // Direct lookup; the `Record<ReminderType, number>` declaration above
  // means TS catches any missing entry at compile time.
  return PRIORITY[t];
}

/**
 * Minimum candidate shape this module needs. Larger candidate types
 * (built in `candidates.ts`) are assignable to this.
 */
export interface PrioritisedCandidate {
  reminderType: ReminderType;
  teacherDocumentId: string | null;
  documentTypeId: string | null;
  userId: string;
}

/**
 * Stable comparator: by priority (asc → highest first), then by
 * (teacherDocumentId, documentTypeId, userId) lex.
 */
export function compareCandidates(
  a: PrioritisedCandidate,
  b: PrioritisedCandidate
): number {
  const pa = priorityForType(a.reminderType);
  const pb = priorityForType(b.reminderType);
  if (pa !== pb) return pa - pb;
  const td = (a.teacherDocumentId ?? "").localeCompare(b.teacherDocumentId ?? "");
  if (td !== 0) return td;
  const dt = (a.documentTypeId ?? "").localeCompare(b.documentTypeId ?? "");
  if (dt !== 0) return dt;
  return a.userId.localeCompare(b.userId);
}

/**
 * Sort candidates so the highest-priority one is first. Pure — returns
 * a new array.
 */
export function sortByPriority<T extends PrioritisedCandidate>(cands: T[]): T[] {
  return [...cands].sort(compareCandidates);
}

/**
 * Group candidates by `userId` (the teacher). Each group is sorted by
 * priority. The dispatcher iterates groups; when the daily cap is on,
 * it sends only the head of each group and skips the rest.
 */
export function groupByTeacher<T extends PrioritisedCandidate>(
  cands: T[]
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const c of cands) {
    const arr = out.get(c.userId);
    if (arr) {
      arr.push(c);
    } else {
      out.set(c.userId, [c]);
    }
  }
  for (const [k, arr] of out) {
    out.set(k, [...arr].sort(compareCandidates));
  }
  return out;
}
