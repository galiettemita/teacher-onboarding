/**
 * Find candidates per reminder type.
 *
 * One function per row in §11.1. Each function:
 *   - issues ONE SQL query against the relevant DB shape
 *   - applies the pure date math from `milestones.ts` to filter to
 *     "fires today"
 *   - returns a typed candidate carrying everything the dispatcher
 *     needs: teacher identity, doc context, milestone key, template
 *     payload, recipient email
 *
 * Candidates DO NOT contain storage keys, file IDs, original filenames,
 * rejection reasons, or any other field the §11.3 rules forbid in
 * outgoing email. The candidate shape itself is the contract.
 */

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  documentTypes,
  teacherDocuments,
  users,
} from "@/lib/db/schema";
import type { ReminderType, ExpiringMilestoneDays } from "./types";
import {
  daysOverdue,
  expiringMilestoneForToday,
  isExpiredToday,
  missingRequiredBucketDate,
  recurringBucketDate,
  rejectedReplaceBucketDate,
} from "./milestones";
import {
  keyExpiring,
  keyExpiredToday,
  keyExpiredRecurring,
  keyMissingRequired,
  keyRejectedReplace,
  keyPendingAdminAlert,
  toYMD,
} from "./keys";
import {
  expiringReminderTypeForDays,
} from "./types";

export interface Candidate {
  userId: string; // teacher
  recipientEmail: string;
  teacherFirstName: string;
  teacherDocumentId: string | null;
  documentTypeId: string | null;
  documentTypeName: string;
  reminderType: ReminderType;
  milestoneKey: string;
  /** Extra payload that templates need (expiresOn, daysOverdue, etc.) */
  payload:
    | { kind: "missing_required" }
    | { kind: "rejected_replace" }
    | { kind: "expiring"; days: ExpiringMilestoneDays; expiresOn: string }
    | { kind: "expired_today"; expiredOn: string }
    | { kind: "expired_recurring"; expiredOn: string; daysOverdue: number }
    | { kind: "pending_admin_alert"; daysPending: number };
}

/**
 * Helpers: derive a first name from `users.name`. We use the first
 * whitespace-separated token; if missing, "there" (matches the
 * grandma-friendly tone). The dispatcher's caller can override but
 * shouldn't need to.
 */
function firstNameFor(fullName: string | null | undefined): string {
  const t = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  return t.length > 0 ? t : "there";
}

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

/**
 * Reminder #1: missing required document.
 *
 * Definition (§11.1 row 1): an `active`, `required` document_type for
 * which the teacher has no current non-superseded row at all.
 *
 * Implementation: pair every (teacher, document_type) with the count of
 * current non-superseded docs and select the zero rows. The cadence
 * bucket is grounded at the teacher's `users.createdAt` so two
 * teachers don't all reminder on the same day.
 */
export async function findMissingRequiredCandidates(
  now: Date,
  intervalDays: number
): Promise<Candidate[]> {
  // Pull (teacher × required-active-doc-type) cross product, then
  // LEFT JOIN to a per-type current doc; rows with NULL on the right
  // are missing.
  const rows = await db.execute<{
    user_id: string;
    user_email: string;
    user_name: string;
    user_created_at: Date;
    document_type_id: string;
    document_type_name: string;
  }>(sql`
    select
      u.id          as user_id,
      u.email       as user_email,
      u.name        as user_name,
      u.created_at  as user_created_at,
      dt.id         as document_type_id,
      dt.name       as document_type_name
    from ${users} u
    cross join ${documentTypes} dt
    left join lateral (
      select 1 as has_doc
      from ${teacherDocuments} td
      where td.user_id = u.id
        and td.document_type_id = dt.id
        and td.superseded_by is null
      limit 1
    ) cur on true
    where u.role = 'teacher'
      and dt.active = true
      and dt.required = true
      and cur.has_doc is null
  `);

  const out: Candidate[] = [];
  for (const r of rows as unknown as Array<{
    user_id: string;
    user_email: string;
    user_name: string;
    user_created_at: Date;
    document_type_id: string;
    document_type_name: string;
  }>) {
    if (!r.user_email) continue;
    const userCreatedAt =
      r.user_created_at instanceof Date
        ? r.user_created_at
        : new Date(r.user_created_at);
    const bucket = missingRequiredBucketDate(userCreatedAt, now, intervalDays);
    if (!bucket) continue;
    out.push({
      userId: r.user_id,
      recipientEmail: r.user_email,
      teacherFirstName: firstNameFor(r.user_name),
      teacherDocumentId: null,
      documentTypeId: r.document_type_id,
      documentTypeName: r.document_type_name,
      reminderType: "missing_required",
      milestoneKey: keyMissingRequired(r.user_id, r.document_type_id, bucket),
      payload: { kind: "missing_required" },
    });
  }
  return out;
}

