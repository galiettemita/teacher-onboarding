import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
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
import { isDocTypeApplicable } from "@/lib/staff/status";
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

  // Active+required doc types define what "complete" means — but completion is
  // computed *per teacher* against the subset that applies to them (first-year
  // vs returning), so returning staff are never marked incomplete for
  // first-year-only paperwork they were never asked for.
  const requiredTypes = await db
    .select()
    .from(documentTypes)
    .where(and(eq(documentTypes.active, true), eq(documentTypes.required, true)));
  const now = new Date();

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

    // The required doc types that apply to THIS teacher right now.
    const applicableRequiredTypeIds = new Set(
      requiredTypes
        .filter((t) => isDocTypeApplicable(t, profile, now))
        .map((t) => t.id)
    );
    const totalRequired = applicableRequiredTypeIds.size;

    // Approved coverage of the applicable required doc types.
    const approvedRequiredTypeIds = new Set<string>();
    let pendingCount = 0;
    let expiredCount = 0;
    let lastActivityAt: Date | null = null;

    for (const d of docs) {
      if (d.status === "pending") pendingCount += 1;
      if (d.status === "expired") expiredCount += 1;
      if (d.status === "approved" && applicableRequiredTypeIds.has(d.documentTypeId)) {
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
  staffStatus?: "new_first_year" | "returning" | null;
  firstYearStartDate?: string | null; // ISO date 'YYYY-MM-DD'
}

export interface InviteTeacherResult {
  id: string;
  email: string;
  name: string;
  temporaryPassword: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateTemporaryPassword(): string {
  return randomBytes(18).toString("base64url");
}

/**
 * Admin-creates-teacher flow.
 *
 * In one transaction:
 *   1. Lowercase + validate email. Reject duplicates with ConflictError (409).
 *   2. Generate a temporary password and store only its bcrypt hash.
 *   3. Insert users row (role='teacher') pending activation
 *      (must_change_password=true, activated_at=null).
 *   4. Insert teacher_profiles row pointing at the new user.
 *   5. Write user.invite audit row.
 *
 * The temporary password is returned exactly once so the route can hand it to
 * the admin to deliver out-of-band. It is never written to audit logs, and the
 * application sends no email itself.
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

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);

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
        passwordHash,
        mustChangePassword: true,
        emailVerified: null,
      })
      .returning();

    const staffStatus =
      input.staffStatus === "new_first_year" ? "new_first_year" : "returning";
    // For a new first-year hire with no explicit first-year start, anchor on the
    // hire date so the one-year window can be computed.
    const firstYearStart =
      input.firstYearStartDate?.trim() ||
      (staffStatus === "new_first_year" ? input.hireDate?.trim() || null : null);

    await tx.insert(teacherProfiles).values({
      userId: created.id,
      phone: input.phone?.trim() || null,
      hireDate: input.hireDate?.trim() || null,
      gradeLevel: input.gradeLevel?.trim() || null,
      staffStatus,
      firstYearStartDate: firstYearStart,
    });

    // Audit row metadata never includes the temporary password.
    await auditLog({
      actorId: currentAdmin.id,
      action: "user.invite",
      targetType: "user",
      targetId: created.id,
      metadata: {
        email: created.email,
        credentialCreated: true,
      },
    });

    return {
      id: created.id,
      email: created.email,
      name: created.name,
      temporaryPassword,
    };
  });
}

/**
 * Re-invite a teacher who has not yet activated their account.
 *
 * Generates a fresh temporary password and stores only its hash, which
 * overwrites the previous one — so any earlier temporary password stops
 * working immediately and only the newest one is valid. The account stays
 * pending activation (must_change_password = true, activated_at = null) and
 * the teacher record is preserved.
 *
 * Refuses if the teacher has already activated: their self-chosen password
 * must not be clobbered by an admin action.
 */
export async function reinviteTeacher(
  currentAdmin: { id: string; role: string },
  teacherId: string
): Promise<InviteTeacherResult> {
  assertAdmin(currentAdmin);

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, teacherId), eq(users.role, "teacher")))
      .limit(1);
    if (!existing) throw new NotFoundError("Teacher not found");
    if (!existing.mustChangePassword) {
      throw new ConflictError("This teacher has already activated their account");
    }

    await tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: true,
        activatedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, teacherId));

    // Audit metadata never includes the temporary password.
    await auditLog({
      actorId: currentAdmin.id,
      action: "user.invite",
      targetType: "user",
      targetId: teacherId,
      metadata: { email: existing.email, reinvite: true },
    });

    return {
      id: existing.id,
      email: existing.email,
      name: existing.name,
      temporaryPassword,
    };
  });
}

export interface UpdateTeacherProfileInput {
  staffStatus?: "new_first_year" | "returning";
  hireDate?: string | null; // 'YYYY-MM-DD' or null to clear
  firstYearStartDate?: string | null; // 'YYYY-MM-DD' or null to clear
  phone?: string | null;
  gradeLevel?: string | null;
}

/**
 * Admin edits a teacher's onboarding metadata (staff status + dates + profile
 * fields). Only ever touches `teacher_profiles` — never the auth user, never
 * any uploaded document. Writes a `user.profile_update` audit row.
 *
 * Setting staff status to new_first_year with no first-year start date anchors
 * it on the hire date when available, so the one-year window is computable.
 */
export async function updateTeacherProfile(
  currentAdmin: { id: string; role: string },
  teacherId: string,
  input: UpdateTeacherProfileInput
): Promise<TeacherProfile> {
  assertAdmin(currentAdmin);

  return db.transaction(async (tx) => {
    const [teacher] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, teacherId), eq(users.role, "teacher")))
      .limit(1);
    if (!teacher) throw new NotFoundError("Teacher not found");

    const [profile] = await tx
      .select()
      .from(teacherProfiles)
      .where(eq(teacherProfiles.userId, teacherId))
      .limit(1);
    if (!profile) throw new NotFoundError("Teacher profile missing");

    const patch: Partial<typeof teacherProfiles.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (input.staffStatus !== undefined) {
      if (input.staffStatus !== "new_first_year" && input.staffStatus !== "returning") {
        throw new ValidationError("Invalid staff status");
      }
      patch.staffStatus = input.staffStatus;
    }
    if (input.hireDate !== undefined) patch.hireDate = input.hireDate?.trim() || null;
    if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
    if (input.gradeLevel !== undefined) patch.gradeLevel = input.gradeLevel?.trim() || null;

    if (input.firstYearStartDate !== undefined) {
      patch.firstYearStartDate = input.firstYearStartDate?.trim() || null;
    }

    // Auto-anchor a new first-year hire on the hire date when no explicit
    // first-year start exists after applying the patch.
    const resolvedStatus = patch.staffStatus ?? profile.staffStatus;
    const resolvedFirstYear =
      patch.firstYearStartDate !== undefined
        ? patch.firstYearStartDate
        : profile.firstYearStartDate;
    const resolvedHire =
      patch.hireDate !== undefined ? patch.hireDate : profile.hireDate;
    if (resolvedStatus === "new_first_year" && !resolvedFirstYear && resolvedHire) {
      patch.firstYearStartDate = resolvedHire;
    }

    const [updated] = await tx
      .update(teacherProfiles)
      .set(patch)
      .where(eq(teacherProfiles.userId, teacherId))
      .returning();

    await auditLog({
      actorId: currentAdmin.id,
      action: "user.profile_update",
      targetType: "user",
      targetId: teacherId,
      metadata: {
        staffStatus: updated.staffStatus,
        firstYearStartDate: updated.firstYearStartDate,
      },
    });

    return updated;
  });
}
