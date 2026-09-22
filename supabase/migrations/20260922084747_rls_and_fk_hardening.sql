-- Explicitly permit only the server service role on non-browser tables and
-- cover all foreign-key lookup paths identified by the Supabase advisor.

create policy audit_events_server_access on public.audit_events for all to service_role
  using (true) with check (true);
create policy provider_credentials_server_access on private.provider_credentials for all to service_role
  using (true) with check (true);
create policy task_outbox_server_access on private.task_outbox for all to service_role
  using (true) with check (true);
create policy cleanup_tasks_server_access on private.cleanup_tasks for all to service_role
  using (true) with check (true);
create policy usage_counters_server_access on private.usage_counters for all to service_role
  using (true) with check (true);

create index cleanup_tasks_attachment_id_idx on private.cleanup_tasks (attachment_id);
create index cleanup_tasks_job_id_idx on private.cleanup_tasks (job_id);
create index cleanup_tasks_workspace_id_idx on private.cleanup_tasks (workspace_id);
create index usage_counters_user_id_idx on private.usage_counters (user_id);
create index attachments_owner_id_idx on public.attachments (owner_id);
create index audit_events_actor_id_idx on public.audit_events (actor_id);
create index audit_events_workspace_id_idx on public.audit_events (workspace_id);
create index draft_approvals_approved_by_idx on public.draft_approvals (approved_by);
create index draft_approvals_revision_id_idx on public.draft_approvals (revision_id);
create index draft_revisions_created_by_idx on public.draft_revisions (created_by);
create index draft_revisions_job_workspace_owner_idx on public.draft_revisions (job_id, workspace_id, owner_id);
create index generation_jobs_rerun_of_job_id_idx on public.generation_jobs (rerun_of_job_id);
create index job_attachments_attachment_workspace_owner_idx on public.job_attachments (attachment_id, workspace_id, owner_id);
create index job_attachments_job_workspace_owner_idx on public.job_attachments (job_id, workspace_id, owner_id);
create index workspace_members_invited_by_idx on public.workspace_members (invited_by);
