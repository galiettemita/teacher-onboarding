# Deployment guide

Target platforms: **Vercel** (recommended) for the Next.js app, **Supabase** for
Postgres + private Storage. Any platform that runs a Node 20+ Next.js app and
gives you a managed Postgres + an S3-compatible private bucket also works.

This guide covers a clean deploy. For local development see [`README.md`](../README.md).

---

## 1. Supabase setup

1. Create a new project in [Supabase](https://supabase.com).
2. Wait for Postgres to provision. Note the connection string from
   *Project Settings → Database → Connection string → URI*.
   - For the app runtime, use the **pooler** URL on port `6543` (`?pgbouncer=true&connection_limit=1`).
   - For migrations (`pnpm db:migrate`) use the **direct** URL on port `5432`.
3. *Project Settings → API*: copy the **service role key** (used server-side
   only) and the **anon key** (not used by this app — Auth.js owns sessions —
   keep it secret anyway).
4. *Storage → Create bucket*:
   - Name: `teacher-onboarding-private` (or whatever you set `SUPABASE_BUCKET` to).
   - **Public bucket: OFF.** This is non-negotiable. The bucket must never be
     public. The app streams bytes server-side; no client ever talks to
     storage directly.
   - *Configuration*: leave default policies disabled. We do not use Supabase
     RLS — application code is the only thing that authorises reads/writes.
5. Apply the schema:
   ```bash
   DATABASE_URL='<direct postgres URL>' pnpm db:migrate
   ```
6. Seed the first admin (optional, but you need at least one):
   ```bash
   DATABASE_URL='<direct postgres URL>' \
   SEED_ADMIN_EMAIL="you@school.org" \
   SEED_ADMIN_PASSWORD="$(openssl rand -base64 18)" \
   pnpm db:seed
   ```
   Capture the password — you'll share it with the admin out-of-band, then
   they should change it.

## 2. Environment variables

Set these in your deployment platform (Vercel → *Project Settings → Environment
Variables*). Mark all of them **Encrypted** unless noted.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Pooler URL (`6543`). The runtime uses this. |
| `AUTH_SECRET` | yes | `openssl rand -base64 32`. |
| `AUTH_URL` | yes (prod) | Public origin, e.g. `https://onboarding.school.org`. |
| `AUTH_TRUST_HOST` | no | Leave unset in production. Set to `true` only behind a trusted reverse proxy you control. |
| `STORAGE_ADAPTER` | yes | `supabase` in production. `local` is **forbidden** outside dev. |
| `SUPABASE_URL` | yes | Project URL, e.g. `https://xyz.supabase.co`. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Never** expose in client code; never prefix with `NEXT_PUBLIC_`. |
| `SUPABASE_BUCKET` | yes | Bucket name (`teacher-onboarding-private` by default). |
| `CRON_SECRET` | yes | Long random string (≥32 bytes). Vercel Cron sends it as `Authorization: Bearer …`. |
| `EXPIRING_SOON_WINDOW_DAYS` | no | Integer days (default `30`). |

> **No email configuration is needed.** The portal sends no email. Teacher
> invitations are manual: inviting a teacher returns a login URL, a one-time
> temporary password, and a copyable invitation message that the admin
> delivers out-of-band (copy/paste).

### Never log or echo these

`AUTH_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `CRON_SECRET`.
The build-time leakage check (`pnpm test:leakage`) catches accidental
embedding of the service-role key in the client bundle. See
[`SECURITY.md`](./SECURITY.md) §4.

## 3. Cron configuration

The daily expiry sweep runs once a day, invoked by Vercel Cron with HTTP GET and
`Authorization: Bearer ${CRON_SECRET}` (see
[the Vercel docs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)).
It flips past-due `approved` rows to `expired`.

### Vercel Cron

`vercel.json` is already in the repo. Confirm the schedule:

```json
{
  "crons": [
    { "path": "/api/cron/expiry", "schedule": "0 7 * * *" }
  ]
}
```

Vercel injects the `Authorization: Bearer ${CRON_SECRET}` header
automatically when `CRON_SECRET` is set as an environment variable.

### Self-hosted (node-cron, systemd, k8s CronJob, …)

```bash
curl -fsS -X GET \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://onboarding.school.org/api/cron/expiry"
```

The route is idempotent — re-runs in the same day produce zero new
state changes.

## 4. Deploy checklist

Run through this list before flipping DNS. Every box must be checked.

- [ ] **Database**: migrations applied, seed run, at least one admin row exists.
- [ ] **Storage**: bucket exists, *Public bucket = OFF*, service-role key in
      env, app boots with `STORAGE_ADAPTER=supabase`.
- [ ] **Auth**: `AUTH_SECRET` set, login works, session cookie is `HttpOnly`,
      `Secure`, `SameSite=Lax`.
- [ ] **Cron**: `CRON_SECRET` set, `vercel.json` registers
      `/api/cron/expiry`, manual `curl` to the endpoint with the secret
      returns 200.
- [ ] **Invitations**: no email configuration required — invitations are
      manual. Confirm an admin can invite a teacher and receives a login URL,
      a one-time temporary password, and a copyable invitation message to
      deliver out-of-band.
- [ ] **Headers**: `curl -I https://your-site/login` shows
      `Strict-Transport-Security`, `Content-Security-Policy`,
      `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
      `Referrer-Policy`, `Permissions-Policy`.
- [ ] **Rate limits**: a quick fast-loop against `/api/auth/signin` from one IP
      returns `429` with `Retry-After` once the budget is exhausted.
- [ ] **Tests**: CI is green on the merge commit. The required suites:
      `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:unit`,
      `pnpm test:integration`, `pnpm test:leakage`.
- [ ] **Reports**: log in as admin, download both CSVs from
      `/admin/reports`, confirm row counts match the dashboard tiles.
- [ ] **Audit viewer**: log in as admin, visit `/admin/audit`, paginate at
      least one page, apply at least one filter.
- [ ] **Backups**: Supabase automated backups enabled. Schedule documented in
      runbook. Recovery tested at least once in a staging environment.

## 5. Production hygiene

- **Secrets rotation**: rotate `AUTH_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`
  on a calendar cadence (twice a year is fine for this app) and immediately
  on any compromise. Rotating `AUTH_SECRET` invalidates existing sessions —
  expected.
- **Dependency updates**: keep Next.js, Auth.js, and Drizzle within one
  major version of the latest stable. Renovate / Dependabot is sufficient.
- **Database**: enable point-in-time recovery in Supabase. Plan a quarterly
  restore drill in a separate project.
- **Logs**: Vercel keeps stdout/stderr from route handlers. Audit history
  lives in the DB (`audit_logs`) — that's authoritative.

## 6. Rollback

If a deploy breaks production:

1. Vercel: *Deployments → previous green deploy → Promote to Production*.
2. If the database schema changed in the bad release, run the **reverse**
   migration script before promoting back. Drizzle migrations are
   append-only; a destructive rollback may require a manual SQL fix.
   Drill this in staging before relying on it.
3. Notify everyone with portal access — sessions issued under a rotated
   `AUTH_SECRET` are invalid; users will need to log in again.

See [`SECURITY.md`](./SECURITY.md) §6 for the incident-response runbook.
