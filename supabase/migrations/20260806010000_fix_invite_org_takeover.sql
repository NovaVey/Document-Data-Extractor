-- CRITICAL SECURITY FIX, found by an adversarial-review audit run right
-- after the invite flow (20260806000000_invite_flow.sql) shipped:
-- handle_new_user() honored invited_org_id/invited_role from ANY new
-- user's raw_user_meta_data, validating only that the named org exists —
-- not that the metadata actually came from inviteMember()/
-- admin.inviteUserByEmail() rather than being self-supplied.
--
-- raw_user_meta_data is the `data` object of Supabase's own PUBLIC
-- signUp() endpoint (POST /auth/v1/signup), reachable by anyone holding
-- only the anon key — which is embedded in every page bundle by design.
-- Confirmed live against this project's actual Auth config: signup was
-- NOT disabled and had no CAPTCHA. Net effect: any anonymous visitor
-- could call supabase.auth.signUp({ email, password, options: { data: {
-- invited_org_id: '<any org uuid>', invited_role: 'owner' } } }) directly
-- against the Auth REST API — bypassing the app's UI entirely, which has
-- no signup form but doesn't need one for this — and become a full
-- owner of any organization whose id they know or can guess. No
-- interaction from a real member required, no email-confirmation step
-- blocks it (the attacker controls the email address end to end).
--
-- Fixed at the one place that actually distinguishes a real invite from
-- self-supplied metadata: auth.users.invited_at, set by Supabase only
-- when a user is created via the admin invite/create flow, never by the
-- public signup endpoint. Confirmed live: the existing demo owner
-- (created via admin.createUser(), not invite) has invited_at = null,
-- same as every public-signup user would — this is a reliable signal,
-- not a guess. The invite-join branch below now requires it in addition
-- to the org-existence check, closing this at the database layer rather
-- than depending on a project-level setting (disable_signup) staying
-- correctly configured forever — same "enforced at the database layer,
-- not application code or project settings that could be bypassed"
-- principle used throughout this schema (approve_document(), the audit
-- log). disable_signup is also being flipped on for this project directly
-- (not via migration — an Auth config setting, not a schema object) as
-- defense in depth, since this app has never had a legitimate use for
-- the public signup endpoint in the first place.
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

  if invited_org_id is not null
    and new.invited_at is not null
    and exists (select 1 from organizations where id = invited_org_id)
  then
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
