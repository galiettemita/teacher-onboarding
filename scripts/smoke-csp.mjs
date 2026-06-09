#!/usr/bin/env node
/**
 * Browser-smoke equivalent for CSP nonce wiring.
 *
 * This catches the bug we shipped on the first attempt: a CSP that
 * blocks Next.js's inline RSC hydration scripts. Spinning up Playwright
 * or @vitest/browser would catch it too, but adds a heavy dep. Instead
 * we do the minimum a browser would do:
 *
 *   1. Boot `next start` (assumes `pnpm build` already ran).
 *   2. Fetch /login.
 *   3. Parse Content-Security-Policy.
 *   4. Parse every inline <script> tag (no `src=` attribute).
 *   5. Confirm CSP carries 'strict-dynamic' OR 'unsafe-inline' OR each
 *      inline script has a matching `nonce="…"` that appears in
 *      script-src.
 *
 * Exits 0 on success, 1 on any failure.
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = process.env.PORT ?? "3100";
const URL = `http://localhost:${PORT}/login`;

function startServer() {
  const child = spawn("pnpm", ["start"], {
    env: {
      ...process.env,
      PORT,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "smoke-throwaway-secret-aaaaaaaa",
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgres://smoke:smoke@127.0.0.1:5432/smoke",
      CRON_SECRET: process.env.CRON_SECRET ?? "smoke-cron",
      STORAGE_ADAPTER: process.env.STORAGE_ADAPTER ?? "local",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

async function waitForReady() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(URL);
      if (r.status >= 200 && r.status < 500) return;
    } catch {
      // not ready yet
    }
    await delay(500);
  }
  throw new Error(`server never became ready at ${URL}`);
}

async function main() {
  const server = startServer();
  try {
    await waitForReady();
    const res = await fetch(URL);
    const csp = res.headers.get("content-security-policy") ?? "";
    const body = await res.text();

    if (!csp) throw new Error("no CSP header on /login");

    // Isolate the script-src directive so 'unsafe-inline' on style-src
    // doesn't fool us into thinking inline JS is allowed.
    const scriptSrcMatch = /(?:^|;)\s*script-src([^;]*)/.exec(csp);
    const scriptSrc = scriptSrcMatch?.[1] ?? "";
    const headerNonceMatch = /nonce-([A-Za-z0-9+/=]+)/.exec(scriptSrc);
    const hasUnsafeInline = /\s'unsafe-inline'/.test(scriptSrc);

    // Inline = <script>…</script> with no src attribute.
    const inlineScripts =
      body.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) ?? [];
    // Externally-loaded scripts (with src=). We require they also carry
    // a nonce when 'strict-dynamic' is set.
    const externalScripts = body.match(/<script[^>]*\bsrc=[^>]*>/g) ?? [];

    const allScripts = [...inlineScripts, ...externalScripts];
    if (allScripts.length === 0) {
      throw new Error("no <script> tags rendered on /login — page broken?");
    }

    if (hasUnsafeInline) {
      console.log(
        "PASS: CSP includes 'unsafe-inline'; inline scripts will execute."
      );
      console.log(`  Found ${allScripts.length} script tags.`);
      return;
    }

    if (!headerNonceMatch) {
      throw new Error(
        "CSP has no nonce and no 'unsafe-inline'; inline scripts would be blocked.\n  CSP: " +
          csp
      );
    }
    const headerNonce = headerNonceMatch[1];

    const offenders = [];
    for (const tag of allScripts) {
      const tagNonceMatch = /\bnonce=(?:"([^"]+)"|'([^']+)')/.exec(tag);
      const tagNonce = tagNonceMatch?.[1] ?? tagNonceMatch?.[2];
      if (!tagNonce) {
        offenders.push("missing nonce: " + tag.slice(0, 120));
      } else if (tagNonce !== headerNonce) {
        offenders.push(
          `nonce mismatch (header=${headerNonce} tag=${tagNonce}): ` +
            tag.slice(0, 120)
        );
      }
    }

    if (offenders.length > 0) {
      console.error(
        "FAIL: scripts that the browser would refuse to execute under the CSP:"
      );
      for (const o of offenders) console.error("  - " + o);
      throw new Error(`${offenders.length} script(s) would be blocked`);
    }

    console.log(
      `PASS: ${allScripts.length} script tags all carry a matching CSP nonce.`
    );
  } finally {
    server.kill("SIGTERM");
    // give it a moment to release the port
    await delay(300).catch(() => {});
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err?.stack ?? err);
    process.exit(1);
  }
);
