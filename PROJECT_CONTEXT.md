# Teacher Onboarding Portal — Project Context & Build Control

> **Purpose:** Single source of truth for architecture, data model, security rules, and multi-agent work boundaries. Every agent (human or AI) must read this file end-to-end before touching code. This document governs what gets built, by whom, on which branch, touching which files. If a decision conflicts with this document, the document wins until it is updated via PR.

---

## Project Goal

A simple, **grandma-friendly** elementary school teacher onboarding paperwork portal.

**Teachers can:** log in · see required documents · upload documents · see missing / pending / approved / rejected / expired statuses · renew documents every 2 years.

**Secretary / admin can:** see all teachers · see who is complete / incomplete · download files · approve / reject files · track expiring / expired documents · export reports · manage required document types.

**Out of scope (do NOT build):** HR features, payroll, student records, gradebooks, messaging, calendars, multi-school tenancy, public sign-up.

---

## 1. Current Repo Stack

| Item | State |
|---|---|
| Framework | **None** |
| Language | **None** |
| Package manager | **None** (host has `npm`, `pnpm`, `yarn`, `bun` available) |
| Existing routes / files | **None** — only `.git/` directory |
| Existing auth | **None** |
| Existing database | **None** |
| Existing storage | **None** |
| Git state | Initialized on branch `main`, **zero commits** |
| Repo state | **Empty.** No prior structure or decisions to respect. |

Verified by direct inspection: `ls -la` shows only `.git/`; `git log` reports "your current branch 'main' does not have any commits yet."

---

## 2. Approved Architecture

