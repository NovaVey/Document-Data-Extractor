-- Phase 3 item 11: correction persistence + the approval gate itself.
-- Two new capabilities for an org member acting as a reviewer:
--   1. Correct an individual field's value (extracted_fields), restricted
--      to only the correction columns, only while the document is still
--      in needs_review, and only ever attributed to the caller themselves.
--   2. Approve a document, but only through a security-definer function —
--      a document can't move to 'approved' while any field scored below
--      the review threshold remains uncorrected. This is the actual
--      enforcement of "mandatory human review before anything reaches
--      export": nothing can skip it via a raw API call either, not just
--      via the UI.

-- Column-level grant: authenticated users may only ever write the
-- correction columns on extracted_fields, never raw_value/normalized_value/
-- model_confidence/validation_status/final_confidence — those are the
-- extraction pipeline's own output and stay an untouched audit trail.
grant update (was_corrected, corrected_value, corrected_by, corrected_at)
  on extracted_fields to authenticated;

-- Name kept to 57 bytes on purpose — an earlier, more descriptive name
-- (69 bytes) hit Postgres's 63-byte identifier limit and was silently
-- truncated, caught only by re-reading the live policy name during
-- verification rather than assuming the CREATE POLICY statement did what
-- its source text said.
create policy "org members can correct fields in their org's review docs"
  on extracted_fields for update
  using (
    exists (
      select 1 from documents d
      where d.id = extracted_fields.document_id
        and d.status = 'needs_review'
        and public.is_org_member(d.org_id)
    )
  )
  with check (
    corrected_by = auth.uid()
    and exists (
      select 1 from documents d
      where d.id = extracted_fields.document_id
        and d.status = 'needs_review'
        and public.is_org_member(d.org_id)
    )
  );

-- Approval must go through this function, the same reasoning as
-- claim_next_document(): the "no field below threshold reaches approval
-- uncorrected" check spans two tables and can't be expressed as a plain
-- RLS predicate on a single UPDATE.
--
-- The 0.9 threshold is duplicated here from src/lib/review/threshold.ts
-- and worker/src/scoring/threshold.ts — a third place to update if it
-- ever changes, accepted for the same reason as the other two: small,
-- changes rarely, and this is the one place the *schema*, not just the
-- UI, actually enforces it.
create or replace function public.approve_document(p_document_id uuid)
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

  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this document''s organization';
  end if;

  if v_status != 'needs_review' then
    raise exception 'document must be in needs_review to approve (currently %)', v_status;
  end if;

  select count(*) into v_unresolved
  from extracted_fields
  where document_id = p_document_id
    and coalesce(final_confidence, 0) < 0.9
    and not was_corrected;

  if v_unresolved > 0 then
    raise exception '% field(s) still need review before this document can be approved', v_unresolved;
  end if;

  update documents
  set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = p_document_id;
end;
$$;

-- Same grant-hygiene lesson as claim_next_document() (Phase 3 item 4):
-- Supabase auto-grants execute on new public-schema functions directly to
-- anon/authenticated, not just to PUBLIC — `revoke ... from public` alone
-- does not strip that. Revoke from the named roles explicitly, then grant
-- back only to authenticated.
revoke all on function public.approve_document(uuid) from public;
revoke execute on function public.approve_document(uuid) from anon, authenticated;
grant execute on function public.approve_document(uuid) to authenticated;
