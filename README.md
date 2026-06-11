# Teacher Onboarding Portal

A simple, grandma-friendly elementary school teacher onboarding paperwork portal.

> **Status:** Phases 1–5 merged. Auth, schema, storage, teacher upload, admin
> review, renewal tracking, CSV reports, audit-log viewer, rate limiting,
> security headers, full test suite.

See [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) for the full architecture and
rules. That document is the source of truth. For deployment see
[`docs/DEPLOY.md`](./docs/DEPLOY.md). For the security model and incident
response, [`docs/SECURITY.md`](./docs/SECURITY.md).

---

## What works today

- **Teachers** can log in, see their required document checklist with
  derived statuses (`missing`, `pending`, `approved`, `rejected`, `expired`,
  `expiring_soon`), upload PDFs, and download their own files.
- **Admins** can list every teacher, drill into one teacher's documents,
  approve or reject uploads (with a reason), manage the document-type
  catalog, invite new teachers, **export completion + expiry CSV reports**,
  and **browse the audit log**.
- **Renewal** is automatic: approving a doc sets `expires_at = reviewed_at +
  renewal_months`. A daily cron sweeps past-due `approved` docs to
  `expired`. A new upload after expiry creates a fresh row and links the
  old one via `superseded_by`.
- **Security**: rate limits on `/api/auth/**`, `/api/upload`, `/api/files/**`;
  HSTS / CSP / X-Frame-Options / no-sniff / Referrer-Policy /
  Permissions-Policy on every response; every admin mutation and file
  download writes an `audit_logs` row.

---

## Requirements

- Node.js 20+ (the host has 24, plus pnpm, yarn, bun)
- Postgres 14+ (Docker for local dev, Supabase Postgres for production)

---

## Quick start (verified — follow it in a clean clone)

```bash
# 1. install deps
pnpm install

# 2. start Postgres locally
docker run --name onboarding-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=onboarding \
  -p 5432:5432 -d postgres:16

# 3. configure env
cp .env.example .env
# then edit .env — at minimum set AUTH_SECRET (openssl rand -base64 32)
# and CRON_SECRET (any long random string)

# 4. apply schema + seed
pnpm db:migrate
pnpm db:seed

# 5. run dev server
pnpm dev
# → open http://localhost:3000
```

Default seeded logins (override via env before running `db:seed`):

| Role    | Email                  | Password      |
|---------|------------------------|---------------|
| admin   | admin@example.com      | `ChangeMe!Now` |
| teacher | teacher@example.com    | `ChangeMe!Now` |
| teacher | teacher2@example.com   | `ChangeMe!Now` |

Change these immediately in any shared environment.

---

## Required environment variables

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. |
| `AUTH_SECRET` | Auth.js JWT signing key. `openssl rand -base64 32`. |
| `AUTH_URL` | Base URL for Auth.js callbacks. `http://localhost:3000` in dev. |
| `AUTH_TRUST_HOST` | `true` in dev; unset in prod when `AUTH_URL` is fixed. |
| `STORAGE_ADAPTER` | `local` (dev only) or `supabase` (production). |
| `LOCAL_STORAGE_DIR` | Local file directory (default `./.uploads`). |
| `CRON_SECRET` | Shared secret for `/api/cron/expiry`. |
| `EXPIRING_SOON_WINDOW_DAYS` | Optional. Integer days (default 30). |
| `EMAIL_PROVIDER` | Optional. `console` (default), `resend`, or `sendgrid` for outbound invite emails. |
| `RESEND_API_KEY` / `SENDGRID_API_KEY` | Required only when using that email provider. Server-only; never `NEXT_PUBLIC_`. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Used by `pnpm db:seed`. |

Full list, including production-only Supabase vars, lives in
[`docs/DEPLOY.md`](./docs/DEPLOY.md).

