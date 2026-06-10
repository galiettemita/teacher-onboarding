import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("storage adapter selection via getStorage()", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up env
    delete process.env.STORAGE_ADAPTER;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_BUCKET;
    delete process.env.LOCAL_STORAGE_DIR;
  });

  it('returns the local adapter when STORAGE_ADAPTER=local', async () => {
    process.env.STORAGE_ADAPTER = "local";
    process.env.LOCAL_STORAGE_DIR = "./.uploads-test";
    const { getStorage } = await import("@/lib/storage/index");
    const storage = getStorage();
    expect(storage.id).toBe("local");
  });

  it('returns the supabase adapter when STORAGE_ADAPTER=supabase with all vars set', async () => {
    process.env.STORAGE_ADAPTER = "supabase";
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key-value";
    process.env.SUPABASE_BUCKET = "test-bucket";
    const { getStorage } = await import("@/lib/storage/index");
    const storage = getStorage();
    expect(storage.id).toBe("supabase");
  });

  it('throws when STORAGE_ADAPTER=supabase but SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    process.env.STORAGE_ADAPTER = "supabase";
    process.env.SUPABASE_URL = "https://test.supabase.co";
    // SUPABASE_SERVICE_ROLE_KEY intentionally NOT set
    process.env.SUPABASE_BUCKET = "test-bucket";
    const { getStorage } = await import("@/lib/storage/index");
    expect(() => getStorage()).toThrow("SUPABASE_SERVICE_ROLE_KEY");
  });

  it('throws when STORAGE_ADAPTER=supabase but SUPABASE_URL is missing', async () => {
    process.env.STORAGE_ADAPTER = "supabase";
    // SUPABASE_URL intentionally NOT set
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.SUPABASE_BUCKET = "test-bucket";
    const { getStorage } = await import("@/lib/storage/index");
    expect(() => getStorage()).toThrow("SUPABASE_URL");
  });

  it('throws on unknown STORAGE_ADAPTER value', async () => {
    process.env.STORAGE_ADAPTER = "unknown-adapter";
    const { getStorage } = await import("@/lib/storage/index");
    expect(() => getStorage()).toThrow("Unknown STORAGE_ADAPTER");
  });

  it('defaults to local when STORAGE_ADAPTER is not set', async () => {
    delete process.env.STORAGE_ADAPTER;
    process.env.LOCAL_STORAGE_DIR = "./.uploads-test";
    const { getStorage } = await import("@/lib/storage/index");
    const storage = getStorage();
    expect(storage.id).toBe("local");
  });
});
