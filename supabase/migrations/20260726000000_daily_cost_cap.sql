-- Phase 3 item 17: per-org daily cost cap. claim_next_document() now
-- skips (never claims) a queued document whose org has already spent
-- daily_cost_cap_cents or more today, summed from extraction_runs joined
-- through documents.org_id. This has to live in the claim query itself,
-- not a check performed after claiming: checking afterward and
-- re-queuing the same row would just re-claim the identical oldest row
-- every tick (it's still oldest), starving every OTHER org's queue
-- behind it — the opposite of a *per-org* cap. Skipping it here instead
-- lets the function fall through to the next-oldest document belonging
-- to an org that isn't capped.
--
-- Changing the parameter list means CREATE OR REPLACE would coexist with
-- the old single-parameter version as a separate overload rather than
-- replacing it (Postgres function identity includes the parameter
-- list) — drop the old one explicitly first, same "verify grants
-- actually changed" discipline as item 4's audit.
drop function if exists public.claim_next_document(interval);

create or replace function public.claim_next_document(
  stale_after interval default interval '10 minutes',
  daily_cost_cap_cents integer default 500
)
returns setof documents
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  select d.id into claimed_id
  from documents d
  where (d.status = 'queued' or (d.status = 'processing' and d.processing_started_at < now() - stale_after))
    and coalesce((
      select sum(er.cost_cents)
      from extraction_runs er
      join documents d2 on d2.id = er.document_id
      where d2.org_id = d.org_id
        and er.created_at >= current_date
    ), 0) < daily_cost_cap_cents
  order by d.uploaded_at
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

revoke all on function public.claim_next_document(interval, integer) from public;
revoke execute on function public.claim_next_document(interval, integer) from anon, authenticated;
grant execute on function public.claim_next_document(interval, integer) to service_role;
