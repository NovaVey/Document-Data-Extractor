-- Phase 3 item 1: upload and storage. Adds the write policy documents
-- actually needs now (Phase 2 deliberately left documents insert-only-via-
-- service-role, per its own note that write policies land with the Phase 3
-- feature that needs them), plus the Storage bucket and its RLS policies.

create policy "org members can insert documents into their org"
  on documents for insert
  with check (public.is_org_member(org_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  20971520, -- 20MB
  array['application/pdf', 'image/png', 'image/jpeg']
);

-- Storage objects are stored as `${org_id}/${uuid}-${filename}` — the first
-- path segment is the org id, so membership is checked the same way as
-- every other org-scoped policy, just reading the org id out of the path
-- instead of a column.
create policy "org members can upload to their org's folder"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

create policy "org members can read their org's documents in storage"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
