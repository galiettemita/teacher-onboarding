import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/edge";

const PUBLIC_PATHS = new Set(["/", "/login", "/unauthorized"]);
const PUBLIC_PREFIXES = ["/api/auth", "/_next", "/favicon", "/assets"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Cron uses shared-secret header, not session.
  if (pathname.startsWith("/api/cron")) {
    return NextResponse.next();
  }

  // Public assets and auth routes pass through.
  if (isPublic(pathname)) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");
  const session = req.auth;

  if (!session?.user?.id) {
    if (isApi) return new NextResponse("Unauthorized", { status: 401 });
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const role = session.user.role;

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
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
