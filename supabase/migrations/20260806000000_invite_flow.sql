-- Self-service invite flow: the last deferred item from the original
-- improvement audit, left as a documented backlog item until now (see
-- WORKFLOW.md decisions log, 2026-07-27) because it's genuinely new
-- product surface — a new signup path, not a bug fix to existing
-- behavior. Built at the user's explicit direction.
--
-- handle_new_user() (Phase 1, supabase/migrations/20260725000000_orgs_memberships_rls.sql)
-- has always unconditionally created a brand-new organization for every
-- new auth user — correct for the only signup path that's existed until
-- now (an operator manually creating a deployment's first user). An
-- invited user needs the opposite: join the org they were invited to,
-- not get one of their own. src/app/settings/members/actions.ts's
-- inviteMember() sets invited_org_id/invited_role in the new user's
-- metadata via admin.inviteUserByEmail() — this trigger now branches on
-- that metadata, falling back to the original always-a-new-org behavior
-- for a signup with none (every non-invite signup path is completely
-- unaffected by this change).
--
-- invited_org_id is validated against a real row before being trusted,
-- not just parsed — this metadata is only ever set by this project's own
-- trusted Server Action today, but a SECURITY DEFINER trigger should
-- never blindly trust caller-supplied data regardless of what's supposed
-- to have set it (same discipline as every other cross-org check in this
-- schema). A malformed/dangling invited_org_id falls back to the
-- original new-org behavior rather than silently dropping the row or
-- raising and blocking the signup entirely — a broken invite shouldn't
-- be able to lock someone out of signing up at all.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  invited_org_id uuid;
  invited_role text;
begin
  begin
    invited_org_id := (new.raw_user_meta_data ->> 'invited_org_id')::uuid;
  exception when others then
    invited_org_id := null;
  end;

  if invited_org_id is not null and exists (select 1 from organizations where id = invited_org_id) then
    invited_role := new.raw_user_meta_data ->> 'invited_role';
    if invited_role not in ('owner', 'member') then
      invited_role := 'member';
    end if;

    insert into memberships (org_id, user_id, role)
    values (invited_org_id, new.id, invited_role);

    return new;
  end if;

  insert into organizations (name)
  values (coalesce(new.raw_user_meta_data ->> 'org_name', split_part(new.email, '@', 1) || '''s organization'))
  returning id into new_org_id;

  insert into memberships (org_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  return new;
end;
$$;

-- Extends check_rate_limit()'s action allow-list (supabase/migrations/
-- 20260805000000_rate_limiting.sql) with the invite flow's own action —
-- that function raises on any action outside its known set by design, so
-- inviteMember() would fail every call without this. Same reasoning as
-- every other bucket: bounds a real abuse vector (looping invites to
-- spam an inbox, or to grow the org's membership list) without needing a
-- second migration just to add one string to an existing IN list.
create or replace function public.check_rate_limit(
  p_action text,
  p_max_hits integer,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  hit_count integer;
begin
  if current_user_id is null then
    return false;
  end if;

  if p_action not in (
    'template_write',
    'document_write',
    'field_correction',
    'document_approval',
    'document_export',
    'member_invite'
  ) then
    raise exception 'check_rate_limit: unrecognized action %', p_action;
  end if;

  perform pg_advisory_xact_lock(hashtext(current_user_id::text), hashtext(p_action));

  delete from rate_limit_hits
  where user_id = current_user_id
    and action = p_action
    and created_at < now() - interval '1 hour';

  select count(*) into hit_count
  from rate_limit_hits
  where user_id = current_user_id
    and action = p_action
    and created_at >= now() - p_window;

  if hit_count >= p_max_hits then
    return false;
  end if;

  insert into rate_limit_hits (user_id, action) values (current_user_id, p_action);
  return true;
end;
$$;
