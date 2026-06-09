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

type AuthShape =
  | { kind: "none" }
  | { kind: "bearer"; secret: string }
  | { kind: "raw"; value: string }
  | { kind: "x-cron-secret"; secret: string };

function makeRequest(method: "GET" | "POST", auth: AuthShape): Request {
  const headers: Record<string, string> = {};
  if (auth.kind === "bearer") {
    headers["authorization"] = `Bearer ${auth.secret}`;
  } else if (auth.kind === "raw") {
    headers["authorization"] = auth.value;
  } else if (auth.kind === "x-cron-secret") {
    headers["x-cron-secret"] = auth.secret;
  }
  return new Request("http://localhost/api/cron/expiry", { method, headers });
}

describe("/api/cron/expiry auth", () => {
  it("401 when Authorization header is missing", async () => {
    const { GET } = await import("@/app/api/cron/expiry/route");
    const res = await GET(makeRequest("GET", { kind: "none" }));
    expect(res.status).toBe(401);
    expect(jobRunInsertCount).toBe(0);
    expect(documentsUpdateCalls).toBe(0);
  });

  it("401 when Bearer token does not match env", async () => {
    const { GET } = await import("@/app/api/cron/expiry/route");
    const res = await GET(
      makeRequest("GET", { kind: "bearer", secret: "wrong-secret" })
    );
    expect(res.status).toBe(401);
    expect(jobRunInsertCount).toBe(0);
  });

  it("401 when scheme is not Bearer", async () => {
    const { GET } = await import("@/app/api/cron/expiry/route");
    const res = await GET(
      makeRequest("GET", { kind: "raw", value: "Basic shh-its-a-secret" })
    );
    expect(res.status).toBe(401);
  });

  it("401 when legacy X-Cron-Secret header is used (Vercel only sends Authorization)", async () => {
    const { GET } = await import("@/app/api/cron/expiry/route");
    const res = await GET(
      makeRequest("GET", { kind: "x-cron-secret", secret: "shh-its-a-secret" })
    );
    expect(res.status).toBe(401);
  });

  it("401 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/cron/expiry/route");
    const res = await GET(
      makeRequest("GET", { kind: "bearer", secret: "anything" })
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/cron/expiry (Vercel-invoked)", () => {
  it("200 + sweeps past-due approved rows and writes telemetry", async () => {
    candidatesForSelect = [{ id: "d1" }, { id: "d2" }];
    candidatesForUpdate = [{ id: "d1" }, { id: "d2" }];

    const { GET } = await import("@/app/api/cron/expiry/route");
    const res = await GET(
      makeRequest("GET", { kind: "bearer", secret: "shh-its-a-secret" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ expired: 2 });

    expect(jobRunInsertCount).toBe(1);
    expect(jobRunInsertedRow?.jobName).toBe("expiry_sweep");
    expect(jobRunInsertedRow?.status).toBe("running");
    expect(documentsUpdateCalls).toBe(1);

    expect(jobRunUpdateCalls).toHaveLength(1);
    const final = jobRunUpdateCalls[0].set;
    expect(final.status).toBe("success");
    expect(final.candidatesConsidered).toBe(2);
    expect(final.metadata).toEqual({ expired_count: 2 });
    expect(final.finishedAt).toBeInstanceOf(Date);
  });

  it("idempotent: rerun with zero candidates → 0 expired, success row still written", async () => {
    candidatesForSelect = [];
    candidatesForUpdate = [];

    const { GET } = await import("@/app/api/cron/expiry/route");
    const res = await GET(
      makeRequest("GET", { kind: "bearer", secret: "shh-its-a-secret" })
    );
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

    const { GET } = await import("@/app/api/cron/expiry/route");
    const res = await GET(
      makeRequest("GET", { kind: "bearer", secret: "shh-its-a-secret" })
    );
    expect(res.status).toBe(500);

    expect(jobRunInsertCount).toBe(1);
    expect(jobRunUpdateCalls).toHaveLength(1);
    const final = jobRunUpdateCalls[0].set;
    expect(final.status).toBe("failed");
    expect(final.errorMessage).toMatch(/simulated db failure/);
  });
});

describe("POST /api/cron/expiry (local-testing alias)", () => {
  it("POST with Bearer also sweeps — same handler", async () => {
    candidatesForSelect = [{ id: "d1" }];
    candidatesForUpdate = [{ id: "d1" }];

    const { POST } = await import("@/app/api/cron/expiry/route");
    const res = await POST(
      makeRequest("POST", { kind: "bearer", secret: "shh-its-a-secret" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ expired: 1 });
  });
});
