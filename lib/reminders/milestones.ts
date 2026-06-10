/**
 * Pure date math for reminder eligibility.
 *
 * Functions take `now` and the relevant document/teacher dates and
 * return *milestones* — the small set of reminder events that would
 * fire today for a given input. No DB access. No clock side-effects.
 *
 * The dispatcher pairs the output of these functions with
 * `notification_logs.milestone_key` (see `keys.ts`) to enforce
 * "send each milestone at most once" via the UNIQUE index.
 *
 * Everything below operates in UTC-day granularity. Hour-of-day
 * doesn't matter to the cadence; the school sees calendar dates.
 */

import {
  EXPIRING_MILESTONE_DAYS,
  type ExpiringMilestoneDays,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Return midnight UTC for the given Date. Used everywhere the
 * computation needs to be insensitive to hour-of-day (which is
 * everywhere here).
 */
export function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
  );
}

/**
 * Whole-day difference (`to - from`) in UTC days. Positive when `to`
 * is in the future. Used to determine "this doc expires in N days."
 */
export function utcDaysBetween(from: Date, to: Date): number {
  const a = startOfUtcDay(from).getTime();
  const b = startOfUtcDay(to).getTime();
  return Math.round((b - a) / DAY_MS);
}

/**
 * For an approved doc with `expires_at`, return the expiring milestone
 * (if any) that fires today.
 *
 * Rule: fires on the EXACT day count. expires_at - 30 days = 30. So
 * the cron must run daily for the chain to be complete; if it skips
 * a day, that day's milestone is lost (by design — we don't backfill
 * milestones, because the dispatcher tracks "highest milestone seen"
 * implicitly via the UNIQUE key).
 *
 * Returns null if none of the configured milestones match today.
 */
export function expiringMilestoneForToday(
  expiresAt: Date,
  now: Date,
  configuredDays: readonly number[] = EXPIRING_MILESTONE_DAYS
): ExpiringMilestoneDays | null {
  const days = utcDaysBetween(now, expiresAt);
  if (days <= 0) return null;
  // Configured days are admin-editable; only the canonical 5 have
  // templates wired. Anything else is ignored at the milestone layer
  // so we never produce a candidate for a milestone we can't render.
  for (const d of EXPIRING_MILESTONE_DAYS) {
    if (configuredDays.includes(d) && days === d) {
      return d;
    }
  }
  return null;
}

/**
 * True iff `expires_at` is today (in UTC days). The candidate query
 * already filters to "expired" docs; this just disambiguates
 * "expired today" from "expired N days ago" for the dispatcher.
 */
export function isExpiredToday(expiresAt: Date, now: Date): boolean {
  return utcDaysBetween(now, expiresAt) === 0;
}

/**
 * For an expired doc, compute the cadence bucket date for the
 * recurring reminder. Returns null if no recurring reminder fires
 * today (i.e. today is not on a multiple of `intervalDays` past the
 * expiration).
 *
 * Example: intervalDays=7, expiresAt=2026-06-01, now=2026-06-15:
 *   daysOverdue=14, 14 % 7 === 0, bucket = 2026-06-15.
 *
 * Example: intervalDays=7, expiresAt=2026-06-01, now=2026-06-08:
 *   daysOverdue=7, 7 % 7 === 0, bucket = 2026-06-08. ALSO, "expired
 *   today" was sent 7 days ago — that's a different milestone key
 *   (`expired_today:`), so this recurring one is independent.
 *
 * Example: intervalDays=7, expiresAt=2026-06-01, now=2026-06-05:
 *   daysOverdue=4, 4 % 7 !== 0, return null. (Also, the "expired today"
 *   would have fired 4 days ago.)
 */
export function recurringBucketDate(
  expiresAt: Date,
  now: Date,
  intervalDays: number
): Date | null {
  if (intervalDays <= 0) return null;
  const days = -utcDaysBetween(now, expiresAt); // days OVERDUE
  if (days <= 0) return null; // not expired (or expires today; the today-case is a different milestone)
  if (days % intervalDays !== 0) return null;
  return startOfUtcDay(now);
}

/**
 * Cadence bucket for the "missing required" reminder. Grounded at the
 * teacher's `users.created_at` so two different teachers don't all
 * receive the missing reminder on the same day of the week — staggers
 * naturally.
 *
 * Returns the bucket date (always today, when one fires) or null when
 * today isn't a cadence day.
 */
export function missingRequiredBucketDate(
  userCreatedAt: Date,
  now: Date,
  intervalDays: number
): Date | null {
  if (intervalDays <= 0) return null;
  const days = utcDaysBetween(userCreatedAt, now);
  if (days < 0) return null; // future-dated user; defensive
  if (days % intervalDays !== 0) return null;
  return startOfUtcDay(now);
}

/**
 * Cadence bucket for the "rejected replace" reminder. Grounded at the
 * doc's `reviewed_at` (the rejection moment).
 *
 * On the day of rejection itself (days === 0), we DO fire: the
 * teacher needs to know straight away.
 */
export function rejectedReplaceBucketDate(
  rejectedAt: Date,
  now: Date,
  intervalDays: number
): Date | null {
  if (intervalDays <= 0) return null;
  const days = utcDaysBetween(rejectedAt, now);
  if (days < 0) return null;
  if (days % intervalDays !== 0) return null;
  return startOfUtcDay(now);
}

/**
 * Days overdue for the recurring template's body text. Always >= 1
 * by construction (recurringBucketDate returns null for non-expired).
 */
export function daysOverdue(expiresAt: Date, now: Date): number {
  return Math.max(1, -utcDaysBetween(now, expiresAt));
}
