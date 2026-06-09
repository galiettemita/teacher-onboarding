import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = ["/", "/login", "/unauthorized"];
const PUBLIC_PREFIXES = ["/api/auth", "/_next", "/favicon", "/assets"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Cron uses shared-secret header, not session.
  if (pathname.startsWith("/api/cron")) {
    return NextResponse.next();
  }

  // Public assets and auth routes pass through.
  if (isPublic(pathname)) return NextResponse.next();

  // All other routes require a valid session.
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    // Auth.js v5 uses these cookie names; pick whichever exists.
    salt:
      process.env.NODE_ENV === "production"
        ? "__Secure-authjs.session-token"
        : "authjs.session-token",
  });

  const isApi = pathname.startsWith("/api/");

  if (!token?.userId) {
    if (isApi) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const role = token.role;

  // Admin-only paths.
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (role !== "admin") {
      if (isApi) return new NextResponse("Forbidden", { status: 403 });
      return NextResponse.redirect(new URL("/unauthorized", req.url));
    }
  }

  // Teacher-only paths.
  if (pathname.startsWith("/teacher")) {
    if (role !== "teacher") {
      if (isApi) return new NextResponse("Forbidden", { status: 403 });
      return NextResponse.redirect(new URL("/unauthorized", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  // Match everything except Next.js internals and static files (those are handled by isPublic too).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
