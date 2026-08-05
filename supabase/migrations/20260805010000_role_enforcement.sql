-- Backlog item flagged in Medium PR F: memberships.role ('owner'/'member',
-- check-constrained since Phase 1) has been in the schema since day one
-- but nothing in the app has ever read it — every member could do
-- everything an owner could, regardless of role. There's no membership-
-- management UI to promote/demote/invite anyone (that's the still-
-- deferred self-service invite flow), so the only way a real deployment
-- gets a non-owner member today is the manual Admin-API + SQL path this
-- project's own onboarding docs describe (README "Adding more users") —
-- but once that happens, the app has to actually behave differently for
-- them, or the role column means nothing.
--
-- Scope: extraction_templates are shared, org-wide configuration that
-- every document upload depends on (a wrong field on a template silently
-- produces wrong extractions for the whole org, not just the person who
-- edited it) — that's the one resource in this app where "anyone in the
-- org can change it" is a real risk, unlike day-to-day document work
-- (upload/correct/approve/export), which every member still needs to do
-- their job and stays open to every role. This mirrors a conventional
-- "admin manages configuration, everyone does the work" split. It's
-- deliberately the smallest change that gives memberships.role a real
-- effect without touching anything a real single-owner org (the only
-- kind that exists in production today) would ever notice.
create or replace function public.is_writable_org_owner(check_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_writable_org_member(check_org_id)
    and exists (
      select 1 from memberships
      where org_id = check_org_id
        and user_id = auth.uid()
        and role = 'owner'
    );
$$;

revoke all on function public.is_writable_org_owner(uuid) from public;
grant execute on function public.is_writable_org_owner(uuid) to anon, authenticated, service_role;

drop policy if exists "org members can create templates in their org" on extraction_templates;
create policy "org owners can create templates in their org"
  on extraction_templates for insert
  with check (public.is_writable_org_owner(org_id));

drop policy if exists "org members can update their org's templates" on extraction_templates;
create policy "org owners can update their org's templates"
  on extraction_templates for update
  using (public.is_writable_org_owner(org_id))
  with check (public.is_writable_org_owner(org_id));

drop policy if exists "org members can delete their org's templates" on extraction_templates;
create policy "org owners can delete their org's templates"
  on extraction_templates for delete
  using (public.is_writable_org_owner(org_id));
