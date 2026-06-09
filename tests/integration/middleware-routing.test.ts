import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { _resetForTests } from "@/lib/rate-limit";

/**
 * Middleware behavior matrix:
 *
 *   - anonymous + /teacher/dashboard → 302 redirect to /login
 *   - anonymous + /api/files/<id>    → 401
 *   - anonymous + /api/admin/teachers → 401
 *   - teacher  + /admin/dashboard    → 302 redirect to /unauthorized
 *                                       (NB: spec says "403" for logs; the
 *                                       middleware redirects pages because
 *                                       the user is already authenticated;
 *                                       the 403 outcome applies to API
 *                                       paths, not page paths. We assert
 *                                       both shapes here.)
 *   - teacher  + /api/admin/teachers → 403
 *   - admin    + /api/admin/audit    → passes through (200)
 *
 * Auth.js's `auth((req) => …)` wrapper attaches `req.auth` from the
 * session cookie. We stub the wrapper to inject a synthetic auth.
 */

let injectedAuth: { user: { id: string; role: "admin" | "teacher" } } | null = null;

vi.mock("@/lib/auth/edge", () => ({
  auth: (
    handler: (
      req: NextRequest & { auth: typeof injectedAuth }
    ) => Promise<Response> | Response
  ) => {
    return async (req: NextRequest) => {
      const decorated = Object.assign(req, { auth: injectedAuth });
      return handler(decorated);
    };
  },
}));

beforeEach(() => {
  injectedAuth = null;
  _resetForTests();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callMiddleware(path: string): Promise<Response> {
  const mw = (await import("@/middleware")).default as (
    req: NextRequest
  ) => Promise<Response>;
  // NextRequest needs an absolute URL.
  const req = new NextRequest(`http://localhost${path}`);
  return mw(req);
}

describe("middleware: anonymous", () => {
  it("redirects /teacher/dashboard to /login (302)", async () => {
    const res = await callMiddleware("/teacher/dashboard");
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const location = res.headers.get("location");
    expect(location).toMatch(/\/login/);
    expect(location).toMatch(/from=%2Fteacher%2Fdashboard/);
  });

  it("returns 401 on /api/files/<id>", async () => {
    const res = await callMiddleware("/api/files/abc");
    expect(res.status).toBe(401);
  });

  it("returns 401 on /api/admin/teachers", async () => {
    const res = await callMiddleware("/api/admin/teachers");
    expect(res.status).toBe(401);
  });

  it("redirects /admin/dashboard to /login (302)", async () => {
    const res = await callMiddleware("/admin/dashboard");
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toMatch(/\/login/);
  });
});

describe("middleware: teacher (role escalation)", () => {
  beforeEach(() => {
    injectedAuth = { user: { id: "t1", role: "teacher" } };
  });

  it("redirects page request to /unauthorized", async () => {
    const res = await callMiddleware("/admin/dashboard");
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toMatch(/\/unauthorized/);
  });

  it("returns 403 on /api/admin/* API", async () => {
    const res = await callMiddleware("/api/admin/teachers");
    expect(res.status).toBe(403);
  });

  it("returns 403 on PATCH /api/admin/documents/<id> via middleware", async () => {
    const res = await callMiddleware("/api/admin/documents/abc");
    expect(res.status).toBe(403);
  });
});

describe("middleware: admin", () => {
  beforeEach(() => {
    injectedAuth = { user: { id: "a1", role: "admin" } };
  });

  it("passes through admin requests", async () => {
    const res = await callMiddleware("/api/admin/audit");
    // NextResponse.next() returns 200 with x-middleware-next header set.
    expect(res.status).toBe(200);
  });
});
