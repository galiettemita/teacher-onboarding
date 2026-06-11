/**
 * Seed the database with:
 *   - 1 admin user (idempotent by email)
 *   - 2 sample teacher users + matching teacher_profiles
 *   - 10 starter document_types (the Phase 1 approved list)
 *
 * All writes are upserts so this script is safe to re-run.
 *
 * Usage: pnpm db:seed
 *
 * Environment overrides (see .env.example):
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME
 *   SEED_TEACHER_EMAIL / SEED_TEACHER_PASSWORD / SEED_TEACHER_NAME
 */
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, teacherProfiles, documentTypes } from "@/lib/db/schema";

type StaffApplicability = "all_staff" | "new_first_year_only" | "returning_staff_only";
type DocCategory = "medical" | "training" | "general" | "other";

type StarterDocType = {
  name: string;
  description: string;
  required: boolean;
  renewalMonths: number;
  applicability: StaffApplicability;
  category: DocCategory;
};

const STARTER_DOCUMENT_TYPES: StarterDocType[] = [
  {
    name: "Employment Application",
    description: "Completed application on file.",
    required: true,
    renewalMonths: 0, // one-time, but kept in schema; renewal logic will treat 0 as "no renewal"
    applicability: "all_staff",
    category: "general",
  },
  {
    name: "Background Check",
    description: "Cleared background check from an approved provider.",
    required: true,
    renewalMonths: 24,
    applicability: "all_staff",
    category: "general",
  },
  {
    name: "Fingerprint Clearance",
    description: "State-issued fingerprint clearance card or letter.",
    required: true,
    renewalMonths: 24,
    applicability: "all_staff",
    category: "general",
  },
  {
    name: "Mandated Reporter Training",
    description: "Certificate of completion for mandated reporter training.",
    required: true,
    renewalMonths: 24,
    applicability: "all_staff",
    category: "training",
  },
  {
    name: "Child Abuse Prevention Training",
    description: "Certificate of completion for child abuse prevention training.",
    required: true,
    renewalMonths: 24,
    applicability: "all_staff",
    category: "training",
  },
  {
    name: "CPR / First Aid Certificate",
    description: "Current CPR and First Aid certificate.",
    required: true,
    renewalMonths: 24,
    applicability: "all_staff",
    category: "medical",
  },
  {
    name: "TB Test / Health Screening",
    description: "Negative TB test result or health clearance from a provider.",
    required: true,
    renewalMonths: 24,
    applicability: "all_staff",
    category: "medical",
  },
  {
    name: "ID / Driver's License",
    description: "Copy of valid government-issued photo ID.",
    required: true,
    renewalMonths: 0,
    applicability: "all_staff",
    category: "general",
  },
  {
    name: "W-4 or Tax Form",
    description: "Completed W-4 (federal) or equivalent state tax form.",
    required: true,
    renewalMonths: 0,
    applicability: "all_staff",
    category: "general",
  },
  {
    name: "Direct Deposit Form",
    description: "Direct deposit authorization with voided check.",
    required: true,
    renewalMonths: 0,
    applicability: "all_staff",
    category: "general",
  },
  {
    name: "Signed Handbook Acknowledgment",
    description: "Signed acknowledgment that you have read the employee handbook.",
    required: true,
    renewalMonths: 24,
    applicability: "all_staff",
    category: "general",
  },
  {
    name: "New Hire Orientation Packet",
    description: "First-year orientation forms — only required during your first year.",
    required: true,
    renewalMonths: 0,
    applicability: "new_first_year_only",
    category: "general",
  },
];

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

async function upsertDocumentType(dt: StarterDocType) {
  await db
    .insert(documentTypes)
    .values({
      name: dt.name,
      description: dt.description,
      required: dt.required,
      renewalMonths: dt.renewalMonths,
      applicability: dt.applicability,
      category: dt.category,
      active: true,
    })
    .onConflictDoUpdate({
      target: documentTypes.name,
      set: {
        description: dt.description,
        required: dt.required,
        renewalMonths: dt.renewalMonths,
        applicability: dt.applicability,
        category: dt.category,
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

  console.log(`→ seeding ${STARTER_DOCUMENT_TYPES.length} starter document types`);
  for (const dt of STARTER_DOCUMENT_TYPES) {
    await upsertDocumentType(dt);
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
