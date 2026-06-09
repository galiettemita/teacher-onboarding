import { promises as fs } from "node:fs";
import path from "node:path";
import type { StorageAdapter } from "./index";

/**
 * LocalStorageAdapter — **DEVELOPMENT ONLY**.
 *
 * Writes files to a private directory on disk (default ./.uploads, gitignored).
 * Production deployments MUST use a cloud adapter (Supabase Storage / S3 / R2)
 * with a private bucket. Deploying with this adapter is forbidden per
 * PROJECT_CONTEXT.md §2.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly id = "local" as const;
  private readonly root: string;

  constructor(rootDir: string) {
    // Resolve relative to project cwd so behavior is predictable.
    this.root = path.resolve(rootDir);
    if (process.env.NODE_ENV === "production") {
      // Loud, intentional refusal. Foot-gun prevention.
      // (Storage is only instantiated on first use, so this only fires when
      //  someone tries to actually move bytes through the local adapter in prod.)
      // eslint-disable-next-line no-console
      console.warn(
        "[storage] LocalStorageAdapter is enabled in production. " +
          "This is unsupported. Switch STORAGE_ADAPTER to a cloud adapter."
      );
    }
  }

  private fullPath(key: string): string {
    // Defense in depth: reject keys that try to escape the root.
    if (key.includes("..") || path.isAbsolute(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return path.join(this.root, key);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const full = this.fullPath(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, { mode: 0o600 });
    // Sidecar so we can recover the original Content-Type without trusting the FS.
    await fs.writeFile(full + ".meta", JSON.stringify({ contentType }), { mode: 0o600 });
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string }> {
    const full = this.fullPath(key);
    const body = await fs.readFile(full);
    let contentType = "application/octet-stream";
    try {
      const meta = JSON.parse(await fs.readFile(full + ".meta", "utf8"));
      if (typeof meta.contentType === "string") contentType = meta.contentType;
    } catch {
      // sidecar missing — fall through with default
    }
    return { body, contentType };
  }

  async remove(key: string): Promise<void> {
    const full = this.fullPath(key);
    await fs.rm(full, { force: true });
    await fs.rm(full + ".meta", { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.fullPath(key));
      return true;
    } catch {
      return false;
    }
  }
}
