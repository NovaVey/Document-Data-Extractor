# Extraction worker

Standalone background worker for Document Data Extractor. Deployed separately
from the Next.js app (Railway, not Vercel) because it needs to run as a
persistent process — a polling loop, not a request/response function.

Talks to the same Supabase project as the app, using the service role key
(bypasses Row Level Security — this process is trusted to see every org's
queue, which is exactly what RLS exists to prevent for a normal client).

## What it does

Repeatedly claims a queued document (`claim_next_document()`, `FOR UPDATE
SKIP LOCKED` under the hood — safe for multiple concurrent claimers, whether
that's multiple lanes in one process or multiple worker instances, to run
without double-processing a row), processes it, and updates its status. A
claim that's been sitting in `processing` past a staleness window is treated
as an abandoned/crashed attempt and reclaimed automatically — no row can get
stuck forever because a worker process died mid-attempt.

By default a single process runs one claim-process-sleep loop ("lane") at a
time — `WORKER_CONCURRENCY` (see `.env.example`, `src/concurrency.ts`) raises
that to N concurrent lanes within the same process for more throughput. This
is orthogonal to running multiple Railway instances of the service (also
safe, for the same `FOR UPDATE SKIP LOCKED` reason): `WORKER_CONCURRENCY`
scales one process's own throughput, running more instances scales
horizontally — both compose. Raising either one widens the per-org daily
cost cap's overshoot window proportionally (`src/index.ts` has the full
reasoning) — keep `WORKER_CONCURRENCY` modest (2-5) unless real volume needs
more.

`src/process.ts` runs the full pipeline: downloads the file from storage,
extracts fields via the Anthropic API (`src/extraction/`), validates and
confidence-scores them (`src/validation/`, `src/scoring/`), records
cost/usage in `extraction_runs`, and upserts the results into
`extracted_fields` before moving the document to `needs_review`. A
heartbeat (`src/process.ts`) periodically refreshes `processing_started_at`
so a long-running call isn't mistaken for a stale/crashed attempt.

## Running locally

```bash
cd worker
npm install
cp .env.example .env   # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ANTHROPIC_API_KEY
npm run build
npm start
```

All three are required — the worker throws on startup without either of the
first two (`src/supabase.ts`, `src/anthropic.ts`), and on the first
extraction call without the third. `SUPABASE_ANON_KEY` is only needed by
`scripts/seed-demo.mjs`, never by the deployed worker itself. `SENTRY_DSN`,
`DAILY_COST_CAP_CENTS`, `REVIEW_CONFIDENCE_THRESHOLD`, and
`WORKER_CONCURRENCY` are optional — Sentry no-ops if unset, the cost cap
defaults to 500 cents/day (`src/claim.ts`), the review threshold defaults to
0.9 (`src/scoring/threshold.ts`, mirrored in `approve_document()` — the
database is what actually enforces it, this worker-side copy only feeds a
log line), and concurrency defaults to 1 lane (`src/concurrency.ts` —
unchanged one-at-a-time behavior). See `.env.example` for the full list.

## Deployment

Deployed as its own Railway service, root directory `worker/`, build command
`npm run build`, start command `npm start`. Needs the same environment
variables as local dev (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
`ANTHROPIC_API_KEY` required; `SENTRY_DSN`, `DAILY_COST_CAP_CENTS`, and
`REVIEW_CONFIDENCE_THRESHOLD` optional), set in Railway rather than a
`.env` file.
