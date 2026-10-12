begin;
do $$
declare owner_id uuid:=gen_random_uuid();team uuid:=gen_random_uuid();host uuid:=gen_random_uuid();conn uuid;job uuid;oldest uuid;b jsonb;section text; i integer;
begin
 insert into auth.users(id) values(owner_id);
 insert into public.workspaces(id,name) values(team,'Section rollout synthetic');
 insert into public.workspace_members(workspace_id,user_id,status) values(team,owner_id,'active');
 insert into private.cli_hosts(id,enabled,token_hash,status,last_seen_at,manifests) values(host,true,repeat('e',64),'ready',clock_timestamp(),jsonb_build_array(repeat('d',64)));
 update private.cli_providers set enabled=true,manifest_digest=repeat('d',64) where provider_id='gemini';
 conn:=(public.cli_user_action(owner_id,'requestCliConnection','{"provider":"gemini"}')->'connection'->>'id')::uuid;
 perform public.cli_worker_action(host,'reportConnection',jsonb_build_object('connectionId',conn,'revision',1,'status','connected'));
 insert into public.agent_prompts(user_id,section_id,content,version) values(owner_id,'plot_description','Personal plot instructions',3);
 foreach section in array array['environment_description','plot_description','comparable_sales'] loop
  b:=jsonb_build_object('sectionId',section,'requestId',gen_random_uuid(),'connectionId',conn,'workspaceId',team,'address','Synthetic address','example','','additionalRequest','',
   'requestHash',repeat('a',64),'instructions','Frozen instructions','inputText','Frozen evidence','promptVersion',case when section='plot_description' then 3 else 0 end,'payloadDigest',repeat('b',64));
  if section='plot_description' then b:=b||jsonb_build_object('plotEvidence',jsonb_build_object('address','Synthetic address','gush','1','parcel','2'));end if;
  if section='comparable_sales' then b:=b||jsonb_build_object('cliContext',jsonb_build_object('kind','nadlan','source','synthetic'));end if;
  job:=(public.cli_user_action(owner_id,'createCliJob',b)->'job'->>'id')::uuid;
  if (select section_id from public.generation_jobs where id=job)<>section or private.cli_job_view(job)->>'sectionId'<>section then raise exception 'Wrong CLI section';end if;
  if (public.cli_user_action(owner_id,'createCliJob',b)->'job'->>'id')::uuid<>job then raise exception 'Section retry duplicated job';end if;
  if section='plot_description' and (select plot_evidence is null from public.generation_jobs where id=job) then raise exception 'Plot evidence missing';end if;
  if section='comparable_sales' and (select cli_context is null from public.generation_jobs where id=job) then raise exception 'Source snapshot missing';end if;
  perform public.cli_user_action(owner_id,'cancelCliJob',jsonb_build_object('jobId',job));
 end loop;
 b:=b||jsonb_build_object('sectionId','plot_description','requestId',gen_random_uuid(),'promptVersion',3);
 begin perform public.cli_user_action(owner_id,'createCliJob',b);raise exception 'Expected missing plot evidence';exception when others then if sqlerrm<>'INVALID_INPUT' then raise;end if;end;
 b:=b||jsonb_build_object('sectionId','comparable_sales');
 for i in 1..11 loop
  b:=b||jsonb_build_object('requestId',gen_random_uuid(),'promptVersion',0);
  job:=(public.cli_user_action(owner_id,'createCliJob',b)->'job'->>'id')::uuid;
  update public.generation_jobs set created_at=clock_timestamp()+make_interval(secs=>i) where id=job;
  if i=1 then oldest:=job;end if;
  perform public.cli_user_action(owner_id,'cancelCliJob',jsonb_build_object('jobId',job));
 end loop;
 if exists(select 1 from public.generation_jobs where id=oldest and (deleted_at is null or cli_context is not null)) then raise exception 'Retention leaked source snapshot';end if;
end $$;
rollback;
