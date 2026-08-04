-- Medium-priority audit finding (product/ops): the 0.9 review-confidence
-- threshold was a bare constant duplicated across src/lib/review/threshold.ts,
-- worker/src/scoring/threshold.ts, and (as a hardcoded literal) this
-- function itself -- no way to tune it per deployment without editing and
-- redeploying code in three places. Made configurable the same way
-- DAILY_COST_CAP_CENTS already is (supabase/migrations/20260726000000_daily_cost_cap.sql):
-- an env-var-overridable value resolved server-side and passed in as an
-- RPC parameter, not a new per-org settings column/UI -- consistent with
-- an already-reviewed pattern in this exact codebase rather than a new
-- product surface.
--
-- Function identity in Postgres is name + parameter TYPES, so adding a
-- parameter isn't a plain CREATE OR REPLACE of the existing 1-arg
-- function -- it would create a second overload unless the old one is
-- dropped first. Dropped explicitly rather than leaving a stale overload
-- (with its own separate revoke/grant surface) sitting around unused.
drop function if exists public.approve_document(uuid);

create function public.approve_document(p_document_id uuid, p_confidence_threshold numeric default 0.9)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status text;
  v_unresolved int;
begin
  select org_id, status into v_org_id, v_status
  from documents where id = p_document_id;

  if v_org_id is null then
    raise exception 'document not found';
  end if;

  if not public.is_writable_org_member(v_org_id) then
    raise exception 'not a member of this document''s organization, or this organization is read-only';
  end if;

  if v_status != 'needs_review' then
    raise exception 'document must be in needs_review to approve (currently %)', v_status;
  end if;

  select count(*) into v_unresolved
  from extracted_fields
  where document_id = p_document_id
    and coalesce(final_confidence, 0) < p_confidence_threshold
    and not was_corrected;

  if v_unresolved > 0 then
    raise exception '% field(s) still need review before this document can be approved', v_unresolved;
  end if;

  update documents
  set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = p_document_id;

  insert into document_audit_log (document_id, event_type, actor_id)
  values (p_document_id, 'approved', auth.uid());
end;
$$;

revoke all on function public.approve_document(uuid, numeric) from public;
revoke execute on function public.approve_document(uuid, numeric) from anon, authenticated;
grant execute on function public.approve_document(uuid, numeric) to authenticated;
