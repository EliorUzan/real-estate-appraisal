alter table public.generation_jobs add column plot_evidence jsonb
  check (plot_evidence is null or (section_id = 'plot_description'
    and jsonb_typeof(plot_evidence) = 'object' and octet_length(plot_evidence::text) <= 6000000));

create index generation_jobs_section_history_idx
  on public.generation_jobs(workspace_id, section_id, created_at desc, id desc)
  where deleted_at is null;

-- Keep only ten completed history payloads per team/section. Pending requests
-- must not be pruned while an upstream provider could still be processing them.
-- Small job receipts survive to keep idempotency and FK/audit references intact.
create function private.prune_section_history(p_workspace uuid, p_section text)
returns void language plpgsql security invoker set search_path='' as $$
declare expired uuid[];
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text || ':' || p_section, 0));
  select array_agg(id) into expired from (
    select id from public.generation_jobs
    where workspace_id=p_workspace and section_id=p_section
      and deleted_at is null and completed_at is not null
    order by created_at desc, id desc offset 10
  ) old;
  if expired is null then return; end if;
  update public.draft_revisions set text='' where job_id=any(expired);
  update public.generation_jobs set deleted_at=clock_timestamp(), output_text=null,
    plot_evidence=null, example_text='', additional_request='', address='[expired]',
    warnings='[]'::jsonb, usage='{}'::jsonb
  where id=any(expired);
end $$;
revoke all on function private.prune_section_history(uuid,text) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.prune_section_history(uuid,text) to service_role;

create or replace function public.poc_finish_job(p_job uuid,p_user uuid,p_text text)
returns void language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs;
begin
  select * into strict j from public.generation_jobs where id=p_job and owner_id=p_user;
  -- Always serialize the group before locking an individual job, including failures.
  perform pg_advisory_xact_lock(hashtextextended(j.workspace_id::text || ':' || j.section_id, 0));
  select * into strict j from public.generation_jobs where id=p_job and owner_id=p_user for update;
  if j.status <> 'running' or not exists(select 1 from public.workspace_members
    where user_id=p_user and workspace_id=j.workspace_id and status='active') then raise exception 'invalid state'; end if;
  update public.generation_jobs set status='succeeded',stage='saving',output_text=p_text,completed_at=clock_timestamp() where id=p_job;
  insert into public.draft_revisions(job_id,workspace_id,owner_id,revision_number,text,text_sha256,created_by)
    values(j.id,j.workspace_id,j.owner_id,1,p_text,encode(extensions.digest(p_text,'sha256'),'hex'),p_user);
  perform private.prune_section_history(j.workspace_id,j.section_id);
end $$;

create function public.poc_fail_job(p_job uuid,p_user uuid,p_uncertain boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs;
begin
  select * into strict j from public.generation_jobs where id=p_job and owner_id=p_user;
  perform pg_advisory_xact_lock(hashtextextended(j.workspace_id::text || ':' || j.section_id, 0));
  select * into strict j from public.generation_jobs where id=p_job and owner_id=p_user for update;
  -- A failed response after successful persistence must never overwrite success.
  if j.status <> 'running' then return; end if;
  update public.generation_jobs set status=case when p_uncertain then 'needs_review'::public.job_status else 'failed'::public.job_status end,
    completed_at=clock_timestamp(),error_code=case when p_uncertain then 'PROVIDER_OUTCOME_UNCERTAIN' else 'PROVIDER_ERROR' end
    where id=p_job;
  perform private.prune_section_history(j.workspace_id,j.section_id);
end $$;
revoke all on function public.poc_finish_job(uuid,uuid,text),public.poc_fail_job(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.poc_finish_job(uuid,uuid,text),public.poc_fail_job(uuid,uuid,boolean) to service_role;

-- Apply the user's retention policy to existing history as well.
do $$ declare g record; begin
  for g in select distinct workspace_id,section_id from public.generation_jobs where deleted_at is null loop
    perform private.prune_section_history(g.workspace_id,g.section_id);
  end loop;
end $$;
