import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { runOnce } from "@/lib/reminders/dispatcher";
import {
  REMINDER_JOB_NAME,
  finishJobRun,
  startJobRun,
} from "@/lib/db/queries/job-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily reminder dispatch.
 *
 * Method + auth: Vercel Cron invokes registered paths with **GET** and
 *   `Authorization: Bearer ${CRON_SECRET}`. See
 *   https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
 *
 *   This route mirrors the Phase 4 `/api/cron/expiry` route exactly:
 *   GET is the production path, POST is provided for local `curl`
 *   testing. The auth check uses `crypto.timingSafeEqual` for
 *   constant-time compare.
 *
 *   REVIEWER_NOTES.md "Agent 4 first attempt shipped POST + X-Cron-
 *   Secret" — DO NOT regress.
 *
 * Telemetry: one row in `scheduled_job_runs` per invocation with
 *   `job_name='reminder_dispatch'` and the dispatch counts. Failures
 *   produce a `status='failed'` row + `error_message` so the admin can
 *   see why nothing went out.
 *
 * Idempotency: enforced by the dispatcher via the
 *   `notification_logs (teacher_id, milestone_key)` UNIQUE index.
 *   Re-running the cron in the same window produces zero new sends.
 */

function isAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = req.headers.get("authorization");
  if (!header) return false;

  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  const provided = match[1];

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function handle(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobRunId = await startJobRun({ jobName: REMINDER_JOB_NAME });

  try {
    const counts = await runOnce(new Date());
    await finishJobRun({
      id: jobRunId,
      status: "success",
      candidatesConsidered: counts.considered,
      emailsSent: counts.sent,
      emailsSkipped:
        counts.skippedDuplicate +
        counts.skippedDailyCap +
        counts.skippedDisabled +
        counts.skippedNoEmail,
      emailsFailed: counts.failed,
      metadata: {
        skipped_breakdown: {
          duplicate_milestone: counts.skippedDuplicate,
          daily_cap: counts.skippedDailyCap,
          reminders_disabled: counts.skippedDisabled,
          no_email_on_file: counts.skippedNoEmail,
        },
      },
    });

    return NextResponse.json(
      {
        ok: true,
        jobRunId,
        counts: {
          considered: counts.considered,
          sent: counts.sent,
          skipped_duplicate_milestone: counts.skippedDuplicate,
          skipped_daily_cap: counts.skippedDailyCap,
          skipped_reminders_disabled: counts.skippedDisabled,
          skipped_no_email_on_file: counts.skippedNoEmail,
          failed: counts.failed,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await finishJobRun({
        id: jobRunId,
        status: "failed",
        candidatesConsidered: 0,
        emailsSent: 0,
        emailsSkipped: 0,
        emailsFailed: 0,
        errorMessage: message.slice(0, 1000),
      });
    } catch {
      // best-effort; surface original error
    }
    return NextResponse.json(
      { ok: false, jobRunId, error: "Reminder dispatch failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
