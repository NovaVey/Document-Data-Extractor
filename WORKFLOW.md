# Doc Extractor — Build Workflow

**Started:** 2026-07-25
**Current phase:** 3

## Phase 0 — Setup
- [x] Confirm scope in/out
- [x] Choose lead document type
- [x] Repo, .gitignore, license, README stub
- [x] Lint, format, CI
- [x] .env.example
- [x] API keys confirmed available

## Phase 1 — Foundation
- [x] Scaffold and routing
- [x] Auth
- [x] Orgs, memberships, RLS (reused by the next project)
- [x] Vertical slice working
- [x] Explain-back: request path and isolation

## Phase 2 — Data model
- [x] Migrations for all 5 tables
- [x] RLS on every table
- [x] Unique index on (org_id, file_hash)
- [x] Supporting indexes
- [x] Cascade deletes verified
- [x] Explain-back: raw vs normalized values

## Phase 3 — Core build
- [x] 1. Upload + storage with validation
- [x] 2. Text extraction, raw output read by hand
- [x] 3. Template CRUD
- [x] 4. Queue worker skeleton, crash-safe
- [ ] 5. Single-document extraction, console output
- [ ] 6. Ground-truth set: 10 docs, fields hand-keyed
- [ ] 7. Deterministic validators
- [ ] 8. Confidence scoring, validators weighted heaviest
- [ ] 9. Review threshold tuned against ground truth
- [ ] 10. Review split view
- [ ] 11. Correction persistence
- [ ] 12. Records table with filters
- [ ] 13. CSV export, then XLSX
- [ ] 14. Batch upload, load-tested at 25
- [ ] 15. Duplicate detection via hash
- [ ] 16. Failure isolation tested
- [ ] 17. Per-org daily cost cap

## Phase 4 — Done-criteria verification
- [ ] 25-file batch, no timeout
- [ ] Field accuracy measured and recorded
- [ ] Every ground-truth error routed to review
- [ ] Nothing below threshold reaches export untouched
- [ ] Corrections persist to export
- [ ] Corrupt + locked files fail alone
- [ ] Export matches screen (ISO dates, numeric currency)
- [ ] Duplicate upload caught
- [ ] Delete removes stored file
- [ ] Cost cap stops processing
- [ ] Dead worker leaves row recoverable
- [ ] No document content in any log

## Phase 5 — Demo data
- [ ] 12 invoices, 3 fictional vendors
- [ ] One skewed scan, one missing PO
- [ ] Some pre-approved records
- [ ] Read-only demo account

## Phase 6 — Deploy
- [ ] Hosting chosen and configured
- [ ] Env vars verified
- [ ] Queue worker confirmed running in production
- [ ] Staging walkthrough with real batch
- [ ] Go-ahead for production
- [ ] Production deploy
- [ ] Demo account verified logged-out
- [ ] Error tracking, contents excluded
- [ ] Backups

## Phase 7 — Portfolio packaging
- [ ] README complete
- [ ] Accuracy numbers published
- [ ] Screenshots: review, queue, export
- [ ] 60-90s recording
- [ ] Upwork entry drafted

## Phase 8 — Interview prep
- [ ] Ten questions generated
- [ ] Answered
- [ ] Weak spots addressed
- [ ] Architecture notes in README

