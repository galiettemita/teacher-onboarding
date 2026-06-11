import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Clear the Auth.js session and return to /login.
 *
 * Used to recover from a session whose user no longer exists (a stale JWT that
 * would otherwise bounce between /login and the dashboard forever). Deletes
 * every Auth.js cookie — session token (and its chunks), CSRF, callback — so
 * the next request is treated as a clean, signed-out visitor.
 */
export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  const jar = await cookies();
  for (const c of jar.getAll()) {
    if (c.name.includes("authjs")) {
      res.cookies.set(c.name, "", {
        path: "/",
        maxAge: 0,
        // A `__Secure-`/`__Host-` cookie can only be (re)set over a Secure
        // response — required for the deletion to take effect in production.
        secure: c.name.startsWith("__Secure-") || c.name.startsWith("__Host-"),
      });
    }
  }
  return res;
}
