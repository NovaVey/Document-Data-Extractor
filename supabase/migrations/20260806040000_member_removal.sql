-- High-priority finding from the 2026-08-06 fresh audit: the members
-- page (self-service invite flow, PR #23) could only invite — there was
-- no way to remove, demote, or cancel a pending invite for a member once
-- added, and no UPDATE/DELETE RLS policy on `memberships` at all (only
-- the original SELECT policy from Phase 1). An owner who invites the
-- wrong email, or whose teammate leaves, had no in-app fix.
--
-- Both new policies are owner-only (is_writable_org_owner(), same
-- predicate template management already uses) and additionally protect
-- against leaving an org with zero owners: a DELETE or an UPDATE that
-- would remove/demote the org's last remaining owner is rejected by RLS
-- itself, not just by application code that could be bypassed — same
-- "enforced at the database layer" principle used throughout this
-- schema. Removing/demoting yourself is allowed as long as another owner
-- still exists; there's nothing special about self-targeting beyond that.
drop policy if exists "org owners can remove their org's members" on memberships;
create policy "org owners can remove their org's members"
  on memberships for delete
  using (
    public.is_writable_org_owner(org_id)
    and (
      role != 'owner'
      or exists (
        select 1 from memberships m2
        where m2.org_id = memberships.org_id
          and m2.role = 'owner'
          and m2.user_id != memberships.user_id
      )
    )
  );

drop policy if exists "org owners can update their org's members' roles" on memberships;
create policy "org owners can update their org's members' roles"
  on memberships for update
  using (public.is_writable_org_owner(org_id))
  with check (
    public.is_writable_org_owner(org_id)
    and (
      role = 'owner'
      or exists (
        select 1 from memberships m2
        where m2.org_id = memberships.org_id
          and m2.role = 'owner'
          and m2.user_id != memberships.user_id
      )
    )
  );

-- Extends check_rate_limit()'s action allow-list (supabase/migrations/
-- 20260805000000_rate_limiting.sql) with a bucket for remove/demote —
-- kept distinct from member_invite (20260806000000_invite_flow.sql)
-- since these are meaningfully different operations (invite sends a real
-- email to a stranger with real external cost/spam-risk; remove/demote
-- only ever affects an already-known org member, no external side
-- effect), not because either needs a tighter or looser limit than the other.
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
    'member_invite',
    'member_manage'
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
