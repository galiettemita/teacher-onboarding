import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cron auth contract tests for /api/cron/reminders.
 *
 * REVIEWER_NOTES.md §1: Vercel Cron invokes registered paths with
 *   HTTP GET and `Authorization: Bearer ${CRON_SECRET}`.
 *   Doc: https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
 *
 * These tests use that exact contract. Bug regression we MUST NOT
 * ship: the Phase-4 first attempt used POST + X-Cron-Secret. The
 * Vercel cron would have hit it with GET + Bearer and gotten 401.
 *
 * The dispatcher is mocked: we're only testing the route's auth +
 * job-run telemetry behaviour here. Dispatcher behaviour gets its own
 * integration tests.
 */

let jobRunInsertCount = 0;
let jobRunInsertedRow: Record<string, unknown> | null = null;
let jobRunUpdateCalls: { set: Record<string, unknown>; whereId: string | null }[] = [];
let runOnceCalls = 0;
let runOnceShouldThrow = false;

vi.mock("@/lib/db/client", () => {
  // We only care about the scheduled_job_runs insert + update sequence.
  const insert = vi.fn(() => ({
    values: (v: Record<string, unknown>) => ({
      returning: async () => {
        if (Object.prototype.hasOwnProperty.call(v, "jobName")) {
          jobRunInsertCount++;
          const row = { id: `job-run-${jobRunInsertCount}`, ...v };
          jobRunInsertedRow = row;
          return [{ id: row.id }];
        }
        return [{ id: "x", ...v }];
      },
    }),
  }));

  const update = vi.fn(() => ({
    set: (s: Record<string, unknown>) => ({
      where: () => {
        jobRunUpdateCalls.push({ set: s, whereId: null });
        return {
          returning: async () => [],
          then: (resolve: (v: unknown) => unknown) => resolve([]),
        };
      },
    }),
  }));

  const select = vi.fn(() => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (v: unknown[]) => unknown) => resolve([]),
    };
    return chain;
  });

  return { db: { select, insert, update } };
});

vi.mock("@/lib/reminders/dispatcher", () => ({
  runOnce: vi.fn(async () => {
    runOnceCalls++;
    if (runOnceShouldThrow) throw new Error("simulated dispatch failure");
    return {
      considered: 5,
      sent: 2,
      skippedDuplicate: 1,
      skippedDailyCap: 1,
      skippedDisabled: 0,
      skippedNoEmail: 1,
      failed: 0,
    };
  }),
}));

beforeEach(() => {
  jobRunInsertCount = 0;
  jobRunInsertedRow = null;
  jobRunUpdateCalls = [];
  runOnceCalls = 0;
  runOnceShouldThrow = false;
  process.env.CRON_SECRET = "shh-its-a-secret";
});

afterEach(() => {
  vi.clearAllMocks();
});

type AuthShape =
  | { kind: "none" }
  | { kind: "bearer"; secret: string }
  | { kind: "raw"; value: string }
  | { kind: "x-cron-secret"; secret: string };

function makeRequest(method: "GET" | "POST", auth: AuthShape): Request {
  const headers: Record<string, string> = {};
  if (auth.kind === "bearer") headers["authorization"] = `Bearer ${auth.secret}`;
  else if (auth.kind === "raw") headers["authorization"] = auth.value;
  else if (auth.kind === "x-cron-secret") headers["x-cron-secret"] = auth.secret;
  return new Request("http://localhost/api/cron/reminders", { method, headers });
}

describe("/api/cron/reminders auth — Vercel contract", () => {
  it("401 when Authorization header is missing", async () => {
    const { GET } = await import("@/app/api/cron/reminders/route");
    const res = await GET(makeRequest("GET", { kind: "none" }));
    expect(res.status).toBe(401);
    expect(jobRunInsertCount).toBe(0);
    expect(runOnceCalls).toBe(0);
  });

  it("401 when Bearer token does not match env", async () => {
    const { GET } = await import("@/app/api/cron/reminders/route");
    const res = await GET(
      makeRequest("GET", { kind: "bearer", secret: "wrong-secret" })
    );
    expect(res.status).toBe(401);
    expect(jobRunInsertCount).toBe(0);
    expect(runOnceCalls).toBe(0);
  });

  it("401 when scheme is not Bearer", async () => {
    const { GET } = await import("@/app/api/cron/reminders/route");
    const res = await GET(
      makeRequest("GET", { kind: "raw", value: "Basic shh-its-a-secret" })
    );
    expect(res.status).toBe(401);
    expect(runOnceCalls).toBe(0);
  });

  it("401 when legacy X-Cron-Secret header is used (Vercel only sends Authorization)", async () => {
    const { GET } = await import("@/app/api/cron/reminders/route");
    const res = await GET(
      makeRequest("GET", { kind: "x-cron-secret", secret: "shh-its-a-secret" })
    );
    expect(res.status).toBe(401);
    expect(runOnceCalls).toBe(0);
  });

  it("401 when CRON_SECRET is not configured (defence in depth)", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/cron/reminders/route");
    const res = await GET(
      makeRequest("GET", { kind: "bearer", secret: "anything" })
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/cron/reminders (Vercel-invoked path)", () => {
  it("200 + writes one scheduled_job_runs row with counts", async () => {
    const { GET } = await import("@/app/api/cron/reminders/route");
    const res = await GET(
      makeRequest("GET", { kind: "bearer", secret: "shh-its-a-secret" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.jobRunId).toBe("job-run-1");
    expect(body.counts).toMatchObject({
      considered: 5,
      sent: 2,
      skipped_duplicate_milestone: 1,
      skipped_daily_cap: 1,
      skipped_no_email_on_file: 1,
      failed: 0,
    });

    // One insert into scheduled_job_runs with jobName='reminder_dispatch'.
    expect(jobRunInsertCount).toBe(1);
    expect(jobRunInsertedRow?.jobName).toBe("reminder_dispatch");
    expect(jobRunInsertedRow?.status).toBe("running");

    // One finishing update.
    expect(jobRunUpdateCalls).toHaveLength(1);
    const finalSet = jobRunUpdateCalls[0].set;
    expect(finalSet.status).toBe("success");
    expect(finalSet.candidatesConsidered).toBe(5);
    expect(finalSet.emailsSent).toBe(2);
    expect(finalSet.emailsFailed).toBe(0);
    expect(finalSet.emailsSkipped).toBe(3); // 1 dup + 1 cap + 0 disabled + 1 no_email

    expect(runOnceCalls).toBe(1);
  });

  it("POST also works (handy for local curl, same handler)", async () => {
    const { POST } = await import("@/app/api/cron/reminders/route");
    const res = await POST(
      makeRequest("POST", { kind: "bearer", secret: "shh-its-a-secret" })
    );
    expect(res.status).toBe(200);
  });
});

describe("dispatcher errors are captured in scheduled_job_runs", () => {
  it("500 + writes a failed row with error_message", async () => {
    runOnceShouldThrow = true;
    const { GET } = await import("@/app/api/cron/reminders/route");
    const res = await GET(
      makeRequest("GET", { kind: "bearer", secret: "shh-its-a-secret" })
    );
    expect(res.status).toBe(500);
    expect(jobRunInsertCount).toBe(1);
    expect(jobRunUpdateCalls).toHaveLength(1);
    expect(jobRunUpdateCalls[0].set.status).toBe("failed");
    expect(jobRunUpdateCalls[0].set.errorMessage).toMatch(/simulated dispatch failure/);
  });
});
