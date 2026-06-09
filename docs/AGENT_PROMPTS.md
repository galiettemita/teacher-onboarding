# Agent Prompts — Teacher Onboarding Portal

> **Source of truth:** `PROJECT_CONTEXT.md` at repo root. These prompts are scoped, executable extracts. If anything here conflicts with `PROJECT_CONTEXT.md`, the doc wins. Every agent reads `PROJECT_CONTEXT.md` end-to-end before touching code.

---

## Execution order

```
main (Phase 1: feature/auth-database-storage merged)
 ├── feature/teacher-upload-flow      ─┐
 ├── feature/admin-review-dashboard   ─┴── both merge before Agent 4 starts
                                             └── feature/renewal-tracking
                                                  └── feature/security-tests-docs
```

- **Agent 2 ‖ Agent 3** run in parallel after Phase 1 lands. File ownership is disjoint per §7.
- **Agent 4** waits for Agent 3 — renewal logic must be wired into the admin approve path and tested against real approvals.
- **Agent 5** waits for Agents 2, 3, 4 — every meaningful security/QA assertion needs the real features merged.

---

## Universal rules (every agent must obey)

1. **First action:** read `PROJECT_CONTEXT.md` end-to-end. Specifically: §3 (data model), §4 (file storage), §5 (roles + login), §7 (your branch's file lists), §8 (safety), §9 (your phase's DoD), §10 (test plan).
2. **Branch:** use the exact branch name from §7. Do not invent variants. Never commit to `main`.
3. **Stay in your lane:** only touch files listed in your "FILES YOU OWN" section. Everywhere else is read-only.
4. **Schema-change STOP rule:** if you believe you need a column, table, index, or migration, **stop coding**. Do not edit `lib/db/schema.ts` or add a migration in your feature branch. Open a schema-only PR first per §8 rule 4, get it merged, rebase, then continue. The schema PR must also update `PROJECT_CONTEXT.md` §3.
5. **Blocked-dependency rule:** if you need data another agent owns (e.g. an uploaded doc, an approved doc), **seed it via `scripts/seed.ts`**. Do NOT build the missing feature yourself. If you cannot seed it, stop and report the blocker.
6. **No reminder emails before Phase 6.** Do not import `lib/email/*` or call any email provider in branches 2/3/4/5. The only exception is the Auth.js magic-link send (handled by the foundation).
7. **No public file URLs, ever.** All file reads go through `GET /api/files/[id]`. Supabase URLs, bucket names, storage keys, signed URLs — none of these may appear in a client-visible response body, client JS bundle, or email.
8. **Server-side checks only.** Client-side gating is cosmetic. Every permission decision happens on the server using a freshly-loaded session + DB-resolved role.
9. **Audit everything that matters.** Every admin mutation, every file download (by anyone), every login attempt writes an `audit_logs` row via `lib/audit/log.ts`. Bypassing the helper is forbidden.
10. **No raw SQL with template strings.** Use Drizzle parameterized queries only.
11. **No new dependencies without a coordination PR.** `package.json` changes need approval. If you need a new package, propose it in the PR comments first.
12. **Definition-of-Done in your PR description.** Paste your phase's DoD checklist from §9 and check off each item with evidence (test output, screenshot, log line, or one-line prose). PRs missing this get rejected.
13. **Before opening a PR:** run `pnpm typecheck && pnpm lint && pnpm build && pnpm test`. Paste the tail of each command's output in the PR description.
14. **If a test passes only by removing a permission check, the test is wrong.** Add a TODO and report it. Never weaken security to make tests green.


3. Do not change schema, auth, middleware, storage interfaces, or environment variables unless your assigned prompt explicitly allows it. If you believe a schema/auth/storage change is required, STOP and report the exact reason before editing.

4. Do not build another agent’s feature. If you are blocked by a missing dependency, use seed data, mocks, or clearly documented temporary fixtures. Do not implement the missing feature yourself.

5. Do not expose public file URLs, Supabase signed URLs, raw storage paths, or private file keys to the browser. All file access must go through protected server routes.

6. All permission checks must happen server-side. Frontend hiding is not security.

7. All upload/download/approve/reject actions must create audit log rows when that phase owns the behavior.

8. File uploads must validate size and type server-side. Do not rely only on file extension or browser MIME type.

9. PR/report must include:

* branch name
* files changed
* forbidden files touched, if any
* commands run
* lint/typecheck/build/test results
* manual smoke tests
* known limitations
* whether the work satisfies the Definition of Done in PROJECT_CONTEXT.md §9

10. Do not claim success if a test/check was not run. Say clearly what was not run and why.

11. If you remove or weaken a permission check to make code work, that is a failure. Stop and report it.

12. Keep the UI grandma-friendly: big buttons, plain English, clear status labels, mobile-first, no clutter.

13. Automated emails are Phase 6 only. Do not send emails, add reminder dispatch jobs, or build email UI unless assigned Phase 6.

---

# AGENT 2 — Teacher Upload Flow

**Branch:** `feature/teacher-upload-flow`
**Phase:** 2
**Runs after:** `feature/auth-database-storage` is merged to `main`.
**Runs in parallel with:** Agent 3 (`feature/admin-review-dashboard`). File ownership is disjoint — verify by diff before merging.

## Mission

Build the entire teacher-facing experience: dashboard, upload flow, own-document list, and own-file download. Grandma-friendly UI. Zero admin features. Zero email sends. Zero schema changes.

## Inputs you can rely on (from Phase 1 foundation)

- `users`, `teacher_profiles`, `document_types`, `teacher_documents`, `audit_logs` tables exist.
- Auth.js v5 session is wired. `middleware.ts` already gates `/teacher/**` to `role='teacher'`.
- `lib/auth/session.ts` exposes `getCurrentUser()` returning `{ id, email, role } | null`.
- `lib/storage/index.ts` exposes a storage adapter with `put(key, stream, contentType)` and `getStream(key)`.
- `lib/audit/log.ts` exposes `auditLog({ actorId, action, targetType, targetId, metadata })`.
- `/api/upload` and `/api/files/[id]` exist as 501 stubs — you implement them.
- Seed data: 1 admin user, 3 `document_types`, 1 `reminder_settings` row.

If any of the above is missing, **stop**. File a "Phase 1 incomplete" report instead of working around it.

