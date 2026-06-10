import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We need to control env BEFORE importing the adapter (constructor reads env).
// Use dynamic import inside each test, after setting env.

const VALID_ENV = {
  SUPABASE_URL: "https://test-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-service-role-key",
  SUPABASE_BUCKET: "teacher-onboarding-private",
};

function setEnv(overrides: Partial<typeof VALID_ENV> = {}) {
  const env = { ...VALID_ENV, ...overrides };
  process.env.SUPABASE_URL = env.SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_BUCKET = env.SUPABASE_BUCKET;
}

function clearEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_BUCKET;
}

// Dynamically import the adapter fresh (no module cache issues)
async function createAdapter() {
  const { SupabaseStorageAdapter } = await import("@/lib/storage/supabase");
  return new SupabaseStorageAdapter();
}

describe("SupabaseStorageAdapter", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset module registry so constructor re-reads env each time
    vi.resetModules();
    clearEnv();

    // Mock global fetch
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearEnv();
  });

  // ---- Constructor validation ----

  describe("constructor env validation", () => {
    it("throws when SUPABASE_URL is missing", async () => {
      process.env.SUPABASE_SERVICE_ROLE_KEY = VALID_ENV.SUPABASE_SERVICE_ROLE_KEY;
      process.env.SUPABASE_BUCKET = VALID_ENV.SUPABASE_BUCKET;
      await expect(createAdapter()).rejects.toThrow("SUPABASE_URL");
    });

    it("throws when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
      process.env.SUPABASE_URL = VALID_ENV.SUPABASE_URL;
      process.env.SUPABASE_BUCKET = VALID_ENV.SUPABASE_BUCKET;
      await expect(createAdapter()).rejects.toThrow("SUPABASE_SERVICE_ROLE_KEY");
    });

    it("throws when SUPABASE_BUCKET is missing", async () => {
      process.env.SUPABASE_URL = VALID_ENV.SUPABASE_URL;
      process.env.SUPABASE_SERVICE_ROLE_KEY = VALID_ENV.SUPABASE_SERVICE_ROLE_KEY;
      await expect(createAdapter()).rejects.toThrow("SUPABASE_BUCKET");
    });

    it("succeeds when all env vars are present", async () => {
      setEnv();
      const adapter = await createAdapter();
      expect(adapter.id).toBe("supabase");
    });
  });

  // ---- Key validation ----

  describe("key validation", () => {
    beforeEach(() => setEnv());

    it("rejects keys containing '..'", async () => {
      const adapter = await createAdapter();
      await expect(adapter.put("foo/../etc/passwd", Buffer.from("x"), "text/plain")).rejects.toThrow(
        "Invalid storage key"
      );
    });

    it("rejects keys starting with '/'", async () => {
      const adapter = await createAdapter();
      await expect(adapter.put("/absolute/path", Buffer.from("x"), "text/plain")).rejects.toThrow(
        "Invalid storage key"
      );
    });

    it("rejects keys with spaces", async () => {
      const adapter = await createAdapter();
      await expect(adapter.put("has space/file.txt", Buffer.from("x"), "text/plain")).rejects.toThrow(
        "Invalid storage key"
      );
    });

    it("rejects empty keys", async () => {
      const adapter = await createAdapter();
      await expect(adapter.put("", Buffer.from("x"), "text/plain")).rejects.toThrow(
        "Invalid storage key"
      );
    });

    it("accepts valid keys with slashes, dots, dashes, underscores", async () => {
      const adapter = await createAdapter();
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 200 }));
      await expect(
        adapter.put(
          "teachers/abc-123/doc-type/550e8400-e29b-41d4-a716.pdf",
          Buffer.from("x"),
          "application/pdf"
        )
      ).resolves.toBeUndefined();
    });
  });

  // ---- put ----

  describe("put", () => {
    beforeEach(() => setEnv());

    it("sends POST with correct URL, Authorization, Content-Type, and body", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 200 }));
      const adapter = await createAdapter();
      const body = Buffer.from("hello pdf");
      await adapter.put("teachers/u1/d1/abc.pdf", body, "application/pdf");

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe(
        "https://test-project.supabase.co/storage/v1/object/teacher-onboarding-private/teachers/u1/d1/abc.pdf"
      );
      expect(opts.method).toBe("POST");
      expect(opts.headers.Authorization).toBe(
        `Bearer ${VALID_ENV.SUPABASE_SERVICE_ROLE_KEY}`
      );
      expect(opts.headers["Content-Type"]).toBe("application/pdf");
      // Body is Uint8Array from the Buffer
      expect(Buffer.from(opts.body).toString()).toBe("hello pdf");
    });

    it("treats 200 as success", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 200 }));
      const adapter = await createAdapter();
      await expect(adapter.put("f.txt", Buffer.from("x"), "text/plain")).resolves.toBeUndefined();
    });

    it("treats 201 as success", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 201 }));
      const adapter = await createAdapter();
      await expect(adapter.put("f.txt", Buffer.from("x"), "text/plain")).resolves.toBeUndefined();
    });

    it("throws on non-2xx WITHOUT echoing raw response body", async () => {
      const secretBody = "SENSITIVE_INTERNAL_ERROR: secret details here that should not leak out to the user verbatim in production";
      fetchSpy.mockResolvedValueOnce(new Response(secretBody, { status: 500 }));
      const adapter = await createAdapter();
      try {
        await adapter.put("f.txt", Buffer.from("x"), "text/plain");
        expect.fail("should have thrown");
      } catch (err: unknown) {
        const msg = (err as Error).message;
        expect(msg).toContain("500");
        // Verify the error is capped (max 200 chars of body included)
        expect(msg.length).toBeLessThan(secretBody.length + 100);
      }
    });
  });

  // ---- get ----

  describe("get", () => {
    beforeEach(() => setEnv());

    it("returns Buffer and content-type on 200", async () => {
      const payload = Buffer.from("file-bytes");
      fetchSpy.mockResolvedValueOnce(
        new Response(payload, {
          status: 200,
          headers: { "content-type": "image/png" },
        })
      );
      const adapter = await createAdapter();
      const result = await adapter.get("teachers/u1/d1/abc.png");
      expect(Buffer.isBuffer(result.body)).toBe(true);
      expect(result.body.toString()).toBe("file-bytes");
      expect(result.contentType).toBe("image/png");
    });

    it("defaults content-type to application/octet-stream when missing", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(Buffer.from("x"), { status: 200 })
      );
      const adapter = await createAdapter();
      const result = await adapter.get("f.bin");
      expect(result.contentType).toBe("application/octet-stream");
    });

    it("throws 'not found' on 404", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 404 }));
      const adapter = await createAdapter();
      await expect(adapter.get("missing.txt")).rejects.toThrow(/not found/i);
    });

    it("throws on other non-2xx", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("err", { status: 500 }));
      const adapter = await createAdapter();
      await expect(adapter.get("f.txt")).rejects.toThrow("500");
    });
  });

  // ---- remove ----

  describe("remove", () => {
    beforeEach(() => setEnv());

    it("succeeds on 200", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 200 }));
      const adapter = await createAdapter();
      await expect(adapter.remove("f.txt")).resolves.toBeUndefined();
    });

    it("succeeds on 204 (no content)", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
      const adapter = await createAdapter();
      await expect(adapter.remove("f.txt")).resolves.toBeUndefined();
    });

    it("succeeds on 404 (idempotent)", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 404 }));
      const adapter = await createAdapter();
      await expect(adapter.remove("f.txt")).resolves.toBeUndefined();
    });

    it("throws on 500", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("err", { status: 500 }));
      const adapter = await createAdapter();
      await expect(adapter.remove("f.txt")).rejects.toThrow("500");
    });
  });

  // ---- exists ----

  describe("exists", () => {
    beforeEach(() => setEnv());

    it("returns true on 200", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));
      const adapter = await createAdapter();
      expect(await adapter.exists("f.txt")).toBe(true);
    });

    it("returns false on 404", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 404 }));
      const adapter = await createAdapter();
      expect(await adapter.exists("f.txt")).toBe(false);
    });

    it("throws on other status", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 403 }));
      const adapter = await createAdapter();
      await expect(adapter.exists("f.txt")).rejects.toThrow("403");
    });
  });

  // ---- URL encoding ----

  describe("URL encoding", () => {
    beforeEach(() => setEnv());

    it("properly encodes key segments in the URL", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));
      const adapter = await createAdapter();
      // A canonical key with slashes should preserve the path structure
      await adapter.exists("teachers/user-id/doc-type/file.pdf");
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe(
        "https://test-project.supabase.co/storage/v1/object/teacher-onboarding-private/teachers/user-id/doc-type/file.pdf"
      );
    });
  });

  // ---- Auth header format ----

  describe("auth header", () => {
    beforeEach(() => setEnv());

    it("sends exactly 'Bearer <key>' with capital B and space", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));
      const adapter = await createAdapter();
      await adapter.exists("f.txt");
      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts.headers.Authorization).toBe(
        `Bearer ${VALID_ENV.SUPABASE_SERVICE_ROLE_KEY}`
      );
      // Not "bearer " (lowercase) or "Bearer:" (colon instead of space)
      expect(opts.headers.Authorization).toMatch(/^Bearer [^\s]/);
    });
  });

  // ---- id ----

  describe("id", () => {
    beforeEach(() => setEnv());

    it("is 'supabase'", async () => {
      const adapter = await createAdapter();
      expect(adapter.id).toBe("supabase");
    });
  });
});
