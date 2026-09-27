-- Integration test: all synthetic fixtures and pruning are rolled back.
begin;
do $$
declare team_a uuid:=gen_random_uuid(); team_b uuid:=gen_random_uuid();
  member_id uuid; job_id uuid; first_id uuid; last_id uuid; pending_id uuid;
  i integer; target_team uuid; target_section text;
begin
  select user_id into strict member_id from public.workspace_members where status='active' limit 1;
  insert into public.workspaces(id,name) values(team_a,'History test A'),(team_b,'History test B');
  insert into public.workspace_members(workspace_id,user_id,status) values(team_a,member_id,'active'),(team_b,member_id,'active');
  for i in 1..15 loop
    target_team:=case when i=14 then team_b else team_a end;
    target_section:=case when i=13 then 'environment_description' else 'plot_description' end;
    insert into public.generation_jobs(workspace_id,owner_id,section_id,address,provider_id,model_id,credential_version,
      prompt_hash,consent_version,consented_at,idempotency_key,request_hash,status,started_at,created_at,plot_evidence)
    values(target_team,member_id,target_section,'Retention test','groq','test-model',1,repeat('a',64),'test',now(),
      gen_random_uuid(),repeat('b',64),'running',now(),now()+make_interval(secs=>i),
      case when target_section='plot_description' then '{"rawGovMapResponses":[{"response":{"geom":"original polygon"}}]}'::jsonb else null end)
    returning id into job_id;
    if i=1 then first_id:=job_id; end if;
    if i=15 then
      pending_id:=job_id;
    else
      perform public.poc_finish_job(job_id,member_id,'Test AI report '||i);
      last_id:=job_id;
    end if;
  end loop;
  if (select count(*) from public.generation_jobs where workspace_id=team_a and section_id='plot_description' and deleted_at is null and completed_at is not null)<>10 then raise exception 'Retention count failed'; end if;
  if exists(select 1 from public.generation_jobs where id=first_id and (deleted_at is null or output_text is not null or plot_evidence is not null)) then raise exception 'Expired payload retained'; end if;
  if exists(select 1 from public.draft_revisions r where r.job_id=first_id and r.text<>'') then raise exception 'Duplicate revision retained'; end if;
  if not exists(select 1 from public.generation_jobs where id=pending_id and deleted_at is null and plot_evidence is not null and status='running') then raise exception 'Pending job pruned'; end if;
  if (select count(*) from public.generation_jobs where workspace_id=team_a and section_id='environment_description' and deleted_at is null)<>1 then raise exception 'Other section changed'; end if;
  if (select count(*) from public.generation_jobs where workspace_id=team_b and deleted_at is null)<>1 then raise exception 'Other team changed'; end if;
  if not exists(select 1 from public.generation_jobs where id=last_id and output_text='Test AI report 14' and plot_evidence->'rawGovMapResponses'->0->'response'->>'geom'='original polygon') then raise exception 'Snapshot/report pairing failed'; end if;
  perform public.poc_fail_job(last_id,member_id,true);
  if (select status from public.generation_jobs where id=last_id)<>'succeeded' then raise exception 'Success overwritten'; end if;
  perform public.poc_fail_job(pending_id,member_id,false);
  if (select count(*) from public.generation_jobs where workspace_id=team_a and section_id='plot_description' and deleted_at is null)<>10 then raise exception 'Failure retention failed'; end if;
  if has_function_privilege('authenticated','public.poc_fail_job(uuid,uuid,boolean)','EXECUTE') then raise exception 'Failure mutation publicly executable'; end if;
  if not has_function_privilege('service_role','private.prune_section_history(uuid,text)','EXECUTE') then raise exception 'Pruning unavailable to backend'; end if;
end $$;
rollback;
