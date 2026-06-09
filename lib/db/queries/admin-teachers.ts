import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  users,
  teacherProfiles,
  teacherDocuments,
  documentTypes,
  type User,
  type TeacherDocument,
  type DocumentType,
} from "@/lib/db/schema";
import { auditLog } from "@/lib/audit/log";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

type TeacherProfile = typeof teacherProfiles.$inferSelect;

export type CompletionState = "all" | "complete" | "incomplete";

export interface TeacherListFilters {
  search?: string;
  completionState?: CompletionState;
}

export interface TeacherListRow {
  user: User;
  profile: TeacherProfile;
  completion: { approvedRequired: number; totalRequired: number; pct: number };
  pendingCount: number;
  expiredCount: number;
  lastActivityAt: Date | null;
}

function assertAdmin(currentAdmin: { role: string }) {
  if (currentAdmin.role !== "admin") {
    throw new ForbiddenError("Admin role required");
  }
}

/**
 * For each teacher, return the latest non-superseded document per document_type.
 * A document is "current" if no other row points at it via supersededBy.
 *
 * We rely on `superseded_by` to chain replacements (Phase 2's teacher upload
 * flow is responsible for setting this when a teacher uploads a replacement).
 * Until Phase 2 lands, every uploaded row is current.
 */
async function loadCurrentDocsForUsers(userIds: string[]): Promise<Map<string, TeacherDocument[]>> {
  const byUser = new Map<string, TeacherDocument[]>();
  if (userIds.length === 0) return byUser;

  const rows = await db
    .select()
    .from(teacherDocuments)
    .where(
      and(
        inArray(teacherDocuments.userId, userIds),
        isNull(teacherDocuments.supersededBy)
      )
    );

  for (const row of rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }
  return byUser;
}

/**
 * List every teacher (role='teacher'), joined with their profile, with completion
 * stats computed against the currently-active required document types.
 *
 * Filters:
 *   - search: substring match against name OR email (case-insensitive)
 *   - completionState: 'complete' = all required active doc types approved;
 *                      'incomplete' = anything else; 'all' = no filter.
 */
export async function listAllTeachers(
  currentAdmin: { role: string },
  filters: TeacherListFilters = {}
): Promise<TeacherListRow[]> {
  assertAdmin(currentAdmin);

  // Active+required doc types define what "complete" means today.
  const requiredTypes = await db
    .select()
    .from(documentTypes)
    .where(and(eq(documentTypes.active, true), eq(documentTypes.required, true)));
  const requiredTypeIds = new Set(requiredTypes.map((t) => t.id));
  const totalRequired = requiredTypeIds.size;

  // Base query: every teacher user + their profile.
  const whereParts = [eq(users.role, "teacher")];
  if (filters.search && filters.search.trim().length > 0) {
    const pattern = `%${filters.search.trim()}%`;
    whereParts.push(
      or(ilike(users.name, pattern), ilike(users.email, pattern))!
    );
  }

  const rows = await db
    .select({
      user: users,
      profile: teacherProfiles,
    })
    .from(users)
    .innerJoin(teacherProfiles, eq(teacherProfiles.userId, users.id))
    .where(and(...whereParts))
    .orderBy(desc(users.createdAt));

  const userIds = rows.map((r) => r.user.id);
  const docsByUser = await loadCurrentDocsForUsers(userIds);

  const result: TeacherListRow[] = rows.map(({ user, profile }) => {
    const docs = docsByUser.get(user.id) ?? [];

    // Approved coverage of required active doc types.
    const approvedRequiredTypeIds = new Set<string>();
    let pendingCount = 0;
    let expiredCount = 0;
    let lastActivityAt: Date | null = null;

    for (const d of docs) {
      if (d.status === "pending") pendingCount += 1;
      if (d.status === "expired") expiredCount += 1;
      if (d.status === "approved" && requiredTypeIds.has(d.documentTypeId)) {
        approvedRequiredTypeIds.add(d.documentTypeId);
      }
      const candidate = d.reviewedAt ?? d.uploadedAt;
      if (candidate && (!lastActivityAt || candidate > lastActivityAt)) {
        lastActivityAt = candidate;
      }
    }

    const approvedRequired = approvedRequiredTypeIds.size;
    const pct =
      totalRequired === 0 ? 100 : Math.round((approvedRequired / totalRequired) * 100);

    return {
      user,
      profile,
      completion: { approvedRequired, totalRequired, pct },
      pendingCount,
      expiredCount,
      lastActivityAt,
    };
  });

  if (filters.completionState === "complete") {
    return result.filter((r) => r.completion.pct === 100);
  }
  if (filters.completionState === "incomplete") {
    return result.filter((r) => r.completion.pct < 100);
  }
  return result;
}

export interface TeacherDetail {
  user: User;
  profile: TeacherProfile;
  documents: Array<TeacherDocument & { documentType: DocumentType | null }>;
}

/**
 * Per-teacher view used by /admin/teachers/[id]. Returns all current
 * (non-superseded) documents joined with their document type, plus the
 * profile + user record. Historical (superseded) rows are intentionally
 * omitted from the primary view.
 */