| Layer | Choice | Notes |
|---|---|---|
| **Frontend framework** | Next.js 15 (App Router) + React 19 + TypeScript | Server-first, large-font friendly via Tailwind |
| **UI kit** | Tailwind CSS + shadcn/ui | Accessible defaults, easy to make grandma-friendly |
| **Backend** | Next.js Route Handlers (`app/api/**`) + Server Actions | One process, no separate API service |
| **Database** | **Supabase Postgres** (production) / local Postgres via Docker (development). **Drizzle ORM** is the schema + migration + query layer on top. | Supabase provides the managed Postgres engine; Drizzle owns the schema files in `drizzle/` and is the only thing that writes DDL. We do NOT use the Supabase migration CLI. SQLite is not used. |
| **Auth** | **Auth.js (NextAuth v5)** with the Drizzle adapter — email magic link primary, password fallback optional | Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`. We use Auth.js (not Supabase Auth) so role + session live in our own `users` table and there is one auth path to reason about. Supabase JWT / Supabase Auth is explicitly NOT used. |
| **Authorization** | Role on `users.role` (`teacher` \| `admin`) + per-row ownership checks inside `lib/db/queries/*` + middleware route gating | Enforced server-side only. No Supabase RLS — all access control is in application code so it can be unit-tested. |
| **File storage** | **Supabase Storage** (production, private bucket) via the storage adapter / local disk (development only). | Files keyed by server-generated UUID, never by user-supplied name. The bucket is private (no public ACL). All client reads go through `/api/files/[id]` which authenticates the user, checks ownership/role, then either streams bytes via the Supabase service-role client or issues a short-lived signed URL (≤60s) created server-side. **Deploying with the local adapter in production is forbidden.** S3 / Cloudflare R2 are acceptable substitutes if Supabase Storage is ever swapped out, but the default is Supabase Storage. |
| **Private downloads** | All downloads go through `GET /api/files/[id]`. The route: (1) requires a session, (2) loads the document row, (3) checks `doc.user_id === session.user.id OR session.user.role === 'admin'`, (4) streams bytes from storage with `Content-Disposition: attachment` and `Cache-Control: private, no-store`. No direct storage URLs are ever exposed to the client. Signed URLs, if used, are ≤60s and generated server-side after the same check. |
| **Background jobs** | Vercel Cron (or `node-cron` on VPS) hitting `POST /api/cron/expiry` daily with a shared secret header | Marks `expired`, sends reminders |
| **Email** | Resend or SMTP via Nodemailer | Magic links + expiry reminders |
| **Logging / audit** | `audit_logs` table written from a single `lib/audit/log.ts` helper | Every admin mutation + every file download |

### Directory layout (canonical)

```
app/
  (teacher)/        teacher-only pages
  (admin)/          admin-only pages
  api/              route handlers
  login/            auth pages
  layout.tsx        root shell
lib/
  auth/             session helpers, role guards
  db/
    client.ts       drizzle client singleton
    schema.ts       table definitions
    queries/        all data access, organized per feature
  storage/          adapter (local, s3)
  validation/       zod schemas, file magic-byte sniffing
  email/            email sender
  audit/            audit log helper
  expiry/           expiry calculation
components/
  teacher/          teacher UI
  admin/            admin UI
  upload/           shared upload UI
  ui/               shadcn primitives
middleware.ts       route protection + role gating
drizzle/            migrations (numbered, append-only)
tests/              vitest + playwright
```

---

## 3. Data Model

All tables use `id: uuid primary key default gen_random_uuid()` and `created_at timestamptz not null default now()` unless noted. All foreign keys are `on delete restrict` except `audit_logs.actor_id` and `notification_logs.actor_id` which are `on delete set null`.

**Tables in scope (8 total):** `users`, `teacher_profiles`, `document_types`, `teacher_documents`, `audit_logs`, `reminder_settings`, `notification_logs`, `scheduled_job_runs`.

### 3.1 `users`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | citext unique not null | Lowercased on write |
| name | text not null | |
| role | text not null check in (`teacher`, `admin`) | Default `teacher` |
| password_hash | text nullable | Only if password auth enabled |
| email_verified_at | timestamptz nullable | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### 3.2 `teacher_profiles`

One-to-one with `users` where `role = 'teacher'`. Holds onboarding metadata that doesn't belong on the auth user.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users.id unique not null | |
| phone | text nullable | |
| hire_date | date nullable | Drives initial renewal due dates |
| grade_level | text nullable | e.g. "K", "1", "2" |
| onboarding_complete | boolean not null default false | Derived; cached for fast list views |
| created_at, updated_at | timestamptz | |

### 3.3 `document_types`

Admin-managed catalog of required documents.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text not null unique | e.g. "Teaching Credential" |
| description | text nullable | |
| required | boolean not null default true | If false, optional doc |
| renewal_months | integer not null default 24 | 2-year default |
| active | boolean not null default true | Soft delete |
| created_at, updated_at | timestamptz | |

### 3.4 `teacher_documents`

One row per upload. Renewals create a NEW row (history preserved). The "current" document for a (teacher, document_type) is the most recent non-superseded row.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users.id not null | The teacher |
| document_type_id | uuid FK → document_types.id not null | |
| storage_key | text not null unique | e.g. `teachers/{user_id}/{document_type_id}/{uuid}.pdf` — **never** the user-supplied filename |
| original_filename | text not null | Display only, sanitized |
| mime_type | text not null | Magic-byte verified, not header-trusted |
| size_bytes | bigint not null | Enforced ≤ 10 MB |
| sha256 | text not null | For dedupe + integrity |
| status | text not null check in (`pending`, `approved`, `rejected`, `expired`) | Default `pending` |
| uploaded_at | timestamptz not null default now() | |
| reviewed_at | timestamptz nullable | |
| reviewed_by | uuid FK → users.id nullable | Must be admin |
| rejection_reason | text nullable | Required when status = `rejected` |
| expires_at | timestamptz nullable | Set on approval = `reviewed_at + document_type.renewal_months` |
| superseded_by | uuid FK → teacher_documents.id nullable | Points to renewal row |

**Statuses (state machine):**
- `pending` → `approved` (admin) | `rejected` (admin)
- `approved` → `expired` (cron) | `superseded` (implicit via `superseded_by`)
- `rejected` → terminal (teacher must upload new row)
- `expired` → terminal (teacher must upload new row, which supersedes)

**Indexes:**
- `(user_id, document_type_id, uploaded_at desc)`
- `(status)`
- `(expires_at)` partial where status = `approved`

### 3.5 `audit_logs`

Every admin mutation, every file download (by anyone), every login attempt.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| actor_id | uuid FK → users.id nullable | Null for system / cron |
| action | text not null | e.g. `document.approve`, `document.reject`, `file.download`, `doc_type.create`, `auth.login.success`, `auth.login.fail` |
| target_type | text nullable | e.g. `teacher_document`, `document_type`, `user` |
| target_id | uuid nullable | |
| metadata | jsonb not null default '{}' | IP, user agent, reason, etc. |
| created_at | timestamptz | |

**Indexes:** `(actor_id, created_at desc)`, `(target_type, target_id)`, `(action, created_at desc)`.

### 3.6 `reminder_settings`

Singleton-style configuration row for the automated email reminder system (see §11). The migration seeds exactly one row; admin UI edits it in place. Code MUST handle "row missing" by falling back to documented defaults.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | Singleton: enforced via unique constant or `id = '00000000-0000-0000-0000-000000000001'` |
| enabled | boolean not null default true | Master on/off switch for all automated reminders |
| sender_name | text not null default `'Onboarding Portal'` | Display name in From header |
| sender_email | text not null | Must be a verified sender at the email provider |
| portal_url | text not null | Base URL for the "Log in to portal" CTA |
| reminder_days_before_expiration | integer[] not null default `'{90,60,30,14,7}'` | Milestones (days before `expires_at`) |
| post_expiration_interval_days | integer not null default 7 | Cadence after expiration until renewed + approved |
| max_one_email_per_teacher_per_day | boolean not null default true | Hard rate limit per teacher |
| pending_review_days_before_admin_alert | integer nullable | If set, alert admin when a doc has been `pending` longer than N days |
| missing_doc_reminder_interval_days | integer not null default 14 | Cadence for "you still have missing required documents" reminder |
| rejected_doc_reminder_interval_days | integer not null default 7 | Cadence for "rejected, please re-upload" reminder |
| created_at, updated_at | timestamptz | |

### 3.7 `notification_logs`

Append-only log of every reminder the system attempted to send. Used for duplicate prevention, admin visibility, and audit. **Never deleted.**

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| teacher_id | uuid FK → users.id not null | The recipient |
| teacher_document_id | uuid FK → teacher_documents.id nullable | Null for non-doc-scoped reminders (e.g. "you have missing documents") |
| document_type_id | uuid FK → document_types.id nullable | Helpful when `teacher_document_id` is null but reminder concerns a specific type |
| reminder_type | text not null check in (`missing_required`, `rejected_replace`, `expiring_90`, `expiring_60`, `expiring_30`, `expiring_14`, `expiring_7`, `expired_today`, `expired_recurring`, `pending_admin_alert`, `manual`) | |
| milestone_key | text not null | Idempotency key, e.g. `expiring_30:{teacher_document_id}` or `missing_required:{user_id}:{document_type_id}:{YYYY-MM-DD}` — UNIQUE per (teacher_id, milestone_key) |
| recipient_email | text not null | Snapshot at send time |
| subject | text not null | |
| status | text not null check in (`queued`, `sent`, `failed`, `skipped`) | |
| provider_message_id | text nullable | From email provider (e.g. Resend ID) |
| sent_at | timestamptz nullable | Set when status = `sent` |
| failed_reason | text nullable | Provider error message |
| skipped_reason | text nullable | e.g. `daily_cap`, `duplicate_milestone`, `reminders_disabled`, `no_email_on_file` |
| triggered_by | text not null check in (`cron`, `admin_manual`) | |
| actor_id | uuid FK → users.id nullable | Set when `triggered_by = 'admin_manual'` |
| created_at | timestamptz | |

**Indexes:**
- UNIQUE `(teacher_id, milestone_key)` — enforces "send each milestone at most once"
- `(teacher_id, created_at desc)`
- `(status, created_at desc)`
- `(reminder_type, created_at desc)`

### 3.8 `scheduled_job_runs`

One row per cron tick. Lets admins see when the job ran, what it processed, and any failures. Useful for diagnosing missing reminders.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| job_name | text not null | e.g. `expiry_sweep`, `reminder_dispatch` |
| started_at | timestamptz not null default now() | |
| finished_at | timestamptz nullable | |
| status | text not null check in (`running`, `success`, `failed`) | |
| candidates_considered | integer not null default 0 | |
| emails_sent | integer not null default 0 | |
| emails_skipped | integer not null default 0 | |
| emails_failed | integer not null default 0 | |
| error_message | text nullable | |
| metadata | jsonb not null default '{}' | |

**Indexes:** `(job_name, started_at desc)`.

### 3.9 Relationships (summary)

- `users 1—1 teacher_profiles` (only when role = teacher)
- `users 1—N teacher_documents`
- `document_types 1—N teacher_documents`
- `users 1—N teacher_documents` via `reviewed_by` (admin only)
- `teacher_documents 0—1 teacher_documents` via `superseded_by` (renewal chain)
- `users 1—N audit_logs` via `actor_id`
- `users 1—N notification_logs` via `teacher_id`
- `teacher_documents 1—N notification_logs` via `teacher_document_id`
- `users 1—N notification_logs` via `actor_id` (manual admin sends)
- `reminder_settings` — singleton, no FKs

---

## 4. File Storage Rules

1. **Private storage only.** S3 / R2 bucket has `Block Public Access = ON`. No object ACL is ever `public-read`. Local dev disk is under `./.uploads/` and excluded from git.
2. **No public file URLs.** The client never receives a storage URL. Every file is fetched through `GET /api/files/[id]`.
3. **Path structure:** `teachers/{user_id}/{document_type_id}/{uuid}.{ext}`. The `{uuid}` and `{ext}` are server-generated. User-supplied filenames are stored in `original_filename` only.
4. **Allowed file types (whitelist):** `application/pdf`, `image/jpeg`, `image/png`. Everything else is rejected. **No HTML, no SVG, no Office docs, no archives, no executables.**
5. **Max upload size:** **10 MB** enforced at the route handler before reading the full stream. Reject early with 413.
6. **Server-side validation pipeline (in this order):**
   1. Auth check (session exists)
   2. Content-Length check (≤ 10 MB)
   3. Stream to temp with size cap (kill stream if exceeded)
   4. Magic-byte sniff (e.g. `file-type` npm package) — must match whitelist
   5. Recompute SHA-256
   6. Persist to storage under server-generated key
   7. Insert `teacher_documents` row with status = `pending`
   8. Audit log entry
7. **Server-side download authorization:** `/api/files/[id]` must:
   - Require a valid session (else 401).
   - Look up the document row.
   - Allow if `doc.user_id === session.user.id` OR `session.user.role === 'admin'` (else 403).
   - Stream with `Content-Type` from DB, `Content-Disposition: attachment; filename="<sanitized>"`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`.
   - Write `file.download` audit log entry.
8. **Filename sanitization** for `Content-Disposition`: strip control chars, quotes, slashes; collapse to `[A-Za-z0-9._-]`.
9. **No client-side virus claim trust.** A virus-scan interface (`lib/storage/scan.ts`) is stubbed in MVP and required to return "clean" before status can move to `approved` in production.

---

## 5. Role and Permission Rules

### 5.1 Teacher (`role = 'teacher'`) — CAN

- Log in / log out
- View their own `teacher_profile` and edit limited fields (phone, etc.)
- View the list of active `document_types`
- View their own `teacher_documents` and their statuses
- Upload a new document for any `document_type` (creates `pending` row; if `approved` exists, the new one becomes the candidate renewal)
- Download their own files via `/api/files/[id]`

### 5.2 Teacher — MUST NEVER

- See another teacher's profile, documents, or files
- See the `users` list
- Approve / reject any document (including their own)
- Modify `document_types`
- Read `audit_logs`
- Hit any `/api/admin/**` route
- Receive a storage URL or signed URL for another user's file

### 5.3 Admin (`role = 'admin'`) — CAN

- Everything a teacher can do (but admins are not enrolled as teachers; they have no `teacher_profile`)
- List all teachers with completion %
- View any teacher's profile and documents
- Download any teacher's file
- Approve / reject `pending` documents (rejection requires reason)
- Create / edit / deactivate `document_types`
- Export reports (CSV)
- View `audit_logs`

### 5.4 Admin — MUST NEVER

- Bypass audit logging (every mutation goes through helpers that log)
- Modify another user's `password_hash` directly (use reset flow)
- Edit historical `teacher_documents` rows (status transitions only via state machine)
- Delete `audit_logs` rows
- Promote themselves or others via UI without a secondary check (role changes are out of MVP scope; seed admins via migration only)

### 5.5 Server-side enforcement (non-negotiable)

Every one of the following checks happens on the server, on every request:

1. **Session check** in `middleware.ts` for all routes except `/login`, `/api/auth/**`, public assets.
2. **Role check** in `middleware.ts` for `/admin/**` and `/api/admin/**`.
3. **Row ownership check** inside every `lib/db/queries/*` function that returns or mutates `teacher_documents` or `teacher_profiles`. The function signature takes `currentUser` and filters by it.
4. **Download permission check** in `/api/files/[id]` (see §4.7).
5. **CSRF**: rely on Auth.js CSRF + SameSite=Lax cookie + same-origin check on all `POST/PATCH/DELETE`.
6. **No client-side role gating is trusted.** UI hiding is cosmetic; the server must enforce.

### 5.6 Login workflow & role-based routing (canonical)

This is the **only** approved login flow. No public sign-up exists. There is no "register" page.

**Account creation:**

1. **Admin creates the teacher.** Admin goes to `/admin/teachers/new`, enters the teacher's name + email, optional profile fields. Server-side:
   - Creates a `users` row with `role = 'teacher'` and `email_verified_at = null`.
   - Creates the matching `teacher_profiles` row.
   - Sends an **invite email** containing a magic-link login URL (generated by Auth.js). The email body follows the §11.3 privacy rules (no file data, single CTA = log in).
   - Writes an `audit_logs` row (`action = 'user.invite'`).
2. **Initial admin** is seeded via the Phase 1 seed script and migration — never via UI. To add additional admins, an existing admin uses a CLI seed (out of MVP UI scope).
3. **Teachers cannot self-register.** The `/login` page accepts an email; if no `users` row exists, the response is generic ("If that address is on file, a link has been sent") to prevent email enumeration.

**Login flow:**

1. User visits any protected URL while unauthenticated → middleware redirects to `/login`.
2. User enters email on `/login` → server triggers Auth.js magic-link send.
3. User clicks the magic link → Auth.js verifies the token, sets the session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`), and on first successful verification sets `users.email_verified_at`.
4. **Role-based redirect** happens server-side immediately after sign-in, in `app/auth/callback/route.ts` (or the Auth.js `redirect` callback):
   - `users.role === 'admin'` → redirect to `/admin/dashboard`
   - `users.role === 'teacher'` → redirect to `/teacher/dashboard`
   - Any other value → 403 + force logout (defensive; should never happen).
5. The session JWT/cookie carries `userId` and `role`. Both are re-checked from the DB on every protected request (role can be revoked).

**Route protection rules (enforced in `middleware.ts`):**

| Path prefix | Required state |
|---|---|
| `/` (landing) | Public, but redirects logged-in users to their role dashboard |
| `/login`, `/api/auth/**` | Public |
| `/teacher/**` | Session required AND `role === 'teacher'` |
| `/admin/**` | Session required AND `role === 'admin'` |
| `/api/upload` | Session required (any role); but business logic only allows teachers to upload for themselves |
| `/api/files/[id]` | Session required; row-level ownership check inside the route (owner OR admin) |
| `/api/admin/**` | Session required AND `role === 'admin'` |
| `/api/cron/**` | No session — guarded by shared-secret header `X-Cron-Secret` |
| Public assets (`/_next/**`, favicon, images) | Public |

A teacher hitting any `/admin/**` or `/api/admin/**` URL receives **403**, not a redirect (so it's obvious in logs and tests). An unauthenticated user hitting a protected page is **redirected** to `/login`; an unauthenticated API call returns **401**.

**File download authorization (re-stated for emphasis):**

`GET /api/files/[id]` is the only path to a stored file. It MUST:

1. Require a valid session (else 401).
2. Load the `teacher_documents` row by id.
3. Allow if `doc.user_id === session.user.id` **OR** `session.user.role === 'admin'`. Else 403.
4. Stream from Supabase Storage using the service-role key (server-side) OR generate a ≤60s signed URL server-side and 302 to it. Never expose the storage path or the service-role key to the client.
5. Set `Content-Disposition: attachment`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`.
6. Write an `audit_logs` row with `action = 'file.download'`.

**What teachers MUST NEVER see:**

- The Supabase URL, bucket name, or storage path of any file (their own or others').
- Any admin route's response — middleware short-circuits with 403 before the route runs.
- Any other teacher's profile, documents, audit entries, or notification logs.

---

## 6. MVP Build Order

> Phases are sequential at the integration level. Within Phase 2 and Phase 3, multiple agents can work in parallel (see §7).

### Phase 1 — Foundation: auth / database / storage
- Next.js + TS + Tailwind + shadcn/ui scaffold
- **Supabase project provisioned** (or local Postgres via Docker for dev); connection string in `.env`
- Drizzle config pointed at Supabase Postgres; initial migration creating all **8** tables from §3
- Auth.js v5 with Drizzle adapter, email magic link, role on user, login page, logout, role-based redirect callback (see §5.6)
- Middleware: session gate + role gate (per §5.6 table)
- Storage adapter with two implementations: `local` (dev) and `supabase` (prod, private bucket); upload + download routes scaffolded as 501 stubs (not yet wired to UI)
- Seed script: 1 admin user, 3 sample `document_types`, 1 `reminder_settings` row with defaults
- `.env.example` documents: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `EMAIL_SERVER` (Resend or SMTP), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `STORAGE_DRIVER` (`local` \| `supabase`), `CRON_SECRET`
- `README.md`, CI: typecheck + lint

### Phase 2 — Teacher dashboard + upload flow
- `/teacher/dashboard` showing required doc types with status badges (missing / pending / approved / rejected / expired)
- Upload component → `POST /api/upload` with full validation pipeline (§4.6)
- `/teacher/documents` listing the teacher's own documents with download links via `/api/files/[id]`
- Status badge component shared with admin views

### Phase 3 — Admin dashboard + review + download
- `/admin/dashboard` summary (counts)
- `/admin/teachers` list with completion %
- `/admin/teachers/[id]` per-teacher detail with all their documents
- Approve / Reject actions → `PATCH /api/admin/documents/[id]` (reason required on reject)
- Admin can download any file via the same `/api/files/[id]` route (permission check allows admin)
- `/admin/document-types` CRUD

### Phase 4 — Renewal / expiration tracking
- Approval sets `expires_at = reviewed_at + renewal_months`
- Cron route `POST /api/cron/expiry` (shared-secret header): marks docs `expired` when `expires_at < now()`
- Email reminders at 30 / 14 / 7 days before expiry
- Teacher re-upload supersedes prior approved doc (sets `superseded_by`)
- "Expiring soon" badge on teacher dashboard and admin views

### Phase 5 — Reports / export / polish / testing
- CSV export of completion + expiry report (`/api/admin/reports`)
- Audit log viewer at `/admin/audit`
- Accessibility pass (large fonts, focus rings, keyboard nav, screen reader labels)
- Rate limiting on `/api/auth/**`, `/api/upload`, `/api/files/**`
- Security headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- Full test suite (§10)
- Production deploy docs

### Phase 6 — Automated email reminder system (see §11)
- Reminder dispatch cron route `POST /api/cron/reminders` (shared-secret header)
- Email templates for all `reminder_type` values, plain-text + minimal HTML, privacy-safe (§11.3)
- Duplicate-prevention via `notification_logs.milestone_key` UNIQUE constraint + daily cap
- Admin UI at `/admin/reminders`: settings, template preview, log viewer, manual send, failed/skipped views
- `scheduled_job_runs` populated by both expiry and reminder crons
- Tests in §11.8

> Phase 1 ships the `reminder_settings`, `notification_logs`, and `scheduled_job_runs` schema placeholders + seed row only. No reminder logic in Phase 1.

---

## 7. Multi-Agent Branch Plan

> **Rule:** No agent works on `main`. No agent merges their own PR without review. Schema changes are coordinated (see §8).

### Branch: `feature/auth-database-storage` (Phase 1 — BLOCKING)

- **Agent responsibility:** Lay the foundation. Everything else depends on this branch landing on `main`.
- **Files likely touched:**
  - `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.eslintrc.cjs`, `.gitignore`
  - `middleware.ts`
  - `app/layout.tsx`, `app/page.tsx`, `app/login/page.tsx`, `app/api/auth/[...nextauth]/route.ts`
  - `lib/auth/*`, `lib/db/client.ts`, `lib/db/schema.ts`, `lib/db/queries/users.ts`
  - `lib/storage/index.ts`, `lib/storage/local.ts`, `lib/storage/s3.ts`
  - `drizzle/0000_init.sql`, `drizzle.config.ts`
  - `scripts/seed.ts`
  - `.env.example`, `README.md`
- **Files to avoid:** none yet — this branch creates the foundation
- **Dependencies:** none
- **Acceptance criteria:**
  1. `pnpm install && pnpm typecheck && pnpm lint && pnpm build` passes
  2. `pnpm db:migrate && pnpm db:seed` creates all 5 tables and seeds 1 admin + 3 doc types
  3. Visiting `/` while unauthenticated redirects to `/login`
  4. Magic-link (or dev-mode email log) login works; session cookie is `HttpOnly` + `SameSite=Lax`
  5. After login as teacher → redirected to `/teacher/dashboard` (placeholder OK)
  6. After login as admin → redirected to `/admin/dashboard` (placeholder OK)
  7. `middleware.ts` blocks `/admin/**` for teachers (403 or redirect)
  8. `/api/upload` and `/api/files/[id]` exist as stubs returning 501

### Branch: `feature/teacher-upload-flow` (Phase 2)

- **Agent responsibility:** Teacher-facing dashboard, upload, and own-file download.
- **Files likely touched:**
  - `app/(teacher)/dashboard/page.tsx`
  - `app/(teacher)/documents/page.tsx`
  - `app/api/upload/route.ts`
  - `app/api/files/[id]/route.ts`
  - `lib/db/queries/teacher-documents.ts`
  - `lib/validation/file.ts`
  - `components/teacher/*`, `components/upload/*`, `components/status-badge.tsx`
- **Files to avoid:**
  - `lib/db/schema.ts` (no schema changes — request via coordination PR)
  - `middleware.ts`, `lib/auth/*`
  - Anything under `app/(admin)/`
  - `lib/storage/*` (consume only)
- **Dependencies:** `feature/auth-database-storage` merged to `main`
- **Acceptance criteria:**
  1. Logged-in teacher sees one row per active `document_type` with correct status
  2. Upload of a 9 MB PDF succeeds; 11 MB rejected with 413; `.exe` renamed to `.pdf` rejected via magic-byte sniff
  3. Uploaded doc appears as `pending` and is downloadable by its owner only
  4. Calling `/api/files/[id]` for another teacher's doc returns 403
  5. Calling `/api/files/[id]` without a session returns 401
  6. All upload + download attempts produce an `audit_logs` row

### Branch: `feature/admin-review-dashboard` (Phase 3)

- **Agent responsibility:** Admin views, approve/reject flow, doc-type management.
- **Files likely touched:**
  - `app/(admin)/dashboard/page.tsx`
  - `app/(admin)/teachers/page.tsx`, `app/(admin)/teachers/[id]/page.tsx`
  - `app/(admin)/document-types/page.tsx`
  - `app/api/admin/documents/[id]/route.ts`
  - `app/api/admin/document-types/route.ts`, `app/api/admin/document-types/[id]/route.ts`
  - `lib/db/queries/admin-teachers.ts`, `lib/db/queries/admin-review.ts`, `lib/db/queries/document-types.ts`
  - `components/admin/*`
- **Files to avoid:**
  - `lib/db/schema.ts`, `middleware.ts`, `lib/auth/*`
  - `app/(teacher)/**`, `app/api/upload/route.ts`, `app/api/files/[id]/route.ts`
  - `lib/db/queries/teacher-documents.ts`
- **Dependencies:** `feature/auth-database-storage` merged; **soft dependency** on `feature/teacher-upload-flow` for end-to-end testing (admin needs real uploads to review — can use seed data otherwise)
- **Acceptance criteria:**
  1. Admin teacher list shows accurate completion % (approved required docs ÷ total required docs)
  2. Approving a `pending` doc sets `status=approved`, `reviewed_by`, `reviewed_at`, and `expires_at`
  3. Rejecting requires non-empty `rejection_reason`; rejected docs cannot be re-approved
  4. Admin can download any file; teacher cannot use admin endpoints (403)
  5. Doc-type create/edit/deactivate works; deactivating hides from teacher dashboard but preserves history
  6. Every admin mutation produces an `audit_logs` row

### Branch: `feature/renewal-tracking` (Phase 4)

- **Agent responsibility:** Expiry calculation, cron, email reminders, renewal supersession.
- **Files likely touched:**
  - `app/api/cron/expiry/route.ts`
  - `lib/expiry/*`
  - `lib/email/*`
  - `vercel.json` (or equivalent cron config)
  - Tiny additions to `lib/db/queries/teacher-documents.ts` and `lib/db/queries/admin-review.ts` to handle `superseded_by` (coordinate via PR)
- **Files to avoid:**
  - `lib/db/schema.ts` (the `superseded_by` and `expires_at` columns already exist — do not re-migrate)
  - `middleware.ts`, `lib/auth/*`
  - UI files outside small badge additions
- **Dependencies:** `feature/admin-review-dashboard` (needs approval flow to test expiry)
- **Acceptance criteria:**
  1. Approval correctly sets `expires_at`
  2. Cron run with shared secret marks past-due `approved` docs as `expired`; without secret → 401
  3. Teacher re-upload of an expired doc sets `superseded_by` on the new doc pointing to ... no — on the old doc pointing to the new (per §3.4). Verify direction in implementation.
  4. Reminder emails fire at 30 / 14 / 7 days before `expires_at` and are idempotent (no duplicates within a window)
  5. "Expiring soon" badge appears within 30 days of `expires_at`

### Branch: `feature/security-tests-docs` (Phase 5)

- **Agent responsibility:** Reports, audit viewer, rate limits, security headers, full test suite, deploy docs.
- **Files likely touched:**
  - `app/api/admin/reports/route.ts`, `app/(admin)/reports/page.tsx`
  - `app/(admin)/audit/page.tsx`, `app/api/admin/audit/route.ts`
  - `lib/audit/*`, `lib/rate-limit/*`
  - `next.config.ts` (headers — coordinate with foundation owner)
  - `middleware.ts` (rate-limit hooks — coordinate)
  - `tests/**` (unit, integration, e2e)
  - `docs/DEPLOY.md`, `docs/SECURITY.md`, `README.md`
- **Files to avoid:**
  - `lib/db/schema.ts`
  - Feature route handlers (only add tests around them, no behavior changes without a paired PR)
- **Dependencies:** Phases 1–4 merged
- **Acceptance criteria:**
  1. CSV export downloads with correct columns and row counts
  2. Audit log viewer paginates and filters by actor / action / date
  3. Rate limits engaged on `/api/auth/**` (5/min/IP), `/api/upload` (10/hour/user), `/api/files/**` (60/min/user)
  4. Response headers include HSTS, CSP, X-Frame-Options=DENY, X-Content-Type-Options=nosniff, Referrer-Policy=strict-origin-when-cross-origin
  5. All tests in §10 pass in CI

### Branch: `feature/email-reminders` (Phase 6)

- **Agent responsibility:** Build the entire automated email reminder system per §11 — cron, dispatch logic, templates, duplicate prevention, admin UI, logging.
- **Files likely touched:**
  - `app/api/cron/reminders/route.ts`
  - `lib/reminders/*` (dispatcher, milestone calculator, priority resolver, daily-cap check, idempotency key builder)
  - `lib/email/templates/*` (one file per `reminder_type`, plain-text + minimal HTML)
  - `lib/email/send.ts` (provider adapter wrapping Resend / SMTP)
  - `lib/db/queries/notification-logs.ts`, `lib/db/queries/reminder-settings.ts`, `lib/db/queries/job-runs.ts`
  - `app/(admin)/reminders/page.tsx`, `app/(admin)/reminders/settings/page.tsx`, `app/(admin)/reminders/logs/page.tsx`
  - `app/api/admin/reminders/settings/route.ts`, `app/api/admin/reminders/manual/route.ts`, `app/api/admin/reminders/preview/route.ts`
  - `components/admin/reminders/*`
  - `tests/unit/reminders/*`, `tests/integration/reminders/*`, `tests/e2e/reminders.spec.ts`
- **Files to avoid:**
  - `lib/db/schema.ts` — `reminder_settings`, `notification_logs`, and `scheduled_job_runs` already exist from Phase 1. Do NOT migrate.
  - `middleware.ts`, `lib/auth/*`
  - `app/(teacher)/**` (no teacher-facing UI changes for reminders — teachers receive emails, that's it)
  - `lib/storage/*` — reminders MUST NOT touch storage
  - `app/api/upload/route.ts`, `app/api/files/[id]/route.ts`
- **Dependencies:** Phases 1–4 merged. (Phase 5 is independent and may run in parallel.)
- **Acceptance criteria:**
  1. Cron POST with shared secret runs `reminder_dispatch` and writes one `scheduled_job_runs` row with accurate counts; without secret → 401
  2. UNIQUE `(teacher_id, milestone_key)` constraint prevents duplicate milestone sends across reruns
  3. Daily cap honored: teacher with multiple eligible reminders gets one `sent` and the rest `skipped(daily_cap)`
  4. Master toggle off → all candidates logged `skipped(reminders_disabled)`, zero provider calls
  5. Outgoing email payload (asserted via mock provider): zero attachments, zero storage URLs, zero file paths, zero cross-teacher data; single CTA links to `reminder_settings.portal_url`
  6. Admin can edit settings, preview each template, view logs (filterable), manually send, and see failed sends
  7. Manual send bypasses daily cap and writes `triggered_by='admin_manual'` + `actor_id`
  8. Post-expiration cadence: doc expired N days ago with no replacement triggers exactly one reminder per `post_expiration_interval_days` window
  9. Renewal stops the chain: once a new doc is uploaded AND approved, no further `expired_recurring` for the prior doc
  10. All §11.8 tests pass

---

## 8. Safety Rules for All Agents

1. **Never commit to `main` directly.** Always work on a `feature/*` branch and open a PR.
2. **Stay in your lane.** Touch only the files listed for your branch in §7. Read-only everywhere else.
3. **Do not duplicate schema or auth logic.** `lib/db/schema.ts` and `lib/auth/*` have one owner; all features consume helpers from them.
4. **Schema changes are coordinated.** If you need a column, open a schema-only PR first, land it, then rebase your feature branch.
5. **Never edit an existing Drizzle migration.** Only add a new numbered file.
6. **Never create public file links.** No signed URL longer than 60 seconds. No public S3 ACLs. All downloads via `/api/files/[id]`.
7. **Never skip permission checks.** Every query that returns user data takes `currentUser`. Every download route checks ownership or admin role.
8. **Never trust client-side validation alone.** Re-validate on the server with zod + magic-byte sniffing.
9. **Never use raw SQL with template strings.** Use Drizzle's parameterized API.
10. **Never log secrets, tokens, passwords, or full file contents.** Audit log metadata is structured and reviewed.
11. **Do not overbuild.** No HR, payroll, student records, gradebooks, messaging, calendars, multi-tenancy, or public registration. If a feature isn't in §6, do not build it.
12. **Do not add dependencies unilaterally.** `package.json` changes require a coordination PR.
13. **Do not bypass the audit helper.** All admin mutations and all file downloads call `lib/audit/log.ts`.
14. **Reminder emails never carry files or links to files.** No attachments, no signed URLs, no storage paths, no other teacher's data. Single CTA = portal login. See §11.3.
15. **Reminder dispatch goes through the dispatcher.** All sends — automated and manual — go through `lib/reminders/dispatch.ts` which enforces idempotency + daily cap + logging. No ad-hoc `sendEmail()` calls from feature code.
16. **Local storage adapter is dev-only.** Production deploys MUST use private object storage (S3 / R2 / Supabase Storage). See §11.7.

---

## 9. Definition of Done (per phase)

A phase is **not** complete until every item below is demonstrated on the branch's PR (screenshots, logs, or test output).

### Phase 1 DoD
- Repo builds clean (`pnpm typecheck`, `pnpm lint`, `pnpm build`) with zero errors
- All 8 tables exist after `pnpm db:migrate` (users, teacher_profiles, document_types, teacher_documents, audit_logs, reminder_settings, notification_logs, scheduled_job_runs)
- Seed creates 1 admin + 3 doc types + 1 `reminder_settings` row with documented defaults
- UNIQUE constraint on `notification_logs (teacher_id, milestone_key)` is in place
- Login works for seeded admin; role-based redirect verified
- Middleware blocks `/admin/**` for teachers and unauthenticated users
- `.env.example` documents every required env var
- README has setup steps a new contributor can follow

### Phase 2 DoD
- Teacher sees one row per active doc type with correct status
- 10 MB PDF upload succeeds; 11 MB blocked; `.exe` renamed `.pdf` blocked; `.svg` blocked
- Uploaded file is downloadable by owner via `/api/files/[id]`; 403 for other teachers; 401 unauthenticated
- Audit log records every upload and download
- No client ever receives a storage URL

### Phase 3 DoD
- Admin teacher list shows correct completion %
- Approve sets `expires_at`; reject requires reason and stores it
- Admin can download any file; teacher cannot access `/api/admin/**`
- Doc-type CRUD works; deactivation hides from teacher but preserves history
- Every admin mutation logged

### Phase 4 DoD
- Cron with secret marks expired docs; without secret returns 401
- Approval correctly sets `expires_at = reviewed_at + renewal_months`
- Renewal supersession chain correct (`superseded_by` populated)
- Expiring badge appears in both teacher and admin views
- (Reminder emails are NOT in this phase — see Phase 6)

### Phase 5 DoD
- CSV export matches DB counts
- Audit log viewer functional with filters
- Rate limits return 429 when exceeded
- Security headers present on every response
- All §10 tests pass in CI
- Deploy + security docs complete

### Phase 6 DoD
- Reminder cron with shared secret produces one `scheduled_job_runs` row per run with accurate counts; without secret → 401
- Each `reminder_type` template renders correctly in admin preview, plain-text + HTML, with zero attachments and zero storage URLs
- Milestone idempotency: rerunning cron same day produces zero new `sent` rows for already-sent milestones
- Daily cap enforced: extras logged `skipped(daily_cap)` with the highest-priority send winning
- Master toggle off → zero provider calls, all candidates logged `skipped(reminders_disabled)`
- Privacy assertions pass in tests: no attachments, no storage URLs, no cross-teacher fields, no auth-bypass tokens in body
- Admin can edit settings, preview templates, view filtered logs, manually send, and see failed sends
- All §11.8 tests pass in CI

---

## 10. Test Plan

### 10.1 Automated — unit (Vitest)

| Test | File | Asserts |
|---|---|---|
| Magic-byte sniff rejects mislabeled files | `tests/unit/file-validation.test.ts` | `.exe` renamed `.pdf` → rejected; real PDF → accepted; SVG → rejected |
| Expiry calculation | `tests/unit/expiry.test.ts` | Approval at T sets `expires_at = T + renewal_months`; "expiring soon" window correct |
| Audit log helper | `tests/unit/audit.test.ts` | Writes correct shape; never throws to caller |
| Filename sanitization | `tests/unit/sanitize.test.ts` | Path traversal, control chars, quotes stripped |
| Permission guard | `tests/unit/permissions.test.ts` | Teacher cannot read other teacher's doc; admin can |

### 10.2 Automated — integration (Vitest + test DB)

| Test | Asserts |
|---|---|
| Upload flow | Insert doc row + storage write + audit row, all in one request |
| Approve flow | Status transitions, sets `expires_at`, audit row |
| Reject flow | Requires reason; missing reason returns 400 |
| Renewal supersession | New upload after expiry creates new row; old row gets `superseded_by` link |
| Cron expiry | Approved doc past `expires_at` becomes `expired`; future stays `approved` |

### 10.3 Automated — end-to-end (Playwright)

| Test | Steps |
|---|---|
| Teacher upload | Login as teacher → upload PDF → see `pending` status → file appears in own list |
| Admin review | Login as admin → see teacher → approve doc → status becomes `approved` with expiry |
| File download — owner | Teacher downloads own file → 200 + correct bytes |
| File download — cross-tenant blocked | Teacher A tries `/api/files/<docB.id>` → 403 |
| Unauthenticated blocked | Anonymous hits `/teacher/dashboard` → redirect to `/login`; anonymous hits `/api/files/<id>` → 401 |
| Invalid file rejected | Upload `.exe` renamed `.pdf` → 415; upload 11 MB → 413 |
| Role escalation blocked | Teacher hits `/api/admin/documents/<id>` PATCH → 403 |
| Expiring badge | Seed doc with `expires_at` in 14 days → teacher dashboard shows "expiring soon" |

### 10.4 Manual smoke tests (every release)

1. Create a new teacher via admin → teacher receives magic link → logs in → sees empty dashboard
2. Teacher uploads a PDF for each required type → all show `pending`
3. Admin approves all → teacher dashboard shows all `approved` + expiry dates
4. Admin rejects one → teacher sees rejection reason → re-uploads → back to `pending`
5. Fast-forward `expires_at` in DB → run cron manually → doc shows `expired` → teacher re-uploads → supersession verified
6. Try to access another teacher's file URL while logged in as a different teacher → 403
7. Try every admin URL while logged in as teacher → 403 or redirect
8. Log out → try any protected URL → redirect to `/login`
9. Export CSV → open in spreadsheet → row count matches admin dashboard

---

## 11. Automated Email Reminder System

The portal sends scheduled, privacy-safe email reminders to teachers about their documents. This system is **a separate phase (Phase 6)** built after the core upload / review / expiration flow is working. Phase 1 only seeds harmless schema placeholders so later phases don't require schema rebuilds.

### 11.1 Reminder use cases

| # | Reminder type | Trigger condition |
|---|---|---|
| 1 | **Missing required document** | Teacher has no `teacher_documents` row (or no current non-superseded row) for an `active`, `required` `document_type`. Cadence: every `missing_doc_reminder_interval_days` (default 14), capped to one per teacher per day. |
| 2 | **Rejected document needs replacement** | Most recent doc for a required type has `status = 'rejected'` and no newer upload exists. Cadence: every `rejected_doc_reminder_interval_days` (default 7) until teacher uploads a replacement. |
| 3 | **Document expiring soon** | `status = 'approved'` AND `expires_at` falls on a milestone day (default 90, 60, 30, 14, 7 days from now). Each milestone fires at most once per document. |
| 4 | **Document expired** | `status = 'expired'` (just transitioned today). Send "expired today" reminder once. |
| 5 | **Expired — still not renewed** | `status = 'expired'` AND more than `post_expiration_interval_days` (default 7) have passed since the last reminder. Continue every interval until a new doc is uploaded AND approved (then chain stops automatically because new doc is `pending` or `approved`). |
| 6 | **Pending too long (admin alert)** | If `pending_review_days_before_admin_alert` is set and a `pending` doc is older than that threshold, send an alert to admin (not the teacher). Cadence: once per (admin, document). |

### 11.2 Default schedule

Reminders for **expiring approved documents** fire on these milestones, calculated as `expires_at - N days`:

- 90 days before expiration
- 60 days before expiration
- 30 days before expiration
- 14 days before expiration
- 7 days before expiration
- **On the expiration date** (the "expired today" reminder)
- **Every 7 days after expiration** until the teacher has uploaded a replacement AND the replacement has been approved

All milestone values are read from `reminder_settings`. Defaults above ship in the seed migration.

### 11.3 Privacy-safe email rules (non-negotiable)

1. **Never attach paperwork.** No PDF, image, or any binary in the email.
2. **No public file links.** Emails MUST NOT contain S3 / R2 / Supabase URLs, signed URLs, or any direct storage path.
3. **No private storage paths.** No `storage_key`, no UUID file paths, no internal IDs that map to files. Emails reference document types by their public `name` only (e.g. "Teaching Credential"), never by storage key.
4. **No other teacher's data.** Emails only reference the recipient's own documents. Multi-recipient sends are forbidden.
5. **General wording only.** "Your Teaching Credential expires on 2026-09-01. Please log in to the portal to upload a renewal." Do NOT include extracted document contents, OCR text, original filenames, reviewer names, or rejection reasons that contain PII — sanitize rejection reasons before including, or simply say "An item needs attention; log in to see details."
6. **Single CTA: log in.** The email contains exactly one action: a link to `reminder_settings.portal_url` (the portal login page). No deep links that bypass auth.
7. **Authentication is not bypassed by email.** Magic-link auth (used for login) is sent separately by Auth.js and is single-use, short-lived, and unrelated to reminders. Reminder emails MUST NOT embed any authentication token, session, or signed bypass link.
8. **No third-party tracking pixels** or click-trackers that leak document state to external services.
9. **Plain-text + minimal HTML.** Both parts. No external image hosts.
10. **Footer must include:** school name, an "if you received this in error" line, and the portal URL again as plain text.

### 11.4 Duplicate-prevention rules

The system MUST NOT spam teachers. Enforced by `notification_logs.milestone_key` UNIQUE per `(teacher_id, milestone_key)` and an in-process daily-cap check before send.

1. **At most one email per (teacher, milestone).** `milestone_key` examples:
   - `expiring_30:{teacher_document_id}`
   - `expired_today:{teacher_document_id}`
   - `expired_recurring:{teacher_document_id}:{YYYY-MM-DD}` (the date encodes the 7-day cadence)
   - `missing_required:{user_id}:{document_type_id}:{YYYY-MM-DD-of-cadence-bucket}`
   - `rejected_replace:{teacher_document_id}:{YYYY-MM-DD-of-cadence-bucket}`
2. **At most one automated reminder per teacher per day** when `max_one_email_per_teacher_per_day = true` (default). If multiple reminders would qualify on the same day, send the highest-priority one and log the rest as `skipped` with `skipped_reason = 'daily_cap'`.
3. **Manual admin sends override the daily cap** but still write a `notification_logs` row with `triggered_by = 'admin_manual'` and `actor_id = <admin>`.
4. **Skipped reminders are always logged** with a `skipped_reason`. Common reasons: `daily_cap`, `duplicate_milestone`, `reminders_disabled`, `no_email_on_file`, `teacher_inactive`.
5. **Send order priority** (when daily cap forces a choice): `expired_today` > `expired_recurring` > `expiring_7` > `expiring_14` > `expiring_30` > `expiring_60` > `expiring_90` > `rejected_replace` > `missing_required` > `pending_admin_alert`.
6. **Idempotent cron.** Re-running the cron in the same day must not produce duplicate sends.

### 11.5 Admin controls

Admin UI under `/admin/reminders` (added in Phase 6) provides:

1. **Master toggle** — flip `reminder_settings.enabled` on/off. When off, the cron still runs but logs everything as `skipped` with reason `reminders_disabled`.
2. **Edit settings** — sender name/email, portal URL, milestone day list, post-expiration interval, daily cap toggle, admin-alert threshold.
3. **Preview email templates** — render each `reminder_type` against a sample teacher/document (no send). Templates live in `lib/email/templates/*`.
4. **Notifications log viewer** — paginated `notification_logs` filtered by status, type, teacher, date.
5. **Manual send** — for a chosen teacher + reminder type, send immediately. Bypasses daily cap, still logs.
6. **Failed sends view** — quick filter on `status = 'failed'` with provider error message.
7. **Job runs view** — `scheduled_job_runs` history with counts and any error.

All admin reminder actions write an `audit_logs` row (e.g. `reminders.settings.update`, `reminders.manual_send`, `reminders.toggle`).

### 11.6 Build order placement

Email reminders are **Phase 6**. Prerequisites that must be on `main` first:

1. Auth works (Phase 1)
2. `teacher_profiles` exist (Phase 1)
3. `document_types` exist and are admin-managed (Phases 1 + 3)
4. Upload + review flow works (Phases 2 + 3)
5. `expires_at` is calculated correctly on approval (Phase 4)

**Phase 1 ships only the schema placeholders** for `reminder_settings`, `notification_logs`, and `scheduled_job_runs` (so later phases don't need a schema-rebuild migration) plus a seed row in `reminder_settings` with defaults. **No reminder logic, no email sending, no admin UI** in Phase 1.

### 11.7 Production note (storage)

Phase 1 uses a **local disk storage adapter for development only.** A deployment must not run with the local adapter. Production MUST use private object storage (S3, Cloudflare R2, Supabase Storage, or equivalent) with:

- Block Public Access enabled
- No `public-read` ACLs on any object
- All reads served exclusively through `/api/files/[id]` after auth + ownership checks
- Bucket credentials in environment variables, never committed
- Server-side encryption at rest (provider default acceptable; KMS preferred)

The reminder system reinforces this rule: emails NEVER carry file content or storage URLs (§11.3). The only way to view a document is to log in to the portal.

### 11.8 Test additions for Phase 6

| Test | Asserts |
|---|---|
| Milestone idempotency | Running cron twice in one day produces exactly one `sent` row per milestone |
| Daily cap | Teacher with 5 eligible reminders on the same day receives 1 send + 4 `skipped(daily_cap)` rows |
| Disabled master switch | `enabled = false` → every candidate logged as `skipped(reminders_disabled)`, zero sends |
| Privacy: no attachments | Outgoing email payload has zero attachments and zero storage URLs (assert via mock provider) |
| Privacy: no cross-teacher data | Reminder body rendered for teacher A never contains any field from teacher B |
| Manual override | Admin manual send bypasses daily cap, writes `triggered_by='admin_manual'` and `actor_id` |
| Post-expiration cadence | Doc expired 8 days ago with no replacement → reminder sent today; doc expired 6 days ago → skipped(duplicate) |
| Renewal stops the chain | New upload + approval cancels future `expired_recurring` sends for that doc |

---

# Summary (latest update)

## What changed in this revision

Added the **Automated Email Reminder System** as a first-class, governed feature of the portal. Specifically:

- **§2 Approved Architecture** — clarified that local storage is dev-only; production MUST use private object storage (S3 / R2 / Supabase Storage).
- **§3 Data Model** — table count grew from 5 to **8**. Added:
  - **§3.6 `reminder_settings`** — singleton config row with milestone defaults, daily-cap toggle, sender info, portal URL.
  - **§3.7 `notification_logs`** — append-only per-send log with UNIQUE `(teacher_id, milestone_key)` for idempotency, status enum, skipped reasons, manual-vs-cron source.
  - **§3.8 `scheduled_job_runs`** — per-cron-tick visibility for admins.
  - **§3.9 Relationships** — updated with the new tables.
- **§6 MVP Build Order** — added **Phase 6 — Automated Email Reminders** as the last phase. Phase 1 only ships the schema placeholders + a seeded `reminder_settings` row; no reminder logic, no email sending.
- **§7 Multi-Agent Branch Plan** — added **`feature/email-reminders`** with full responsibility, file ownership, dependencies, and 10 acceptance criteria.
- **§8 Safety Rules** — added rules 14–16: no files/links in reminder emails, all sends go through the single dispatcher, local storage adapter is dev-only.
- **§9 Definition of Done** — Phase 1 DoD now requires 8 tables + reminder_settings seed + the UNIQUE constraint. Phase 4 DoD scrubbed of reminder-email language (moved to Phase 6). Added a full **Phase 6 DoD**.
- **§11 Automated Email Reminder System** (NEW) — complete spec:
  - 11.1 six reminder use cases
  - 11.2 default schedule (90/60/30/14/7 days before + on expiration + every 7 days after)
  - 11.3 ten privacy-safe email rules
  - 11.4 duplicate-prevention rules with milestone-key idempotency and priority ordering
  - 11.5 admin controls (toggle, settings, preview, log viewer, manual send, failed view, job runs)
  - 11.6 build-order placement (Phase 6, after Phases 1–4)
  - 11.7 production storage note
  - 11.8 eight reminder-specific tests

## Is the foundation branch ready to start?

**Yes.** The spec is now complete enough for `feature/auth-database-storage` to begin. The Phase 1 scope grew slightly: the foundation must now create **8 tables** instead of 5, seed **1 `reminder_settings` row** with documented defaults, and add the UNIQUE constraint on `notification_logs (teacher_id, milestone_key)`. No reminder logic, no email provider integration, no admin reminder UI in Phase 1 — only schema placeholders.

## Did any earlier tables/schema change?

**No existing table was modified.** All five original tables (`users`, `teacher_profiles`, `document_types`, `teacher_documents`, `audit_logs`) are unchanged in shape. Three new tables were added (`reminder_settings`, `notification_logs`, `scheduled_job_runs`). Because they ship in the initial migration in Phase 1, no later phase needs a schema rebuild — Phase 6 can be pure application code on top of a stable schema.

## What should be built first

**Phase 1 foundation on branch `feature/auth-database-storage`.** Concretely:

1. Next.js 15 + TypeScript + Tailwind + shadcn/ui scaffold
2. Drizzle config + initial migration creating all **8** tables with constraints and indexes from §3
3. Seed: 1 admin user, 3 sample `document_types`, 1 `reminder_settings` row with defaults
4. Auth.js v5 with email magic link, role on user, login page, logout
5. Middleware enforcing session + role gating
6. Local storage adapter, with `/api/upload` and `/api/files/[id]` stubbed (501) so downstream branches have stable import paths
7. `.env.example`, `README.md`, CI running typecheck + lint

This is the only work that can start right now. Every other branch is blocked on this landing on `main`.
