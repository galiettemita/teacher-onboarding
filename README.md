# Teacher Onboarding Portal

A simple, grandma-friendly elementary school teacher onboarding paperwork portal.

> **Status:** Phase 1 — foundation only. Auth, schema, storage adapter, and route stubs are in place. The teacher/admin dashboards are placeholders; the upload and file routes return `501` until Phase 2.

See [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) for the full architecture and rules. That document is the source of truth.

---

## What's in this branch (`feature/auth-database-storage`)

- Next.js 15 (App Router) + React 19 + TypeScript + Tailwind
- Drizzle ORM with the full Phase 1 schema (8 tables) and the initial SQL migration
- Auth.js v5 with the Drizzle adapter, email + password credentials, JWT sessions
- `middleware.ts` enforces session + role gating
- Storage adapter interface with a local-disk dev implementation
- Stubbed `POST /api/upload` and `GET /api/files/[id]` (return 501 — Phase 2 wires them up)
- `GET /api/me` returns the current session
- Login page, role-aware home redirect, placeholder teacher and admin dashboards, unauthorized page
- Seed script: 1 admin, 2 sample teachers, 10 starter document types

---

## Requirements

- Node.js 20+ (the host has Node 24, pnpm, yarn, bun, npm all available)
- Postgres 14+ (use Docker for local dev, Supabase Postgres for production)

---

## Quick start

```bash
# 1. install deps (pnpm recommended; npm/yarn/bun work too)
pnpm install

# 2. start Postgres locally
docker run --name onboarding-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=onboarding \
  -p 5432:5432 -d postgres:16

# 3. configure env
cp .env.example .env
# then edit .env — at minimum set AUTH_SECRET (openssl rand -base64 32)

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
| `DATABASE_URL` | Postgres connection string. Required for migrate/seed and the running app. |
| `AUTH_SECRET` | Auth.js JWT signing key. Generate with `openssl rand -base64 32`. |
| `AUTH_URL` | Base URL for Auth.js callbacks. `http://localhost:3000` in dev. |
| `AUTH_TRUST_HOST` | `true` in dev; unset in prod when `AUTH_URL` is fixed. |
| `STORAGE_ADAPTER` | `local` (dev only). Production must be `supabase` (added in a later phase). |
| `LOCAL_STORAGE_DIR` | Where local files live. Default `./.uploads`. Gitignored. |
| `CRON_SECRET` | Shared secret for `/api/cron/*` routes (Phase 4+). |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_NAME` / `SEED_ADMIN_PASSWORD` | Used by `pnpm db:seed`. |
| `SEED_TEACHER_EMAIL` / `SEED_TEACHER_NAME` / `SEED_TEACHER_PASSWORD` | Same. |
| `EMAIL_FROM`, `EMAIL_SERVER` | Reserved; magic-link email is wired up in a later phase. |

---

## Creating the first admin user

The first admin is created by running the seed script:

```bash
SEED_ADMIN_EMAIL="you@school.org" \
SEED_ADMIN_NAME="Your Name" \
SEED_ADMIN_PASSWORD="$(openssl rand -base64 18)" \
pnpm db:seed
```

The seed is idempotent — re-running it updates the admin row in place rather than creating a duplicate. Subsequent admins are added by re-running the seed with a different email, or via direct SQL (a UI for promoting users is out of MVP scope per PROJECT_CONTEXT §5.6).

---

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run the Next.js dev server on `http://localhost:3000`. |
| `pnpm build` | Production build. |
| `pnpm start` | Run the production server (after `build`). |
| `pnpm lint` | Run `next lint`. |
| `pnpm typecheck` | `tsc --noEmit` over the whole project. |
| `pnpm db:migrate` | Apply every SQL file in `./drizzle/` in order. Idempotent. |
| `pnpm db:seed` | Create/update the admin, sample teachers, and starter document types. Idempotent. |
| `pnpm db:generate` | Have Drizzle Kit generate a new migration after editing `lib/db/schema.ts`. |

---

## Security boundaries (Phase 1)

- Every protected route is gated by `middleware.ts`. Unauthenticated browsers are redirected to `/login`; unauthenticated API calls receive `401`.
- `/admin/**` and `/api/admin/**` require `role === 'admin'`. Teachers hitting them get `403` (API) or a redirect to `/unauthorized` (pages).
- `/teacher/**` requires `role === 'teacher'`. Admins are not enrolled as teachers.
- File downloads will only ever flow through `GET /api/files/[id]` after Phase 2; no storage URL ever reaches the client. The route is already stubbed and auth-gated.
- The local storage adapter prints a warning if instantiated in production. Per PROJECT_CONTEXT, deploying with the local adapter is forbidden.

---

## Known limitations (Phase 1)

- `POST /api/upload` and `GET /api/files/[id]` are stubs that return `501`. Phase 2 wires up the full validation pipeline (magic-byte sniff, 10 MB cap, sha256, DB row, audit log) and the protected download.
- Login uses email + password (Auth.js Credentials provider). Magic-link login via Nodemailer is part of the architecture but is gated on configuring an SMTP transport; this is a small follow-up.
- No tests exist yet. The Phase 1 scope deliberately omits the test suite (added in Phase 5 per PROJECT_CONTEXT §10). When asked to run tests, the right answer is "they do not exist yet."
- The local storage adapter is **development only**. Production must use Supabase Storage (or S3 / R2) with `Block Public Access = ON`.
- No emails are sent in Phase 1. `reminder_settings`, `notification_logs`, and `scheduled_job_runs` are seeded as future-safe schema only; reminder dispatch is Phase 6.
- Admin promotion via UI is intentionally absent (PROJECT_CONTEXT §5.4). Seed additional admins via the script.

---

## Project layout

See PROJECT_CONTEXT §2 for the canonical directory layout. Files created in this branch:

```
app/
  layout.tsx
  page.tsx                                  # redirects to role dashboard
  globals.css
  login/page.tsx                            # email + password sign-in
  unauthorized/page.tsx
  (teacher)/teacher/dashboard/page.tsx      # placeholder
  (admin)/admin/dashboard/page.tsx          # placeholder
  api/
    auth/[...nextauth]/route.ts             # Auth.js handlers
    me/route.ts                             # current user
    upload/route.ts                         # 501 stub, auth-gated
    files/[id]/route.ts                     # 501 stub, auth-gated
lib/
  auth/{config,guards,handlers}.ts
  db/{client,schema}.ts
  storage/{index,local}.ts
middleware.ts
drizzle/0000_init.sql
drizzle.config.ts
scripts/{migrate,seed}.ts
```

---

## Next branch

After this lands on `main`, Phase 2 picks up on `feature/teacher-upload-flow` — implements the upload pipeline, teacher document list, and own-file download. See PROJECT_CONTEXT §7 for the full multi-agent branch plan.
