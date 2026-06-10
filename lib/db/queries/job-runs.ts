/**
 * Access layer for `scheduled_job_runs`.
 *
 * One row per cron tick. The reminder cron mirrors the Phase 4 expiry
 * cron's "insert running → update with counts → mark success/failed"
 * pattern.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scheduledJobRuns } from "@/lib/db/schema";
import { ForbiddenError } from "@/lib/errors";

export const REMINDER_JOB_NAME = "reminder_dispatch";

export interface StartJobRunInput {
  jobName: string;
  metadata?: Record<string, unknown>;
}

export async function startJobRun(input: StartJobRunInput): Promise<string> {
  const [row] = await db
    .insert(scheduledJobRuns)
    .values({
      jobName: input.jobName,
      status: "running",
      metadata: input.metadata ?? {},
    })
    .returning({ id: scheduledJobRuns.id });
  return row.id;
}

export interface FinishJobRunInput {
  id: string;
  status: "success" | "failed";
  candidatesConsidered: number;
  emailsSent: number;
  emailsSkipped: number;
  emailsFailed: number;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

export async function finishJobRun(input: FinishJobRunInput): Promise<void> {
  await db
    .update(scheduledJobRuns)
    .set({
      finishedAt: new Date(),
      status: input.status,
      candidatesConsidered: input.candidatesConsidered,
      emailsSent: input.emailsSent,
      emailsSkipped: input.emailsSkipped,
      emailsFailed: input.emailsFailed,
      errorMessage: input.errorMessage ?? null,
      metadata: input.metadata ?? {},
    })
    .where(eq(scheduledJobRuns.id, input.id));
}

function assertAdmin(actor: { role: string }) {
  if (actor.role !== "admin") throw new ForbiddenError("Admin role required");
}

export interface JobRunRow {
  id: string;
  jobName: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  candidatesConsidered: number;
  emailsSent: number;
  emailsSkipped: number;
  emailsFailed: number;
  errorMessage: string | null;
  metadata: unknown;
}

export async function listRecentJobRuns(
  actor: { role: string },
  jobName: string | null,
  limit = 50
): Promise<JobRunRow[]> {
  assertAdmin(actor);
  const lim = Math.min(200, Math.max(1, Math.floor(limit)));
  const query = db
    .select()
    .from(scheduledJobRuns)
    .orderBy(desc(scheduledJobRuns.startedAt))
    .limit(lim);
  const rows = jobName
    ? await query.where(eq(scheduledJobRuns.jobName, jobName))
    : await query;
  return rows.map((r) => ({
    id: r.id,
    jobName: r.jobName,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    status: r.status,
    candidatesConsidered: r.candidatesConsidered,
    emailsSent: r.emailsSent,
    emailsSkipped: r.emailsSkipped,
    emailsFailed: r.emailsFailed,
    errorMessage: r.errorMessage,
    metadata: r.metadata,
  }));
}
