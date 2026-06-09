/**
 * Apply all SQL files in ./drizzle in lexicographic order.
 * Idempotent: each migration file uses CREATE ... IF NOT EXISTS.
 *
 * Usage: pnpm db:migrate
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
    process.exit(1);
  }

  const dir = path.resolve("drizzle");
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const files = entries.filter((f) => f.endsWith(".sql")).sort();

  if (files.length === 0) {
    console.log("No migration files found in ./drizzle.");
    return;
  }

  const sql = postgres(url, { max: 1 });
  try {
    for (const file of files) {
      const full = path.join(dir, file);
      const body = await fs.readFile(full, "utf8");
      console.log(`→ applying ${file}`);
      await sql.unsafe(body);
    }
    console.log("✓ migrations applied");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
