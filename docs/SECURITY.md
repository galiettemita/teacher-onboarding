# Security model

This document covers the threat model, security controls, rate-limit choices,
audit-log shape, and incident response for the Teacher Onboarding Portal. It
is the security source of truth for the codebase. Architecture and data-model
rules live in [`PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md); deployment lives
in [`DEPLOY.md`](./DEPLOY.md).

---

## 1. Threat model summary

| # | Asset | Threat | Control |
|---|---|---|---|
| 1 | Teacher PII (name, email, phone, hire date) | Cross-tenant read by another teacher | Per-row ownership check on every read (`lib/db/queries/teacher-documents.ts`). Tested in `tests/unit/permissions.test.ts` + `tests/integration/cross-tenant.test.ts`. |
| 2 | Uploaded documents | Direct fetch from storage URL | Bucket is private; downloads go through `GET /api/files/[id]` which authenticates, authorises (owner OR admin), then streams bytes. No signed URLs leave the server. Response is regex-scanned for storage URLs / bucket names. |
| 3 | Admin actions (approve/reject/invite) | Replay / unauthorised mutation | `PATCH /api/admin/**` requires `role='admin'` enforced by middleware AND a re-check inside the handler. Every mutation writes one audit row via `lib/audit/log.ts`. |
| 4 | Service-role storage key | Accidental embedding in client bundle | Build-time grep (`pnpm test:leakage`) blocks the release if the literal value or the strings `service_role`, `service-role`, or `SUPABASE_SERVICE_ROLE_KEY` appear in `.next/static/**`. |
| 5 | Auth credentials | Brute force / credential stuffing | Rate limit `/api/auth/**` to 5 requests / minute / IP. Returns `429 Retry-After`. |
| 6 | Upload endpoint | Denial of service via large/abusive files | 10 MB hard cap, magic-byte sniff, 10 uploads / hour / user rate limit, server-built storage key. |
| 7 | File download endpoint | Hot-loop enumeration | 60 downloads / minute / user rate limit. UUID-only id path; non-UUID = 404 without DB lookup. |
| 8 | Cron endpoint | Unauthorised expiry sweep / DoS | `Authorization: Bearer ${CRON_SECRET}` required; constant-time compare. |
| 9 | Audit log | Tampering / silent failure | Single chokepoint writer (`lib/audit/log.ts`). Never throws to caller. Read-only access via admin-only viewer. |
| 10 | Cookies & XSS | Session theft | `HttpOnly`, `Secure`, `SameSite=Lax`. CSP requires a per-request nonce for all `<script>`s (`'strict-dynamic'`). `X-Frame-Options: DENY` blocks clickjacking. |
| 11 | **CSV formula injection (CWE-1236)** | A teacher whose name starts with `=`, `+`, `-`, `@`, TAB, or CR triggers formula execution on the secretary's machine when she opens the export in Excel / Google Sheets / LibreOffice. | `lib/reports/csv.ts#escapeCell` prepends `'` to any cell starting with one of those characters before RFC 4180 quoting. Tested in `tests/unit/csv.test.ts`. |
| 12 | **Storage credential leakage to client bundle** | A change accidentally references `SUPABASE_SERVICE_ROLE_KEY` from a client component. The leakage check would catch the literal value at build time. | `scripts/leakage-grep.mjs` runs on every CI build; fails the build if any sentinel string or literal env value is found in `.next/static/**`. Adapter constructed lazily server-side only (`lib/storage/index.ts` is imported only from route handlers). |
| 13 | **Email header injection (CWE-93)** | A caller-supplied value (teacher name, doc-type name) lands in the `To`, `Subject`, or `From` header of an invite email. A CR/LF in that value could smuggle an extra `Bcc:` header on a vulnerable transport, or break out of the MIME envelope. Multi-recipient sends would be possible. | `lib/email/sanitize.ts` validates every field that enters the outbound payload: rejects `\r`/`\n`/other control bytes, caps lengths, requires a single plain RFC-5321-shaped address for `to` (no commas, no angle-brackets, no display names). All sends route through the single `sendEmail` dispatcher (`lib/email/send.ts`); the `EmailMessage` type forbids `cc`/`bcc`/`replyTo`/`attachments` at the type level. Tested by `tests/unit/teacher-invite-email.test.ts` (sanitisation runs BEFORE any provider call). |
| 14 | **Email provider key leakage** | `RESEND_API_KEY` / `SENDGRID_API_KEY` accidentally referenced from a client component (e.g. via an ill-prefixed `NEXT_PUBLIC_` variant) or interpolated into a string that ends up in `.next/static/**`. | `scripts/leakage-grep.mjs` scans `.next/static/**` for the sentinel strings (`RESEND_API_KEY`, `SENDGRID_API_KEY`) + a literal-value sweep when the key is set in the environment. The provider adapter throws on construction if `EMAIL_PROVIDER=resend`/`sendgrid` and the matching key is missing — fail-loud rather than silent no-op. |

Out of scope: nation-state actors, supply-chain compromise of `next` itself,
physical access to Supabase infra. We trust Vercel and Supabase. Compromise of
the deployment platform is treated as a total breach.

## 2. Security headers

Two surfaces:

1. **Static headers** in [`next.config.ts`](../next.config.ts) `headers()`
   — applied to every response: `Strict-Transport-Security`,
   `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
   `Permissions-Policy`.
2. **Per-request CSP** in [`middleware.ts`](../middleware.ts) +
   [`lib/security/csp.ts`](../lib/security/csp.ts) — the CSP carries a
   fresh nonce per response and is the only place CSP is set. Browsers
   intersect multiple CSP headers, so emitting it twice (statically AND
   from middleware) would defeat the nonce.

| Header | Value | Rationale |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | 2-year HSTS, subdomain included, preload-list eligible. |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'nonce-<random>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` | Per-request nonce. `'strict-dynamic'` extends trust from the nonced loader script to chunks it loads, so we don't enumerate chunk URLs. Inline `<style>` is required by Next.js's chunked stylesheet runtime — we accept it. No remote XHR. Cannot be framed. |
| `X-Frame-Options` | `DENY` | Belt for `frame-ancestors 'none'`. |
| `X-Content-Type-Options` | `nosniff` | Stops MIME-sniff-driven XSS on downloads. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Outbound links don't leak path or query. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | We don't use these powerful features and want browsers to enforce that. |

### Why per-request CSP, not static `script-src 'self'`?

Next.js App Router emits inline `<script>self.__next_f.push(…)</script>`
tags for RSC streaming and hydration. Under `script-src 'self'` browsers
refuse to execute them; the page loads chrome but never hydrates and
forms / navigation are dead. The middleware generates a 128-bit base64
nonce, sets it on the `x-nonce` request header (Next reads this and
stamps `nonce="…"` onto every inline script), and includes it in the
response CSP. Verified end-to-end against `pnpm start` (header nonce ==
body nonce on every render) and tested at
`tests/integration/middleware-routing.test.ts` and
`tests/unit/security-headers.test.ts`.

## 3. Rate limits

Implementation: `lib/rate-limit/*`, wired in `middleware.ts`.

### Choice: in-memory fixed-window per worker

MVP-acceptable rationale:

1. The portal serves ≲100 teachers and one secretary. There's no
   traffic profile that would defeat a per-worker counter at our scale.
2. Cross-worker rate limiting requires Redis / Upstash. Adding a
   datastore dependency for our scale is over-engineering. When the user
   count or traffic grows enough that per-worker limits are insufficient,
   swap `lib/rate-limit/index.ts` for an Upstash-Redis client behind the
   same `check()` signature — one-file change.

### Honest limits of the current design

The limiter lives in-process. On Vercel's Edge runtime (where
`middleware.ts` runs) each worker instance is short-lived: a cold start
spins up a fresh worker with an empty counter Map. **Concretely this
means a determined attacker can extend their effective budget by
forcing cold-starts, and limits are not shared across regions.** For
our threat model (slow-burn brute force from a small number of IPs
against an audience of ≲100 known teachers) this is acceptable. It
would not be acceptable for a public-signup app or anything customer-
facing — file that under "swap to Upstash before scaling out".

### Limits

| Prefix | Subject | Budget |
|---|---|---|
| `/api/auth/**` | IP (X-Forwarded-For leftmost, fallback X-Real-IP) | 5 / minute |
| `/api/upload` | session user id (fallback: IP) | 10 / hour |
| `/api/files/**` | session user id (fallback: IP) | 60 / minute |

Exceeded → `429 Too Many Requests`, `Retry-After: <seconds>`,
`X-RateLimit-Reset: <unix-seconds>`. Tested in `tests/unit/rate-limit*.test.ts`.

### Notes on IP spoofing

The IP-keyed `/api/auth/**` rule trusts the platform load balancer's
`X-Forwarded-For` header. A client that controls the leftmost value can
forge an IP and get a fresh bucket. The mitigation is platform-level: only
deploy behind a proxy you trust to strip / rewrite XFF.

## 4. No service-role key leakage (mandatory build-time check)

The Supabase service-role key has full database+storage privileges. If it
ever lands in a client-shipped JS bundle the attack surface is unlimited.
The repo's invariant: **the service-role key is server-only**.

Enforcement:

1. The Supabase client is only ever imported in route handlers and server
   utilities. We never use `NEXT_PUBLIC_` for it.
2. After `pnpm build`, `pnpm test:leakage` walks `.next/`:
   - **literal value** of `SUPABASE_SERVICE_ROLE_KEY` (read from env or
     `.env.test`) anywhere under `.next/` → **fail**;
   - the strings `service_role`, `service-role`, or
     `SUPABASE_SERVICE_ROLE_KEY` anywhere under `.next/static/**` (the
     client-shipped chunks) → **fail**.

Failing this check is a release blocker. CI runs it on every PR.

### Defence in depth: refuse to silently pass

`scripts/leakage-grep.mjs` **exits 1** when no `SUPABASE_SERVICE_ROLE_KEY`
is available in env or `.env.*` files — a misconfigured CI job that
forgets to set the env var cannot accidentally turn the literal-value
sweep into a no-op. Pass `--skip-literal` to intentionally bypass the
sweep on local runs where the developer hasn't configured Supabase. CI
sets the env var, so the production gate runs every time.

## 5. Audit log

### Schema (`audit_logs`)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `actor_id` | uuid → users.id (set null on delete) | `null` for system actions (e.g. cron). |
| `action` | text | One of the enum in `lib/audit/log.ts#AuditAction`. |
| `target_type` | text | `document`, `doc_type`, `user`, `file`, `teacher_document`. |
| `target_id` | uuid | Nullable for bulk-target actions like `report.export`. |
| `metadata` | jsonb | Action-specific structured data. No PII beyond the subject the action concerns. No file contents. No secrets. |
| `created_at` | timestamptz | |

Indexes: `(actor_id, created_at)`, `(target_type, target_id)`,
`(action, created_at)`.

### What is logged

Every admin mutation + every file download + every report export. The full
list is in `lib/audit/log.ts#AuditAction`:

- `document.upload`, `document.approve`, `document.reject`
- `doc_type.create`, `doc_type.update`, `doc_type.deactivate`
- `user.invite`
- `file.download`, `file.missing`
- `report.export`

### Privacy rules for `metadata`

- Never include raw passwords, tokens, signed URLs, or full file bytes.
- Reference users by `id` (the column already does), not name. Email is
  acceptable in `user.invite.metadata.email` because the row is about that
  user's account.
- Reference documents by `id`. Include `mime`, `sizeBytes`, `sha256` —
  these are useful for incident triage and contain no content.
- Rejection reasons are stored on the document row (`rejection_reason`),
  not in audit metadata. The audit row only needs `documentId`.

### Read access

Only admins can read the audit log. The viewer at `/admin/audit` and its
API counterpart `/api/admin/audit` are gated by middleware AND a
re-check inside each handler. Filters: `actorId`, `action`, `targetType`,
`since`, `until`. Pagination is mandatory (default page size 25, max 100).

## 6. Incident response

When you notice or are told about something bad (suspected compromise,
unexpected mass deletion, a public bug report), follow this runbook in
order.

### 6.1 First 15 minutes — contain

1. **Confirm the incident is real.** A failing health check or a stuck
   deploy is not an incident.
2. **Rotate `AUTH_SECRET`** (Vercel env var, then redeploy). This signs
   all existing sessions out and forces every user — including the
   attacker — to log in again.
3. If a service-role key compromise is suspected:
   - Rotate `SUPABASE_SERVICE_ROLE_KEY` in the Supabase dashboard.
   - Set the new value in Vercel env vars; redeploy.
   - The old key is invalidated instantly server-side.
4. If active malicious traffic is observed, temporarily tighten rate
   limits by editing `lib/rate-limit/rules.ts` and hot-deploying. Do not
   disable auth.

### 6.2 First hour — investigate

1. Pull the audit log:
   ```sql
   select * from audit_logs
   where created_at > now() - interval '24 hours'
   order by created_at desc;
   ```
2. Cross-reference suspicious `actor_id` values with `users.email`. Look
   for `user.invite` rows you didn't initiate. Look for unusual
   `file.download` patterns (one actor pulling many docs in a short
   window).
3. If a teacher account is suspected of compromise, set
   `users.password_hash = null` and `users.email_verified_at = null` for
   that user. They will be locked out until an admin re-invites them.
4. Pull `scheduled_job_runs` to confirm cron behavior wasn't tampered with.

### 6.3 First day — disclose + remediate

1. Notify the school administrator and (if state law requires) affected
   teachers. Use a channel outside the portal.
2. Snapshot the database (Supabase Backups) and capture the current
   Vercel deployment id. Both are needed for forensic analysis.
3. If a code defect enabled the incident, file a bug, then ship a fix
   plus a regression test that fails on the old code and passes on the
   new code. Do not weaken a permission check to make a test pass.

### 6.4 Followup

- Add a runbook entry: what happened, how it was detected, what was
  fixed. Keep these in `docs/incidents/<date>.md` (create the folder as
  needed).
- If the root cause was a missing test, add the missing test.
- If the root cause was a missing control, add it and document the
  rationale here.

## 7. Test isolation

All tests in this repo run against module-level mocks of `lib/db/client`,
`lib/storage`, `lib/auth/config`, and `lib/audit/log`. They do **not**
touch a real Postgres instance. Vitest's worker isolation (`pool: "forks"`)
means each file gets a fresh module registry; mocks do not leak.

This is the MVP choice: a real test database would let us catch
constraint-level regressions but adds significant CI complexity for our
scale. When the team grows or schema changes start carrying risk, swap in
a per-CI ephemeral Postgres + a separate `tests/db/` suite. The mocked
tests stay as-is.

What this means for you:

- **Never** run tests against the dev or staging database. The mocks
  prevent it by default; if you ever bypass them, set
  `DATABASE_URL=postgres://test:test@localhost:5432/test_throwaway` and
  point at a disposable instance.
- Schema-level changes still need a manual smoke against a real DB before
  merging.
