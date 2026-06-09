import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cron route only touches the DB. We mock the drizzle `db` to record
 * each operation and to return deterministic candidate / update sets, then
 * assert the route's behaviour around auth, telemetry rows, and
 * idempotency on rerun.
 */

type Row = Record<string, unknown>;

// Fixtures controlled per-test:
let candidatesForSelect: Row[] = [];
let candidatesForUpdate: Row[] = [];
let updateShouldThrow = false;

// Observed work:
let jobRunInsertCount = 0;
let jobRunInsertedRow: Row | null = null;
let jobRunUpdateCalls: { set: Row; whereId: string | null }[] = [];
let documentsUpdateCalls: number = 0;

vi.mock("@/lib/db/client", () => {
  const select = vi.fn(() => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (v: Row[]) => unknown) => resolve(candidatesForSelect),
    };
    return chain;
  });

  const insert = vi.fn(() => ({
    values: (v: Row) => ({
      returning: async (cols?: unknown) => {
        void cols;
        // Tag whether this is the scheduled_job_runs insert by looking for
        // jobName field.
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

  const update = vi.fn((tableRef: unknown) => {
    void tableRef;
    return {
      set: (s: Row) => {
        const resolveWork = () => {
          // The route updates either:
          //   teacher_documents (set status='expired') — large work
          //   scheduled_job_runs (set finishedAt/status) — telemetry
          if (s.status === "expired") {
            if (updateShouldThrow) throw new Error("simulated db failure");
            documentsUpdateCalls++;
            return candidatesForUpdate;
          }
          jobRunUpdateCalls.push({ set: s, whereId: null });
          return [];
        };
        return {
          where: () => {
            // Awaitable directly, OR chained with .returning().
            return {
              returning: async () => resolveWork(),
              then: (resolve: (v: unknown) => unknown) => resolve(resolveWork()),
            };
          },
        };
      },
    };
  });

  return { db: { select, insert, update } };
});

beforeEach(() => {
  candidatesForSelect = [];
  candidatesForUpdate = [];
  updateShouldThrow = false;
  jobRunInsertCount = 0;
  jobRunInsertedRow = null;
  jobRunUpdateCalls = [];
  documentsUpdateCalls = 0;
  process.env.CRON_SECRET = "shh-its-a-secret";
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeRequest(secret?: string | null): Request {
  const headers: Record<string, string> = {};
  if (secret !== null && secret !== undefined) {
    headers["x-cron-secret"] = secret;
  }
  return new Request("http://localhost/api/cron/expiry", {
    method: "POST",
    headers,
  });
}

describe("POST /api/cron/expiry", () => {
  it("401 when secret header is missing", async () => {
    const { POST } = await import("@/app/api/cron/expiry/route");
    const res = await POST(makeRequest(null));
    expect(res.status).toBe(401);
    expect(jobRunInsertCount).toBe(0);
    expect(documentsUpdateCalls).toBe(0);
  });

  it("401 when secret header does not match env", async () => {
    const { POST } = await import("@/app/api/cron/expiry/route");
    const res = await POST(makeRequest("wrong-secret"));
    expect(res.status).toBe(401);
    expect(jobRunInsertCount).toBe(0);
  });

  it("401 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const { POST } = await import("@/app/api/cron/expiry/route");
    const res = await POST(makeRequest("anything"));
    expect(res.status).toBe(401);
  });

  it("200 + sweeps past-due approved rows and writes telemetry", async () => {
    candidatesForSelect = [{ id: "d1" }, { id: "d2" }];
    candidatesForUpdate = [{ id: "d1" }, { id: "d2" }];

    const { POST } = await import("@/app/api/cron/expiry/route");
    const res = await POST(makeRequest("shh-its-a-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ expired: 2 });

    expect(jobRunInsertCount).toBe(1);
    expect(jobRunInsertedRow?.jobName).toBe("expiry_sweep");
    expect(jobRunInsertedRow?.status).toBe("running");

    expect(documentsUpdateCalls).toBe(1);

    // job-runs row updated with success + counts
    expect(jobRunUpdateCalls).toHaveLength(1);
    const final = jobRunUpdateCalls[0].set;
    expect(final.status).toBe("success");
    expect(final.candidatesConsidered).toBe(2);
    expect(final.metadata).toEqual({ expired_count: 2 });
    expect(final.finishedAt).toBeInstanceOf(Date);
  });

  it("idempotent: rerun with zero candidates → 0 expired, success row still written", async () => {
    candidatesForSelect = []; // nothing past-due (already swept)
    candidatesForUpdate = [];

    const { POST } = await import("@/app/api/cron/expiry/route");
    const res = await POST(makeRequest("shh-its-a-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ expired: 0 });

    expect(jobRunUpdateCalls).toHaveLength(1);
    expect(jobRunUpdateCalls[0].set.status).toBe("success");
    expect(jobRunUpdateCalls[0].set.candidatesConsidered).toBe(0);
    expect(jobRunUpdateCalls[0].set.metadata).toEqual({ expired_count: 0 });
  });

  it("500 + failed telemetry row when the UPDATE throws", async () => {
    candidatesForSelect = [{ id: "d1" }];
    updateShouldThrow = true;

    const { POST } = await import("@/app/api/cron/expiry/route");
    const res = await POST(makeRequest("shh-its-a-secret"));
    expect(res.status).toBe(500);

    expect(jobRunInsertCount).toBe(1);
    expect(jobRunUpdateCalls).toHaveLength(1);
    const final = jobRunUpdateCalls[0].set;
    expect(final.status).toBe("failed");
    expect(final.errorMessage).toMatch(/simulated db failure/);
  });
});
