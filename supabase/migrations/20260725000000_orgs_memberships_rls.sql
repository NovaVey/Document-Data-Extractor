-- Phase 1 foundation: organizations, memberships, and RLS, built before any
-- feature table exists. A minimal `documents` table is included so the
-- Phase 1 vertical slice (log in, see one document belonging to your org,
-- and nothing that doesn't) has something real to prove isolation against.
-- Phase 2 replaces `documents` with its full column set via a later migration.

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index memberships_user_id_idx on memberships (user_id);
create index memberships_org_id_idx on memberships (org_id);

create table documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);

create index documents_org_id_idx on documents (org_id);

-- security definer so the membership check itself doesn't trigger RLS on
-- `memberships` (a policy on a table that queries that same table in its
-- USING clause is a classic infinite-recursion trap in Postgres).
create or replace function public.is_org_member(check_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from memberships
    where org_id = check_org_id
      and user_id = auth.uid()
  );
$$;

alter table organizations enable row level security;
alter table memberships enable row level security;
alter table documents enable row level security;

create policy "org members can view their org"
  on organizations for select
  using (public.is_org_member(id));

create policy "org members can view memberships in their org"
  on memberships for select
  using (public.is_org_member(org_id));

create policy "org members can view their org's documents"
  on documents for select
  using (public.is_org_member(org_id));

-- New auth users get an organization and an owner membership automatically —
-- there is no self-service org creation or invite flow in v1.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  insert into organizations (name)
  values (coalesce(new.raw_user_meta_data ->> 'org_name', split_part(new.email, '@', 1) || '''s organization'))
  returning id into new_org_id;

  insert into memberships (org_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
