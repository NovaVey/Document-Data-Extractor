-- Backlog item flagged in Medium PR F: zero rate limiting existed
-- anywhere in the app or worker. No Redis/Upstash or any other cache is
-- provisioned for this deployment (checked: no such env var anywhere in
-- .env.example or worker/.env.example) — consistent with every other
-- piece of shared state this project has needed so far (the daily cost
-- cap, the queue itself), this uses Postgres rather than introducing a
-- new piece of infrastructure the project has never needed before.
--
-- One small table plus a SECURITY DEFINER function, the same shape as
-- claim_next_document()'s own FOR UPDATE SKIP LOCKED pattern: each call
-- both counts this caller's recent hits for one action and records this
-- one, inside a single function invocation, so two near-simultaneous
-- calls can't both slip through a limit that should have blocked the
-- second one — see the advisory lock below for what actually makes that
-- true (an initial version of this function only had the count-then-
-- insert shape without it, which is a check-then-act race: two
-- concurrent calls under READ COMMITTED can each read the same
-- under-limit count before either commits its insert).
create table rate_limit_hits (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);

-- Serves both the "count hits in the trailing window" read check_rate_limit()
-- does on every call and its own opportunistic cleanup below — (user_id,
-- action) first since every query filters on both, created_at last for
-- the range scan.
create index rate_limit_hits_user_action_created_idx
  on rate_limit_hits (user_id, action, created_at);

alter table rate_limit_hits enable row level security;
-- No policies created: RLS with zero policies denies all access to
-- anon/authenticated by default, including a raw PostgREST request
-- against this table directly. It's only ever touched through the
-- function below, which runs SECURITY DEFINER and so isn't itself
-- subject to RLS.
revoke all on rate_limit_hits from anon, authenticated;

-- Returns true and records the hit if the caller is under p_max_hits
-- within the trailing p_window; returns false (and records nothing, so a
-- caller already over the limit can't keep growing this table by
-- retrying) otherwise.
--
-- Also opportunistically deletes this same caller's own hits older than
-- an hour on every call — bounded to an indexed (user_id, action, ...)
-- scan of the caller's own rows, not a table-wide sweep, so it's cheap
-- enough to run inline rather than needing a separate cron job just to
-- keep this table from growing forever. Safe against every window this
-- app actually uses (all under an hour; see the call sites) — a window
-- longer than the cleanup threshold would undercount its own hits.
--
-- p_action is restricted to the app's own known action names, not a free
-- -form string: this function is GRANTed to the entire `authenticated`
-- role (any signed-in user can call it directly via supabase.rpc(), not
-- just through this app's own Server Actions), and the opportunistic
-- cleanup above only ever revisits a (user_id, action) pair it has seen
-- before. A caller looping this call with a fresh, never-before-seen
-- p_action on every invocation would otherwise insert one permanent,
-- never-cleaned-up row per call — an unbounded-growth vector. Keep this
-- list in sync with RATE_LIMIT_ACTIONS in src/lib/rate-limit/check.ts.
create or replace function public.check_rate_limit(
  p_action text,
  p_max_hits integer,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  hit_count integer;
begin
  if current_user_id is null then
    return false;
  end if;

  if p_action not in (
    'template_write',
    'document_write',
    'field_correction',
    'document_approval',
    'document_export'
  ) then
    raise exception 'check_rate_limit: unrecognized action %', p_action;
  end if;

  -- Serializes concurrent calls for the same (user, action) pair so the
  -- count-then-insert below can't race: two simultaneous calls would
  -- otherwise both evaluate the SELECT below against the same snapshot
  -- before either commits its INSERT (plain SELECT takes no lock, and
  -- Postgres's default READ COMMITTED isolation doesn't serialize this on
  -- its own) — both would then see an under-limit count and both let
  -- their request through, silently doubling (or worse, with more
  -- concurrent callers) the configured limit. The two-key overload keys
  -- the lock on the pair directly rather than concatenating them into one
  -- string; a hash collision with an unrelated (user, action) pair would
  -- only ever cause extra, harmless serialization between unrelated
  -- callers, never an incorrect result. Transaction-scoped (_xact_):
  -- released automatically at the end of this call, no explicit unlock
  -- needed and no risk of leaking a held lock past this function.
  perform pg_advisory_xact_lock(hashtext(current_user_id::text), hashtext(p_action));

  delete from rate_limit_hits
  where user_id = current_user_id
    and action = p_action
    and created_at < now() - interval '1 hour';

  select count(*) into hit_count
  from rate_limit_hits
  where user_id = current_user_id
    and action = p_action
    and created_at >= now() - p_window;

  if hit_count >= p_max_hits then
    return false;
  end if;

  insert into rate_limit_hits (user_id, action) values (current_user_id, p_action);
  return true;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, interval) from public;
grant execute on function public.check_rate_limit(text, integer, interval) to authenticated;