## Outputs (what you ship)

1. **`/teacher/dashboard`** — one card per active `document_type`, showing status badge and a primary action button ("Upload" / "Replace" / "View"). Progress summary at top ("4 of 7 documents approved").
2. **`/teacher/documents`** — flat list of the current teacher's documents with type, status, upload date, expiry date (if present), and a Download button per row.
3. **`POST /api/upload`** — accepts a single file + `document_type_id`. Runs the full §4.6 validation pipeline. Returns 201 + the new document row id, OR a precise error code.
4. **`GET /api/files/[id]`** — streams a file ONLY to its owner (or any admin). Streams from the storage adapter. Sets the required headers. Writes an audit log entry.
5. **Status badge component** at `components/status-badge.tsx` — reusable, accepts a `status` prop including the derived states `missing` and (if Agent 4 has merged) `expiring_soon`.

## Status mapping you render (read-only — don't store derived states)

| UI label | Source |
|---|---|
| Missing | No current (non-superseded) `teacher_documents` row exists for this `document_type` |
| Pending review | `status = 'pending'` |
| Approved | `status = 'approved'` AND not expiring soon |
| Expiring soon | `status = 'approved'` AND Agent 4's `isExpiringSoon(doc)` returns true. If Agent 4 not merged, hide this state. |
| Rejected | `status = 'rejected'` (show `rejection_reason` inline) |
| Expired | `status = 'expired'` |

**Never** introduce new values into the `teacher_documents.status` column. Derived states live in render code.

## UI requirements (grandma-friendly)

- Mobile-first. Test at 360px wide.
- Base font ≥ 18px. Buttons ≥ 48px tall. Tap targets ≥ 44px.
- Plain English. No jargon. "Pending review" not "QUEUED". "Expires Sept 1, 2026" not "exp: 2026-09-01T00:00:00Z".
- One primary action per card. Secondary actions in a clearly-labeled menu, not buried.
- Errors written like a human: "That file is too big. The largest we can accept is 10 MB." Not "ERR_413_PAYLOAD_TOO_LARGE".
- Loading states for every async action. Never let the user wonder if a click did anything.
- Keyboard navigable. Focus rings visible. `aria-label` on icon-only controls.

## FILES YOU OWN (touch freely)

- `app/(teacher)/dashboard/page.tsx`
- `app/(teacher)/documents/page.tsx`
- `app/api/upload/route.ts`
- `app/api/files/[id]/route.ts`
- `lib/db/queries/teacher-documents.ts` *(create)*
- `lib/validation/file.ts` *(create — magic-byte sniff + zod schemas)*
- `components/teacher/*` *(create)*
- `components/upload/*` *(create)*
- `components/status-badge.tsx` *(create)*
- `tests/unit/file-validation.test.ts`
- `tests/integration/upload.test.ts`
- `tests/integration/file-download.test.ts`

## FILES YOU MUST NOT TOUCH

- `lib/db/schema.ts` — schema-change STOP rule
- `drizzle/**` — no new migrations
- `middleware.ts`, `lib/auth/*` — auth is owned by foundation
- `app/(admin)/**`, `app/api/admin/**` — Agent 3's lane
- `lib/storage/*` internals — consume only via `lib/storage/index.ts`
- `lib/supabase/server.ts` — service-role client is server-only and owned by foundation
- `lib/audit/log.ts` internals — consume only
- `lib/email/*`, `lib/reminders/*` — Phase 6
- `package.json` / `pnpm-lock.yaml` — coordinate before adding deps

## Build steps (in order)

### Step 1 — Data access layer

Create `lib/db/queries/teacher-documents.ts` with these functions. **Every function takes `currentUser` and filters by it. No exceptions.**

```ts
// All signatures take currentUser; throw if currentUser.role !== 'teacher'
listMyDocumentTypesWithStatus(currentUser): Promise<Array<{
  documentType: DocumentType;
  currentDoc: TeacherDocument | null;   // most recent non-superseded
  uiStatus: 'missing' | 'pending' | 'approved' | 'rejected' | 'expired' | 'expiring_soon';
}>>

listMyDocuments(currentUser): Promise<TeacherDocument[]>  // includes superseded for history

getMyDocumentById(currentUser, id): Promise<TeacherDocument | null>  // returns null if not theirs

insertMyDocument(currentUser, input: {
  documentTypeId: string;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}): Promise<TeacherDocument>
```

**Test:** `tests/unit/permissions.test.ts` (add cases): Teacher A cannot `getMyDocumentById` Teacher B's doc id. `insertMyDocument` always writes `user_id = currentUser.id` regardless of input.

### Step 2 — File validation

Create `lib/validation/file.ts`:

```ts
export const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const MAX_BYTES = 10 * 1024 * 1024;  // 10 MB

export async function sniffAndValidate(buffer: Buffer): Promise<
  | { ok: true; mime: typeof ALLOWED_MIME[number]; ext: 'pdf' | 'jpg' | 'png' }
  | { ok: false; reason: 'unsupported_type' | 'corrupt' }
>;

export function sanitizeFilename(name: string): string;  // strips control chars, quotes, slashes, collapses to [A-Za-z0-9._-]
```

Use the `file-type` npm package (propose in PR if not already in `package.json`). Never trust the `Content-Type` header. Magic bytes only.

**Test:** `tests/unit/file-validation.test.ts` — `.exe` renamed `.pdf` rejected; SVG rejected; real PDF/JPEG/PNG accepted; truncated PDF rejected; filename `../../../etc/passwd` sanitized to `etcpasswd`.

### Step 3 — Upload route

Implement `POST /api/upload` in **this exact order**:

1. `const user = await getCurrentUser()` — if null, return **401**.
2. If `user.role !== 'teacher'`, return **403**.
3. Parse `multipart/form-data`. Read `document_type_id` (zod-validate as uuid).
4. Verify `document_type_id` exists, is `active`, is required-or-optional (load type row).
5. Check `Content-Length` header. If > `MAX_BYTES`, return **413** before reading the body.
6. Stream the file into a buffer with a hard cap; if the cap is exceeded mid-stream, kill the stream and return **413**.
7. Run `sniffAndValidate(buffer)`. If `!ok`, return **415** with reason.
8. Compute SHA-256.
9. Build storage key: `teachers/${user.id}/${document_type_id}/${crypto.randomUUID()}.${ext}`.
10. `storage.put(key, buffer, mime)`. If put fails, return **500** and DO NOT insert a DB row.
11. `insertMyDocument({ ..., storageKey: key, ... })` with `status = 'pending'` (default).
12. `auditLog({ actorId: user.id, action: 'document.upload', targetType: 'teacher_document', targetId: newDoc.id, metadata: { mime, sizeBytes, sha256 } })`.
13. Return **201** + `{ id: newDoc.id }`.

