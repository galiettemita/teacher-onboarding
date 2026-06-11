-- Staff-specific document requirements + document categories.
--
-- teacher_profiles:
--   staff_status          : 'new_first_year' | 'returning'. Drives which
--                           first-year-only documents a teacher is asked for.
--                           Existing teachers default to 'returning' so nobody
--                           is retroactively blocked for first-year-only docs.
--   first_year_start_date : anchor for "is the first year over yet?". Falls
--                           back to hire_date in application code when null.
--
-- document_types:
--   applicability : 'all_staff' | 'new_first_year_only' | 'returning_staff_only'.
--                   Existing types default to 'all_staff'.
--   category      : 'medical' | 'training' | 'general' | 'other'. Existing
--                   types default to 'general'; a guarded backfill tags the
--                   known training/medical seed types so their 2-year renewal
--                   reads correctly in the admin UI.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded constraint creation + guarded
-- backfills. Reversible by dropping the added columns/constraints.

ALTER TABLE "teacher_profiles"
  ADD COLUMN IF NOT EXISTS "staff_status" text NOT NULL DEFAULT 'returning';
ALTER TABLE "teacher_profiles"
  ADD COLUMN IF NOT EXISTS "first_year_start_date" date;

ALTER TABLE "document_types"
  ADD COLUMN IF NOT EXISTS "applicability" text NOT NULL DEFAULT 'all_staff';
ALTER TABLE "document_types"
  ADD COLUMN IF NOT EXISTS "category" text NOT NULL DEFAULT 'general';

-- CHECK constraints (guarded: Postgres has no ADD CONSTRAINT IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teacher_profiles_staff_status_check'
  ) THEN
    ALTER TABLE "teacher_profiles"
      ADD CONSTRAINT "teacher_profiles_staff_status_check"
      CHECK ("staff_status" IN ('new_first_year','returning'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_types_applicability_check'
  ) THEN
    ALTER TABLE "document_types"
      ADD CONSTRAINT "document_types_applicability_check"
      CHECK ("applicability" IN ('all_staff','new_first_year_only','returning_staff_only'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_types_category_check'
  ) THEN
    ALTER TABLE "document_types"
      ADD CONSTRAINT "document_types_category_check"
      CHECK ("category" IN ('medical','training','general','other'));
  END IF;
END$$;

-- Backfill categories for the known seed types so existing deployments show
-- the right family without manual edits. Only touches rows still on the
-- 'general' default (won't clobber an admin's later choice).
UPDATE "document_types"
   SET "category" = 'training'
 WHERE "category" = 'general'
   AND "name" IN (
     'Mandated Reporter Training',
     'Child Abuse Prevention Training'
   );

UPDATE "document_types"
   SET "category" = 'medical'
 WHERE "category" = 'general'
   AND "name" IN (
     'CPR / First Aid Certificate'
   );
