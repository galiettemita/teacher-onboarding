import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/edge";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit/edge";
import { buildCsp, generateNonce } from "@/lib/security/csp";

const PUBLIC_PATHS = new Set(["/", "/login", "/unauthorized", "/logout"]);
const PUBLIC_PREFIXES = ["/api/auth", "/_next", "/favicon", "/assets"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/** Attach the per-request CSP carrying the nonce. */
function withCsp(res: NextResponse, nonce: string): NextResponse {
  res.headers.set("Content-Security-Policy", buildCsp(nonce));
  return res;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Rate limits run before auth so /api/auth/** is still throttled.
  const limited = enforceRateLimit({
    pathname,
    ip: clientIp(req),
    userId: req.auth?.user?.id ?? null,
  });
  if (limited) return limited;

  // Per-request CSP nonce. Next.js reads `x-nonce` and stamps it onto
  // every inline <script> it emits for RSC streaming/hydration.
  const nonce = generateNonce();
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);
  const nextOpts = { request: { headers: reqHeaders } };

  // Cron uses shared-secret header, not session.
  if (pathname.startsWith("/api/cron")) {
    return withCsp(NextResponse.next(nextOpts), nonce);
  }

  // Public assets and auth routes pass through.
  if (isPublic(pathname)) return withCsp(NextResponse.next(nextOpts), nonce);

  const isApi = pathname.startsWith("/api/");
  const session = req.auth;

  if (!session?.user?.id) {
    if (isApi) return new NextResponse("Unauthorized", { status: 401 });
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("from", pathname);
    return withCsp(NextResponse.redirect(loginUrl), nonce);
  }

  const role = session.user.role;

  // Admin-only paths.
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (role !== "admin") {
      if (isApi) return new NextResponse("Forbidden", { status: 403 });
      return withCsp(NextResponse.redirect(new URL("/unauthorized", req.url)), nonce);
    }
  }

  // Teacher-only paths.
  if (pathname.startsWith("/teacher")) {
    if (role !== "teacher") {
      if (isApi) return new NextResponse("Forbidden", { status: 403 });
      return withCsp(NextResponse.redirect(new URL("/unauthorized", req.url)), nonce);
    }
  }

  return withCsp(NextResponse.next(nextOpts), nonce);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
