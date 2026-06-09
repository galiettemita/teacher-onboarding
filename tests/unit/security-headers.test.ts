import { describe, expect, it } from "vitest";
import nextConfig, { SECURITY_HEADERS } from "@/next.config";
import { STATIC_FALLBACK_CSP, buildCsp, generateNonce } from "@/lib/security/csp";

/**
 * Headers split:
 *   - Static `next.config.ts headers()` carries HSTS, X-Frame-Options,
 *     X-Content-Type-Options, Referrer-Policy, Permissions-Policy on
 *     every response.
 *   - CSP is emitted by middleware per request (see
 *     tests/integration/middleware-csp.test.ts) because it carries a
 *     fresh nonce. Setting CSP twice would cause browsers to intersect
 *     the policies and defeat the nonce.
 */
describe("next.config.ts security headers (non-CSP)", () => {
  it("registers a wildcard rule that applies to every path", async () => {
    expect(nextConfig.headers).toBeDefined();
    const rules = await nextConfig.headers!();
    expect(rules.length).toBeGreaterThan(0);
    const wildcard = rules.find((r) => r.source === "/:path*");
    expect(wildcard).toBeDefined();
    expect(wildcard!.headers.length).toBeGreaterThan(0);
  });

  it("contains every required non-CSP directive", async () => {
    const rules = await nextConfig.headers!();
    const headers = rules.find((r) => r.source === "/:path*")!.headers;
    const map = new Map(headers.map((h) => [h.key, h.value]));

    expect(map.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload"
    );
    expect(map.get("X-Frame-Options")).toBe("DENY");
    expect(map.get("X-Content-Type-Options")).toBe("nosniff");
    expect(map.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(map.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=()"
    );
  });

  it("does NOT set CSP statically (avoids double-CSP intersection)", async () => {
    const rules = await nextConfig.headers!();
    const headers = rules.find((r) => r.source === "/:path*")!.headers;
    const cspEntry = headers.find((h) => h.key === "Content-Security-Policy");
    expect(cspEntry).toBeUndefined();
  });

  it("SECURITY_HEADERS export contains the expected keys", () => {
    const keys = SECURITY_HEADERS.map((h) => h.key);
    expect(keys).toContain("Strict-Transport-Security");
    expect(keys).toContain("X-Frame-Options");
    expect(keys).toContain("X-Content-Type-Options");
    expect(keys).toContain("Referrer-Policy");
    expect(keys).toContain("Permissions-Policy");
    expect(keys).not.toContain("Content-Security-Policy");
  });
});

describe("lib/security/csp", () => {
  it("buildCsp embeds the nonce in script-src with 'strict-dynamic'", () => {
    const csp = buildCsp("abc123==");
    expect(csp).toContain("script-src 'self' 'nonce-abc123==' 'strict-dynamic'");
  });

  it("buildCsp contains every required directive", () => {
    const csp = buildCsp("n");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("STATIC_FALLBACK_CSP omits any nonce reference", () => {
    expect(STATIC_FALLBACK_CSP).not.toContain("nonce");
    expect(STATIC_FALLBACK_CSP).not.toContain("strict-dynamic");
    expect(STATIC_FALLBACK_CSP).toContain("script-src 'self'");
  });

  it("generateNonce returns a base64-ish string with sufficient entropy", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(20); // 16 bytes → 24 chars base64
    expect(a).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});
