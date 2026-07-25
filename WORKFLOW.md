# Doc Extractor — Build Workflow

**Started:** 2026-07-25
**Current phase:** 1

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
- [ ] Explain-back: request path and isolation

## Phase 2 — Data model
- [ ] Migrations for all 5 tables
- [ ] RLS on every table
- [ ] Unique index on (org_id, file_hash)
- [ ] Supporting indexes
- [ ] Cascade deletes verified
- [ ] Explain-back: raw vs normalized values

## Phase 3 — Core build
- [ ] 1. Upload + storage with validation
- [ ] 2. Text extraction, raw output read by hand
- [ ] 3. Template CRUD
- [ ] 4. Queue worker skeleton, crash-safe
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
|      | Review threshold: | |
|      | Field accuracy: | |
|      | Error catch rate: | |
|      | Cost per document: | |

## Open questions
- **Full browser login flow is unverified end-to-end.** RLS isolation itself is rigorously verified (see decisions log), but the literal click-through — sign in via the real /login form, land on /documents, see only your org's document — has only been verified up to the point where the browser calls Supabase (this sandbox can't reach `*.supabase.co` directly to complete it). Worth a 30-second manual check once you have a normal network to run `npm run dev` from, or this naturally gets covered by Phase 6's staging walkthrough.
