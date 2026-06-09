import { describe, expect, it } from "vitest";
import nextConfig, { SECURITY_HEADERS } from "@/next.config";

/**
 * The `headers()` function in next.config.ts is invoked by Next at build
 * time to register response headers. We exercise it directly here and
 * confirm every required directive is present on the default `/:path*`
 * route — which covers /login, /teacher/dashboard, /admin/dashboard,
 * /api/files/[id] and any other route in the app.
 */
describe("security headers via next.config.ts", () => {
  it("registers a wildcard rule that applies to every path", async () => {
    expect(nextConfig.headers).toBeDefined();
    const rules = await nextConfig.headers!();
    expect(rules.length).toBeGreaterThan(0);
    const wildcard = rules.find((r) => r.source === "/:path*");
    expect(wildcard).toBeDefined();
    expect(wildcard!.headers.length).toBeGreaterThan(0);
  });

  it("contains every required directive", async () => {
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

    const csp = map.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("connect-src 'self'");
  });

  it("exports the same SECURITY_HEADERS array used by next.config", () => {
    const keys = SECURITY_HEADERS.map((h) => h.key);
    expect(keys).toContain("Strict-Transport-Security");
    expect(keys).toContain("Content-Security-Policy");
    expect(keys).toContain("X-Frame-Options");
    expect(keys).toContain("X-Content-Type-Options");
    expect(keys).toContain("Referrer-Policy");
    expect(keys).toContain("Permissions-Policy");
  });
});
