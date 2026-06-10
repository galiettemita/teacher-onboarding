#!/usr/bin/env node
/**
 * Service-role key leakage check.
 *
 * After `pnpm build` the production bundle is in `.next/`. None of these
 * artifacts may contain:
 *
 *   - the literal value of SUPABASE_SERVICE_ROLE_KEY (from env or
 *     .env.test / .env.local / .env)
 *   - the strings 'service_role', 'service-role', or
 *     'SUPABASE_SERVICE_ROLE_KEY' inside `.next/static/**` (client bundle)
 *
 * The check is mandatory and a release blocker. See docs/SECURITY.md §4.
 *
 * Exits 0 on success, 1 on any match. Also exits 1 if no literal value
 * is available to test against — defence in depth against a
 * misconfigured CI job silently passing. Pass `--skip-literal` to
 * intentionally bypass the literal-value sweep (e.g. for local runs
 * where the dev never set up Supabase).
 */
import fs from "node:fs";
import path from "node:path";

const SKIP_LITERAL = process.argv.includes("--skip-literal");

const ROOT = process.cwd();
const NEXT_DIR = path.join(ROOT, ".next");
const STATIC_DIR = path.join(NEXT_DIR, "static");

const errors = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) {
        // skip cache + ephemeral build dirs that are huge and harmless
        if (e.name === "cache") continue;
        stack.push(p);
      } else if (e.isFile()) {
        out.push(p);
      }
    }
  }
  return out;
}

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

if (!fs.existsSync(NEXT_DIR)) {
  console.error("ERROR: .next/ does not exist. Run `pnpm build` first.");
  process.exit(1);
}

// 1. Sentinel-string scan over the entire .next/ directory.
const SENTINEL_STRINGS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "service_role",
  "service-role",
  // Supabase env var names that must never appear in the client bundle
  "SUPABASE_BUCKET",
  // Phase 6 — email provider secret. RESEND_API_KEY is server-only;
  // a NEXT_PUBLIC_-prefixed variant or a literal echo into a client
  // component would smuggle it into .next/static. The literal value
  // sweep below is the second line of defence.
  "RESEND_API_KEY",
];

const STATIC_FILES = walk(STATIC_DIR);

for (const file of STATIC_FILES) {
  const ext = path.extname(file);
  if (![".js", ".mjs", ".json", ".css", ".html", ".txt", ".map", ""].includes(ext)) continue;
  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const needle of SENTINEL_STRINGS) {
    if (content.includes(needle)) {
      errors.push(
        `Found sentinel '${needle}' in ${path.relative(ROOT, file)}`
      );
    }
  }
}

// 2. Literal-value scan across the WHOLE .next/ directory (server + client).
const envCandidates = [
  path.join(ROOT, ".env.test"),
  path.join(ROOT, ".env.local"),
  path.join(ROOT, ".env"),
];
let literalValue = process.env.SUPABASE_SERVICE_ROLE_KEY;
for (const p of envCandidates) {
  if (literalValue) break;
  const env = loadDotEnv(p);
  if (env.SUPABASE_SERVICE_ROLE_KEY) literalValue = env.SUPABASE_SERVICE_ROLE_KEY;
}

// Also resolve SUPABASE_URL literal for defence-in-depth (not a secret on its
// own, but if it leaks alongside the service-role key it narrows the attack).
let supabaseUrlLiteral = process.env.SUPABASE_URL;
for (const p of envCandidates) {
  if (supabaseUrlLiteral) break;
  const env = loadDotEnv(p);
  if (env.SUPABASE_URL) supabaseUrlLiteral = env.SUPABASE_URL;
}

if (literalValue && literalValue.length >= 16) {
  const ALL_FILES = walk(NEXT_DIR);
  for (const file of ALL_FILES) {
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (content.includes(literalValue)) {
      errors.push(
        `Found literal SUPABASE_SERVICE_ROLE_KEY value in ${path.relative(ROOT, file)}`
      );
    }
    // Defence-in-depth: also check for SUPABASE_URL literal in client bundle.
    if (
      supabaseUrlLiteral &&
      supabaseUrlLiteral.length >= 10 &&
      file.startsWith(STATIC_DIR) &&
      content.includes(supabaseUrlLiteral)
    ) {
      errors.push(
        `Found literal SUPABASE_URL value in ${path.relative(ROOT, file)}`
      );
    }
  }
} else if (SKIP_LITERAL) {
  console.warn(
    "[leakage] --skip-literal set — skipping literal-value sweep (sentinel-string sweep still ran)."
  );
  // Still check SUPABASE_URL in static if available (even with --skip-literal)
  if (supabaseUrlLiteral && supabaseUrlLiteral.length >= 10) {
    for (const file of STATIC_FILES) {
      let content;
      try {
        content = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (content.includes(supabaseUrlLiteral)) {
        errors.push(
          `Found literal SUPABASE_URL value in ${path.relative(ROOT, file)}`
        );
      }
    }
  }
} else {
  console.error(
    "[leakage] FAIL: no SUPABASE_SERVICE_ROLE_KEY available in env or .env.* files."
  );
  console.error(
    "  The literal-value sweep cannot run, so we cannot prove the key is not bundled."
  );
  console.error(
    "  Either set SUPABASE_SERVICE_ROLE_KEY (CI must do this) or pass --skip-literal"
  );
  console.error(
    "  to intentionally bypass the sweep (local-only)."
  );
  process.exit(1);
}

// 3. Phase 6 — RESEND_API_KEY literal sweep over .next/static/**.
//    The sentinel-string sweep above already catches the variable name;
//    this sweep catches the literal value (a real attacker exfil vector
//    if the secret got string-interpolated into a client component).
//    We scan ONLY .next/static/** because the server bundle is allowed
//    to mention the secret (process.env reads, etc).
let resendApiKeyLiteral = process.env.RESEND_API_KEY;
for (const p of envCandidates) {
  if (resendApiKeyLiteral) break;
  const env = loadDotEnv(p);
  if (env.RESEND_API_KEY) resendApiKeyLiteral = env.RESEND_API_KEY;
}

if (resendApiKeyLiteral && resendApiKeyLiteral.length >= 16) {
  for (const file of STATIC_FILES) {
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (content.includes(resendApiKeyLiteral)) {
      errors.push(
        `Found literal RESEND_API_KEY value in ${path.relative(ROOT, file)}`
      );
    }
  }
} else if (!SKIP_LITERAL) {
  // RESEND_API_KEY is optional (default provider is `console`), so we
  // don't hard-fail when it's absent — but we DO log so CI can confirm
  // the sweep actually had something to look for when EMAIL_PROVIDER=resend.
  console.warn(
    "[leakage] note: RESEND_API_KEY not set; skipped literal-value sweep for it."
  );
}

if (errors.length > 0) {
  console.error("FAIL: secret leakage check found matches:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

console.log("PASS: no secret leakage detected in .next/");
process.exit(0);