**The client never sees the storage key.**

**Test:** `tests/integration/upload.test.ts` — full success creates row + storage object + audit log all in one request; 413/415/401/403 cases; rollback on storage failure (no orphan DB row).

### Step 4 — Download route

Implement `GET /api/files/[id]` in **this exact order**:

1. `const user = await getCurrentUser()` — if null, return **401**.
2. Load doc by id from DB. If not found, return **404**.
3. **Permission check:** `if (doc.user_id !== user.id && user.role !== 'admin') return 403`. (Admin path is intentional — Agent 3 will hit this same route.)
4. `const stream = await storage.getStream(doc.storage_key)`. If missing, return **404** and log a `file.missing` audit entry.
5. Set response headers:
   - `Content-Type: <doc.mime_type>`
   - `Content-Disposition: attachment; filename="${sanitizeFilename(doc.original_filename)}"`
   - `Cache-Control: private, no-store`
   - `X-Content-Type-Options: nosniff`
6. `auditLog({ actorId: user.id, action: 'file.download', targetType: 'teacher_document', targetId: doc.id, metadata: { byRole: user.role } })`.
7. Stream the body.

**Never** return a Supabase URL or a signed URL in the response body. If you must use a signed URL internally, generate it server-side with a ≤60s TTL and `302` to it — the URL must not appear in any JSON payload.

**Test:** `tests/integration/file-download.test.ts` — owner gets 200 + bytes; other teacher gets 403; admin gets 200; anonymous gets 401; response body contains no `supabase`, no bucket name, no `storage_key`; required headers present; audit row written.

### Step 5 — Teacher dashboard UI

`app/(teacher)/dashboard/page.tsx`:

- Server component. Calls `listMyDocumentTypesWithStatus(user)`.
- Top: progress card ("**4 of 7** required documents approved", visual progress bar).
- Grid of cards, one per `document_type`. Card content: name, description, status badge, primary action button.
- Click "Upload" → opens upload modal (client component) → posts to `/api/upload` → on success, refresh server data.
- Show `rejection_reason` inline on rejected cards.

### Step 6 — Teacher documents list

`app/(teacher)/documents/page.tsx`:

- Server component. Calls `listMyDocuments(user)`.
- Table: type, status, uploaded_at, expires_at (or "—"), Download.
- Download link is a plain `<a href="/api/files/{id}">` — the route handles auth + headers.

### Step 7 — Status badge

`components/status-badge.tsx`:

- Pure function of `uiStatus`. Maps to color + label + (optional) icon.
- Reused by Agent 3 in admin views — keep the API minimal: `<StatusBadge status={uiStatus} />`.

## Test contract (must all pass before PR)

