#!/usr/bin/env node
/**
 * Service-role key leakage check.
 *
 * After `pnpm build` the production bundle is in `.next/`. None of these
 * artifacts may contain:
 *
 *   - the literal value of SUPABASE_SERVICE_ROLE_KEY from .env.test (if set)
 *   - the strings 'service_role', 'service-role', or
 *     'SUPABASE_SERVICE_ROLE_KEY' inside `.next/static/**` (client bundle)
 *
 * The check is mandatory and a release blocker. See docs/SECURITY.md §4.
 *
 * Exits 0 on success, 1 on any match.
 */
import fs from "node:fs";
import path from "node:path";

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
  }
} else {
  console.warn(
    "[leakage] SUPABASE_SERVICE_ROLE_KEY not set in env or .env.test — skipping literal-value sweep."
  );
}

if (errors.length > 0) {
  console.error("FAIL: service-role key leakage check found matches:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

console.log("PASS: no service-role key leakage detected in .next/");
process.exit(0);
