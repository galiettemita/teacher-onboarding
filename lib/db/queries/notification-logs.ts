/**
 * Access layer for `notification_logs`.
 *
 * The UNIQUE `(teacher_id, milestone_key)` index
 * (`notification_logs_milestone_uq`) is the idempotency primitive. The
 * dispatcher rides it as follows:
 *
 *   1. tryReserveSlot(...) inserts a row with status='queued'. If the
 *      UNIQUE index throws (Postgres error code 23505), we treat that
 *      as "another invocation already claimed this milestone" and
 *      return { reserved: false }.
 *   2. The dispatcher calls sendEmail.
 *   3. recordSent(...) / recordFailed(...) updates the row to sent/failed
 *      based on the provider result.
 *
 * This pattern is safe under concurrent cron invocations: if two
 * workers race for the same milestone, exactly one wins the UNIQUE
 * insert and sends. The other gets back to its loop without sending.
 *
 * "check then insert" would have a TOCTOU window — explicitly
 * forbidden by PROJECT_CONTEXT §11.4.
 */

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { notificationLogs, users } from "@/lib/db/schema";
import { ForbiddenError } from "@/lib/errors";

/**
 * The Postgres error code for unique_violation. See
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PG_UNIQUE_VIOLATION = "23505";

/**
 * Heuristic test for the unique-violation error coming out of
 * postgres-js. We check both `code` (the standard SQLSTATE) and
 * a string match on the constraint name as belt-and-braces — the
 * constraint name is stable in `schema.ts`
 * (`notification_logs_milestone_uq`).
 */
export function isMilestoneUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; constraint_name?: string; message?: string };
  if (e.code === PG_UNIQUE_VIOLATION) return true;
  if (typeof e.message === "string" && e.message.includes("notification_logs_milestone_uq")) {
    return true;
  }
  return false;
}

export type ReminderTypeStr =
  | "missing_required"
  | "rejected_replace"
  | "expiring_90"
  | "expiring_60"
  | "expiring_30"
  | "expiring_14"
  | "expiring_7"
  | "expired_today"
  | "expired_recurring"
  | "pending_admin_alert"
  | "manual";

export type NotificationStatus = "queued" | "sent" | "failed" | "skipped";
export type TriggeredBy = "cron" | "admin_manual";

export interface ReserveInput {
  teacherId: string;
  teacherDocumentId: string | null;
  documentTypeId: string | null;
  reminderType: ReminderTypeStr;
  milestoneKey: string;
  recipientEmail: string;
  subject: string;
  triggeredBy: TriggeredBy;
  actorId: string | null;
}

export interface ReserveResult {
  reserved: boolean;
  /** The row id when reserved=true; null when the milestone was already claimed. */
  notificationLogId: string | null;
}

/**
 * Insert a `queued` row. Catches the UNIQUE-violation error from the
 * `(teacher_id, milestone_key)` index and reports back so the dispatcher
 * can log the skip without burning a provider call.
 */
export async function tryReserveSlot(input: ReserveInput): Promise<ReserveResult> {
  try {
    const [row] = await db
      .insert(notificationLogs)
      .values({
        teacherId: input.teacherId,
        teacherDocumentId: input.teacherDocumentId,
        documentTypeId: input.documentTypeId,
        reminderType: input.reminderType,
        milestoneKey: input.milestoneKey,
        recipientEmail: input.recipientEmail,
        subject: input.subject,
        status: "queued",
        triggeredBy: input.triggeredBy,
        actorId: input.actorId,
      })
      .returning({ id: notificationLogs.id });
    return { reserved: true, notificationLogId: row.id };
  } catch (err) {
    if (isMilestoneUniqueViolation(err)) {
      return { reserved: false, notificationLogId: null };
    }
    throw err;
  }
}

/**
 * Insert a `skipped` row. Skipped rows DON'T need to participate in the
 * UNIQUE index — we still want a record that we considered the
 * candidate and decided not to send. To avoid colliding with a future
 * "real" send for the same milestone, we use a synthesised key that
 * mixes in the skipped reason + a uuid suffix.
 */
export async function recordSkip(input: {
  teacherId: string;
  teacherDocumentId: string | null;
  documentTypeId: string | null;
  reminderType: ReminderTypeStr;
  recipientEmail: string;
  subject: string;
  skippedReason: string;
  triggeredBy: TriggeredBy;
  actorId: string | null;
  /** When the skip is "duplicate_milestone", we still want it in the log
   *  but NOT colliding with the winning row's key. Suffix the key. */
  baseMilestoneKey: string;
}): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [row] = await db
    .insert(notificationLogs)
    .values({
      teacherId: input.teacherId,
      teacherDocumentId: input.teacherDocumentId,
      documentTypeId: input.documentTypeId,
      reminderType: input.reminderType,
      milestoneKey: `${input.baseMilestoneKey}#skip:${input.skippedReason}:${suffix}`,
      recipientEmail: input.recipientEmail,
      subject: input.subject,
      status: "skipped",
      skippedReason: input.skippedReason,
      triggeredBy: input.triggeredBy,
      actorId: input.actorId,
    })
    .returning({ id: notificationLogs.id });
  return row.id;
}

