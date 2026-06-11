/**
 * Read-only schema probe. Run against the prod DB to confirm the account-
 * activation migration landed and the exact query the app uses succeeds.
 *
 *   DATABASE_URL='<direct 5432 url>' npx tsx scripts/check-schema.ts
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });

  try {
    const cols = await sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'users'
        and column_name in ('must_change_password', 'activated_at')
      order by column_name`;
    console.log("users new columns present:", cols.map((c) => c.column_name));

    const es = await sql`select to_regclass('public.email_settings') as t`;
    console.log("email_settings table:", es[0].t ?? "MISSING");

    const rs = await sql`select to_regclass('public.reminder_settings') as t`;
    console.log("legacy reminder_settings:", rs[0].t ?? "(gone, good)");

    // Exactly the columns the app selects from users on login / pages:
    const probe = await sql`
      select id, email, role, must_change_password, activated_at
      from users limit 1`;
    console.log("users SELECT probe: OK; sample row:", probe[0] ?? "(no rows)");

    const counts = await sql`select role, count(*)::int as n from users group by role`;
    console.log("user counts:", counts);
    console.log("\n==> Schema looks good.");
  } catch (e) {
    console.error("\n==> SCHEMA PROBE FAILED:", e instanceof Error ? e.message : e);
    console.error("   (If this says a column/table does not exist, the migration did not land.)");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
