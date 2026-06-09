import { beforeEach, describe, expect, it } from "vitest";
import { _resetForTests } from "@/lib/rate-limit";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit/edge";
import { NextRequest } from "next/server";

beforeEach(() => {
  _resetForTests();
});

describe("enforceRateLimit", () => {
  it("returns null when no rule matches", () => {
    const res = enforceRateLimit({ pathname: "/admin/dashboard", ip: "1.1.1.1", userId: null });
    expect(res).toBeNull();
  });

  it("auth path: 6th hit returns 429 with Retry-After header", () => {
    for (let i = 0; i < 5; i++) {
      const ok = enforceRateLimit({ pathname: "/api/auth/signin", ip: "9.9.9.9", userId: null });
      expect(ok).toBeNull();
    }
    const blocked = enforceRateLimit({ pathname: "/api/auth/signin", ip: "9.9.9.9", userId: null });
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    const retryAfter = blocked!.headers.get("retry-after");
    expect(retryAfter).toMatch(/^\d+$/);
  });

  it("upload path: user-scoped; same IP + different user gets independent bucket", () => {
    const userA = "user-a";
    const userB = "user-b";
    for (let i = 0; i < 10; i++) {
      const r = enforceRateLimit({
        pathname: "/api/upload",
        ip: "1.2.3.4",
        userId: userA,
      });
      expect(r).toBeNull();
    }
    // userA blocked
    const blockedA = enforceRateLimit({
      pathname: "/api/upload",
      ip: "1.2.3.4",
      userId: userA,
    });
    expect(blockedA?.status).toBe(429);

    // userB on the SAME ip still allowed
    const okB = enforceRateLimit({
      pathname: "/api/upload",
      ip: "1.2.3.4",
      userId: userB,
    });
    expect(okB).toBeNull();
  });

  it("files path: 61st hit returns 429", () => {
    for (let i = 0; i < 60; i++) {
      const r = enforceRateLimit({
        pathname: "/api/files/abc",
        ip: "5.5.5.5",
        userId: "u1",
      });
      expect(r).toBeNull();
    }
    const blocked = enforceRateLimit({
      pathname: "/api/files/abc",
      ip: "5.5.5.5",
      userId: "u1",
    });
    expect(blocked?.status).toBe(429);
    expect(blocked!.headers.get("retry-after")).toBeTruthy();
  });
});

describe("clientIp", () => {
  it("prefers X-Forwarded-For leftmost address", () => {
    const req = new NextRequest("http://localhost/", {
      headers: { "x-forwarded-for": "1.2.3.4, 9.9.9.9" },
    });
    expect(clientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to X-Real-IP when XFF is absent", () => {
    const req = new NextRequest("http://localhost/", {
      headers: { "x-real-ip": "7.7.7.7" },
    });
    expect(clientIp(req)).toBe("7.7.7.7");
  });

  it("returns 'unknown' when no IP header is present", () => {
    const req = new NextRequest("http://localhost/");
    expect(clientIp(req)).toBe("unknown");
  });
});
