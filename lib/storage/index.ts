/**
 * Storage adapter interface.
 *
 * All file I/O in the app MUST go through this interface. Routes never
 * touch the filesystem or cloud SDK directly. This makes Phase 1's local
 * adapter swappable for Supabase Storage / S3 / R2 later without
 * changing any route handler.
 *
 * Security rules enforced by every adapter:
 *  - No public URLs. Reads always return a stream / Buffer to the server.
 *  - Keys are server-generated (UUID-based), never user-supplied filenames.
 *  - The bucket / directory is private. Never exposed to the client.
 */
export interface StorageAdapter {
  /** Persist bytes under the given server-generated key. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Read all bytes for the given key. Throws if missing. */
  get(key: string): Promise<{ body: Buffer; contentType: string }>;
  /** Permanently remove an object. Used by admin tooling only. */
  remove(key: string): Promise<void>;
  /** True if the object exists. */
  exists(key: string): Promise<boolean>;
  /** Human-readable adapter id, for logs / health checks. */
  readonly id: "local" | "supabase" | "s3";
}

import { LocalStorageAdapter } from "./local";

let _instance: StorageAdapter | null = null;

/** Lazily instantiate the configured adapter. */
export function getStorage(): StorageAdapter {
  if (_instance) return _instance;
  const which = (process.env.STORAGE_ADAPTER ?? "local").toLowerCase();
  switch (which) {
    case "local":
      _instance = new LocalStorageAdapter(process.env.LOCAL_STORAGE_DIR ?? "./.uploads");
      return _instance;
    // case "supabase": _instance = new SupabaseStorageAdapter(...); return _instance;
    default:
      throw new Error(`Unknown STORAGE_ADAPTER: ${which}`);
  }
}

/**
 * Build the canonical storage key for a teacher document.
 * Caller is responsible for generating the UUID with crypto.randomUUID().
 */
export function buildStorageKey(args: {
  userId: string;
  documentTypeId: string;
  uuid: string;
  ext: string;
}): string {
  const ext = args.ext.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 5);
  return `teachers/${args.userId}/${args.documentTypeId}/${args.uuid}.${ext}`;
}
