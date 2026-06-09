import { and, asc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { teacherDocuments, type TeacherDocument } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/guards";
import { ForbiddenError } from "@/lib/errors";

/**
 * Expiry-tracking read paths.
 *
 * All three functions take a `currentUser` and apply role-based row
 * filtering before issuing the query — admins see every teacher's docs,
 * teachers see only their own. There is no overload that skips the
 * caller. This is a second wall behind middleware / route guards.
 */

function ensureValidUser(user: SessionUser): void {
  if (user.role !== "admin" && user.role !== "teacher") {
    throw new ForbiddenError("Unknown role");
  }
}

/**
 * Documents that are approved and expiring within `withinDays` (exclusive
 * of the past — already-expired docs surface via `listExpired`).
 *
 * - Admin: every teacher's docs.
 * - Teacher: only their own.
 *
 * Ordering: soonest-expiring first.
 */
export async function listExpiring(
  currentUser: SessionUser,
  withinDays: number
): Promise<TeacherDocument[]> {
  ensureValidUser(currentUser);
  if (!Number.isFinite(withinDays) || withinDays <= 0) {
    throw new Error("listExpiring: withinDays must be a positive number");
  }
  const cutoff = sql`now() + ${`${withinDays} days`}::interval`;

  const conditions = [
    eq(teacherDocuments.status, "approved"),
    gt(teacherDocuments.expiresAt, sql`now()`),
    lte(teacherDocuments.expiresAt, cutoff),
  ];
  if (currentUser.role === "teacher") {
    conditions.push(eq(teacherDocuments.userId, currentUser.id));
  }

  return db
    .select()
    .from(teacherDocuments)
    .where(and(...conditions))
    .orderBy(asc(teacherDocuments.expiresAt));
}

/**
 * Documents that are currently expired. Includes both DB
 * `status='expired'` rows and approved-but-past-due rows that cron
 * hasn't yet swept (the latter is a safety net — under normal
 * operation cron keeps these in sync).
 *
 * - Admin: every teacher's docs.
 * - Teacher: only their own.
 */
export async function listExpired(
  currentUser: SessionUser
): Promise<TeacherDocument[]> {
  ensureValidUser(currentUser);

  const expiredCondition = sql`(${teacherDocuments.status} = 'expired' OR (${teacherDocuments.status} = 'approved' AND ${teacherDocuments.expiresAt} < now()))`;

  const conditions = [expiredCondition];
  if (currentUser.role === "teacher") {
    conditions.push(eq(teacherDocuments.userId, currentUser.id));
  }

  return db
    .select()
    .from(teacherDocuments)
    .where(and(...conditions))
    .orderBy(asc(teacherDocuments.expiresAt));
}

/**
 * Expired documents the teacher hasn't replaced yet: i.e. the expired
 * row is the *current* (non-superseded) row for its
 * `(user_id, document_type_id)` pair. Powers reminder targeting in
 * Phase 6 — kept here so all expiry reads live in one module.
 */
export async function listExpiredWithoutReplacement(
  currentUser: SessionUser
): Promise<TeacherDocument[]> {
  ensureValidUser(currentUser);

  const expiredCondition = sql`(${teacherDocuments.status} = 'expired' OR (${teacherDocuments.status} = 'approved' AND ${teacherDocuments.expiresAt} < now()))`;

  const conditions = [expiredCondition, isNull(teacherDocuments.supersededBy)];
  if (currentUser.role === "teacher") {
    conditions.push(eq(teacherDocuments.userId, currentUser.id));
  }

  return db
    .select()
    .from(teacherDocuments)
    .where(and(...conditions))
    .orderBy(asc(teacherDocuments.expiresAt));
}

