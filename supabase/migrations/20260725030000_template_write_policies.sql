-- Phase 3 item 3: Template CRUD needs write access to extraction_templates,
-- which Phase 2 deliberately left read-only (same pattern as documents'
-- insert policy added in item 1 — write policies land with the feature
-- that actually needs them).

create policy "org members can create templates in their org"
  on extraction_templates for insert
  with check (public.is_org_member(org_id));

create policy "org members can update their org's templates"
  on extraction_templates for update
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy "org members can delete their org's templates"
  on extraction_templates for delete
  using (public.is_org_member(org_id));
