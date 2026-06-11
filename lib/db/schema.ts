import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  timestamp,
  date,
  jsonb,
  check,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ---------- users ----------
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: text("role").notNull().default("teacher"),
    passwordHash: text("password_hash"),
    // Account-activation state. `mustChangePassword` is the access gate: while
    // true the teacher is forced into /teacher/activate and can do nothing else.
    // `activatedAt` records when the teacher created their own password (null
    // until activated); it powers the admin "Account Created" status display.
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    // Auth.js Drizzle adapter expects JS property names `emailVerified` and `image`.
    // We keep PROJECT_CONTEXT's `email_verified_at` as the DB column name.
    emailVerified: timestamp("email_verified_at", { mode: "date", withTimezone: true }),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    roleCheck: check("users_role_check", sql`${t.role} in ('teacher','admin')`),
  })
);

// ---------- teacher_profiles ----------
export const teacherProfiles = pgTable("teacher_profiles", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "restrict" }),
  phone: text("phone"),
  hireDate: date("hire_date"),
  gradeLevel: text("grade_level"),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- document_types ----------
export const documentTypes = pgTable("document_types", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  required: boolean("required").notNull().default(true),
  renewalMonths: integer("renewal_months").notNull().default(24),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- teacher_documents ----------
export const teacherDocuments = pgTable(
  "teacher_documents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    documentTypeId: uuid("document_type_id")
      .notNull()
      .references(() => documentTypes.id, { onDelete: "restrict" }),
    storageKey: text("storage_key").notNull().unique(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    status: text("status").notNull().default("pending"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "restrict" }),
    rejectionReason: text("rejection_reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    supersededBy: uuid("superseded_by").references((): AnyPgColumn => teacherDocuments.id, {
      onDelete: "restrict",
    }),
  },
  (t) => ({
    statusCheck: check(
      "teacher_documents_status_check",
      sql`${t.status} in ('pending','approved','rejected','expired')`
    ),
    byUserType: index("teacher_documents_user_type_idx").on(
      t.userId,
      t.documentTypeId,
      t.uploadedAt
    ),
    byStatus: index("teacher_documents_status_idx").on(t.status),
    byExpires: index("teacher_documents_expires_idx").on(t.expiresAt),
  })
);

// ---------- audit_logs ----------
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byActor: index("audit_logs_actor_idx").on(t.actorId, t.createdAt),
    byTarget: index("audit_logs_target_idx").on(t.targetType, t.targetId),
    byAction: index("audit_logs_action_idx").on(t.action, t.createdAt),
  })
);

// ---------- email_settings ----------
// Singleton row holding the deployment's verified outbound-mail identity
// (sender display name, `from` address, portal URL). Read by the
// teacher-invite flow to build the `from` header and login link.
export const emailSettings = pgTable("email_settings", {
  id: uuid("id").primaryKey().default(sql`'00000000-0000-0000-0000-000000000001'::uuid`),
  senderName: text("sender_name").notNull().default("Onboarding Portal"),
  senderEmail: text("sender_email").notNull().default("noreply@example.com"),
  portalUrl: text("portal_url").notNull().default("http://localhost:3000"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- scheduled_job_runs ----------
// Telemetry for cron jobs (currently the daily expiry sweep): one row per
// invocation with start/finish, status, and a candidate count.
export const scheduledJobRuns = pgTable(
  "scheduled_job_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    jobName: text("job_name").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull(),
    candidatesConsidered: integer("candidates_considered").notNull().default(0),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({
    byJob: index("scheduled_job_runs_job_idx").on(t.jobName, t.startedAt),
  })
);

// ---------- Auth.js adapter tables ----------
// Auth.js Drizzle adapter requires its own tables (accounts, sessions, verificationTokens).
// These live alongside our `users` table; the adapter is configured to reuse `users`.
export const accounts = pgTable("accounts", {
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("providerAccountId").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
});

export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable("verificationToken", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type DocumentType = typeof documentTypes.$inferSelect;
export type TeacherDocument = typeof teacherDocuments.$inferSelect;
