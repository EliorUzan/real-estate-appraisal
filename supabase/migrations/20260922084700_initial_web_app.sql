-- Initial schema for the collaborative web application.
-- Run only through the Supabase migration workflow; do not paste credentials into this file.

create extension if not exists pgcrypto;
create schema if not exists private;

create type public.member_role as enum ('admin', 'member');
create type public.member_status as enum ('active', 'suspended', 'invited');
create type public.attachment_status as enum (
  'reserved', 'uploaded', 'validating', 'ready', 'rejected', 'deleting', 'deleted'
);
create type public.job_status as enum (
  'queued', 'running', 'retry_wait', 'succeeded', 'failed', 'needs_review',
  'cancel_requested', 'cancelled', 'expired'
);
create type public.job_stage as enum ('validating', 'extracting', 'calling_provider', 'saving');
create type public.attachment_group as enum ('example', 'additional_request');
create type private.dispatch_state as enum ('pending', 'dispatched', 'failed', 'complete');
create type private.cleanup_status as enum ('pending', 'running', 'complete', 'failed');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role public.member_role not null default 'member',
  status public.member_status not null default 'invited',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id),
  unique (id, workspace_id)
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  display_name text not null default '' check (char_length(display_name) <= 120),
  locale text not null default 'he-IL' check (locale in ('he-IL', 'en')),
  default_provider text check (default_provider in ('openai', 'gemini', 'anthropic', 'moonshot', 'qwen')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.provider_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  provider_id text not null check (provider_id in ('openai', 'gemini', 'anthropic', 'moonshot', 'qwen')),
  model_id text not null check (char_length(btrim(model_id)) between 1 and 160),
  configured boolean not null default false,
  key_last4 text check (key_last4 is null or key_last4 ~ '^[^[:space:]]{4}$'),
  credential_version integer not null default 0 check (credential_version >= 0),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider_id)
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  object_key text not null unique check (object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/source\\.[a-z0-9]{1,10}$'),
  original_name text not null check (char_length(btrim(original_name)) between 1 and 255),
  suffix text not null check (suffix in ('.pdf', '.docx', '.xlsx', '.xls', '.csv', '.txt', '.md')),
  detected_mime text,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  status public.attachment_status not null default 'reserved',
  expires_at timestamptz not null,
  deleted_at timestamptz,
  cleanup_attempts integer not null default 0 check (cleanup_attempts >= 0),
  validation_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id, owner_id),
  check (expires_at > created_at),
  check ((status = 'deleted') = (deleted_at is not null))
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  rerun_of_job_id uuid references public.generation_jobs(id) on delete restrict,
  section_id text not null check (section_id in ('environment_description')),
  address text not null check (char_length(btrim(address)) between 1 and 500),
  example_text text not null default '' check (char_length(example_text) <= 20000),
  additional_request text not null default '' check (char_length(additional_request) <= 20000),
  provider_id text not null check (provider_id in ('openai', 'gemini', 'anthropic', 'moonshot', 'qwen')),
  model_id text not null check (char_length(btrim(model_id)) between 1 and 160),
  credential_version integer not null check (credential_version > 0),
  prompt_hash text not null check (prompt_hash ~ '^[0-9a-f]{64}$'),
  consent_version text not null check (char_length(consent_version) between 1 and 80),
  consented_at timestamptz not null,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status public.job_status not null default 'queued',
  stage public.job_stage,
  attempt integer not null default 0 check (attempt between 0 and 3),
  lease_token uuid,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  output_text text,
  provider_request_id text,
  usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object'),
  app_commit_sha text,
  job_schema_version integer not null default 1 check (job_schema_version > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, idempotency_key),
  unique (id, workspace_id, owner_id),
  check ((lease_token is null) = (lease_expires_at is null)),
  check ((status in ('succeeded', 'failed', 'needs_review', 'cancelled', 'expired')) = (completed_at is not null))
);

