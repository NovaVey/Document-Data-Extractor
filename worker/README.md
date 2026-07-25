# Extraction worker

Standalone background worker for Document Data Extractor. Deployed separately
from the Next.js app (Railway, not Vercel) because it needs to run as a
persistent process — a polling loop, not a request/response function.

Talks to the same Supabase project as the app, using the service role key
(bypasses Row Level Security — this process is trusted to see every org's
queue, which is exactly what RLS exists to prevent for a normal client).

## What it does

Repeatedly claims one queued document at a time (`claim_next_document()`,
`FOR UPDATE SKIP LOCKED` under the hood — safe for multiple worker instances
to run concurrently without double-processing a row), processes it, and
updates its status. A claim that's been sitting in `processing` past a
staleness window is treated as an abandoned/crashed attempt and reclaimed
automatically — no row can get stuck forever because a worker process died
mid-attempt.

The actual extraction logic (`src/process.ts`) is currently a placeholder —
real extraction, validation, and confidence scoring land in later build
items. This skeleton only proves the queue mechanics: enqueue, claim,
status transitions, crash recovery.

## Running locally

```bash
cd worker
npm install
cp .env.example .env   # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm run build
npm start
```

## Deployment

Deployed as its own Railway service, root directory `worker/`, build command
`npm run build`, start command `npm start`. Needs the same two environment
variables as local dev, set in Railway rather than a `.env` file.
