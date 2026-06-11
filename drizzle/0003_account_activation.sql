-- Teacher account-activation lifecycle.
--
-- Admin-created teacher accounts get a temporary password and must create their
-- own password on first login before they can use the portal.
--   must_change_password : access gate. While true the teacher is forced into
--                          /teacher/activate and blocked from everything else.
--   activated_at         : when the teacher created their own password. Null
--                          until activated; powers the admin status display.
--
-- Idempotent: re-running is a no-op (ADD COLUMN IF NOT EXISTS + a guarded backfill).

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "activated_at" timestamptz;

-- Backfill: teachers who already have a usable password (not pending a forced
-- change) count as activated, so the status display reads "Yes" with a sensible
-- timestamp. New invitations set must_change_password = true and activated_at = null.
UPDATE "users"
   SET "activated_at" = COALESCE("activated_at", "created_at")
 WHERE "role" = 'teacher'
   AND "must_change_password" = false
   AND "activated_at" IS NULL;