/**
 * Reminder #2: rejected document needs replacement.
 *
 * Definition (§11.1 row 2): most recent doc for a required type is
 * `rejected` AND no newer upload exists. Cadence from rejection date.
 *
 * "Most recent" = `superseded_by is null AND status='rejected'`. A new
 * upload would supersede → falls out of the candidate set.
 */
export async function findRejectedReplaceCandidates(
  now: Date,
  intervalDays: number
): Promise<Candidate[]> {
  const rows = await db
    .select({
      teacherDocumentId: teacherDocuments.id,
      userId: teacherDocuments.userId,
      userEmail: users.email,
      userName: users.name,
      documentTypeId: teacherDocuments.documentTypeId,
      documentTypeName: documentTypes.name,
      reviewedAt: teacherDocuments.reviewedAt,
    })
    .from(teacherDocuments)
    .innerJoin(users, eq(users.id, teacherDocuments.userId))
    .innerJoin(documentTypes, eq(documentTypes.id, teacherDocuments.documentTypeId))
    .where(
      and(
        eq(teacherDocuments.status, "rejected"),
        isNull(teacherDocuments.supersededBy),
        eq(documentTypes.active, true),
        eq(users.role, "teacher")
      )
    );

  const out: Candidate[] = [];
  for (const r of rows) {
    if (!r.reviewedAt || !r.userEmail) continue;
    const bucket = rejectedReplaceBucketDate(r.reviewedAt, now, intervalDays);
    if (!bucket) continue;
    out.push({
      userId: r.userId,
      recipientEmail: r.userEmail,
      teacherFirstName: firstNameFor(r.userName),
      teacherDocumentId: r.teacherDocumentId,
      documentTypeId: r.documentTypeId,
      documentTypeName: r.documentTypeName,
      reminderType: "rejected_replace",
      milestoneKey: keyRejectedReplace(r.teacherDocumentId, bucket),
      payload: { kind: "rejected_replace" },
    });
  }
  return out;
}

/**
 * Reminder #3: expiring approved document.
 *
 * Definition (§11.1 row 3 + §11.2): an approved, non-superseded doc
 * whose `expires_at` matches one of the configured milestone days.
 *
 * Renewal cancellation is implicit: a renewal sets `superseded_by` on
 * the old row (per §3.4), which drops it from this query.
 */
export async function findExpiringCandidates(
  now: Date,
  configuredDays: readonly number[]
): Promise<Candidate[]> {
  const rows = await db
    .select({
      teacherDocumentId: teacherDocuments.id,
      userId: teacherDocuments.userId,
      userEmail: users.email,
      userName: users.name,
      documentTypeId: teacherDocuments.documentTypeId,
      documentTypeName: documentTypes.name,
      expiresAt: teacherDocuments.expiresAt,
    })
    .from(teacherDocuments)
    .innerJoin(users, eq(users.id, teacherDocuments.userId))
    .innerJoin(documentTypes, eq(documentTypes.id, teacherDocuments.documentTypeId))
    .where(
      and(
        eq(teacherDocuments.status, "approved"),
        isNotNull(teacherDocuments.expiresAt),
        isNull(teacherDocuments.supersededBy),
        eq(users.role, "teacher")
      )
    );

  const out: Candidate[] = [];
  for (const r of rows) {
    if (!r.expiresAt || !r.userEmail) continue;
    const milestone = expiringMilestoneForToday(r.expiresAt, now, configuredDays);
    if (milestone === null) continue;
    out.push({
      userId: r.userId,
      recipientEmail: r.userEmail,
      teacherFirstName: firstNameFor(r.userName),
      teacherDocumentId: r.teacherDocumentId,
      documentTypeId: r.documentTypeId,
      documentTypeName: r.documentTypeName,
      reminderType: expiringReminderTypeForDays(milestone),
      milestoneKey: keyExpiring(milestone, r.teacherDocumentId),
      payload: { kind: "expiring", days: milestone, expiresOn: toYMD(r.expiresAt) },
    });
  }
  return out;
}