create table public.job_attachments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  attachment_id uuid not null unique,
  workspace_id uuid not null,
  owner_id uuid not null,
  "group" public.attachment_group not null,
  position smallint not null check (position >= 0 and position < 5),
  original_name text not null check (char_length(original_name) between 1 and 255),
  suffix text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  source_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, "group", position),
  foreign key (job_id, workspace_id, owner_id)
    references public.generation_jobs (id, workspace_id, owner_id) on delete restrict,
  foreign key (attachment_id, workspace_id, owner_id)
    references public.attachments (id, workspace_id, owner_id) on delete restrict
);

create table public.draft_revisions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  workspace_id uuid not null,
  owner_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  text text not null,
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (job_id, revision_number),
  foreign key (job_id, workspace_id, owner_id)
    references public.generation_jobs (id, workspace_id, owner_id) on delete restrict
);

create table public.draft_approvals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete restrict,
  revision_id uuid not null references public.draft_revisions(id) on delete restrict,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (job_id, revision_id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete restrict,
  event_type text not null check (char_length(event_type) between 1 and 100),
  resource_id uuid,
  request_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table private.provider_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  provider_id text not null check (provider_id in ('openai', 'gemini', 'anthropic', 'moonshot', 'qwen')),
  version integer not null check (version > 0),
  ciphertext bytea not null,
  nonce bytea not null check (octet_length(nonce) = 12),
  encryption_key_version integer not null check (encryption_key_version > 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, provider_id, version)
);

create table private.task_outbox (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('generation_job', 'attachment', 'cleanup')),
  resource_id uuid not null,
  event_type text not null check (event_type in ('dispatch_generation', 'validate_attachment', 'cleanup_resource')),
  generation integer not null default 1 check (generation > 0),
  dispatch_state private.dispatch_state not null default 'pending',
  attempt integer not null default 0 check (attempt >= 0),
  next_attempt_at timestamptz not null default now(),
  dispatched_at timestamptz,
  deployment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_type, resource_id, event_type, generation)
);

create table private.cleanup_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  job_id uuid references public.generation_jobs(id) on delete restrict,
  attachment_id uuid references public.attachments(id) on delete restrict,
  resource_kind text not null check (resource_kind in ('storage_object', 'provider_file')),
  object_key text,
  remote_file_id text,
  provider_id text check (provider_id is null or provider_id in ('openai', 'gemini', 'anthropic', 'moonshot', 'qwen')),
  credential_version integer check (credential_version is null or credential_version > 0),
  status private.cleanup_status not null default 'pending',
  attempt integer not null default 0 check (attempt >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((resource_kind = 'storage_object' and object_key is not null and remote_file_id is null)
      or (resource_kind = 'provider_file' and remote_file_id is not null)),
  unique nulls not distinct (resource_kind, object_key, remote_file_id)
);

create table private.usage_counters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  window_start timestamptz not null,
  window_kind text not null check (window_kind in ('daily_jobs', 'storage_bytes', 'provider_tokens')),
  count integer not null default 0 check (count >= 0),
  reserved_tokens integer not null default 0 check (reserved_tokens >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, window_start, window_kind)
);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workspaces_set_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
create trigger workspace_members_set_updated_at before update on public.workspace_members for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger provider_settings_set_updated_at before update on public.provider_settings for each row execute function public.set_updated_at();
create trigger attachments_set_updated_at before update on public.attachments for each row execute function public.set_updated_at();
create trigger generation_jobs_set_updated_at before update on public.generation_jobs for each row execute function public.set_updated_at();
create trigger task_outbox_set_updated_at before update on private.task_outbox for each row execute function public.set_updated_at();
create trigger cleanup_tasks_set_updated_at before update on private.cleanup_tasks for each row execute function public.set_updated_at();
create trigger usage_counters_set_updated_at before update on private.usage_counters for each row execute function public.set_updated_at();

