-- Decommission the teacher notification/reminder subsystem.
--
-- Fresh databases never create the legacy objects (see 0000_init.sql), so
-- every statement here is guarded to be a no-op on a clean install and to
-- converge a previously-deployed database to the new shape. The migration
-- runner re-applies all files on every run, so this MUST stay idempotent.

-- 1. Carry the sender identity over from the legacy settings table (if it
--    still exists) into email_settings, then drop the legacy table. The
--    to_regclass guard keeps this safe when reminder_settings is already gone.
DO $$
BEGIN
    IF to_regclass('public.reminder_settings') IS NOT NULL THEN
        INSERT INTO "email_settings" ("id", "sender_name", "sender_email", "portal_url", "created_at", "updated_at")
        SELECT "id", "sender_name", "sender_email", "portal_url", "created_at", "updated_at"
        FROM "reminder_settings"
        ON CONFLICT ("id") DO NOTHING;

        DROP TABLE "reminder_settings" CASCADE;
    END IF;
END $$;

-- 2. Drop the notification delivery log entirely.
DROP TABLE IF EXISTS "notification_logs" CASCADE;

-- 3. Strip the email-delivery counters from the shared job-telemetry table.
--    `candidates_considered` stays — the expiry sweep still records it.
ALTER TABLE IF EXISTS "scheduled_job_runs" DROP COLUMN IF EXISTS "emails_sent";
ALTER TABLE IF EXISTS "scheduled_job_runs" DROP COLUMN IF EXISTS "emails_skipped";
ALTER TABLE IF EXISTS "scheduled_job_runs" DROP COLUMN IF EXISTS "emails_failed";

-- 4. Purge audit rows written by the removed reminder admin surface.
DELETE FROM "audit_logs"
WHERE "action" LIKE 'reminders.%'
   OR "target_type" IN ('reminder_settings', 'notification_log');