## Decisions log
| Date | Decision | Why |
|------|----------|-----|
| 2026-07-25 | Lead document type: invoices | Confirmed live by user. Matches the plan's default and the existing README stub. |
| 2026-07-25 | API keys (Claude API, Supabase) confirmed available | Confirmed live by user — both accounts/keys ready. Actual values still only go in the environment, never the repo. |
| 2026-07-25 | Node/TS toolchain (ESLint flat config, Prettier, Vitest) as Phase 0 CI baseline | Framework choice (Next.js vs. other) is a Phase 1 item, not Phase 0. Phase 0 only needs lint/build/test to run in CI; Phase 1 scaffold builds on top of this and may extend the build script. |
| 2026-07-25 | Framework: Next.js 16 App Router + Tailwind, auth via Supabase Auth (email/password) | Implied by the stated stack (TypeScript, Supabase, Vercel) — Next.js is the standard pairing. Email/password (not magic link) because Phase 5 needs a demo account with visible, reusable credentials on the login screen. |
| 2026-07-25 | Supabase project: existing "Upwork Portfolio" (ref vujkdmnvegfvtvxpyebw), confirmed live by user | User stated this project is shared across all future portfolio-demo apps. Already held 13 unrelated tables (a separate CRM-style app: clients, invoices, bookings, leads, etc.) with RLS disabled and integer PKs — checked for collisions before touching anything; none found, and this build is the first to establish the org/RLS pattern in that project. Future portfolio projects reusing this project must check for table-name collisions before their own migrations. |
| 2026-07-25 | `documents` in the Phase 1 migration is a deliberate placeholder (id, org_id, title, created_at only) | Needed something real to prove RLS isolation against before Phase 2 defines the full documents schema (template_id, storage_path, file_hash, status, etc.). Phase 2 will migrate this table to its full column set rather than starting a new one. |
| 2026-07-25 | RLS isolation verified two ways | (1) SQL-level: created two throwaway auth users (direct SQL insert into auth.users/auth.identities, bcrypt via pgcrypto — no self-hosted Supabase CLI available here), one document per org, then simulated each user's session (`set local role authenticated; set local request.jwt.claims`) inside a rolled-back transaction and confirmed each saw only their own org's one document; a no-claims case confirmed zero rows (default-deny). This is a direct test of the actual enforcement mechanism (Postgres RLS), not app code. (2) App-level: confirmed via Playwright against a local `next dev` that an unauthenticated visit to /documents redirects to /login. Full logged-in browser click-through (sign in → see own doc) could **not** be run — this sandbox's egress proxy blocks direct browser/Node access to `*.supabase.co` (confirmed via the exact failure: `net::ERR_TUNNEL_CONNECTION_FAILED` hitting the correct GoTrue token endpoint, i.e. a network policy block, not an app bug). All test users/orgs/documents were deleted after verification, confirmed back to zero rows. |
| 2026-07-25 | ANTHROPIC_API_KEY left blank in local .env.local | Not needed until Phase 3 (first Claude API call). User confirmed the key is available; just hasn't been entered into any environment yet since nothing consumes it before Phase 3. |
| 2026-07-25 | `documents` migrated in place to its full Phase 2 schema (rename created_at→uploaded_at, drop title, add template_id/original_filename/storage_path/file_hash/mime_type/page_count/status/error_message/processed_at/approved_by/approved_at) | Table was empty in the live project, so no data migration was needed — safe to add NOT NULL columns directly. Kept the same table identity (and its existing RLS policy, org_id index) rather than dropping/recreating. |
| 2026-07-25 | `extraction_runs.created_at` added, though not in the original column list | Phase 3's per-org daily cost cap (item 17) has to sum "today's" cost across runs — unanswerable without each run recording what day it happened on. Flagged here rather than added silently. |
| 2026-07-25 | `documents.template_id` → `ON DELETE RESTRICT`; person-reference columns (`approved_by`, `corrected_by`, `export_jobs.created_by`) → `ON DELETE SET NULL` | Not specified in the original schema. RESTRICT on template_id prevents deleting a template that documents still reference (a document without its template loses the meaning of its extracted fields). SET NULL on person-references preserves the row (and its audit trail) if that user account is later deleted, rather than cascading the delete into unrelated data. |
| 2026-07-25 | `extracted_fields`/`extraction_runs` RLS checks membership through the parent `documents.org_id` (no `org_id` column of their own) | Matches the schema as specified (neither table has an org_id column) — the same `is_org_member()` helper from Phase 1 is reused, just via an EXISTS join to `documents` instead of a direct column check. |
| 2026-07-25 | Only SELECT RLS policies added for all Phase 2 tables, no insert/update/delete yet | Same pattern as Phase 1: write policies get added alongside the Phase 3 feature that actually needs them (template CRUD, upload, corrections, export), not guessed at ahead of time. The background extraction worker is expected to write via the service-role key, which bypasses RLS entirely. |
| 2026-07-25 | Cascade deletes and the (org_id, file_hash) unique index verified live, then cleaned up | Inserted a full chain (org → template → document → field → run) via the live Supabase project, deleted the document, confirmed its field and run rows disappeared too. Confirmed the unique index rejects a duplicate (org_id, file_hash) pair but allows the same file_hash under a different org. All test rows deleted afterward — project back to zero extra rows. |
| 2026-07-25 | Uploads go browser → Supabase Storage directly, not through a Next.js server/API route | Vercel serverless functions have a request body size limit (a few MB) and a request timeout — proxying file bytes through our own server would hit both under real invoice-scan file sizes and a 25-file batch (item 14). The browser Supabase client uploads straight to Storage using the user's own session; the server only ever handles small JSON metadata (filename, hash, mime type) to insert the `documents` row. Storage bucket `documents` created private, with `allowed_mime_types`/`file_size_limit` (20MB, not specified anywhere — my default) enforced at the infrastructure level, not just client-side JS. |
| 2026-07-25 | Storage path convention: `${org_id}/${uuid}-${sanitized_filename}` | The leading org_id segment is what storage.objects RLS policies check via `(storage.foldername(name))[1]::uuid` and `is_org_member()` — same pattern as every other org-scoped table, just read from a path instead of a column. Verified both directions live (own-org path accepted, other-org path rejected) via the same SQL-level RLS simulation technique used in Phase 1/2. |
| 2026-07-25 | Added the `documents` INSERT policy Phase 2 deliberately deferred | Phase 2's decisions log said write policies land "alongside the Phase 3 feature that actually needs them" — upload is that feature. Verified live (own-org insert succeeds, other-org insert rejected), same technique. |
| 2026-07-25 | Duplicate-hash pre-check before upload, not the full replace/skip prompt | A quick SELECT for an existing (org, file_hash) match before uploading bytes avoids wasting a Storage upload (and leaving an orphaned object) on an obvious duplicate. The polished replace/skip UI is explicitly item 15's job — this is just the minimal "don't waste an upload" version, not building ahead of the plan. |
| 2026-07-25 | PDF text extraction via `unpdf`; scanned images/image-only PDFs get no separate OCR pipeline, they go to Claude's vision input at extraction time (item 5) | Built two synthetic test fixtures (a real digital PDF and the same content rendered as a "scanned" image wrapped in a PDF) and read the actual extracted output by hand, per this item's own instruction. Digital PDF: clean, complete, correct text (434 chars, every field present). Scanned/image-only PDF: **zero characters** — confirms text-layer extraction is structurally blind to image content, exactly the trap this item warns about. Decided now rather than discovering it in Phase 4: no bolted-on OCR dependency (Tesseract etc.) — Claude is already multimodal and already the extraction model this project pays for, so image-based documents get read directly by vision instead of a second, separately-tuned OCR system. Consistent with the scope note ruling out "custom-trained OCR models" — this delegates image reading to the vision-capable model already in use, it doesn't add one. Both fixtures and a real vitest test are checked in (`test/fixtures/*.pdf`, `test/pdf-text.test.ts`) rather than left as a throwaway script. |
| 2026-07-25 | Template CRUD: added the extraction_templates write policies Phase 2 deferred; field key/label/type validated server-side (not DB-constrained) | `fields` is unstructured jsonb (Phase 2 decision), so `validateFields()` in `src/lib/templates/types.ts` is the one place a malformed field (duplicate key, bad key format, blank label) gets caught before it can corrupt extraction results later. Covered by a real vitest suite (`test/template-validation.test.ts`), not just manual checking. |
| 2026-07-25 | `deleteTemplate` surfaces the `documents.template_id` FK-restrict (Postgres code 23503) as a plain message instead of a raw Postgres error | A template still referenced by documents can't be deleted, by the Phase 2 `ON DELETE RESTRICT` decision — this just makes that failure legible instead of leaking a database error string to the UI. |
| 2026-07-25 | Upload now requires selecting a template; `documents.template_id` gets set at upload time | Closes the loop Phase 3 item 1 deliberately left open (templates didn't exist yet). If no templates exist, the upload control is replaced with a prompt to create one first, rather than allowing an upload with no template — the field schema an extraction is run against has to be known before extraction, not decided later. |
| 2026-07-25 | Corrected the RLS verification method for UPDATE/DELETE (methodology note, not a design decision) | Initially checked "did the cross-org write succeed" by re-querying as the same restricted test user — invalid, because that user's SELECT policy already hides the foreign row regardless of whether the write succeeded, so a 0-row result was ambiguous. Fixed by using `reset role` mid-transaction to check the true row state as an unrestricted role before rolling back. Re-ran both the UPDATE and DELETE cross-org checks this way and confirmed both are genuinely blocked, not just invisible. Worth recording since the same mistake would silently invalidate any future RLS write-policy test built the same (wrong) way. |
| 2026-07-25 | **Security fix**: `claim_next_document()` was callable by `anon`/`authenticated`, not just the worker's service role | `revoke all on function ... from public` only strips privileges granted to the PUBLIC pseudo-role. Supabase auto-grants EXECUTE on new public-schema functions directly to the *named* roles anon/authenticated/service_role at creation time — a PUBLIC-only revoke never touches those. Confirmed the gap live via `pg_proc.proacl` (anon/authenticated both listed with execute rights despite the revoke), fixed with an explicit `revoke execute ... from anon, authenticated`, reconfirmed via the same query. Real impact if missed: the function doesn't check org membership at all (by design — the worker needs to see every org's queue), so any signed-in user could have called it directly via RPC and both read and claimed another org's queued documents. Prompted a full audit of every function's grants, every RLS policy, and RLS-enabled status across all tables — everything else checked out (details not repeated here; see conversation). Lesson for future migrations: always verify a revoke actually took effect via `pg_proc.proacl` / `pg_class.relacl` — never assume `revoke ... from public` covers named-role default grants. |
| 2026-07-25 | Hosting: Next.js app on Vercel, background worker as its own persistent Node service on Railway (user already has a Railway account) | Vercel is serverless-only — no persistent process, and Hobby-tier Cron Jobs are capped at once/day (confirmed live via web search), far too infrequent for "upload, then see it processed shortly after." Railway supports an always-on process, so the worker can be the obvious thing (a poll loop) instead of `after()`-triggered-per-upload workarounds. User confirmed this project may become a reusable template for future clients, which favors the architecturally cleaner option since it'll be replicated, not just run once. Both sides share the same Supabase database as the source of truth, so which platform runs which piece doesn't affect correctness. |
| 2026-07-25 | Worker lives in `worker/` as its own package (own package.json/tsconfig, compiled with `tsc`, run as `node dist/index.js`), excluded from the root app's tsconfig/eslint | It's a separate deployable (Railway, not Vercel) with a different module target (NodeNext vs. the app's bundler resolution) and only needs one dependency (`@supabase/supabase-js`) — folding it into the app's build would create tsconfig conflicts for no benefit. CI now has a second job that builds it. |
| 2026-07-25 | `documents.processing_started_at` added (not in the original column list) | Same category of addition as `extraction_runs.created_at` in Phase 2: "handle a crashed worker without losing the row" requires knowing how long a document has sat in `processing`, to tell a genuinely in-flight row apart from one whose worker died mid-attempt. |
| 2026-07-25 | Claiming uses a Postgres function (`claim_next_document()`, `FOR UPDATE SKIP LOCKED`) called via `.rpc()`, not a plain query | PostgREST (the Supabase client's query layer) has no way to express `FOR UPDATE SKIP LOCKED` — it's only reachable through a database function. This is also why the function has to be `security definer` and why its grants needed the fix above: it operates across every org's queue by design, which no ordinary RLS-scoped client call could do. |
| 2026-07-25 | Enqueue transition (`uploaded` → `queued`) restricted two ways at once: column-level grant (`authenticated` can only UPDATE the `status` column, not the whole row) plus an RLS policy allowing only that one transition | A single restriction wasn't enough: an RLS policy alone would stop a user from *reaching* an unauthorized status value, but wouldn't stop them from also tampering with unrelated columns (`file_hash`, `approved_by`, etc.) in the same request via a raw API call, since RLS validates the resulting row against a predicate, not which columns changed. Verified live, all four cases: legitimate `uploaded→queued` succeeds; skipping straight to `approved` is rejected (RLS); changing `status` and `file_hash` together is rejected (column grant, different error — "permission denied for table," not an RLS violation); a cross-org attempt affects nothing (checked via the `reset role` technique). |
| 2026-07-25 | Queue mechanics verified live via direct SQL calls to `claim_next_document()`, not by running the compiled worker process | This sandbox's egress proxy blocks direct network access to `*.supabase.co` (same limitation hit in Phase 1's browser-login test) — the actual Node worker can't reach the live project from here. Verified instead: three sequential claims each return a different document, oldest first, with no duplicates; a fourth claim returns nothing once all three are freshly `processing`; backdating one document's `processing_started_at` past the staleness window causes it to be reclaimed on the next claim (crash recovery); a full `queued → processing → needs_review` lifecycle completes with correct timestamps throughout. This exercises the exact same RPC the worker calls — what's unverified is only the Node process wrapper around it, not the queue mechanism itself. Worth a live smoke test once deployed to Railway (Phase 6). |
|      | Review threshold: | |
|      | Field accuracy: | |
|      | Error catch rate: | |
|      | Cost per document: | |

## Open questions
- **Full browser login flow is unverified end-to-end.** RLS isolation itself is rigorously verified (see decisions log), but the literal click-through — sign in via the real /login form, land on /documents, see only your org's document — has only been verified up to the point where the browser calls Supabase (this sandbox can't reach `*.supabase.co` directly to complete it). Worth a 30-second manual check once you have a normal network to run `npm run dev` from, or this naturally gets covered by Phase 6's staging walkthrough.
- **The worker's Node process itself hasn't run against the live database.** The queue mechanism it depends on (`claim_next_document()`) is thoroughly verified live (see decisions log), but the actual `worker/` process — reading env vars, calling `.rpc()`, looping — has only been build-checked (`tsc` compiles cleanly), not run, for the same network reason as the browser-login gap above. Worth `npm start`-ing it locally once you have a normal network, before or during the Phase 6 Railway deploy.
- **Railway service not yet provisioned.** The worker is built and ready to deploy, but no Railway project/service has been created for it — that's Phase 6 ("Hosting chosen and configured") territory, not done prematurely here.