/**
 * Reminder #4: doc expired today.
 *
 * Definition (§11.1 row 4): status='expired' AND today is the expiry
 * date. The cron's expiry sweep (Phase 4) flips approved→expired when
 * `expires_at < now`; we look at both. (A doc that was expired but
 * already has `expired_today` logged is filtered out by the UNIQUE
 * index at reserve time.)
 */
export async function findExpiredTodayCandidates(now: Date): Promise<Candidate[]> {
  // Either: status='expired' AND expires_at is today (cron just flipped)
  //     or: status='approved' AND expires_at <= today (cron hasn't run
  //         yet today but the doc is already past-due)
  // The reservation step deduplicates.
  const rows = await db
    .select({
      teacherDocumentId: teacherDocuments.id,
      userId: teacherDocuments.userId,
      userEmail: users.email,
      userName: users.name,
      documentTypeId: teacherDocuments.documentTypeId,
      documentTypeName: documentTypes.name,
      expiresAt: teacherDocuments.expiresAt,
      status: teacherDocuments.status,
    })
    .from(teacherDocuments)
    .innerJoin(users, eq(users.id, teacherDocuments.userId))
    .innerJoin(documentTypes, eq(documentTypes.id, teacherDocuments.documentTypeId))
    .where(
      and(
        isNotNull(teacherDocuments.expiresAt),
        isNull(teacherDocuments.supersededBy),
        eq(users.role, "teacher")
      )
    );

  const out: Candidate[] = [];
  for (const r of rows) {
    if (!r.expiresAt || !r.userEmail) continue;
    if (!isExpiredToday(r.expiresAt, now)) continue;
    // Skip docs that aren't expired-or-about-to-be.
    if (r.status !== "expired" && r.status !== "approved") continue;
    out.push({
      userId: r.userId,
      recipientEmail: r.userEmail,
      teacherFirstName: firstNameFor(r.userName),
      teacherDocumentId: r.teacherDocumentId,
      documentTypeId: r.documentTypeId,
      documentTypeName: r.documentTypeName,
      reminderType: "expired_today",
      milestoneKey: keyExpiredToday(r.teacherDocumentId),
      payload: { kind: "expired_today", expiredOn: toYMD(r.expiresAt) },
    });
  }
  return out;
}

/**
 * Reminder #5: expired, still not renewed.
 *
 * Definition (§11.1 row 5): `expired` doc, no newer non-superseded
 * upload, and today is on the post-expiration cadence.
 *
 * Renewal cancellation (§7 acceptance #9): a new upload supersedes the
 * expired row → `superseded_by IS NOT NULL` → dropped from this query.
 */
export async function findExpiredRecurringCandidates(
  now: Date,
  intervalDays: number
): Promise<Candidate[]> {
  const rows = await db
    .select({
      teacherDocumentId: teacherDocuments.id,
      userId: teacherDocuments.userId,
      userEmail: users.email,
      userName: users.name,
      documentTypeId: teacherDocuments.documentTypeId,
      documentTypeName: documentTypes.name,
      expiresAt: teacherDocuments.expiresAt,
    })
    .from(teacherDocuments)
    .innerJoin(users, eq(users.id, teacherDocuments.userId))
    .innerJoin(documentTypes, eq(documentTypes.id, teacherDocuments.documentTypeId))
    .where(
      and(
        eq(teacherDocuments.status, "expired"),
        isNotNull(teacherDocuments.expiresAt),
        isNull(teacherDocuments.supersededBy),
        eq(users.role, "teacher")
      )
    );

  const out: Candidate[] = [];
  for (const r of rows) {
    if (!r.expiresAt || !r.userEmail) continue;
    const bucket = recurringBucketDate(r.expiresAt, now, intervalDays);
    if (!bucket) continue;
    out.push({
      userId: r.userId,
      recipientEmail: r.userEmail,
      teacherFirstName: firstNameFor(r.userName),
      teacherDocumentId: r.teacherDocumentId,
      documentTypeId: r.documentTypeId,
      documentTypeName: r.documentTypeName,
      reminderType: "expired_recurring",
      milestoneKey: keyExpiredRecurring(r.teacherDocumentId, bucket),
      payload: {
        kind: "expired_recurring",
        expiredOn: toYMD(r.expiresAt),
        daysOverdue: daysOverdue(r.expiresAt, now),
      },
    });
  }
  return out;
}

