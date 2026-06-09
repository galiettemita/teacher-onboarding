import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scheduledJobRuns, teacherDocuments } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily sweep: any `approved` teacher_documents row whose `expires_at` is
 * in the past gets flipped to `expired`. The route is the only writer of
 * this transition; admin actions never set status to `expired` directly.
 *
 * Method: Vercel Cron invokes registered paths with **GET** and a
 *   `Authorization: Bearer ${CRON_SECRET}` header. We export both `GET`
 *   (the production path) and `POST` (handy for local `curl` testing) and
 *   share one handler. The auth check uses `crypto.timingSafeEqual` so the
 *   constant-time guarantee survives even though the header value isn't
 *   secret-grade entropy.
 *
 * Telemetry: one row in `scheduled_job_runs` per invocation. Started
 * before the work; finished (success or failure) after. `metadata` carries
 * `{ expired_count }` so we can graph it over time.
 *
 * Idempotency: rerunning produces zero new state changes — the WHERE
 * clause filters by `status='approved'`, so previously-expired rows are
 * already out of the candidate set. We additionally guard on
 * `expires_at IS NOT NULL` even though SQL's NULL semantics would skip
 * them anyway — explicit is friendlier than tribal SQL knowledge.
 */

function isAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = req.headers.get("authorization");
  if (!header) return false;

  // Format: `Bearer <secret>` (case-insensitive scheme).
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  const provided = match[1];

  // Constant-time compare. Buffer.from requires equal-length buffers to
  // avoid throwing, so fast-path-reject mismatched lengths first.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function runSweep(): Promise<Response> {
  const [run] = await db
    .insert(scheduledJobRuns)
    .values({
      jobName: "expiry_sweep",
      status: "running",
    })
    .returning({ id: scheduledJobRuns.id });

  try {
    // Candidates: approved + non-null + past-due. Counting separately
    // from the UPDATE is fine — the race window is one statement wide
    // and at worst we undercount candidates by rows that just went
    // past-due, which doesn't affect correctness of the sweep itself.
    const candidates = await db
      .select({ id: teacherDocuments.id })
      .from(teacherDocuments)
      .where(
        and(
          eq(teacherDocuments.status, "approved"),
          isNotNull(teacherDocuments.expiresAt),
          lt(teacherDocuments.expiresAt, sql`now()`)
        )
      );

    const updated = await db
      .update(teacherDocuments)
      .set({ status: "expired" })
      .where(
        and(
          eq(teacherDocuments.status, "approved"),
          isNotNull(teacherDocuments.expiresAt),
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
      // best-effort; original error wins
    }
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}

async function handle(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSweep();
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
