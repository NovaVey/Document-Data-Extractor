-- Phase 3 item 4: queue worker mechanics. `processing_started_at` isn't in
-- the original documents column list — added because "handle a crashed
-- worker without losing the row" is impossible without knowing how long a
-- document has been sitting in 'processing', to tell a genuinely-in-flight
-- row apart from one whose worker died mid-attempt.

alter table documents add column processing_started_at timestamptz;

-- Atomically claims one document: either a fresh 'queued' row, or a
-- 'processing' row whose worker has clearly gone silent (older than
-- stale_after). FOR UPDATE SKIP LOCKED means concurrent workers never
-- fight over the same row — each just moves on to the next one.
--
-- This is a plpgsql function (not a plain query through the Supabase
-- client) because PostgREST has no way to express FOR UPDATE SKIP LOCKED —
-- the client can only call this via .rpc(), never a bare .from() query.
--
-- security definer + explicit revoke/grant below: this function does not
-- check org membership at all (a shared worker has to see every org's
-- queue), so it must never be callable with the anon/authenticated key —
-- only the service role (the worker) may invoke it.
create or replace function public.claim_next_document(stale_after interval default interval '10 minutes')
returns setof documents
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  select id into claimed_id
  from documents
  where status = 'queued'
     or (status = 'processing' and processing_started_at < now() - stale_after)
  order by uploaded_at
  limit 1
  for update skip locked;

  if claimed_id is null then
    return;
  end if;

  return query
    update documents
    set status = 'processing', processing_started_at = now()
    where id = claimed_id
    returning *;
end;
$$;

revoke all on function public.claim_next_document(interval) from public;
grant execute on function public.claim_next_document(interval) to service_role;