/**
 * Reminder #6: admin alert for long-pending review.
 *
 * Definition (§11.1 row 6): docs in `pending` longer than the
 * configured threshold. Sent to each admin once per pending doc.
 */
export async function findPendingAdminAlertCandidates(
  now: Date,
  thresholdDays: number | null
): Promise<Candidate[]> {
  if (thresholdDays === null || thresholdDays <= 0) return [];

  // Pending docs older than `now - thresholdDays`.
  const cutoff = new Date(startOfUtcDay(now).getTime() - thresholdDays * 86_400_000);

  const pending = await db
    .select({
      teacherDocumentId: teacherDocuments.id,
      teacherId: teacherDocuments.userId,
      teacherName: users.name,
      documentTypeId: teacherDocuments.documentTypeId,
      documentTypeName: documentTypes.name,
      uploadedAt: teacherDocuments.uploadedAt,
    })
    .from(teacherDocuments)
    .innerJoin(users, eq(users.id, teacherDocuments.userId))
    .innerJoin(documentTypes, eq(documentTypes.id, teacherDocuments.documentTypeId))
    .where(
      and(
        eq(teacherDocuments.status, "pending"),
        isNull(teacherDocuments.supersededBy),
        sql`${teacherDocuments.uploadedAt} <= ${cutoff}`
      )
    );

  if (pending.length === 0) return [];

  const admins = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.role, "admin"));

  const out: Candidate[] = [];
  for (const admin of admins) {
    if (!admin.email) continue;
    for (const p of pending) {
      const days =
        Math.floor(
          (startOfUtcDay(now).getTime() - startOfUtcDay(p.uploadedAt).getTime()) /
            86_400_000
        ) || 0;
      out.push({
        userId: admin.id, // recipient is the admin
        recipientEmail: admin.email,
        teacherFirstName: firstNameFor(admin.name),
        teacherDocumentId: p.teacherDocumentId,
        documentTypeId: p.documentTypeId,
        documentTypeName: p.documentTypeName,
        reminderType: "pending_admin_alert",
        // One-shot per pending doc per admin: include admin id in the
        // milestone key by composing with the existing helper + admin
        // suffix so two admins don't collide.
        milestoneKey: `${keyPendingAdminAlert(p.teacherDocumentId)}:${admin.id}`,
        payload: { kind: "pending_admin_alert", daysPending: days },
      });
    }
  }
  return out;
}

/** Gather every candidate type. Used by the dispatcher's main loop. */
export async function findAllCandidates(opts: {
  now: Date;
  configuredExpiringDays: readonly number[];
  postExpirationIntervalDays: number;
  missingDocIntervalDays: number;
  rejectedDocIntervalDays: number;
  pendingAdminAlertDays: number | null;
}): Promise<Candidate[]> {
  const [missing, rejected, expiring, expiredToday, expiredRecurring, pendingAlert] =
    await Promise.all([
      findMissingRequiredCandidates(opts.now, opts.missingDocIntervalDays),
      findRejectedReplaceCandidates(opts.now, opts.rejectedDocIntervalDays),
      findExpiringCandidates(opts.now, opts.configuredExpiringDays),
      findExpiredTodayCandidates(opts.now),
      findExpiredRecurringCandidates(opts.now, opts.postExpirationIntervalDays),
      findPendingAdminAlertCandidates(opts.now, opts.pendingAdminAlertDays),
    ]);
  return [
    ...missing,
    ...rejected,
    ...expiring,
    ...expiredToday,
    ...expiredRecurring,
    ...pendingAlert,
  ];
}
