-- A suspended workspace must stop exposing data even while its membership
-- records remain active. Keep the existing ownership and deleted-job rules.
set lock_timeout = '5s';
set statement_timeout = '30s';

alter policy workspaces_active_member_read on public.workspaces
using (status='active' and exists (
  select 1 from public.workspace_members m where m.workspace_id=workspaces.id
    and m.user_id=(select auth.uid()) and m.status='active'
));

alter policy attachments_owner_read on public.attachments
using (owner_id=(select auth.uid()) and exists (
  select 1 from public.workspace_members m join public.workspaces w on w.id=m.workspace_id
  where m.workspace_id=attachments.workspace_id and m.user_id=(select auth.uid())
    and m.status='active' and w.status='active'
));

alter policy jobs_team_read on public.generation_jobs
using (deleted_at is null and exists (
  select 1 from public.workspace_members m join public.workspaces w on w.id=m.workspace_id
  where m.workspace_id=generation_jobs.workspace_id and m.user_id=(select auth.uid())
    and m.status='active' and w.status='active'
));

alter policy job_attachments_team_read on public.job_attachments
using (exists (
  select 1 from public.generation_jobs j join public.workspace_members m on m.workspace_id=j.workspace_id
  join public.workspaces w on w.id=j.workspace_id
  where j.id=job_attachments.job_id and j.deleted_at is null
    and m.user_id=(select auth.uid()) and m.status='active' and w.status='active'
));

alter policy draft_revisions_team_read on public.draft_revisions
using (exists (
  select 1 from public.generation_jobs j join public.workspace_members m on m.workspace_id=j.workspace_id
  join public.workspaces w on w.id=j.workspace_id
  where j.id=draft_revisions.job_id and j.deleted_at is null
    and m.user_id=(select auth.uid()) and m.status='active' and w.status='active'
));

alter policy draft_approvals_team_read on public.draft_approvals
using (exists (
  select 1 from public.generation_jobs j join public.workspace_members m on m.workspace_id=j.workspace_id
  join public.workspaces w on w.id=j.workspace_id
  where j.id=draft_approvals.job_id and j.deleted_at is null
    and m.user_id=(select auth.uid()) and m.status='active' and w.status='active'
));
