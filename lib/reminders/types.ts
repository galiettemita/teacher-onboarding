/**
 * Shared types for the reminder subsystem. Kept separate from
 * `lib/db/schema.ts` (which we don't touch in Phase 6) and from the
 * individual modules so candidates, dispatcher, and queries can refer
 * to a single canonical shape.
 */

/**
 * The values of `notification_logs.reminder_type` (§3.7) that the
 * dispatcher actually emits. `manual` exists in the schema enum so
 * future ad-hoc messages have a slot, but the dispatcher always uses
 * one of the concrete types below and discriminates manual sends via
 * `triggered_by='admin_manual'`.
 */
export const REMINDER_TYPES = [
  "missing_required",
  "rejected_replace",
  "expiring_90",
  "expiring_60",
  "expiring_30",
  "expiring_14",
  "expiring_7",
  "expired_today",
  "expired_recurring",
  "pending_admin_alert",
] as const;

export type ReminderType = (typeof REMINDER_TYPES)[number];

export const EXPIRING_MILESTONE_DAYS = [90, 60, 30, 14, 7] as const;
export type ExpiringMilestoneDays = (typeof EXPIRING_MILESTONE_DAYS)[number];

export function expiringReminderTypeForDays(
  days: ExpiringMilestoneDays
): "expiring_90" | "expiring_60" | "expiring_30" | "expiring_14" | "expiring_7" {
  switch (days) {
    case 90:
      return "expiring_90";
    case 60:
      return "expiring_60";
    case 30:
      return "expiring_30";
    case 14:
      return "expiring_14";
    case 7:
      return "expiring_7";
  }
}

/** What `dispatcher.runOnce()` returns. */
export interface DispatchCounts {
  considered: number;
  sent: number;
  skippedDuplicate: number;
  skippedDailyCap: number;
  skippedDisabled: number;
  skippedNoEmail: number;
  failed: number;
}

export function emptyCounts(): DispatchCounts {
  return {
    considered: 0,
    sent: 0,
    skippedDuplicate: 0,
    skippedDailyCap: 0,
    skippedDisabled: 0,
    skippedNoEmail: 0,
    failed: 0,
  };
}
