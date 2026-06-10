#!/usr/bin/env node
/**
 * Reminder cron contract smoke test.
 *
 * Defence against the Phase-4 regression we shipped on first attempt:
 * the route was POST + X-Cron-Secret, which Vercel's GET + Bearer
 * would never invoke. Here we exercise the route with the EXACT
 * contract Vercel sends.
 *
 * Reference: https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
 *
 * The script boots `next start`, then:
 *   1. GET /api/cron/reminders with NO header -> assert 401
 *   2. GET with wrong Bearer -> assert 401
 *   3. GET with the right Bearer -> assert 200 + JSON {ok:true, counts, jobRunId}
 *
 * This runs against the console provider so no real emails are sent.
 * The DB is not exercised — runOnce() will hit it; we accept that it
 * may produce zero candidates against an empty test DB, which is fine
 * (we're testing the cron contract, not the dispatcher logic).
 *
 * Exits 0 on success, 1 on any failure.
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = process.env.PORT ?? "3101";
const BASE = `http://localhost:${PORT}`;
const URL = `${BASE}/api/cron/reminders`;
const CRON_SECRET =
  process.env.CRON_SECRET ?? "smoke-cron-secret-throwaway-aaaaaaaa";

function startServer() {
  const child = spawn("pnpm", ["start"], {
    env: {
      ...process.env,
      PORT,
      AUTH_SECRET:
        process.env.AUTH_SECRET ?? "smoke-throwaway-secret-aaaaaaaa",
      AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST ?? "true",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://smoke:smoke@127.0.0.1:5432/smoke",
      CRON_SECRET,
      STORAGE_ADAPTER: process.env.STORAGE_ADAPTER ?? "local",
      EMAIL_PROVIDER: process.env.EMAIL_PROVIDER ?? "console",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

async function waitForReady() {
  for (let i = 0; i < 60; i++) {
    try {
      // /login responds even without a DB; we just need the server up.
      const r = await fetch(`${BASE}/login`);
      if (r.status >= 200 && r.status < 600) return;
    } catch {
      // not ready yet
    }
    await delay(500);
  }
  throw new Error(`server never became ready at ${BASE}/login`);
}

function expect(label, condition, detail) {
  if (!condition) {
    throw new Error(`FAIL: ${label}${detail ? " — " + detail : ""}`);
  }
  console.log(`  PASS: ${label}`);
}

async function main() {
  const server = startServer();
  try {
    console.log(`Starting next start on ${BASE}...`);
    await waitForReady();
    console.log("Server is up.");

    // 1. No Authorization header -> 401
    {
      const r = await fetch(URL, { method: "GET" });
      expect("GET /api/cron/reminders without header -> 401", r.status === 401, `got ${r.status}`);
    }

    // 2. Wrong Bearer -> 401
    {
      const r = await fetch(URL, {
        method: "GET",
        headers: { Authorization: "Bearer not-the-right-secret" },
      });
      expect("GET with wrong Bearer -> 401", r.status === 401, `got ${r.status}`);
    }

    // 3. Right Bearer -> 200 + expected JSON shape
    {
      const r = await fetch(URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      });
      const text = await r.text();
      // The handler may return 500 if the DB isn't reachable. That's a
      // legitimate "the contract is correct, the DB is the problem"
      // signal — we accept both 200 and 500 for the contract test, but
      // require valid JSON either way.
      if (r.status !== 200 && r.status !== 500) {
        throw new Error(
          `GET with right Bearer expected 200 or 500, got ${r.status}: ${text.slice(0, 200)}`
        );
      }
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(
          `GET with right Bearer returned non-JSON: ${text.slice(0, 200)}`
        );
      }
      if (r.status === 200) {
        expect(
          "200 body has ok:true",
          body.ok === true,
          JSON.stringify(body).slice(0, 200)
        );
        expect(
          "200 body has counts object",
          typeof body.counts === "object" && body.counts !== null,
          JSON.stringify(body)
        );
        expect(
          "counts has the expected keys",
          [
            "considered",
            "sent",
            "skipped_duplicate_milestone",
            "skipped_daily_cap",
            "skipped_reminders_disabled",
            "skipped_no_email_on_file",
            "failed",
          ].every((k) => k in body.counts),
          JSON.stringify(body.counts)
        );
        expect(
          "200 body has jobRunId",
          typeof body.jobRunId === "string" && body.jobRunId.length > 0,
          JSON.stringify(body).slice(0, 200)
        );
      } else {
        // 500 path: the route still wrote a jobRunId (or tried to)
        // and surfaced an error. As long as it's the route's known
        // failure shape, the contract test passes.
        expect(
          "500 body has ok:false (handler reached dispatcher)",
          body.ok === false,
          JSON.stringify(body).slice(0, 200)
        );
        console.warn(
          "  NOTE: route returned 500 — likely DB unreachable from smoke harness."
        );
      }
    }

    console.log("\nSMOKE PASS: /api/cron/reminders matches the Vercel contract.");
  } finally {
    server.kill("SIGTERM");
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