create index workspace_members_user_active_idx on public.workspace_members (user_id, workspace_id) where status = 'active';
create index attachments_owner_status_idx on public.attachments (workspace_id, owner_id, status, created_at desc);
create index generation_jobs_history_idx on public.generation_jobs (workspace_id, created_at desc, id desc) where deleted_at is null;
create index generation_jobs_owner_history_idx on public.generation_jobs (workspace_id, owner_id, created_at desc, id desc) where deleted_at is null;
create index generation_jobs_dispatch_idx on public.generation_jobs (status, lease_expires_at) where status in ('queued', 'retry_wait', 'running');
create index job_attachments_job_idx on public.job_attachments (job_id, position);
create index draft_revisions_job_idx on public.draft_revisions (job_id, revision_number desc);
create index draft_approvals_job_idx on public.draft_approvals (job_id, approved_at desc);
create index task_outbox_pending_idx on private.task_outbox (dispatch_state, next_attempt_at);
create index cleanup_tasks_pending_idx on private.cleanup_tasks (status, next_attempt_at);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.profiles enable row level security;
alter table public.provider_settings enable row level security;
alter table public.attachments enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.job_attachments enable row level security;
alter table public.draft_revisions enable row level security;
alter table public.draft_approvals enable row level security;
alter table public.audit_events enable row level security;
alter table private.provider_credentials enable row level security;
alter table private.task_outbox enable row level security;
alter table private.cleanup_tasks enable row level security;
alter table private.usage_counters enable row level security;

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.workspaces, public.workspace_members, public.provider_settings,
  public.generation_jobs, public.job_attachments, public.draft_revisions, public.draft_approvals,
  public.audit_events from authenticated;
grant usage on schema public to authenticated;
grant select on public.workspaces, public.workspace_members, public.profiles, public.provider_settings,
  public.attachments, public.generation_jobs, public.job_attachments, public.draft_revisions,
  public.draft_approvals to authenticated;

create policy workspace_members_self_read on public.workspace_members for select to authenticated
  using (user_id = (select auth.uid()));

create policy workspaces_active_member_read on public.workspaces for select to authenticated
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = workspaces.id and m.user_id = (select auth.uid()) and m.status = 'active'
  ));

create policy profiles_owner_read on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));

create policy provider_settings_owner_read on public.provider_settings for select to authenticated
  using (user_id = (select auth.uid()));

create policy attachments_owner_read on public.attachments for select to authenticated
  using (owner_id = (select auth.uid()) and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = attachments.workspace_id and m.user_id = (select auth.uid()) and m.status = 'active'
  ));

create policy jobs_team_read on public.generation_jobs for select to authenticated
  using (deleted_at is null and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = generation_jobs.workspace_id and m.user_id = (select auth.uid()) and m.status = 'active'
  ));

create policy job_attachments_team_read on public.job_attachments for select to authenticated
  using (exists (
    select 1 from public.generation_jobs j join public.workspace_members m on m.workspace_id = j.workspace_id
    where j.id = job_attachments.job_id and j.deleted_at is null
      and m.user_id = (select auth.uid()) and m.status = 'active'
  ));

create policy draft_revisions_team_read on public.draft_revisions for select to authenticated
  using (exists (
    select 1 from public.generation_jobs j join public.workspace_members m on m.workspace_id = j.workspace_id
    where j.id = draft_revisions.job_id and j.deleted_at is null
      and m.user_id = (select auth.uid()) and m.status = 'active'
  ));

create policy draft_approvals_team_read on public.draft_approvals for select to authenticated
  using (exists (
    select 1 from public.generation_jobs j join public.workspace_members m on m.workspace_id = j.workspace_id
    where j.id = draft_approvals.job_id and j.deleted_at is null
      and m.user_id = (select auth.uid()) and m.status = 'active'
  ));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('temporary-source-files', 'temporary-source-files', false, 20971520,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
        'text/csv', 'text/plain', 'text/markdown'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

revoke all on storage.objects from anon, authenticated;
-- Upload/download capabilities are minted by the backend with short-lived, path-specific signed URLs.
