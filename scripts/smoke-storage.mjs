#!/usr/bin/env node
/**
 * Production-path smoke test for Supabase Storage adapter.
 *
 * Performs a real round-trip against a live Supabase bucket:
 *   1. put  → upload a small payload
 *   2. exists → true
 *   3. get  → returns same bytes and content-type
 *   4. remove → deletes the object
 *   5. exists → false
 *
 * Operator-run only — requires real SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * and SUPABASE_BUCKET env vars. Not added to CI (no creds in CI). Run
 * manually after provisioning a Supabase project:
 *
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   SUPABASE_BUCKET=teacher-onboarding-private \
 *   pnpm test:smoke:storage
 *
 * Exits 0 on success or when skipping (no env vars).
 * Exits 1 with a clear message on any failure.
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_BUCKET;

if (!url || !key || !bucket) {
  console.log("SKIP: no SUPABASE_* env vars — set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_BUCKET to run this smoke test.");
  process.exit(0);
}

// Set env so the adapter constructor can read them
process.env.STORAGE_ADAPTER = "supabase";

async function main() {
  // Dynamic import to pick up env vars
  const { SupabaseStorageAdapter } = await import("../lib/storage/supabase.ts");
  const adapter = new SupabaseStorageAdapter();

  const timestamp = new Date().toISOString();
  const testKey = `smoke/${timestamp.replace(/[:.]/g, "-")}.txt`;
  const payload = Buffer.from(`storage-smoke-${timestamp}`);
  const contentType = "text/plain";

  console.log(`[smoke] key: ${testKey}`);

  // 1. put
  console.log("[smoke] put...");
  await adapter.put(testKey, payload, contentType);
  console.log("[smoke] put OK");

  // 2. exists → true
  console.log("[smoke] exists (expect true)...");
  const existsAfterPut = await adapter.exists(testKey);
  if (!existsAfterPut) {
    console.error("FAIL: exists returned false after put");
    process.exit(1);
  }
  console.log("[smoke] exists OK (true)");

  // 3. get → same bytes + content-type
  console.log("[smoke] get...");
  const got = await adapter.get(testKey);
  if (!got.body.equals(payload)) {
    console.error(
      `FAIL: get body mismatch. Expected ${payload.toString()}, got ${got.body.toString()}`
    );
    process.exit(1);
  }
  // Supabase may return e.g. "text/plain; charset=utf-8", so startsWith check
  if (!got.contentType.startsWith("text/plain")) {
    console.error(
      `FAIL: content-type mismatch. Expected text/plain*, got ${got.contentType}`
    );
    process.exit(1);
  }
  console.log("[smoke] get OK");

  // 4. remove
  console.log("[smoke] remove...");
  await adapter.remove(testKey);
  console.log("[smoke] remove OK");

  // 5. exists → false
  console.log("[smoke] exists (expect false)...");
  const existsAfterRemove = await adapter.exists(testKey);
  if (existsAfterRemove) {
    console.error("FAIL: exists returned true after remove");
    process.exit(1);
  }
  console.log("[smoke] exists OK (false)");

  console.log("[smoke] ALL PASSED ✓");
}

main().catch((err) => {
  console.error("FAIL:", err.message || err);
  process.exit(1);
});
