-- Medium-priority audit finding: nothing distinguished "no uploads today"
-- from "the worker has been silently down for six hours" — the only
-- existing signal was in-process Sentry error capture, which only fires on
-- an actual crash. A worker that's simply stopped running (deploy failure,
-- Railway service paused, an uncaught error before Sentry.captureException
-- is reached) produces no signal anywhere.
--
-- Singleton-row table (id forced to the literal `true`, one row max) — the
-- same pattern this project already uses for "there is exactly one of
-- this" invariants elsewhere would be overkill for a single timestamp; a
-- one-row table with a boolean primary key is the simplest structure that
-- can never accumulate more than one row.
create table worker_heartbeat (
  id boolean primary key default true,
  last_tick_at timestamptz not null default now(),
  constraint worker_heartbeat_singleton check (id)
);

insert into worker_heartbeat (id, last_tick_at) values (true, now());

alter table worker_heartbeat enable row level security;

-- Read-only for any signed-in org member (this isn't org-scoped data —
-- there's exactly one worker serving every org — so unlike every other
-- table in this schema, membership in a *specific* org isn't the relevant
-- check, just being a real authenticated user of the app at all).
-- Written exclusively by the worker's own service-role client (bypasses
-- RLS entirely, same as every other worker write), so no insert/update
-- policy for authenticated is needed or granted.
create policy "authenticated users can read the worker heartbeat"
  on worker_heartbeat for select
  to authenticated
  using (true);

revoke all on worker_heartbeat from anon, authenticated;
grant select on worker_heartbeat to authenticated;
