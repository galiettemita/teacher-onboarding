import type { RateLimitRule } from "./index";

/**
 * Canonical rate-limit rules. See AGENT 5 spec §3 + docs/SECURITY.md.
 *
 * Path prefixes are matched in declaration order — the FIRST match wins.
 * Subjects:
 *   - "ip"   : limiter keyed by client IP
 *   - "user" : limiter keyed by session user id (caller must supply it
 *              after auth resolution; otherwise the rule is skipped here
 *              and middleware falls back to the IP rule).
 */
export type Subject = "ip" | "user";

export interface PathRule {
  pathPrefix: string;
  subject: Subject;
  rule: RateLimitRule;
}

const ONE_MIN = 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

export const AUTH_RULE: RateLimitRule = {
  name: "auth",
  windowMs: ONE_MIN,
  max: 5,
};

export const UPLOAD_RULE: RateLimitRule = {
  name: "upload",
  windowMs: ONE_HOUR,
  max: 10,
};

export const FILES_RULE: RateLimitRule = {
  name: "files",
  windowMs: ONE_MIN,
  max: 60,
};

export const PATH_RULES: PathRule[] = [
  { pathPrefix: "/api/auth", subject: "ip", rule: AUTH_RULE },
  { pathPrefix: "/api/upload", subject: "user", rule: UPLOAD_RULE },
  { pathPrefix: "/api/files", subject: "user", rule: FILES_RULE },
];

export function findRule(pathname: string): PathRule | null {
  for (const r of PATH_RULES) {
    if (pathname.startsWith(r.pathPrefix)) return r;
  }
  return null;
}
