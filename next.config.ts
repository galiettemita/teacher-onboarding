import type { NextConfig } from "next";

/**
 * Security headers applied to every response via Next.js's `headers()`
 * config. See docs/SECURITY.md §2 for the rationale behind each directive.
 *
 * Content-Security-Policy is NOT set here. It carries a per-request
 * nonce and is emitted by `middleware.ts` (see lib/security/csp.ts).
 * Setting CSP twice causes browsers to enforce the intersection, which
 * would defeat the nonce. Middleware runs on every non-static-asset
 * path; truly-static assets (_next/static, _next/image, favicon.ico)
 * don't execute scripts so the lack of a CSP on those responses is
 * harmless.
 */
export const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
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