---

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run the Next.js dev server. |
| `pnpm build` | Production build. Required before `pnpm test:leakage`. |
| `pnpm start` | Run the production server. |
| `pnpm lint` | `next lint`. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm db:migrate` | Apply every SQL file in `./drizzle/` in order. Idempotent. |
| `pnpm db:seed` | Create/update the admin, sample teachers, document types. |
| `pnpm db:generate` | Drizzle Kit migration generator (after editing `lib/db/schema.ts`). |
| `pnpm test` | Run every test (unit + integration). |
| `pnpm test:unit` | Just `tests/unit/**`. |
| `pnpm test:integration` | Just `tests/integration/**`. |
| `pnpm test:leakage` | Grep `.next/` for service-role-key leakage. **Requires a prior `pnpm build`.** |

---

## CI pipeline

`.github/workflows/ci.yml` runs on every PR:

```
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm build
pnpm test:unit
pnpm test:integration
pnpm test:leakage
```

---

## Security boundaries

- **Middleware** gates every route. Unauthenticated browsers → redirect to
  `/login`; unauthenticated API calls → `401`. Cross-role API access → `403`.
- **`/api/admin/**`** requires `role='admin'`. Middleware AND every handler
  re-checks.
- **File downloads** flow through `GET /api/files/[id]` only. The route
  authenticates, runs an owner-OR-admin check, then streams bytes with
  `Content-Disposition: attachment; …`, `Cache-Control: private, no-store`,
  `X-Content-Type-Options: nosniff`. No storage URL ever reaches the client.
- **Rate limits**: 5/min/IP on auth, 10/hour/user on upload, 60/min/user on
  downloads. Exceeded → `429` with `Retry-After`.
- **Headers**: HSTS, CSP (no inline JS), X-Frame-Options DENY,
  X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin,
  Permissions-Policy locking out camera/mic/geolocation. Applied via
  `next.config.ts`.
- **Audit log** records every admin mutation, file download, and report
  export. Browse it at `/admin/audit`.
- **Service-role key** never appears in the client bundle. The
  `pnpm test:leakage` check is a release blocker.

Threat model and incident-response runbook: [`docs/SECURITY.md`](./docs/SECURITY.md).

---

## Troubleshooting

- **`pnpm dev` fails with `EvalError: Code generation from strings disallowed for this context`** — this happens when your shell has `NODE_ENV=production` exported. Auth.js's edge bundle is stricter under prod mode. Run dev with `NODE_ENV=development pnpm dev` or `unset NODE_ENV` first.
- **Tests pass locally but `pnpm test:leakage` fails in CI** — the leakage grep runs against `.next/` so it depends on `pnpm build` succeeding first. The CI workflow chains them; locally run `pnpm build && pnpm test:leakage`.

---

## Project layout

See PROJECT_CONTEXT §2 for the canonical directory layout. Key dirs:

```
app/
  (admin)/admin/…    admin pages (dashboard, teachers, doc types, reports, audit)
  (teacher)/teacher/… teacher pages (dashboard, documents)
  api/
    admin/{teachers,documents/[id],document-types,reports,audit}/…
    auth/[...nextauth]/…  Auth.js handlers
    files/[id]/…          private download
    upload/…              teacher upload
    cron/expiry/…         daily expiry sweep
  login/…  unauthorized/…
lib/
  audit/{log,queries}.ts
  auth/{config,edge,guards,handlers}.ts
  db/{client,schema,queries/}…
  expiry/{index,queries,setExpiry,status,supersession}.ts
  rate-limit/{index,rules,edge}.ts
  reports/{csv,queries}.ts
  storage/{index,local}.ts
  validation/file.ts
components/{admin,teacher,upload}/…
middleware.ts             # auth + rate-limit
next.config.ts            # security headers
drizzle/0000_init.sql
tests/{unit,integration}/…
docs/{DEPLOY,SECURITY,AGENT_PROMPTS}.md
scripts/{migrate,seed,leakage-grep}.{ts,mjs}
```
