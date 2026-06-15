/**
 * Seed the database with:
 *   - 1 admin user (idempotent by email)
 *   - 2 sample teacher users + matching teacher_profiles
 *   - the 5 required document_types (lib/db/document-catalog.ts)
 *
 * All writes are upserts so this script is safe to re-run. Any document type
 * NOT in the canonical catalog is deactivated (never hard-deleted) so the
 * teacher/admin views show exactly the five forms.
 *
 * Usage: pnpm db:seed
 *
 * Environment overrides (see .env.example):
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME
 *   SEED_TEACHER_EMAIL / SEED_TEACHER_PASSWORD / SEED_TEACHER_NAME
 */
import bcrypt from "bcryptjs";
import { eq, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, teacherProfiles, documentTypes } from "@/lib/db/schema";
import {
  REQUIRED_DOCUMENT_TYPES,
  REQUIRED_DOCUMENT_TYPE_NAMES,
  type CatalogDocType,
} from "@/lib/db/document-catalog";

// The required-document catalog (the five forms) is defined once in
// lib/db/document-catalog.ts and shared with the prod sync script + tests.
const STARTER_DOCUMENT_TYPES = REQUIRED_DOCUMENT_TYPES;

async function upsertUser(opts: {
  email: string;
  name: string;
  role: "admin" | "teacher";
  password: string;
}) {
  const email = opts.email.toLowerCase();
  const passwordHash = await bcrypt.hash(opts.password, 10);

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    await db
      .update(users)
      .set({
        name: opts.name,
        role: opts.role,
        passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing[0].id));
    return existing[0].id;
  }
  const [row] = await db
    .insert(users)
    .values({
      email,
      name: opts.name,
      role: opts.role,
      passwordHash,
      emailVerified: new Date(),
    })
    .returning({ id: users.id });
  return row.id;
}

async function ensureTeacherProfile(
  userId: string,
  opts: {
    staffStatus?: "new_first_year" | "returning";
    hireDate?: string | null;
    firstYearStartDate?: string | null;
  } = {}
) {
  const existing = await db
    .select()
    .from(teacherProfiles)
    .where(eq(teacherProfiles.userId, userId))
    .limit(1);
  if (existing.length > 0) {
    // Keep the sample profiles' staff status in sync on re-seed.
    await db
      .update(teacherProfiles)
      .set({
        staffStatus: opts.staffStatus ?? "returning",
        hireDate: opts.hireDate ?? null,
        firstYearStartDate: opts.firstYearStartDate ?? opts.hireDate ?? null,
        updatedAt: new Date(),
      })
      .where(eq(teacherProfiles.userId, userId));
    return;
  }
  await db.insert(teacherProfiles).values({
    userId,
    staffStatus: opts.staffStatus ?? "returning",
    hireDate: opts.hireDate ?? null,
    firstYearStartDate: opts.firstYearStartDate ?? opts.hireDate ?? null,
  });
}

async function upsertDocumentType(dt: CatalogDocType) {
  await db
    .insert(documentTypes)
    .values({
      name: dt.name,
      description: dt.description,
      required: dt.required,
      renewalMonths: dt.renewalMonths,
      applicability: dt.applicability,
      active: true,
    })
    .onConflictDoUpdate({
      target: documentTypes.name,
      set: {
        description: dt.description,
        required: dt.required,
        renewalMonths: dt.renewalMonths,
        applicability: dt.applicability,
        active: true,
        updatedAt: new Date(),
      },
    });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
    process.exit(1);
  }

  // Sanity: make sure tables exist before we try to write.
  await db.execute(sql`SELECT 1 FROM users LIMIT 1`).catch(() => {
    console.error(
      "users table missing — run `pnpm db:migrate` before `pnpm db:seed`."
    );
    process.exit(1);
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const adminName = process.env.SEED_ADMIN_NAME ?? "School Admin";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe!Now";

  const teacherEmail = process.env.SEED_TEACHER_EMAIL ?? "teacher@example.com";
  const teacherName = process.env.SEED_TEACHER_NAME ?? "Sample Teacher";
  const teacherPassword = process.env.SEED_TEACHER_PASSWORD ?? "ChangeMe!Now";

  console.log("→ seeding admin");
  await upsertUser({
    email: adminEmail,
    name: adminName,
    role: "admin",
    password: adminPassword,
  });

  console.log("→ seeding sample teachers");
  // Teacher 1 is a NEW first-year hire (hired ~3 months ago) so first-year-only
  // documents apply. Teacher 2 is returning staff (no first-year docs).
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setUTCMonth(threeMonthsAgo.getUTCMonth() - 3);
  const firstYearStart = threeMonthsAgo.toISOString().slice(0, 10);

  const teacher1Id = await upsertUser({
    email: teacherEmail,
    name: teacherName,
    role: "teacher",
    password: teacherPassword,
  });
  await ensureTeacherProfile(teacher1Id, {
    staffStatus: "new_first_year",
    hireDate: firstYearStart,
    firstYearStartDate: firstYearStart,
  });

  const teacher2Id = await upsertUser({
    email: "teacher2@example.com",
    name: "Sample Teacher Two",
    role: "teacher",
    password: teacherPassword,
  });
  await ensureTeacherProfile(teacher2Id, { staffStatus: "returning" });

  console.log(`→ seeding ${STARTER_DOCUMENT_TYPES.length} document types`);
  for (const dt of STARTER_DOCUMENT_TYPES) {
    await upsertDocumentType(dt);
  }

  // Enforce "only these forms": deactivate any other type so it disappears
  // from teacher dashboards and admin completion. We never hard-delete here —
  // existing uploads keep resolving their type name and review history stays
  // intact (matches the admin "Deactivate" behaviour).
  const deactivated = await db
    .update(documentTypes)
    .set({ active: false, updatedAt: new Date() })
    .where(notInArray(documentTypes.name, REQUIRED_DOCUMENT_TYPE_NAMES))
    .returning({ name: documentTypes.name });
  if (deactivated.length > 0) {
    console.log(
      `→ deactivated ${deactivated.length} non-catalog document type(s): ` +
        deactivated.map((d) => d.name).join(", ")
    );
  }

  console.log("");
  console.log("✓ seed complete");
  console.log("");
  console.log(`  Admin login:   ${adminEmail} / ${adminPassword}`);
  console.log(`  Teacher login: ${teacherEmail} / ${teacherPassword}`);
  console.log("");
  console.log("  Change these passwords immediately in any shared environment.");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
