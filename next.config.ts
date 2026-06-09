import type { NextConfig } from "next";

/**
 * Security headers applied to every response. See docs/SECURITY.md §2 for
 * the rationale behind each directive. CSP is intentionally restrictive:
 *
 *   - `default-src 'self'`          : block everything by default
 *   - `script-src 'self'`           : no inline JS, no remote JS
 *   - `style-src 'self' 'unsafe-inline'` : Next.js ships inline <style>
 *                                          chunks; tighten when we drop
 *                                          styled-jsx / inline runtime CSS
 *   - `img-src 'self' data:`        : data: URLs are needed for inline icons
 *   - `connect-src 'self'`          : no remote XHR/fetch
 *   - `frame-ancestors 'none'`      : belt for X-Frame-Options below
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
] as const;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS.map((h) => ({ key: h.key, value: h.value })),
      },
    ];
  },
};

export default nextConfig;
