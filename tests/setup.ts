// Vitest global setup. Loaded once per worker.
// We intentionally avoid importing app code here so individual tests can
// mock modules before they're touched.
process.env.AUTH_SECRET ??= "test-secret-not-for-production";
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.STORAGE_ADAPTER ??= "local";
process.env.LOCAL_STORAGE_DIR ??= "./.uploads-test";
