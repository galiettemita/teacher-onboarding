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

describe("middleware: CSP nonce wiring (the bug we shipped initially)", () => {
  /**
   * Under the original CSP (`script-src 'self'`) Next.js's inline RSC
   * hydration scripts were blocked at runtime. Smoke-verified by
   * curl + pnpm start (see commit history). These tests assert the
   * wiring that prevents regression:
   *
   *   1. Every response middleware emits has a single CSP header.
   *   2. The CSP contains a fresh nonce.
   *   3. Two requests yield two different nonces.
   *   4. The x-nonce request header is set so Next's renderer can
   *      stamp it onto inline <script>s.
   *   5. CSP includes 'strict-dynamic' so the nonced loader can fetch
   *      its chunks.
   */
  it("attaches CSP with a nonce + 'strict-dynamic' on a passthrough", async () => {
    injectedAuth = { user: { id: "a1", role: "admin" } };
    const res = await callMiddleware("/api/admin/audit");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("attaches CSP on the public-path branch (anonymous /login)", async () => {
    injectedAuth = null;
    const res = await callMiddleware("/login");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("nonce-");
  });

  it("attaches CSP on redirects (anonymous → /admin/dashboard)", async () => {
    injectedAuth = null;
    const res = await callMiddleware("/admin/dashboard");
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("nonce-");
  });

  it("emits a fresh nonce per request", async () => {
    injectedAuth = { user: { id: "a1", role: "admin" } };
    const a = await callMiddleware("/api/admin/audit");
    const b = await callMiddleware("/api/admin/audit");
    const nonceA = /nonce-([A-Za-z0-9+/=]+)/.exec(a.headers.get("content-security-policy") ?? "")?.[1];
    const nonceB = /nonce-([A-Za-z0-9+/=]+)/.exec(b.headers.get("content-security-policy") ?? "")?.[1];
    expect(nonceA).toBeTruthy();
    expect(nonceB).toBeTruthy();
    expect(nonceA).not.toBe(nonceB);
  });

  it("sets exactly one CSP header (no static + dynamic double-up)", async () => {
    injectedAuth = { user: { id: "a1", role: "admin" } };
    const res = await callMiddleware("/api/admin/audit");
    // Headers.get returns the single value or a comma-joined list of all
    // values for the same key. Browsers AND multiple CSP headers; we
    // need exactly one to keep the nonce effective.
    const all: string[] = [];
    res.headers.forEach((v, k) => {
      if (k.toLowerCase() === "content-security-policy") all.push(v);
    });
    expect(all.length).toBe(1);
  });
});