export async function getTeacherDetail(
  currentAdmin: { role: string },
  teacherId: string
): Promise<TeacherDetail> {
  assertAdmin(currentAdmin);

  const [userRow] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, teacherId), eq(users.role, "teacher")))
    .limit(1);
  if (!userRow) throw new NotFoundError("Teacher not found");

  const [profileRow] = await db
    .select()
    .from(teacherProfiles)
    .where(eq(teacherProfiles.userId, userRow.id))
    .limit(1);
  if (!profileRow) throw new NotFoundError("Teacher profile missing");

  const documents = await db
    .select({
      document: teacherDocuments,
      documentType: documentTypes,
    })
    .from(teacherDocuments)
    .leftJoin(documentTypes, eq(documentTypes.id, teacherDocuments.documentTypeId))
    .where(
      and(
        eq(teacherDocuments.userId, userRow.id),
        isNull(teacherDocuments.supersededBy)
      )
    )
    .orderBy(desc(teacherDocuments.uploadedAt));

  return {
    user: userRow,
    profile: profileRow,
    documents: documents.map((d) => ({
      ...d.document,
      documentType: d.documentType ?? null,
    })),
  };
}

/**
 * Dashboard summary tiles. Counts teachers (total/complete/incomplete),
 * pending reviews across all teachers, and expired docs.
 */
export interface DashboardSummary {
  totalTeachers: number;
  completeTeachers: number;
  incompleteTeachers: number;
  pendingReviews: number;
  expiredDocuments: number;
}

export async function getDashboardSummary(
  currentAdmin: { role: string }
): Promise<DashboardSummary> {
  assertAdmin(currentAdmin);

  const teachers = await listAllTeachers(currentAdmin, { completionState: "all" });
  const completeTeachers = teachers.filter((t) => t.completion.pct === 100).length;
  const totalTeachers = teachers.length;

  const [pendingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teacherDocuments)
    .where(
      and(
        eq(teacherDocuments.status, "pending"),
        isNull(teacherDocuments.supersededBy)
      )
    );

  const [expiredRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teacherDocuments)
    .where(
      and(
        eq(teacherDocuments.status, "expired"),
        isNull(teacherDocuments.supersededBy)
      )
    );

  return {
    totalTeachers,
    completeTeachers,
    incompleteTeachers: totalTeachers - completeTeachers,
    pendingReviews: pendingRow?.count ?? 0,
    expiredDocuments: expiredRow?.count ?? 0,
  };
}

export interface InviteTeacherInput {
  email: string;
  name: string;
  phone?: string | null;
  hireDate?: string | null; // ISO date 'YYYY-MM-DD'
  gradeLevel?: string | null;
}

export interface InviteTeacherResult {
  id: string;
  email: string;
  inviteEmailSent: boolean;
}

// Very forgiving email shape check — Auth.js will do the real validation
// when (and if) we wire a real email provider in Phase 6.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Admin-creates-teacher flow (PROJECT_CONTEXT §5.6).
 *
 * In one transaction:
 *   1. Lowercase + validate email. Reject duplicates with ConflictError (409).
 *   2. Insert users row (role='teacher', email_verified_at=null).
 *   3. Insert teacher_profiles row pointing at the new user.
 *   4. Write user.invite audit row.
 *
 * Email delivery: PHASE-1 ships only the Credentials provider. The Auth.js
 * Email provider / magic-link send is not wired in this branch — that's a
 * Phase 6 dependency. Until then, the admin shares the temporary password
 * out-of-band; `inviteEmailSent` is always false. When Phase 6 lands, the
 * caller (route handler) is the integration point and should set the flag
 * to true after a successful Auth.js send.
 */
export async function inviteTeacher(
  currentAdmin: { id: string; role: string },
  input: InviteTeacherInput
): Promise<InviteTeacherResult> {
  assertAdmin(currentAdmin);

  const rawEmail = String(input.email ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim();
  if (!rawEmail || !EMAIL_RE.test(rawEmail)) {
    throw new ValidationError("A valid email is required");
  }
  if (!name) throw new ValidationError("Name is required");

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.email, rawEmail))
      .limit(1);
    if (existing) {
      throw new ConflictError("A user with that email already exists");
    }

    const [created] = await tx
      .insert(users)
      .values({
        email: rawEmail,
        name,
        role: "teacher",
        emailVerified: null,
      })
      .returning();

    await tx.insert(teacherProfiles).values({
      userId: created.id,
      phone: input.phone?.trim() || null,
      hireDate: input.hireDate?.trim() || null,
      gradeLevel: input.gradeLevel?.trim() || null,
    });

    // Audit row metadata: only the recipient's own email — no admin identity
    // beyond actorId, no PII beyond the new user's email (which they own).
    await auditLog({
      actorId: currentAdmin.id,
      action: "user.invite",
      targetType: "user",
      targetId: created.id,
      metadata: {
        email: created.email,
        emailDelivered: false,
        note: "Auth.js Email provider not wired in this branch; invite email send deferred to Phase 6.",
      },
    });

    return {
      id: created.id,
      email: created.email,
      inviteEmailSent: false,
    };
  });
}
