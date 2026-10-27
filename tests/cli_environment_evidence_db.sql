-- Synthetic, rolled-back coverage of the actual job-admission RPC and retention.
begin;
do $$
declare
 owner_id uuid:=gen_random_uuid(); team uuid:=gen_random_uuid(); host uuid:=gen_random_uuid();
 conn uuid; job uuid; oldest uuid; b jsonb; evidence jsonb; invalid jsonb; i integer;
begin
 insert into auth.users(id) values(owner_id);
 insert into public.workspaces(id,name) values(team,'Environment evidence regression');
 insert into public.workspace_members(workspace_id,user_id,status) values(team,owner_id,'active');
 insert into private.cli_hosts(id,enabled,token_hash,status,last_seen_at,manifests)
 values(host,true,repeat('e',64),'ready',clock_timestamp(),jsonb_build_array(repeat('d',64)));
 update private.cli_providers set enabled=true,manifest_digest=repeat('d',64) where provider_id='claude';
 conn:=(public.cli_user_action(owner_id,'requestCliConnection','{"provider":"claude"}')->'connection'->>'id')::uuid;
 perform public.cli_worker_action(host,'reportConnection',jsonb_build_object('connectionId',conn,'revision',1,'status','connected'));
 evidence:=jsonb_build_object('kind','govmap_environment','collectionMethod','domain_browser_sdk',
   'address','Synthetic address','source','GovMap PARCEL_ALL','gush','1','parcel','2','retrievedAt',clock_timestamp());
 b:=jsonb_build_object('sectionId','environment_description','requestId',gen_random_uuid(),'connectionId',conn,
   'workspaceId',team,'address','Synthetic address','example','','additionalRequest','',
   'modelSelection','claude-haiku-5-5','requestHash',repeat('a',64),'instructions','Saved environment instructions',
   'inputText','Frozen GovMap evidence: '||evidence::text,'promptVersion',0,'payloadDigest',repeat('b',64),'plotEvidence',evidence);
 job:=(public.cli_user_action(owner_id,'createCliJob',b)->'job'->>'id')::uuid;
 oldest:=job;
 if (select plot_evidence from public.generation_jobs where id=job) is distinct from evidence then
   raise exception 'Environment evidence was not retained';
 end if;
 if (select input_text from private.cli_job_payloads where job_id=job) is distinct from b->>'inputText' then
   raise exception 'Frozen environment input changed';
 end if;
 if (public.cli_user_action(owner_id,'createCliJob',b)->'job'->>'id')::uuid<>job then
   raise exception 'Environment retry duplicated the job';
 end if;
 -- Missing discriminator fields must fail, including SQL NULL comparisons.
 foreach invalid in array array['[]'::jsonb,'null'::jsonb,'{}'::jsonb,evidence-'kind',
   evidence-'collectionMethod',evidence||'{"kind":"other"}',evidence||'{"collectionMethod":"other"}',
   evidence||jsonb_build_object('oversize',repeat('x',6000001))] loop
   begin
     update public.generation_jobs set plot_evidence=invalid where id=job;
     raise exception 'Invalid environment evidence accepted';
   exception when check_violation then null;
   end;
 end loop;
 begin
   update public.generation_jobs set section_id='comparable_sales' where id=job;
   raise exception 'Environment evidence accepted for comparables';
 exception when check_violation then null;
 end;
 begin
   insert into public.generation_jobs(workspace_id,owner_id,section_id,address,provider_id,model_id,
     credential_version,prompt_hash,consent_version,consented_at,idempotency_key,request_hash,execution_mode,plot_evidence)
   values(team,owner_id,'environment_description','Synthetic address','anthropic','synthetic-model',
     1,repeat('b',64),'test',clock_timestamp(),gen_random_uuid(),repeat('a',64),'api',evidence);
   raise exception 'Environment evidence accepted for API mode';
 exception when check_violation then null;
 end;
 perform public.cli_user_action(owner_id,'cancelCliJob',jsonb_build_object('jobId',job));
 -- A request without optional observations still works; pruning scrubs evidence.
 for i in 1..10 loop
   b:=(b-'plotEvidence')||jsonb_build_object('requestId',gen_random_uuid());
   job:=(public.cli_user_action(owner_id,'createCliJob',b)->'job'->>'id')::uuid;
   update public.generation_jobs set created_at=clock_timestamp()+make_interval(secs=>i) where id=job;
   perform public.cli_user_action(owner_id,'cancelCliJob',jsonb_build_object('jobId',job));
 end loop;
 if exists(select 1 from public.generation_jobs where id=oldest and (deleted_at is null or plot_evidence is not null)) then
   raise exception 'Retention leaked environment evidence';
 end if;
end $$;
rollback;
