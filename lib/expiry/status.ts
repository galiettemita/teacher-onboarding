import type { TeacherDocument } from "@/lib/db/schema";

/**
 * Derived UI states for a teacher document. The DB only knows
 *   pending | approved | rejected | expired
 * — these are derived from those plus the expiry window.
 */
export type UiStatus =
  | "missing"
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "expiring_soon";

export type DeriveOpts = {
  /** Override "now" for testing. Defaults to `new Date()`. */
  now?: Date;
  /** Override the expiring-soon window in days. Defaults to env or 30. */
  windowDays?: number;
};

/**
 * Read the configured "expiring soon" window. Resolution order:
 *   1. explicit opts.windowDays
 *   2. EXPIRING_SOON_WINDOW_DAYS env var (parsed as int, must be > 0)
 *   3. 90 (default) — a document counts as "expiring soon" once it is within
 *      three months (90 days) of its expiration date.
 */
export const EXPIRING_SOON_WINDOW_DAYS = 90;

export function getExpiringSoonWindowDays(opts?: DeriveOpts): number {
  if (opts?.windowDays !== undefined) return opts.windowDays;
  const raw = process.env.EXPIRING_SOON_WINDOW_DAYS;
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return EXPIRING_SOON_WINDOW_DAYS;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * True iff `doc` is approved with a future expiry that falls within the
 * window. Boundary is inclusive on the window edge: day 30 = true, day 31
 * = false, day 0/past = false (the caller uses `deriveUiStatus` to map a
 * past expiry to `expired`).
 */
export function isExpiringSoon(
  doc: Pick<TeacherDocument, "status" | "expiresAt"> | null,
  opts?: DeriveOpts
): boolean {
  if (!doc) return false;
  if (doc.status !== "approved") return false;
  if (!doc.expiresAt) return false;
  const now = opts?.now ?? new Date();
  const windowMs = getExpiringSoonWindowDays(opts) * DAY_MS;
  const delta = doc.expiresAt.getTime() - now.getTime();
  return delta > 0 && delta <= windowMs;
}

/**
 * Map a document row to its UI-facing status.
 *
 * Contract:
 *  - `null` row → `missing` (the caller signals "no row exists for this
 *    document type")
 *  - `status === 'pending'` → `pending`
 *  - `status === 'rejected'` → `rejected`
 *  - `status === 'expired'` → `expired`
 *  - `status === 'approved'`:
 *      * expires_at in the past → `expired` (safety net; cron normally
 *        keeps the DB row in sync)
 *      * expires_at within window → `expiring_soon`
 *      * else → `approved`
 *
 * Pure: takes optional `now`, no DB access, no clock side-effects.
 */
export function deriveUiStatus(
  doc: Pick<TeacherDocument, "status" | "expiresAt"> | null,
  opts?: DeriveOpts
): UiStatus {
  if (!doc) return "missing";

  if (doc.status === "expired") return "expired";
  if (doc.status === "rejected") return "rejected";
  if (doc.status === "pending") return "pending";

  // status === 'approved'
  if (doc.expiresAt) {
    const now = opts?.now ?? new Date();
    if (doc.expiresAt.getTime() <= now.getTime()) {
      // Past-due approved row that cron hasn't swept yet — surface as expired.
      return "expired";
    }
    if (isExpiringSoon(doc, opts)) return "expiring_soon";
  }
  return "approved";
}
