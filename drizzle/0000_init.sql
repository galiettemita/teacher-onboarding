-- Phase 1 initial migration. Owns all DDL for the project.
-- Run with: pnpm db:migrate

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------- users ----------
CREATE TABLE IF NOT EXISTS "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "email" text NOT NULL UNIQUE,
    "name" text NOT NULL,
    "role" text NOT NULL DEFAULT 'teacher',
    "password_hash" text,
    "email_verified_at" timestamptz,
    "image" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "users_role_check" CHECK ("role" in ('teacher','admin'))
);

-- ---------- teacher_profiles ----------
CREATE TABLE IF NOT EXISTS "teacher_profiles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE RESTRICT,
    "phone" text,
    "hire_date" date,
    "grade_level" text,
    "onboarding_complete" boolean NOT NULL DEFAULT false,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- ---------- document_types ----------
CREATE TABLE IF NOT EXISTS "document_types" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL UNIQUE,
    "description" text,
    "required" boolean NOT NULL DEFAULT true,
    "renewal_months" integer NOT NULL DEFAULT 24,
    "active" boolean NOT NULL DEFAULT true,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- ---------- teacher_documents ----------
CREATE TABLE IF NOT EXISTS "teacher_documents" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
    "document_type_id" uuid NOT NULL REFERENCES "document_types"("id") ON DELETE RESTRICT,
    "storage_key" text NOT NULL UNIQUE,
    "original_filename" text NOT NULL,
    "mime_type" text NOT NULL,
    "size_bytes" bigint NOT NULL,
    "sha256" text NOT NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "uploaded_at" timestamptz NOT NULL DEFAULT now(),
    "reviewed_at" timestamptz,
    "reviewed_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
    "rejection_reason" text,
    "expires_at" timestamptz,
    "superseded_by" uuid REFERENCES "teacher_documents"("id") ON DELETE RESTRICT,
    CONSTRAINT "teacher_documents_status_check" CHECK ("status" in ('pending','approved','rejected','expired'))
);

CREATE INDEX IF NOT EXISTS "teacher_documents_user_type_idx"
    ON "teacher_documents" ("user_id", "document_type_id", "uploaded_at" DESC);
CREATE INDEX IF NOT EXISTS "teacher_documents_status_idx"
    ON "teacher_documents" ("status");
CREATE INDEX IF NOT EXISTS "teacher_documents_expires_idx"
    ON "teacher_documents" ("expires_at")
    WHERE "status" = 'approved';

-- ---------- audit_logs ----------
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
    "action" text NOT NULL,
    "target_type" text,
    "target_id" uuid,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "audit_logs_actor_idx"
    ON "audit_logs" ("actor_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "audit_logs_target_idx"
    ON "audit_logs" ("target_type", "target_id");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx"
    ON "audit_logs" ("action", "created_at" DESC);

-- ---------- email_settings (singleton) ----------
-- The deployment's verified outbound-mail identity. Read by the
-- teacher-invite flow to build the `from` header and login link.
CREATE TABLE IF NOT EXISTS "email_settings" (
    "id" uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
    "sender_name" text NOT NULL DEFAULT 'Onboarding Portal',
    "sender_email" text NOT NULL DEFAULT 'noreply@example.com',
    "portal_url" text NOT NULL DEFAULT 'http://localhost:3000',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Seed the singleton row (idempotent).
INSERT INTO "email_settings" ("id")
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT ("id") DO NOTHING;

-- ---------- scheduled_job_runs ----------
-- Telemetry for cron jobs (currently the daily expiry sweep).
CREATE TABLE IF NOT EXISTS "scheduled_job_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "job_name" text NOT NULL,
    "started_at" timestamptz NOT NULL DEFAULT now(),
    "finished_at" timestamptz,
    "status" text NOT NULL,
    "candidates_considered" integer NOT NULL DEFAULT 0,
    "error_message" text,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS "scheduled_job_runs_job_idx"
    ON "scheduled_job_runs" ("job_name", "started_at" DESC);

-- ---------- Auth.js adapter tables ----------
CREATE TABLE IF NOT EXISTS "accounts" (
    "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "type" text NOT NULL,
    "provider" text NOT NULL,
    "providerAccountId" text NOT NULL,
    "refresh_token" text,
    "access_token" text,
    "expires_at" integer,
    "token_type" text,
    "scope" text,
    "id_token" text,
    "session_state" text,
    PRIMARY KEY ("provider", "providerAccountId")
);

CREATE TABLE IF NOT EXISTS "sessions" (
    "sessionToken" text PRIMARY KEY NOT NULL,
    "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "expires" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS "verificationToken" (
    "identifier" text NOT NULL,
    "token" text NOT NULL,
    "expires" timestamptz NOT NULL,
    PRIMARY KEY ("identifier", "token")
);
