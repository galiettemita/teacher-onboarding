/**
 * Create or update a single allow-listed user (idempotent).
 *
 * Unlike `scripts/seed.ts`, this script:
 *   - creates ONLY the one user named in the env vars (no sample teachers,
 *     no document types — those are handled by `db:seed` or by the admin
 *     UI in production)
 *   - is safe to run repeatedly: each invocation re-hashes the password and
 *     upserts on email, so it doubles as a password-reset tool
 *   - prints exactly what it did (created vs. updated) so the operator
 *     can verify
 *
 * Required env vars:
 *   DATABASE_URL     — Postgres connection string (Supabase URI mode)
 *   ADMIN_EMAIL      — email for the user
 *   ADMIN_PASSWORD   — plaintext password (will be bcrypt-hashed, never stored raw)
 *
 * Optional env vars:
 *   ADMIN_NAME       — display name (default: derived from email local-part)
 *   ADMIN_ROLE       — 'admin' or 'teacher' (default: 'admin')
 *
 * Usage:
 *   DATABASE_URL='postgres://...' \
 *   ADMIN_EMAIL='you@example.com' \
 *   ADMIN_PASSWORD='your-password' \
 *   npx tsx scripts/seed-admin-only.ts
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

type Role = "admin" | "teacher";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`ERROR: ${name} is required.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  // Validate required env up front so we never half-run.
  requireEnv("DATABASE_URL");
  const rawEmail = requireEnv("ADMIN_EMAIL");
  const password = requireEnv("ADMIN_PASSWORD");

  const email = rawEmail.trim().toLowerCase();
  const role: Role = process.env.ADMIN_ROLE === "teacher" ? "teacher" : "admin";
  const name = process.env.ADMIN_NAME?.trim() || email.split("@")[0];

  // Defence in depth: warn loudly on obviously weak passwords. We don't
  // *block* — the operator may be seeding a dev environment intentionally —
  // but a noisy warning is the right default.
  if (password.length < 12) {
    console.warn(
      `[warn] ADMIN_PASSWORD is ${password.length} chars. Consider 12+ for production.`
    );
  }

  // Sanity check: the users table must exist. If migrations haven't run
  // this query throws, and the message we print is more actionable than
  // the raw Postgres error.
  try {
    await db.select({ id: users.id }).from(users).limit(1);
  } catch (err) {
    console.error(
      "ERROR: cannot read from `users` table. Did you run `npm run db:migrate` first?"
    );
    console.error(err);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(users)
      .set({
        name,
        role,
        passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing[0].id));
    console.log(`✓ updated existing user  email=${email}  role=${role}  name=${name}`);
  } else {
    await db.insert(users).values({
      email,
      name,
      role,
      passwordHash,
      emailVerified: new Date(),
    });
    console.log(`✓ created new user       email=${email}  role=${role}  name=${name}`);
  }

  console.log("");
  console.log("  Log in at /login with the email + password above.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
