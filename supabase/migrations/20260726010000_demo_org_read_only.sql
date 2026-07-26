-- Read-only demo org enforcement (Phase 5).
--
-- Demo credentials are meant to be publicly visible on the login screen, so
-- "read-only" has to be real RLS enforcement, not just hidden UI buttons —
-- a crafted API request could otherwise bypass a client-side-only guard.
-- is_writable_org_member() wraps the existing is_org_member() check and
-- additionally requires the org is not flagged is_demo, then replaces
-- is_org_member() in every write-path policy predicate (insert/update/delete
-- across documents, storage.objects, extraction_templates, extracted_fields)
-- and inside approve_document(). Read (select) policies are untouched —
-- demo visitors can still see everything, just not change it.

alter table organizations add column is_demo boolean not null default false;

create or replace function public.is_writable_org_member(check_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_org_member(check_org_id)
    and not coalesce((select is_demo from organizations where id = check_org_id), false);
$$;

revoke all on function public.is_writable_org_member(uuid) from public;
grant execute on function public.is_writable_org_member(uuid) to anon, authenticated, service_role;

-- documents
drop policy if exists "org members can insert documents into their org" on documents;
create policy "org members can insert documents into their org"
  on documents for insert
  with check (public.is_writable_org_member(org_id));

drop policy if exists "org members can enqueue their own uploaded documents" on documents;
create policy "org members can enqueue their own uploaded documents"
  on documents for update
  using (status = 'uploaded' and public.is_writable_org_member(org_id))
  with check (status = 'queued' and public.is_writable_org_member(org_id));

drop policy if exists "org members can delete their org's documents" on documents;
create policy "org members can delete their org's documents"
  on documents for delete
  using (public.is_writable_org_member(org_id));

-- storage.objects
drop policy if exists "org members can upload to their org's folder" on storage.objects;
create policy "org members can upload to their org's folder"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and public.is_writable_org_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "org members can delete their org's documents in storage" on storage.objects;
create policy "org members can delete their org's documents in storage"
  on storage.objects for delete
  using (
    bucket_id = 'documents'
    and public.is_writable_org_member((storage.foldername(name))[1]::uuid)
  );

-- extraction_templates
drop policy if exists "org members can create templates in their org" on extraction_templates;
create policy "org members can create templates in their org"
  on extraction_templates for insert
  with check (public.is_writable_org_member(org_id));

drop policy if exists "org members can update their org's templates" on extraction_templates;
create policy "org members can update their org's templates"
  on extraction_templates for update
  using (public.is_writable_org_member(org_id))
  with check (public.is_writable_org_member(org_id));

drop policy if exists "org members can delete their org's templates" on extraction_templates;
create policy "org members can delete their org's templates"
  on extraction_templates for delete
  using (public.is_writable_org_member(org_id));

-- extracted_fields correction
drop policy if exists "org members can correct fields in their org's review docs" on extracted_fields;
create policy "org members can correct fields in their org's review docs"
  on extracted_fields for update
  using (
    exists (
      select 1 from documents d
      where d.id = extracted_fields.document_id
        and d.status = 'needs_review'
        and public.is_writable_org_member(d.org_id)
    )
  )
  with check (
    corrected_by = auth.uid()
    and exists (
      select 1 from documents d
      where d.id = extracted_fields.document_id
        and d.status = 'needs_review'
        and public.is_writable_org_member(d.org_id)
    )
  );

-- approve_document(): re-check membership AND not-read-only before
-- allowing the transition to 'approved'.
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

  if not public.is_writable_org_member(v_org_id) then
    raise exception 'not a member of this document''s organization, or this organization is read-only';
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

revoke all on function public.approve_document(uuid) from public;
revoke execute on function public.approve_document(uuid) from anon, authenticated;
grant execute on function public.approve_document(uuid) to authenticated;
