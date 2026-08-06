-- High-priority finding from the 2026-08-06 fresh audit: claim_next_document()'s
-- per-org daily cost-cap check is a correlated subquery joining through
-- documents on every candidate row the outer scan examines, with no
-- supporting index either side — extraction_runs has only a document_id
-- index and (deliberately, per this table's own original comment in
-- 20260725010000_extraction_data_model.sql) no org_id column of its own;
-- documents has no index on uploaded_at, the column the outer scan
-- orders by. Cheap while the queue is usually empty; degrades toward a
-- scan the moment one org hits its cap while still having queued
-- documents ahead of other orgs' work, and gets slower every month since
-- extraction_runs only ever grows (never pruned). WORKER_CONCURRENCY (a
-- real, designed-to-be-raised throughput knob) multiplies N lanes
-- concurrently hitting the same expensive per-row check.
--
-- Fixed by denormalizing org_id directly onto extraction_runs — a
-- deliberate, narrow exception to that table's stated "no org_id of its
-- own" design: extraction_runs rows are insert-only (nothing ever
-- updates one after creation, confirmed by worker/src/process.ts being
-- the only write site and it never issuing an update), so a denormalized
-- org_id can never drift out of sync with documents.org_id the way a
-- mutable denormalized column could.
--
-- Nullable, not NOT NULL, deliberately: this migration applies to the
-- live database immediately, ahead of the worker code that populates
-- org_id on insert actually being redeployed (a separate, slower
-- process on Railway) — a NOT NULL constraint applied first would make
-- every extraction_runs insert from the still-running old worker fail
-- outright until it redeploys. Nullable fails soft instead: a run
-- inserted in that gap just doesn't count toward the cap sum (coalesce
-- below), never a hard error. A future migration can add NOT NULL once
-- the new worker code is confirmed live and all rows are backfilled.
alter table extraction_runs add column org_id uuid references organizations(id) on delete cascade;

update extraction_runs er
set org_id = d.org_id
from documents d
where d.id = er.document_id
  and er.org_id is null;

-- (org_id, created_at): exactly the two columns claim_next_document()'s
-- cost-cap check filters on.
create index extraction_runs_org_id_created_at_idx
  on extraction_runs (org_id, created_at);

-- The outer claim scan's own `order by uploaded_at limit 1` had no
-- index to drive it either.
create index documents_uploaded_at_idx on documents (uploaded_at);

-- Same signature as before (CREATE OR REPLACE, not a new overload) — only
-- the cost-cap subquery's body changes, reading the new indexed column
-- directly instead of joining through documents.
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
      where er.org_id = d.org_id
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
