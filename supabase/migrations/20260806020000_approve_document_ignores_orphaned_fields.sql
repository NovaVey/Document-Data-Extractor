-- High-priority finding from the 2026-08-06 fresh audit: editing a
-- template's fields (rename/remove a key) after documents were already
-- extracted permanently stranded those documents. review-panel.tsx's
-- client-side unresolvedCount only ever iterates templateFields (the
-- CURRENT template's field list) -- an extracted_fields row whose
-- field_key no longer exists on the template isn't shown at all, so
-- there's no way to correct it and it's excluded from the client-side
-- count, making the Approve button look enabled. But approve_document()
-- counted every extracted_fields row for the document regardless of
-- whether its field_key still existed on the current template, so it
-- still rejected the approval on the orphaned row -- a document a
-- reviewer could never fix a specific way to unblock, since the UI never
-- shows them what's blocking it.
--
-- Fixed by making the server-side gate match the client-side one: only
-- count an unresolved field if its field_key is still present in the
-- CURRENT template's fields. A renamed/removed field's old extracted_fields
-- row stays in the table (historical data, never deleted) but no longer
-- blocks approval, exactly like it's no longer shown or correctable in
-- the review UI. Falls back to the original strict "count every row"
-- behavior when a document has no template_id at all (defensive: never
-- let an edge case silently bypass review entirely, only ever narrow
-- what's already-known-inapplicable).
create or replace function public.approve_document(p_document_id uuid, p_confidence_threshold numeric default 0.9)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status text;
  v_template_id uuid;
  v_current_field_keys text[];
  v_unresolved int;
begin
  select org_id, status, template_id into v_org_id, v_status, v_template_id
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

  -- documents.template_id -> extraction_templates(id) is ON DELETE RESTRICT
  -- (Phase 2 decision), so a non-null v_template_id guarantees the
  -- template row still exists -- this can never silently miss a template
  -- that was "deleted out from under" the document.
  if v_template_id is not null then
    select array_agg(tf ->> 'key')
    into v_current_field_keys
    from extraction_templates t
    cross join lateral jsonb_array_elements(t.fields) as tf
    where t.id = v_template_id;
  end if;

  select count(*) into v_unresolved
  from extracted_fields
  where document_id = p_document_id
    and coalesce(final_confidence, 0) < p_confidence_threshold
    and not was_corrected
    and (v_current_field_keys is null or field_key = any(v_current_field_keys));

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
