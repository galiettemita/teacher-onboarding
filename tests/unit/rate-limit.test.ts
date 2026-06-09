import { beforeEach, describe, expect, it } from "vitest";
import { _resetForTests, check, sweep } from "@/lib/rate-limit";
import { AUTH_RULE, FILES_RULE, UPLOAD_RULE, findRule } from "@/lib/rate-limit/rules";

beforeEach(() => {
  _resetForTests();
});

describe("rate-limit core", () => {
  it("allows up to `max` hits within the window, then blocks", () => {
    const now = 1_000_000;
    for (let i = 0; i < AUTH_RULE.max; i++) {
      const r = check(AUTH_RULE, "ip:1.2.3.4", now + i);
      expect(r.allowed).toBe(true);
    }
    const blocked = check(AUTH_RULE, "ip:1.2.3.4", now + AUTH_RULE.max);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.remaining).toBe(0);
  });

  it("resets the counter when the window rolls over", () => {
    const start = 5_000_000;
    for (let i = 0; i < AUTH_RULE.max; i++) {
      check(AUTH_RULE, "ip:1.2.3.4", start + i);
    }
    expect(check(AUTH_RULE, "ip:1.2.3.4", start + 1).allowed).toBe(false);

    const after = start + AUTH_RULE.windowMs + 1;
    expect(check(AUTH_RULE, "ip:1.2.3.4", after).allowed).toBe(true);
  });

  it("isolates buckets by subject", () => {
    const now = 9_000_000;
    for (let i = 0; i < AUTH_RULE.max; i++) {
      check(AUTH_RULE, "ip:1.1.1.1", now + i);
    }
    // Different subject should not be affected.
    expect(check(AUTH_RULE, "ip:9.9.9.9", now).allowed).toBe(true);
  });

  it("isolates buckets by rule name", () => {
    const now = 12_000_000;
    for (let i = 0; i < AUTH_RULE.max; i++) {
      check(AUTH_RULE, "ip:1.1.1.1", now + i);
    }
    // Same subject under a different rule has its own bucket.
    expect(check(UPLOAD_RULE, "ip:1.1.1.1", now).allowed).toBe(true);
  });

  it("sweep drops expired buckets", () => {
    const now = 50_000_000;
    check(AUTH_RULE, "ip:a", now);
    check(UPLOAD_RULE, "user:b", now);
    const dropped = sweep(now + UPLOAD_RULE.windowMs + 1);
    expect(dropped).toBeGreaterThanOrEqual(1);
  });

  it("retryAfterSeconds is at least 1 even at the very boundary", () => {
    const now = 100_000_000;
    for (let i = 0; i < AUTH_RULE.max; i++) {
      check(AUTH_RULE, "ip:x", now);
    }
    const blocked = check(AUTH_RULE, "ip:x", now + AUTH_RULE.windowMs - 100);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe("findRule", () => {
  it("matches /api/auth requests to the auth rule", () => {
    const r = findRule("/api/auth/signin");
    expect(r?.rule).toBe(AUTH_RULE);
    expect(r?.subject).toBe("ip");
  });

  it("matches /api/upload to the upload rule (user-scoped)", () => {
    const r = findRule("/api/upload");
    expect(r?.rule).toBe(UPLOAD_RULE);
    expect(r?.subject).toBe("user");
  });

  it("matches /api/files/<id> to the files rule (user-scoped)", () => {
    const r = findRule("/api/files/abc");
    expect(r?.rule).toBe(FILES_RULE);
    expect(r?.subject).toBe("user");
  });

  it("returns null for unrelated paths", () => {
    expect(findRule("/api/admin/teachers")).toBeNull();
    expect(findRule("/")).toBeNull();
    expect(findRule("/teacher/dashboard")).toBeNull();
  });
});

describe("rate-limit cardinal counts per spec", () => {
  it("auth: 6th request within a minute → blocked with Retry-After", () => {
    const now = 1_700_000_000;
    for (let i = 0; i < 5; i++) {
      expect(check(AUTH_RULE, "ip:auth-ip", now + i).allowed).toBe(true);
    }
    const sixth = check(AUTH_RULE, "ip:auth-ip", now + 5);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("upload: 11th request within an hour → blocked", () => {
    const now = 1_700_001_000;
    for (let i = 0; i < 10; i++) {
      expect(check(UPLOAD_RULE, "user:up-user", now + i).allowed).toBe(true);
    }
    const eleventh = check(UPLOAD_RULE, "user:up-user", now + 10);
    expect(eleventh.allowed).toBe(false);
  });

  it("files: 61st request within a minute → blocked", () => {
    const now = 1_700_002_000;
    for (let i = 0; i < 60; i++) {
      expect(check(FILES_RULE, "user:f-user", now + i).allowed).toBe(true);
    }
    const sixtyFirst = check(FILES_RULE, "user:f-user", now + 60);
    expect(sixtyFirst.allowed).toBe(false);
  });
});
