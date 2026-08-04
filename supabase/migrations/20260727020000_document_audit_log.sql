-- Phase 9 audit item: corrections and approvals were last-write-wins columns
-- (extracted_fields.corrected_value, documents.approved_by/approved_at),
-- with no history — not hypothetical, this project's own build already hit
-- exactly this gap once (see the decisions log entry for 2026-07-26: a test
-- correction and four test approvals had to be reset by hand via direct
-- superuser SQL because there was no other way to see or undo them).
--
-- An append-only log, populated two ways, neither of which is the app's
-- own Server Action code (same "enforced at the database layer, not
-- application code that could be bypassed" principle as approve_document()
-- itself): a trigger on extracted_fields for corrections, and a direct
-- insert inside approve_document() for approvals. A raw API write that
-- skipped the app's UI entirely still gets logged, same guarantee as every
-- other database-level enforcement in this project.

create table document_audit_log (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  event_type text not null check (event_type in ('corrected', 'approved')),
  -- Only set for 'corrected' events — an 'approved' event is document-level,
  -- not per-field.
  field_key text,
  old_value text,
  new_value text,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index document_audit_log_document_id_idx on document_audit_log (document_id);

alter table document_audit_log enable row level security;

-- Read-only for org members, same join-through-documents pattern as
-- extracted_fields (this table has no org_id column of its own either).
-- Deliberately no insert/update/delete policy for authenticated at all —
-- the only two ways a row is ever written are the trigger function and
-- approve_document() below, both security definer. An append-only log
-- that ordinary write access could edit or delete wouldn't be much of one.
create policy "org members can view their org's audit log"
  on document_audit_log for select
  using (
    exists (
      select 1 from documents d
      where d.id = document_audit_log.document_id
        and public.is_org_member(d.org_id)
    )
  );

-- Fires whenever a correction's value genuinely changes — not just the
-- first time a field is corrected. Using IS DISTINCT FROM (not =) so the
-- very first correction (old.corrected_value null) still logs, and a
-- reviewer re-saving the exact same value they already saved does not
-- produce a redundant entry.
create or replace function public.log_field_correction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.was_corrected and old.corrected_value is distinct from new.corrected_value then
    insert into document_audit_log (document_id, event_type, field_key, old_value, new_value, actor_id)
    values (new.document_id, 'corrected', new.field_key, old.corrected_value, new.corrected_value, new.corrected_by);
  end if;
  return new;
end;
$$;

revoke all on function public.log_field_correction() from public;

create trigger extracted_fields_log_correction
  after update on extracted_fields
  for each row
  execute function public.log_field_correction();

-- approve_document() itself gets the one new line — everything else in the
-- function is unchanged from supabase/migrations/20260726010000_demo_org_read_only.sql.
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

  insert into document_audit_log (document_id, event_type, actor_id)
  values (p_document_id, 'approved', auth.uid());
end;
$$;

revoke all on function public.approve_document(uuid) from public;
revoke execute on function public.approve_document(uuid) from anon, authenticated;
grant execute on function public.approve_document(uuid) to authenticated;
