create or replace function public.poc_finish_job(p_job uuid,p_user uuid,p_text text)
returns void language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs;
begin
 select * into strict j from public.generation_jobs where id=p_job and owner_id=p_user for update;
 if j.status <> 'running' or not exists(select 1 from public.workspace_members where user_id=p_user and workspace_id=j.workspace_id and status='active') then raise exception 'invalid state'; end if;
 update public.generation_jobs set status='succeeded',stage='saving',output_text=p_text,completed_at=now() where id=p_job;
 insert into public.draft_revisions(job_id,workspace_id,owner_id,revision_number,text,text_sha256,created_by)
 values(j.id,j.workspace_id,j.owner_id,1,p_text,encode(extensions.digest(p_text,'sha256'),'hex'),p_user);
end $$;

