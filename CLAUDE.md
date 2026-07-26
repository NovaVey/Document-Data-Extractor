# For any Claude session working on this repo

**Read `WORKFLOW.md` in full before doing anything else.** It is this
project's persistent memory across sessions: what's built, what's verified
(and how), every non-obvious decision and why, and what's still open. Do not
re-derive context that's already answered there.

## Standing rules from this project's build

- State lives in `WORKFLOW.md`. Update it — checklist items, decisions log,
  open questions — as part of any non-trivial change, not as an afterthought.
- Never check off a done-criteria item without live verification (a real
  query, a real test run, a real deploy log) — "should work" is not done.
- One item/decision at a time. Don't auto-advance to the next phase or the
  next open item without the user's go-ahead.
- Explain back non-trivial changes before moving on.
- Secrets only ever live in environment variables — never in the repo, never
  hardcoded, never logged.
- Documents (even the fictional demo invoices) represent other people's data.
  Never log or print document contents or field values — metadata only (ids,
  filenames, statuses, counts, error reasons).
- The review/threshold gate is the actual product. Never widen it, weaken
  it, or bypass it for a demo or for convenience — that includes the demo
  account, which is intentionally read-only rather than having its
  enforcement relaxed.
- This is a **public template** — assume unpredictable public traffic
  against shared resources like the demo account, not a single
  personally-monitored instance.

## Where things actually run

- Web app and worker are two separate Railway services (same repo, worker's
  `rootDirectory` is `worker/`), both tracking `main`.
- Redeploy via a `serviceConnect` no-op reconnect, not `serviceInstanceDeploy`
  or the `railway_redeploy` tool — both of the latter have been observed to
  replay a stale cached build manifest instead of rebuilding fresh (see
  WORKFLOW.md's decisions log for the incident).
- Supabase project: "Upwork Portfolio". Free tier — no automated backups
  exist (a deliberate, logged decision for this template, not an oversight).
- Sentry is wired into both services and confirmed live end-to-end.
