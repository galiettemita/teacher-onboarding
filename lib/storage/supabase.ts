import type { StorageAdapter } from "./index";

/**
 * SupabaseStorageAdapter — **PRODUCTION**.
 *
 * Talks to Supabase Storage's HTTP REST API using the service-role key.
 * Server-side only. Uses global `fetch` (Node 20+). Zero runtime deps.
 *
 * Env vars consumed (never prefixed with NEXT_PUBLIC_):
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 *  - SUPABASE_BUCKET
 */
export class SupabaseStorageAdapter implements StorageAdapter {
  readonly id = "supabase" as const;

  private readonly url: string;
  private readonly key: string;
  private readonly bucket: string;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_BUCKET;

    if (!url) throw new Error("Missing required env var: SUPABASE_URL");
    if (!key) throw new Error("Missing required env var: SUPABASE_SERVICE_ROLE_KEY");
    if (!bucket) throw new Error("Missing required env var: SUPABASE_BUCKET");

    this.url = url.replace(/\/+$/, ""); // strip trailing slash
    this.key = key;
    this.bucket = bucket;
  }

  // ---------- key validation ----------

  private static readonly SAFE_KEY = /^[A-Za-z0-9._/-]+$/;

  private validateKey(key: string): void {
    if (!key || key.startsWith("/") || key.includes("..") || !SupabaseStorageAdapter.SAFE_KEY.test(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
  }

  /**
   * Encode each path segment of the key individually so that forward-slashes
   * inside keys become path separators (Supabase treats them that way) while
   * other special characters are percent-encoded.
   */
  private encodedKeyPath(key: string): string {
    return key
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
  }

  private objectUrl(key: string): string {
    return `${this.url}/storage/v1/object/${this.bucket}/${this.encodedKeyPath(key)}`;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.key}` };
  }

  // ---------- interface methods ----------

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.validateKey(key);
    const res = await fetch(this.objectUrl(key), {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": contentType,
        // Supabase upsert mode – avoids 409 if key already exists
        "x-upsert": "true",
      },
      body: new Uint8Array(body),
    });
    if (!res.ok) {
      const snippet = (await res.text()).slice(0, 200);
      throw new Error(
        `Supabase Storage PUT failed (${res.status}): ${snippet}`
      );
    }
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string }> {
    this.validateKey(key);
    const res = await fetch(this.objectUrl(key), {
      method: "GET",
      headers: this.authHeaders(),
    });
    if (res.status === 404) {
      throw new Error(`not found: ${key}`);
    }
    if (!res.ok) {
      const snippet = (await res.text()).slice(0, 200);
      throw new Error(
        `Supabase Storage GET failed (${res.status}): ${snippet}`
      );
    }
    const ct = res.headers.get("content-type") ?? "application/octet-stream";
    const buf = Buffer.from(await res.arrayBuffer());
    return { body: buf, contentType: ct };
  }

  async remove(key: string): Promise<void> {
    this.validateKey(key);
    const res = await fetch(this.objectUrl(key), {
      method: "DELETE",
      headers: this.authHeaders(),
    });
    // Idempotent: 200, 204, and 404 are all success.
    if (res.ok || res.status === 404) return;
    const snippet = (await res.text()).slice(0, 200);
    throw new Error(
      `Supabase Storage DELETE failed (${res.status}): ${snippet}`
    );
  }

  async exists(key: string): Promise<boolean> {
    this.validateKey(key);
    const res = await fetch(this.objectUrl(key), {
      method: "HEAD",
      headers: this.authHeaders(),
    });
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    throw new Error(
      `Supabase Storage HEAD failed (${res.status})`
    );
  }
}