/** Update a `queued` row to `sent`. */
export async function recordSent(
  notificationLogId: string,
  providerMessageId: string | undefined
): Promise<void> {
  await db
    .update(notificationLogs)
    .set({
      status: "sent",
      providerMessageId: providerMessageId ?? null,
      sentAt: new Date(),
    })
    .where(eq(notificationLogs.id, notificationLogId));
}

/** Update a `queued` row to `failed`. */
export async function recordFailed(
  notificationLogId: string,
  failedReason: string
): Promise<void> {
  await db
    .update(notificationLogs)
    .set({
      status: "failed",
      failedReason: failedReason.slice(0, 1000),
    })
    .where(eq(notificationLogs.id, notificationLogId));
}

/**
 * For the daily-cap check: has this teacher had ANY `sent` row today
 * (UTC day)? Used by the dispatcher when
 * `max_one_email_per_teacher_per_day = true`.
 *
 * Manual sends count too — the cap is about teacher inbox volume, not
 * just cron output.
 */
export async function teacherHadSentToday(
  teacherId: string,
  nowUtc: Date
): Promise<boolean> {
  const startOfDay = new Date(
    Date.UTC(
      nowUtc.getUTCFullYear(),
      nowUtc.getUTCMonth(),
      nowUtc.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );
  const endOfDay = new Date(startOfDay.getTime() + 86_400_000);

  const rows = await db
    .select({ id: notificationLogs.id })
    .from(notificationLogs)
    .where(
      and(
        eq(notificationLogs.teacherId, teacherId),
        eq(notificationLogs.status, "sent"),
        gte(notificationLogs.sentAt, startOfDay),
        lt(notificationLogs.sentAt, endOfDay)
      )
    )
    .limit(1);
  return rows.length > 0;
}

// ===== Admin viewer =====

export interface NotificationLogRow {
  id: string;
  teacherId: string;
  teacherEmail: string | null;
  teacherName: string | null;
  teacherDocumentId: string | null;
  documentTypeId: string | null;
  reminderType: string;
  milestoneKey: string;
  recipientEmail: string;
  subject: string;
  status: string;
  providerMessageId: string | null;
  sentAt: Date | null;
  failedReason: string | null;
  skippedReason: string | null;
  triggeredBy: string;
  actorId: string | null;
  createdAt: Date;
}

export interface NotificationLogFilters {
  teacherId?: string | null;
  status?: NotificationStatus | null;
  reminderType?: string | null;
  since?: Date | null;
  until?: Date | null;
}

export interface NotificationLogPage {
  rows: NotificationLogRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const NOTIFICATION_LOG_DEFAULT_PAGE_SIZE = 25;
export const NOTIFICATION_LOG_MAX_PAGE_SIZE = 100;

function assertAdmin(actor: { role: string }) {
  if (actor.role !== "admin") throw new ForbiddenError("Admin role required");
}

export async function listNotificationLogs(
  actor: { role: string },
  filters: NotificationLogFilters = {},
  opts: { page?: number; pageSize?: number } = {}
): Promise<NotificationLogPage> {
  assertAdmin(actor);

  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(
    NOTIFICATION_LOG_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(opts.pageSize ?? NOTIFICATION_LOG_DEFAULT_PAGE_SIZE))
  );

  const conds = [] as ReturnType<typeof eq>[];
  if (filters.teacherId) conds.push(eq(notificationLogs.teacherId, filters.teacherId));
  if (filters.status) conds.push(eq(notificationLogs.status, filters.status));
  if (filters.reminderType)
    conds.push(eq(notificationLogs.reminderType, filters.reminderType));
  if (filters.since) conds.push(gte(notificationLogs.createdAt, filters.since));
  if (filters.until) conds.push(lt(notificationLogs.createdAt, filters.until));

  const whereExpr = conds.length > 0 ? and(...conds) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notificationLogs)
    .where(whereExpr as never);

  const rows = await db
    .select({
      id: notificationLogs.id,
      teacherId: notificationLogs.teacherId,
      teacherEmail: users.email,
      teacherName: users.name,
      teacherDocumentId: notificationLogs.teacherDocumentId,
      documentTypeId: notificationLogs.documentTypeId,
      reminderType: notificationLogs.reminderType,
      milestoneKey: notificationLogs.milestoneKey,
      recipientEmail: notificationLogs.recipientEmail,
      subject: notificationLogs.subject,
      status: notificationLogs.status,
      providerMessageId: notificationLogs.providerMessageId,
      sentAt: notificationLogs.sentAt,
      failedReason: notificationLogs.failedReason,
      skippedReason: notificationLogs.skippedReason,
      triggeredBy: notificationLogs.triggeredBy,
      actorId: notificationLogs.actorId,
      createdAt: notificationLogs.createdAt,
    })
    .from(notificationLogs)
    .leftJoin(users, eq(notificationLogs.teacherId, users.id))
    .where(whereExpr as never)
    .orderBy(desc(notificationLogs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    rows,
    total: count,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(count / pageSize)),
  };
}
