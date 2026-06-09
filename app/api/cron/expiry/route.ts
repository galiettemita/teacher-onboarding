import { NextResponse } from "next/server";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scheduledJobRuns, teacherDocuments } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/cron/expiry`
 *
 * Daily sweep: any `approved` teacher_documents row whose `expires_at` is
 * in the past gets flipped to `expired`. The route is the only writer of
 * this transition; admin actions never set status to `expired` directly.
 *
 * Auth: header `X-Cron-Secret` must match `process.env.CRON_SECRET`. We
 * intentionally log nothing about the auth attempt to avoid leaking even
 * the existence of the endpoint to attackers (PROJECT_CONTEXT §11.3).
 *
 * Telemetry: one row in `scheduled_job_runs` per invocation. Started
 * before the work; finished (success or failure) after. `metadata` carries
 * `{ expired_count }` so we can graph it over time.
 *
 * Idempotency: rerunning produces zero new state changes — the WHERE
 * clause filters by `status='approved'`, so previously-expired rows are
 * already out of the candidate set.
 */
export async function POST(req: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret");
  if (!expected || !provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Start the run-row first so a crash mid-sweep is visible in the
  // telemetry table rather than silently dropped.
  const [run] = await db
    .insert(scheduledJobRuns)
    .values({
      jobName: "expiry_sweep",
      status: "running",
    })
    .returning({ id: scheduledJobRuns.id });

  try {
    // Count candidates (approved + past-due) in the same conceptual unit
    // as the UPDATE. Doing it as a separate SELECT is cheaper than
    // counting the UPDATE's affected rows on a per-row basis, and the
    // race between count and update is non-fatal: at worst the
    // `candidates_considered` undercounts by the rows that newly went
    // past-due between the two statements.
    const candidates = await db
      .select({ id: teacherDocuments.id })
      .from(teacherDocuments)
      .where(
        and(
          eq(teacherDocuments.status, "approved"),
          lt(teacherDocuments.expiresAt, sql`now()`)
        )
      );

    const updated = await db
      .update(teacherDocuments)
      .set({ status: "expired" })
      .where(
        and(
          eq(teacherDocuments.status, "approved"),
          lt(teacherDocuments.expiresAt, sql`now()`)
        )
      )
      .returning({ id: teacherDocuments.id });

    const expiredCount = updated.length;

    await db
      .update(scheduledJobRuns)
      .set({
        finishedAt: new Date(),
        status: "success",
        candidatesConsidered: candidates.length,
        metadata: { expired_count: expiredCount },
      })
      .where(eq(scheduledJobRuns.id, run.id));

    return NextResponse.json({ expired: expiredCount }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort: mark the run as failed. If THIS write also fails
    // there's nothing left to do but surface the original error.
    try {
      await db
        .update(scheduledJobRuns)
        .set({
          finishedAt: new Date(),
          status: "failed",
          errorMessage: message.slice(0, 1000),
        })
        .where(eq(scheduledJobRuns.id, run.id));
    } catch {
      // ignore
    }
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}
