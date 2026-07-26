-- Phase 2 data model: the four remaining tables (extraction_templates,
-- extracted_fields, extraction_runs, export_jobs), and migrating `documents`
-- from Phase 1's minimal placeholder (id, org_id, title, created_at) to its
-- full production schema.

create table extraction_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index extraction_templates_org_id_idx on extraction_templates (org_id);

-- Migrate `documents` in place rather than dropping/recreating, so the
-- table identity, its existing RLS policy, and documents_org_id_idx all
-- carry forward. The table is empty in every environment this has run in
-- so far, so adding NOT NULL columns without a default is safe here.
alter table documents rename column created_at to uploaded_at;
alter table documents drop column title;
alter table documents
  add column template_id uuid references extraction_templates(id) on delete restrict,
  add column original_filename text not null,
  add column storage_path text not null,
  add column file_hash text not null,
  add column mime_type text not null,
  add column page_count integer,
  add column status text not null default 'uploaded'
    check (status in ('uploaded', 'queued', 'processing', 'needs_review', 'approved', 'failed')),
  add column error_message text,
  add column processed_at timestamptz,
  add column approved_by uuid references auth.users(id) on delete set null,
  add column approved_at timestamptz;

create index documents_status_idx on documents (status);

-- Duplicate detection belongs in the database: two documents in the same
-- org with the same file content are a duplicate upload; the same file
-- uploaded to two different orgs is not.
create unique index documents_org_id_file_hash_key on documents (org_id, file_hash);

create table extracted_fields (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  field_key text not null,
  raw_value text,
  normalized_value text,
  model_confidence numeric,
  validation_status text,
  validation_notes text,
  final_confidence numeric,
  was_corrected boolean not null default false,
  corrected_value text,
  corrected_by uuid references auth.users(id) on delete set null,
  corrected_at timestamptz
);

create index extracted_fields_document_id_idx on extracted_fields (document_id);

create table extraction_runs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  attempt integer not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  cost_cents integer,
  duration_ms integer,
  error_message text,
  -- Not in the original column list, but load-bearing: Phase 3's per-org
  -- daily cost cap has to sum "today's" cost across runs, which is only
  -- answerable if a run knows what day it happened on.
  created_at timestamptz not null default now()
);

create index extraction_runs_document_id_idx on extraction_runs (document_id);

create table export_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  filters jsonb not null default '{}'::jsonb,
  format text not null check (format in ('csv', 'xlsx')),
  row_count integer,
  storage_path text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index export_jobs_org_id_idx on export_jobs (org_id);

alter table extraction_templates enable row level security;
alter table extracted_fields enable row level security;
alter table extraction_runs enable row level security;
alter table export_jobs enable row level security;

create policy "org members can view their org's templates"
  on extraction_templates for select
  using (public.is_org_member(org_id));

-- extracted_fields and extraction_runs have no org_id of their own — org
-- membership is checked through the parent document, the same way a
-- foreign key would be followed in application code.
create policy "org members can view fields on their org's documents"
  on extracted_fields for select
  using (
    exists (
      select 1 from documents d
      where d.id = extracted_fields.document_id
        and public.is_org_member(d.org_id)
    )
  );

create policy "org members can view runs on their org's documents"
  on extraction_runs for select
  using (
    exists (
      select 1 from documents d
      where d.id = extraction_runs.document_id
        and public.is_org_member(d.org_id)
    )
  );

create policy "org members can view their org's export jobs"
  on export_jobs for select
  using (public.is_org_member(org_id));

-- No insert/update/delete policies yet on any Phase 2 table, same as
-- Phase 1's documents/organizations/memberships: write policies get added
-- alongside the Phase 3 feature that actually needs them (template CRUD,
-- upload, corrections, export), not guessed at ahead of time. The
-- background extraction worker writes via the service role key, which
-- bypasses RLS entirely, so extracted_fields/extraction_runs may never
-- need an authenticated-role insert policy at all.
