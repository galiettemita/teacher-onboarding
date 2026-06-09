import { NextResponse, type NextRequest } from "next/server";
import { check, type RateLimitResult } from "./index";
import { findRule } from "./rules";

/**
 * Extract a stable IP for limiting. We trust the leftmost X-Forwarded-For
 * value (set by the platform load balancer); fall back to X-Real-IP and
 * then a sentinel string. Spoofable, but our IP rule only protects auth
 * brute-force; a determined attacker is rate-limited per-IP they can
 * actually send from.
 */
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export interface EnforceInput {
  pathname: string;
  ip: string;
  userId: string | null;
}

/** Returns null when the request is allowed, or a 429 Response otherwise. */
export function enforceRateLimit(input: EnforceInput): NextResponse | null {
  const match = findRule(input.pathname);
  if (!match) return null;

  // user-scoped rules need an authenticated subject; fall back to IP.
  const subject =
    match.subject === "user" ? (input.userId ?? `ip:${input.ip}`) : `ip:${input.ip}`;

  const result = check(match.rule, subject);
  if (result.allowed) return null;

  return rateLimitResponse(result);
}

export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const res = NextResponse.json(
    { error: "Too Many Requests" },
    { status: 429 }
  );
  res.headers.set("Retry-After", String(result.retryAfterSeconds));
  res.headers.set("X-RateLimit-Remaining", "0");
  res.headers.set("X-RateLimit-Reset", String(Math.floor(result.resetAt / 1000)));
  return res;
}