| Test file | Must assert |
|---|---|
| `tests/unit/file-validation.test.ts` | Magic-byte sniff rejects `.exe`-as-`.pdf`, SVG, truncated PDF; accepts real PDF/JPEG/PNG; filename sanitization strips traversal |
| `tests/unit/permissions.test.ts` | `getMyDocumentById` returns null for other-teacher's doc; `insertMyDocument` forces `user_id = currentUser.id` |
| `tests/integration/upload.test.ts` | 201 happy path writes row + storage + audit; 401 anon; 403 admin trying to upload (admins don't upload); 413 oversize; 415 wrong type; storage failure leaves no DB row |
| `tests/integration/file-download.test.ts` | Owner 200 + bytes; other teacher 403; admin 200; anon 401; body contains zero storage URLs; headers present; audit row written |

## Definition of Done (paste into PR description and check off)

- [ ] Teacher sees one card per active `document_type` with correct derived status
- [ ] Progress summary shows accurate "X of Y" count
- [ ] 10 MB PDF upload succeeds; 11 MB blocked with 413; `.exe`-as-`.pdf` blocked with 415; SVG blocked with 415
- [ ] Uploaded doc is downloadable by owner via `/api/files/[id]`; other teacher gets 403; anonymous gets 401
- [ ] Audit log has one row per upload and one row per download (verify by query)
- [ ] No client response body or rendered HTML contains a Supabase URL, bucket name, signed URL, or `storage_key`
- [ ] Download response includes `Content-Disposition: attachment`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`
- [ ] `pnpm typecheck && pnpm lint && pnpm build && pnpm test` all green (paste tails)

## Anti-goals (do NOT do)

- Build any admin route or admin UI
- Send any email
- Change `lib/db/schema.ts` or add a migration
- Modify `middleware.ts` or `lib/auth/*`
- Introduce new values into `teacher_documents.status`
- Display another teacher's anything
- Return a storage URL in any response
- Trust the client's `Content-Type` header
- Use `file-type@latest` if it isn't pinned — propose a specific version in PR

## PR description template

```
## What
Phase 2: teacher dashboard + upload + download.

## DoD checklist
- [ ] (paste from above with evidence per item)

## Test results
$ pnpm test
... (paste tail)

## Manual verification
- Logged in as teacher@example.com, uploaded sample.pdf, saw "pending"
- (etc.)

## Files changed
(list)

## Known limitations
- Virus-scan stub returns "clean" unconditionally (per spec)
- (anything else)
```

---

# AGENT 3 — Admin Review Dashboard

**Branch:** `feature/admin-review-dashboard`
**Phase:** 3
**Runs after:** `feature/auth-database-storage` is merged to `main`.
**Runs in parallel with:** Agent 2. File ownership is disjoint.
**Soft dependency on Agent 2:** to test approve/reject end-to-end, you need uploaded docs. If Agent 2 isn't merged, **seed test uploads via `scripts/seed.ts`** — do NOT build the upload flow.

## Mission

Build the entire admin/secretary experience: teacher list with completion %, per-teacher document review, approve/reject with audit, doc-type CRUD, and the admin-invites-teacher flow. Zero teacher-facing changes. Zero email sends beyond the Auth.js magic-link invite. Zero schema changes.

## Inputs you can rely on (from Phase 1 foundation)

- All tables exist; seed has 1 admin user.
- Auth.js session + `getCurrentUser()` available.
- `middleware.ts` gates `/admin/**` and `/api/admin/**` to `role='admin'` (teachers get 403, anonymous gets 401).
- `lib/audit/log.ts` available.
- `/api/files/[id]` is implemented by Agent 2 OR is still a 501 stub. **Your admin download path uses the SAME route** — do NOT build an admin-only download shortcut.
- Auth.js `signIn('email', { email })` can send magic links — use this for invites.

## Outputs (what you ship)

1. **`/admin/dashboard`** — counts: total teachers, complete teachers, incomplete, pending reviews, expired (if Agent 4 merged — otherwise zero).
2. **`/admin/teachers`** — searchable, filterable list of all teachers with completion %, last-activity date, status summary.
3. **`/admin/teachers/[id]`** — per-teacher view. Profile + all current documents with status, upload date, review date, expiry date, Approve / Reject buttons, Download link.
4. **`/admin/teachers/new`** — invite form. Creates `users` (`role='teacher'`) + `teacher_profiles`, sends Auth.js magic-link invite email, writes `user.invite` audit row.
5. **`/admin/document-types`** — full CRUD. Create, edit (name/description/required/renewal_months), deactivate (sets `active=false`, never hard-delete).
6. **`PATCH /api/admin/documents/[id]`** — approve or reject.
7. **`POST /api/admin/teachers`** — create + invite.
8. **`POST /api/admin/document-types`**, **`PATCH /api/admin/document-types/[id]`**, **`DELETE /api/admin/document-types/[id]`** (delete = deactivate).

## State machine you enforce (DO NOT add new statuses)

| From | To | Allowed via | Required fields set |
|---|---|---|---|
| `pending` | `approved` | `PATCH /api/admin/documents/[id]` | `reviewed_by`, `reviewed_at`, `expires_at` if Agent 4 helper exists |
| `pending` | `rejected` | `PATCH /api/admin/documents/[id]` | `reviewed_by`, `reviewed_at`, `rejection_reason` (non-empty) |
| `approved` | `expired` | NOT YOU — cron does this (Agent 4) |
| `rejected` | * | TERMINAL — teacher must upload a new row |
| `expired` | * | TERMINAL — teacher upload supersedes |

**Reject without a non-empty `rejection_reason` → 400.** Rejected docs cannot be re-approved by editing the row — the teacher must upload a replacement.

## Expiry-on-approval coordination with Agent 4

- If `feature/renewal-tracking` is merged: import and call `setExpiryOnApproval(doc, docType)` from `lib/expiry/*`. It computes and sets `expires_at`.
- If NOT merged: leave `expires_at` as null. Add a TODO comment referencing Agent 4's PR. **Do not inline the math here** — that helper is Agent 4's contract.

## Admin-invites-teacher flow (per §5.6)

Endpoint: `POST /api/admin/teachers` accepts `{ email, name, phone?, hireDate?, gradeLevel? }`.

In one transaction:

1. Lowercase email. If a user with this email already exists, return **409**.
2. Insert `users` row: `role='teacher'`, `email_verified_at=null`.
3. Insert `teacher_profiles` row pointing at the new user.
4. Trigger Auth.js magic-link send to the new email.
5. `auditLog({ actorId: admin.id, action: 'user.invite', targetType: 'user', targetId: newUser.id, metadata: { email: newUser.email } })`.
6. Return **201** + `{ id: newUser.id }`.

Email body content rules (even though Auth.js builds the template): no PII beyond the recipient's own name, no file references, no admin's identity. Single CTA = magic link to `/login`.

## FILES YOU OWN (touch freely)

- `app/(admin)/dashboard/page.tsx`
- `app/(admin)/teachers/page.tsx`
- `app/(admin)/teachers/[id]/page.tsx`
- `app/(admin)/teachers/new/page.tsx`
- `app/(admin)/document-types/page.tsx`
- `app/api/admin/documents/[id]/route.ts`
- `app/api/admin/teachers/route.ts`
- `app/api/admin/document-types/route.ts`
- `app/api/admin/document-types/[id]/route.ts`
- `lib/db/queries/admin-teachers.ts` *(create)*
- `lib/db/queries/admin-review.ts` *(create)*
- `lib/db/queries/document-types.ts` *(create)*
- `components/admin/*` *(create)*
- `tests/integration/admin-approve.test.ts`
- `tests/integration/admin-reject.test.ts`
- `tests/integration/admin-invite.test.ts`
- `tests/integration/document-types-crud.test.ts`

## FILES YOU MUST NOT TOUCH

- `lib/db/schema.ts` — schema-change STOP rule
- `drizzle/**`
- `middleware.ts`, `lib/auth/*`
- `app/(teacher)/**`, `app/api/upload/route.ts`, `app/api/files/[id]/route.ts`
- `lib/db/queries/teacher-documents.ts` — Agent 2's lane
- `lib/storage/*`, `lib/supabase/server.ts`
- `lib/email/*`, `lib/reminders/*` — Phase 6 (Auth.js magic-link send is OK; it's not in these dirs)
- `package.json` — coordinate before deps

## Build steps (in order)

### Step 1 — Admin queries

Create `lib/db/queries/admin-teachers.ts`:

```ts
listAllTeachers(currentAdmin, filters?: { search?, completionState? }): Promise<Array<{
  user: User;
  profile: TeacherProfile;
  completion: { approvedRequired: number; totalRequired: number; pct: number };
  pendingCount: number;
  expiredCount: number;
}>>

getTeacherDetail(currentAdmin, teacherId): Promise<{
  user: User; profile: TeacherProfile; documents: TeacherDocument[];
}>
```

Every function guards `if (currentAdmin.role !== 'admin') throw new ForbiddenError()`.

Create `lib/db/queries/admin-review.ts`:

```ts
approveDocument(currentAdmin, docId): Promise<TeacherDocument>
  // sets status='approved', reviewed_by, reviewed_at
  // if lib/expiry exists, sets expires_at via setExpiryOnApproval()
  // writes audit log

rejectDocument(currentAdmin, docId, reason: string): Promise<TeacherDocument>
  // requires reason.trim().length > 0 else throws ValidationError
  // sets status='rejected', reviewed_by, reviewed_at, rejection_reason
  // writes audit log
```

Create `lib/db/queries/document-types.ts` with create/update/deactivate/list. Deactivate sets `active=false`. Never hard-delete.

### Step 2 — Admin routes

`PATCH /api/admin/documents/[id]`:

1. Auth + role check (defense in depth; middleware already did this).
2. Body: `{ action: 'approve' | 'reject', reason?: string }` (zod).
3. If `approve` → call `approveDocument`.
4. If `reject` → require `reason` non-empty; call `rejectDocument`.
5. Return **200** + updated doc.

`POST /api/admin/teachers` — per the invite flow above.

`POST/PATCH/DELETE /api/admin/document-types[/id]` — straightforward CRUD; DELETE deactivates.

### Step 3 — UI

- `app/(admin)/dashboard/page.tsx`: server component, summary tiles.
- `app/(admin)/teachers/page.tsx`: searchable table. Search by name + email. Filter by completion state. Click row → `/admin/teachers/[id]`.
- `app/(admin)/teachers/[id]/page.tsx`: profile header + document table with Approve/Reject buttons. Reject opens a modal requiring a reason (validated client AND server side; the server is the only one that matters).
- `app/(admin)/teachers/new/page.tsx`: form → `POST /api/admin/teachers`. On success, show "Invite sent" toast.
- `app/(admin)/document-types/page.tsx`: list + create modal + edit + deactivate (with confirmation showing "This will hide the type from teachers but keep their history").
- Reuse `components/status-badge.tsx` from Agent 2. If Agent 2 isn't merged, create a temporary local copy; remove it during a rebase.

## Audit log actions you write

| Action | When |
|---|---|
| `document.approve` | Successful approval |
| `document.reject` | Successful rejection (include `reason` in `metadata` — sanitized of PII) |
| `doc_type.create` | New doc type created |
| `doc_type.update` | Doc type edited |
| `doc_type.deactivate` | Doc type soft-deleted |
| `user.invite` | New teacher invited |

Always via `lib/audit/log.ts`. Never inline a SQL insert into `audit_logs`.

## Test contract

| Test file | Must assert |
|---|---|
| `tests/integration/admin-approve.test.ts` | Approve transitions `pending`→`approved`, sets `reviewed_by`+`reviewed_at`, writes audit row; non-admin gets 403; approve-twice is no-op or 409 (pick one, document) |
| `tests/integration/admin-reject.test.ts` | Reject requires non-empty reason (400 if missing/blank); writes audit row with reason in metadata; rejected→approve attempt returns 409 |
| `tests/integration/admin-invite.test.ts` | Creates user + profile + magic-link send + audit row; duplicate email → 409; teacher hitting this route → 403 |
| `tests/integration/document-types-crud.test.ts` | Create/update/deactivate write audit rows; deactivated type still appears in historical queries but is hidden from teacher dashboard query |
| `tests/integration/admin-permissions.test.ts` | Teacher PATCH on `/api/admin/documents/[id]` → 403; anonymous → 401 |

## Definition of Done (paste into PR and check off)

- [ ] Admin teacher list shows accurate completion % (verify against seeded data)
- [ ] Search and filters work
- [ ] Approve transitions status correctly and (if Agent 4 merged) sets `expires_at`
- [ ] Reject requires non-empty reason; stores it; rejected docs cannot be re-approved
- [ ] Admin downloads any file via `/api/files/[id]` (same route, no shortcut)
- [ ] Teacher gets 403 on every `/api/admin/**` URL (verify in test)
- [ ] Doc-type CRUD: create/edit/deactivate all work; deactivated types preserve history
- [ ] Invite flow creates user + profile + sends magic link + writes `user.invite` audit row; new teacher's first click lands on `/teacher/dashboard`
- [ ] Every admin mutation in the test list above produces an `audit_logs` row (verify by query)
- [ ] `pnpm typecheck && pnpm lint && pnpm build && pnpm test` all green (paste tails)

## Anti-goals (do NOT do)

- Build any teacher-facing flow
- Send any email beyond Auth.js magic-link invites
- Change schema or add migrations
- Modify `middleware.ts` or `lib/auth/*`
- Add an admin-only file download route
- Inline expiry math (Agent 4 owns that)
- Hard-delete a `document_type` (deactivate only)
- Allow re-approving a rejected doc
- Skip audit logging on any mutation

## PR description template

(Same shape as Agent 2 — copy and adapt.)

---

# AGENT 4 — Renewal Tracking

**Branch:** `feature/renewal-tracking`
**Phase:** 4
**Runs after:** `feature/admin-review-dashboard` is merged to `main` (needs the approve path to wire `expires_at` into).
**Cannot run in parallel** with Agents 2 or 3.

## Mission

Build expiration math, the daily expiry cron, the supersession-on-renewal chain, and the derived status helpers. Wire `expires_at` into the admin approve path. Zero email sends. Zero new UI beyond minimal badge consumption. Zero schema changes (everything you need is in the §3 schema from Phase 1).

## Inputs you can rely on

- `teacher_documents` has columns: `expires_at`, `superseded_by`. Already present.
- `document_types.renewal_months` (default 24).
- `scheduled_job_runs` table exists for cron telemetry.
- Agent 3's `approveDocument(currentAdmin, docId)` exists in `lib/db/queries/admin-review.ts`.
- Agent 2's `insertMyDocument(currentUser, ...)` exists in `lib/db/queries/teacher-documents.ts`.
- `components/status-badge.tsx` accepts an `expiring_soon` status.

## Outputs (what you ship)

1. **`lib/expiry/setExpiry.ts`** — `setExpiryOnApproval(doc, docType)` pure function: `expires_at = reviewed_at + docType.renewal_months months`. Called from `approveDocument`.
2. **`lib/expiry/status.ts`** — `deriveUiStatus(doc, opts?)` and `isExpiringSoon(doc, opts?)`. Default window = 30 days, override via `EXPIRING_SOON_WINDOW_DAYS` env.
3. **`lib/expiry/queries.ts`** — `listExpiring(currentUser, withinDays)`, `listExpired(currentUser)`, `listExpiredWithoutReplacement(currentUser)`. Each enforces role (admin sees all; teacher sees own).
4. **`lib/expiry/supersession.ts`** — `linkSupersession(newDocId, previousDocId)` atomically sets `superseded_by` on the previous row. Called from `insertMyDocument` when a previous current doc exists for the same `(user_id, document_type_id)`.
5. **`app/api/cron/expiry/route.ts`** — `POST` only, guarded by `X-Cron-Secret` header matching `CRON_SECRET` env. Sweeps `approved` docs where `expires_at < now()` and sets `status='expired'`. Idempotent. Writes one `scheduled_job_runs` row per run.
6. **`vercel.json`** (or equivalent) — daily cron schedule for the expiry sweep.
7. **Minimal UI wiring**: Agent 2 and Agent 3 already render `<StatusBadge status={uiStatus} />`. If `uiStatus` is computed via legacy code that doesn't call your helper, update those two call sites to use `deriveUiStatus`. That is the entire UI change.

## Status semantics (read-only — DO NOT add new DB statuses)

DB `teacher_documents.status` stays: `pending | approved | rejected | expired`.

Derived UI states (in `deriveUiStatus`):

| UI status | Condition |
|---|---|
| `missing` | NO row passed (caller signals missing externally; `deriveUiStatus` only handles existing rows) |
| `pending` | `status === 'pending'` |
| `approved` | `status === 'approved'` AND NOT expiring soon |
| `expiring_soon` | `status === 'approved'` AND `expires_at != null` AND `expires_at - now() <= window` AND `expires_at > now()` |
| `expired` | `status === 'expired'` OR (`status === 'approved'` AND `expires_at < now()`) — the second clause is a safety net; cron should keep these in sync |
| `rejected` | `status === 'rejected'` |

## Cron contract

`POST /api/cron/expiry`:

1. Read `X-Cron-Secret` header. If missing or != `process.env.CRON_SECRET`, return **401**. Log nothing PII.
2. Create `scheduled_job_runs` row: `job_name='expiry_sweep'`, `started_at=now()`, `status='running'`.
3. Select all `teacher_documents` where `status='approved'` AND `expires_at < now()`.
4. For each, set `status='expired'`. (Single UPDATE preferred over per-row.) Count rows affected.
5. Update job-runs row: `finished_at=now()`, `status='success'`, `candidates_considered`, `metadata={ expired_count }`.
6. Return **200** + `{ expired: N }`.
7. On any error: update job-runs row to `status='failed'`, `error_message`, return **500**.

**Idempotent:** rerunning the same day produces zero additional state transitions (the `where status='approved'` clause guarantees this — already-expired docs are skipped).

## Supersession contract

When a teacher uploads a new doc for a `(user_id, document_type_id)` where a previous **non-superseded** row exists with `status IN ('approved', 'expired', 'rejected')`:

1. Insert the new row (Agent 2's `insertMyDocument` already does this).
2. Set `previousDoc.superseded_by = newDoc.id`.
3. Both writes happen in one transaction.

This is the entire renewal mechanism. The "renewal chain" is navigable by following `superseded_by` forward.

You will add a small wrapper in `lib/db/queries/teacher-documents.ts` OR expose `linkSupersession` for Agent 2's route to call. **Coordinate in PR comments** — do not silently reshape Agent 2's function. Preferred shape: extend `insertMyDocument` to accept an optional `previousDocId` and call `linkSupersession` if present; computing `previousDocId` happens in the route.

## FILES YOU OWN

- `lib/expiry/setExpiry.ts` *(create)*
- `lib/expiry/status.ts` *(create)*
- `lib/expiry/queries.ts` *(create)*
- `lib/expiry/supersession.ts` *(create)*
- `lib/expiry/index.ts` *(create — re-exports)*
- `app/api/cron/expiry/route.ts` *(create)*
- `vercel.json` *(create or extend)*
- `tests/unit/expiry-math.test.ts`
- `tests/unit/expiry-status.test.ts`
- `tests/integration/cron-expiry.test.ts`
- `tests/integration/supersession.test.ts`

## FILES YOU MAY EDIT WITH COORDINATION (small, surgical changes only)

- `lib/db/queries/admin-review.ts` — add the `setExpiryOnApproval` call in `approveDocument`. Diff must be ≤10 lines.
- `lib/db/queries/teacher-documents.ts` — accept optional `previousDocId` and call `linkSupersession`. Diff must be ≤15 lines.

If your change is bigger than these line budgets, open a separate PR or coordinate with the original author.

## FILES YOU MUST NOT TOUCH

- `lib/db/schema.ts` — everything you need exists; STOP rule applies
- `drizzle/**`
- `middleware.ts`, `lib/auth/*`
- `lib/email/*`, `lib/reminders/*` — Phase 6
- `app/(teacher)/**`, `app/(admin)/**` page structure (badge consumption is the only exception)
- `lib/storage/*`, `lib/supabase/server.ts`
- `app/api/upload/route.ts`, `app/api/files/[id]/route.ts`
- `app/api/admin/**` route handlers (other than the small coordinated diff above)

## Build steps (in order)

1. **Math first.** `setExpiry.ts` is a pure function. Add `tests/unit/expiry-math.test.ts` with boundary cases (24-month default; 12-month custom; leap years; DST edge OK to use UTC).
2. **Status helper.** `status.ts` with `deriveUiStatus`. Tests for every branch including the day-30/day-31 boundary.
3. **Supersession.** `supersession.ts` + integration test using a seeded teacher with one approved doc then a new upload.
4. **Cron.** `route.ts` + integration test that calls it with/without the secret, with seeded past-due docs, asserting idempotency on rerun.
5. **Wiring.** Smallest possible diffs into `admin-review.ts` and `teacher-documents.ts`.

## Test contract

| Test file | Must assert |
|---|---|
| `tests/unit/expiry-math.test.ts` | Default 24mo; custom 12mo; reviewed_at + months yields correct timestamp; null docType throws |
| `tests/unit/expiry-status.test.ts` | day-29 = `expiring_soon`; day-30 = `expiring_soon`; day-31 = `approved`; `status='expired'` always `expired`; rejected always `rejected` |
| `tests/integration/cron-expiry.test.ts` | Missing secret → 401; valid secret + past-due doc → marked `expired`; rerun same day → 0 new changes; future doc untouched; `scheduled_job_runs` row written with counts |
| `tests/integration/supersession.test.ts` | New upload links `superseded_by` on previous row; new row not superseded; chain navigable |
| `tests/integration/approve-sets-expiry.test.ts` | After approve, `expires_at = reviewed_at + docType.renewal_months` |

## Definition of Done

- [ ] Approval correctly sets `expires_at = reviewed_at + renewal_months` (proved by query)
- [ ] Cron with `X-Cron-Secret` marks past-due `approved` docs as `expired`; without secret → 401
- [ ] Cron is idempotent across same-day reruns (proved by test)
- [ ] `scheduled_job_runs` row written per run with `candidates_considered` and counts
- [ ] Renewal supersession: new upload after expiry sets `superseded_by` on previous row (proved by test)
- [ ] `isExpiringSoon` boundary: day 30 = true, day 31 = false (proved by test)
- [ ] "Expiring soon" badge appears in both teacher and admin views (manual smoke + screenshot)
- [ ] No email sent in this phase (grep `lib/email` imports in your diff — zero matches)
- [ ] `pnpm typecheck && pnpm lint && pnpm build && pnpm test` all green

## Anti-goals (do NOT do)

- Send any email
- Build admin reminder UI or reminder logs UI (Phase 6)
- Add new statuses to `teacher_documents.status`
- Change the schema
- Touch auth / middleware / storage
- Restructure admin or teacher pages
- Make giant diffs into other agents' query files (line budgets above)

## PR description template

(Same shape as Agent 2.)

---

# AGENT 5 — Security, QA, Reports, and Docs

**Branch:** `feature/security-tests-docs`
**Phase:** 5
**Runs after:** Agents 2, 3, AND 4 are all merged to `main`. Real features must exist before they can be meaningfully tested.

## Mission

Ship the full Phase 5 deliverable: CSV reports, audit log viewer, rate limits, security headers, complete test suite, and deploy/security docs. Find security gaps and report them — do not silently patch product code in this branch (open paired PRs against the owning agent's area instead).

## Inputs you can rely on

- Phases 1–4 are merged: auth, teacher upload, admin review, renewal/expiry, audit logging, supersession.
- `lib/audit/log.ts` writes rows. Audit data exists from earlier merged work.
- Cron route `/api/cron/expiry` exists.
- `scheduled_job_runs` table populated.

## Outputs (what you ship)

1. **Reports**
   - `GET /api/admin/reports?type=completion` → CSV of every teacher with completion %, expired count, expiring-soon count.
   - `GET /api/admin/reports?type=expiry` → CSV of every approved doc with expiry date and "expiring soon" flag.
   - `/admin/reports` page with download buttons for each report.
2. **Audit log viewer**
   - `GET /api/admin/audit` — paginated, filterable (actor, action, target_type, date range).
   - `/admin/audit` page — paginated table with filter form.
3. **Rate limits** (`lib/rate-limit/*` — in-memory token bucket is acceptable for MVP; document choice in `docs/SECURITY.md`).
   - `/api/auth/**`: 5/min/IP
   - `/api/upload`: 10/hour/user
   - `/api/files/**`: 60/min/user
   - Exceeded → **429** + `Retry-After` header.
4. **Security headers** on every response (via `next.config.ts` `headers()` or `middleware.ts`):
   - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
   - `Content-Security-Policy` (start with `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'` — tighten if possible)
   - `X-Frame-Options: DENY`
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
5. **Test suite** — every test in §10 plus the additions below. Use a **separate test DB**, never the dev DB.
6. **Docs**
   - `docs/DEPLOY.md` — Supabase setup, env vars, cron config, deploy checklist
   - `docs/SECURITY.md` — threat model summary, header rationale, rate-limit rationale, audit-log schema, incident response steps
   - `README.md` refreshed with quickstart that actually works for a new contributor (verified by following it yourself in a clean clone)

## Required tests (in addition to §10)

### Auth & roles
- Anonymous `GET /teacher/dashboard` → **302** to `/login`
- Anonymous `GET /api/files/<id>` → **401**
- Anonymous `GET /api/admin/teachers` → **401**
- Teacher `GET /admin/dashboard` → **403** (NOT redirect — must appear as 403 in logs)
- Teacher `PATCH /api/admin/documents/<id>` → **403**
- Admin `GET /api/admin/audit` → **200**

### Cross-tenant isolation
- Teacher A `GET /api/files/<docB.id>` → **403**
- Teacher A's dashboard query never returns Teacher B's rows (assert via direct DB query)
- Admin `GET /api/files/<any-doc-id>` → **200**

### Upload validation
- 11 MB PDF → **413**
- `.exe` renamed `.pdf` → **415**
- `.svg` → **415**
- Valid 1 MB PDF → **201** + `pending` row + audit row

### Download response privacy
- Response body and headers contain **no** Supabase URL, **no** bucket name, **no** `storage_key`, **no** signed URL (regex sweep)
- `Content-Disposition: attachment; filename="<sanitized>"` present
- `Cache-Control: private, no-store` present
- `X-Content-Type-Options: nosniff` present
- Audit row with `action='file.download'` written

### No service-role key leakage (this is mandatory and easy to verify)
- After `pnpm build`, grep the **entire `.next/` directory** for:
  - The literal value of `SUPABASE_SERVICE_ROLE_KEY` from `.env.test` — **zero matches required**
  - Strings `service_role`, `service-role`, `SUPABASE_SERVICE_ROLE_KEY` in `.next/static/**` — **zero matches required**
- Failing this test is a release blocker.

### Audit logs
For each of these, assert exactly one new row written:
- `document.upload` on successful upload
- `file.download` on owner download
- `file.download` on admin download
- `document.approve` on approve
- `document.reject` on reject (with reason in metadata)
- `doc_type.create`, `doc_type.update`, `doc_type.deactivate`
- `user.invite` on admin invite

### Expiry / renewal (Agent 4 surface)
- Approval sets `expires_at = reviewed_at + renewal_months` (exact)
- Cron without `X-Cron-Secret` → 401
- Cron with secret marks past-due `approved` docs as `expired`
- Cron rerun same day → zero state changes (idempotent)
- Supersession: new upload populates `previous.superseded_by`
- `isExpiringSoon` boundary: day 30 true, day 31 false

### Rate limits
- 6th `/api/auth/*` request within a minute → **429** with `Retry-After`
- 11th `/api/upload` within an hour for the same user → **429**
- 61st `/api/files/*` within a minute for the same user → **429**

### Security headers
- Assert HSTS, CSP, X-Frame-Options=DENY, X-Content-Type-Options=nosniff, Referrer-Policy, Permissions-Policy on a sample of: `/login`, `/teacher/dashboard`, `/admin/dashboard`, `/api/files/[id]`.

## FILES YOU OWN

- `app/api/admin/reports/route.ts`
- `app/(admin)/reports/page.tsx`
- `app/(admin)/audit/page.tsx`
- `app/api/admin/audit/route.ts`
- `lib/audit/queries.ts` *(read-side queries for viewer; do not modify the `log.ts` writer)*
- `lib/rate-limit/*` *(create)*
- `next.config.ts` *(headers — coordinate before editing)*
- `middleware.ts` *(rate-limit hooks — coordinate before editing; diff ≤ 20 lines)*
- `tests/**` (any new test files)
- `docs/DEPLOY.md` *(create)*
- `docs/SECURITY.md` *(create)*
- `README.md` *(update)*
- `.github/workflows/ci.yml` *(extend to run the full test suite)*

## FILES YOU MUST NOT TOUCH

- `lib/db/schema.ts` — STOP rule
- `drizzle/**`
- Any feature route handler (`app/api/upload`, `app/api/files`, `app/api/admin/documents`, `app/api/admin/teachers`, `app/api/admin/document-types`, `app/api/cron/expiry`) — only ADD tests around them. Behavior changes require a paired PR against the owning agent's branch ownership.
- `lib/storage/*`, `lib/supabase/server.ts`
- `lib/auth/*` — auth is owned by foundation; report findings, do not patch here
- `lib/email/*`, `lib/reminders/*` — Phase 6

## Build steps (in order)

1. **Test infrastructure first.** Wire a separate test database. Document setup in `docs/SECURITY.md` and the README. Verify tests do not touch dev/staging.
2. **Port §10 tests.** Get the baseline test plan green.
3. **Add the additional tests above.** Privacy regex sweeps and service-role-key grep are the highest-value.
4. **Rate limits.** Add `lib/rate-limit/*`, wire into `middleware.ts` for the three path prefixes. Test with a fast loop.
5. **Security headers.** Add via `next.config.ts`. Test via a fetched HEAD on representative routes.
6. **Reports.** Implement `/api/admin/reports` with `type` query param. CSV generation server-side; admin role check; audit log entry on download (`action='report.export'`).
7. **Audit viewer.** Implement `/api/admin/audit` and the page.
8. **Docs.** Write `DEPLOY.md` and `SECURITY.md`. Refresh `README.md`. Verify the quickstart by cloning to a fresh dir and following it yourself.
9. **CI.** Extend `.github/workflows/ci.yml` to run typecheck + lint + build + the full test suite, including the build-output grep.

## Test contract (consolidated)

All required tests above must pass. Run order in CI:

```
pnpm typecheck
pnpm lint
pnpm build           # required before the leakage grep
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test:leakage    # grep .next/ for service-role key and string "service_role"
```

## Definition of Done

- [ ] All §10 tests pass plus all additional tests above (paste CI green summary)
- [ ] Service-role key leakage test passes (zero matches in `.next/`)
- [ ] CSV exports match DB counts (compare via test query)
- [ ] Audit log viewer paginates and filters (manual smoke + screenshot)
- [ ] Rate limits return 429 with `Retry-After` (proved by test)
- [ ] Response headers present on every sampled route (proved by test)
- [ ] `docs/DEPLOY.md` and `docs/SECURITY.md` complete and accurate
- [ ] `README.md` quickstart verified end-to-end in a clean clone
- [ ] CI runs the full test suite on every PR
- [ ] Any security gaps found during testing are reported with reproduction steps in the PR description; paired fix PRs are linked if filed

## Anti-goals (do NOT do)

- Add product features (no new flows, no new pages beyond reports/audit)
- Weaken a permission check to make a test pass (rule 14)
- Modify a feature route handler's behavior in this branch
- Touch `lib/db/schema.ts` or add a migration
- Modify auth, storage, or email
- Run tests against the dev/staging DB
- Hide failures with `.skip` — if a test reveals a real bug, file it

## PR description template

```
## What
Phase 5: reports + audit viewer + rate limits + security headers + full test suite + docs.

## DoD checklist
- [ ] (paste DoD with evidence per item)

## Test results
$ pnpm typecheck   # OK
$ pnpm lint        # OK
$ pnpm build       # OK
$ pnpm test:unit          # 87 passed
$ pnpm test:integration   # 42 passed
$ pnpm test:e2e           # 18 passed
$ pnpm test:leakage       # PASS (0 matches)

## Security findings
- (list any gaps found, with severity and repro)
- Paired fix PRs: #NN, #NN

## Files changed
(list)

## Docs added
- docs/DEPLOY.md
- docs/SECURITY.md
- README.md updated
```

---

## Quick reference

| Agent | Branch | When | Parallel with | Owns (high level) | Must not touch |
|---|---|---|---|---|---|
| 2 | `feature/teacher-upload-flow` | After Phase 1 | Agent 3 | `app/(teacher)/**`, upload+download routes, validation, teacher queries | schema, auth, middleware, admin lanes, storage internals |
| 3 | `feature/admin-review-dashboard` | After Phase 1 | Agent 2 | `app/(admin)/**`, admin routes, admin queries, invite flow | schema, auth, middleware, teacher lanes, upload/download routes |
| 4 | `feature/renewal-tracking` | After Agent 3 merges | none | `lib/expiry/*`, expiry cron, supersession, minimal wiring | schema, auth, email, storage, page structure |
| 5 | `feature/security-tests-docs` | After Agents 2+3+4 merge | none | tests, reports, audit viewer, rate limits, headers, deploy/security docs | schema, feature route behavior, auth, email |
