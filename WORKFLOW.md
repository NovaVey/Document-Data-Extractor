# Doc Extractor — Build Workflow

**Started:** 2026-07-25
**Current phase:** 0

## Phase 0 — Setup
- [x] Confirm scope in/out
- [x] Choose lead document type
- [x] Repo, .gitignore, license, README stub
- [x] Lint, format, CI
- [x] .env.example
- [ ] API keys confirmed available

## Phase 1 — Foundation
- [ ] Scaffold and routing
- [ ] Auth
- [ ] Orgs, memberships, RLS (reused by the next project)
- [ ] Vertical slice working
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
| 2026-07-25 | Lead document type: invoices | Default per plan; README stub already committed as "Extract fields from invoice PDFs..." — treated as the user's own prior decision. This session is non-interactive (no live chat to confirm), so this is stated here as the working assumption. Flip it before Phase 2's schema work if wrong — cheap to change now, expensive after templates/fixtures exist. |
| 2026-07-25 | Node/TS toolchain (ESLint flat config, Prettier, Vitest) as Phase 0 CI baseline | Framework choice (Next.js vs. other) is a Phase 1 item, not Phase 0. Phase 0 only needs lint/build/test to run in CI; Phase 1 scaffold builds on top of this and may extend the build script. |
|      | Review threshold: | |
|      | Field accuracy: | |
|      | Error catch rate: | |
|      | Cost per document: | |

## Open questions
- **API keys not confirmed.** This session is non-interactive, so "(ask) Confirm API keys available: Claude API, Supabase" could not be asked live. `.env.example` has both key names in place. Phase 1 (Supabase auth/RLS) and Phase 3.5+ (Claude extraction calls) cannot be built and *tested end-to-end* without real keys in the environment. Confirm before Phase 1 starts, or Phase 1 will get built against local/mocked Supabase only.
- **Document type (invoices) is an inferred default, not a live confirmation.** Say so if a different lead type is wanted — cheapest to change before Phase 2.
