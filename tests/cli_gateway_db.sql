-- Synthetic users, teams, hosts and all gate changes are rolled back.
begin;
do $$
declare owner_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); team uuid:=gen_random_uuid(); host uuid:=gen_random_uuid();
 conn uuid; request uuid; job uuid; first_job uuid; claimed jsonb; b jsonb; result jsonb; receipt jsonb; i integer;
begin
 insert into auth.users(id) values(owner_id),(other_id);
 insert into public.workspaces(id,name) values(team,'CLI synthetic test');
 insert into public.workspace_members(workspace_id,user_id,status) values(team,owner_id,'active'),(team,other_id,'active');
 insert into private.cli_hosts(id,enabled,token_hash,status,last_seen_at,manifests) values(host,true,repeat('e',64),'ready',now(),jsonb_build_array(repeat('d',64)));
 update private.cli_providers set enabled=true,manifest_digest=repeat('d',64) where provider_id='gemini';
 conn:=(public.cli_user_action(owner_id,'requestCliConnection','{"provider":"gemini"}')->'connection'->>'id')::uuid;
 perform public.cli_worker_action(host,'reportConnection',jsonb_build_object('connectionId',conn,'revision',1,'status','connected'));
 if not public.cli_authenticate_host(host,repeat('e',64)) or public.cli_authenticate_host(host,repeat('f',64)) then raise exception 'Host credential scope failed'; end if;
 for i in 1..12 loop
   if i=12 then
     update private.cli_providers set enabled=true,manifest_digest=repeat('d',64) where provider_id='claude';
     update private.cli_connections set provider_id='claude' where id=conn;
   end if;
   request:=gen_random_uuid();
   b:=jsonb_build_object('requestId',request,'connectionId',conn,'workspaceId',team,'address','Synthetic property','example','Style only','additionalRequest','',
     'requestHash',repeat('a',64),'instructions','Synthetic instructions','inputText','Synthetic input','promptVersion',0,'payloadDigest',repeat('b',64));
   job:=(public.cli_user_action(owner_id,'createCliJob',b)->'job'->>'id')::uuid;
   update public.generation_jobs set created_at=now()+make_interval(secs=>i) where id=job;
   if i=1 then first_job:=job; end if;
   if (public.cli_user_action(owner_id,'createCliJob',b)->'job'->>'id')::uuid<>job then raise exception 'Duplicate submit'; end if;
   begin perform public.cli_user_action(owner_id,'createCliJob',b||'{"requestHash":"conflict"}');raise exception 'Expected intent conflict';exception when others then if sqlerrm<>'REQUEST_ID_CONFLICT' then raise; end if;end;
   begin perform public.cli_user_action(other_id,'getCliJob',jsonb_build_object('jobId',job));raise exception 'Expected owner scope';exception when others then if sqlerrm<>'NOT_FOUND' then raise; end if;end;
   if public.cli_worker_action(host,'getAssignment','{}')->'job'<>'null'::jsonb then raise exception 'Recovery claimed new work'; end if;
   claimed:=public.cli_worker_action(host,'claim','{}')->'job';
   if (claimed->>'jobId')::uuid<>job then raise exception 'Claim failed'; end if;
   if (public.cli_worker_action(host,'claim','{}')->'job'->>'jobId')::uuid<>job then raise exception 'Claim response retry lost assignment'; end if;
   claimed:=jsonb_build_object('jobId',job,'attemptNumber',1,'leaseToken',claimed->>'leaseToken','containerRef','cli-job-'||job::text||'-1');
   if public.cli_worker_action(host,'authorizeStart',claimed)->>'authorized'<>'true' then raise exception 'Start denied'; end if;
   if public.cli_worker_action(host,'authorizeStart',claimed)->>'authorized'<>'false' then raise exception 'Second start authorized'; end if;
   if abs(extract(epoch from (select run_deadline_at-launch_authorized_at from private.cli_job_state where job_id=job))-(case when i=12 then 300 else 600 end))>0.01 then raise exception 'Provider runtime deadline incorrect';end if;
   perform public.cli_worker_action(host,'heartbeatJob',claimed);
   if abs(extract(epoch from (select run_deadline_at-launch_authorized_at from private.cli_job_state where job_id=job))-(case when i=12 then 300 else 600 end))>0.01 then raise exception 'Heartbeat renewed deadline';end if;
   result:=jsonb_build_object('text','Synthetic answer '||i,'model',null,'inputTokens',null,'outputTokens',null,'errorCode',null);
   b:=claimed||jsonb_build_object('stopped',true,'result',result,'resultDigest',repeat('c',64));
   if i=2 then perform public.cli_user_action(owner_id,'cancelCliJob',jsonb_build_object('jobId',job)); end if;
   receipt:=public.cli_worker_action(host,'complete',b);
   if public.cli_worker_action(host,'complete',b)<>receipt then raise exception 'Completion acknowledgement not idempotent'; end if;
   if i=2 then
     if exists(select 1 from public.draft_revisions where job_id=job) or (select status from public.generation_jobs where id=job)<>'cancelled' then raise exception 'Cancelled output published'; end if;
   else
     if (select count(*) from public.draft_revisions where job_id=job)<>1 then raise exception 'Revision count failed'; end if;
     perform public.cli_user_action(owner_id,'cancelCliJob',jsonb_build_object('jobId',job));
     if (select status from public.generation_jobs where id=job)<>'succeeded' then raise exception 'Committed success overwritten'; end if;
   end if;
   if exists(select 1 from private.cli_job_payloads where job_id=job) then raise exception 'Prompt snapshot retained after acknowledgement'; end if;
   if exists(select 1 from private.cli_hosts where id=host and active_job_id is not null) then raise exception 'Stopped slot not released'; end if;
 end loop;
 update private.cli_connections set provider_id='gemini' where id=conn;
 if (select count(*) from public.generation_jobs where workspace_id=team and deleted_at is null)<>10 then raise exception 'Retention count failed'; end if;
 if exists(select 1 from public.generation_jobs where id=first_job and (deleted_at is null or output_text is not null)) then raise exception 'Old output retained'; end if;
 -- Late success after lease expiry is discarded, and remains a repeatable receipt.
 request:=gen_random_uuid();b:=jsonb_build_object('requestId',request,'connectionId',conn,'workspaceId',team,'address','Synthetic property','example','style','additionalRequest','',
   'requestHash',repeat('a',64),'instructions','x','inputText','y','promptVersion',0,'payloadDigest',repeat('b',64));
 job:=(public.cli_user_action(owner_id,'createCliJob',b)->'job'->>'id')::uuid;
 claimed:=public.cli_worker_action(host,'claim','{}')->'job';
 claimed:=jsonb_build_object('jobId',job,'attemptNumber',1,'leaseToken',claimed->>'leaseToken','containerRef','cli-job-'||job::text||'-1');
 perform public.cli_worker_action(host,'authorizeStart',claimed);
 update private.cli_job_state set lease_expires_at=now()-interval '1 second' where job_id=job;
 perform public.cli_maintenance();
 if (select active_job_id from private.cli_hosts where id=host) is distinct from job then raise exception 'Uncertain slot released early'; end if;
 b:=claimed||jsonb_build_object('stopped',true,'result',result,'resultDigest',repeat('c',64));
 receipt:=public.cli_worker_action(host,'complete',b);
 if public.cli_worker_action(host,'complete',b)<>receipt or (select output_text from public.generation_jobs where id=job) is not null then raise exception 'Late completion replayed'; end if;
 if has_function_privilege('authenticated','public.cli_user_action(uuid,text,jsonb)','EXECUTE')
   or has_function_privilege('anon','public.cli_worker_action(uuid,text,jsonb)','EXECUTE')
   or has_table_privilege('authenticated','private.cli_job_state','SELECT') then raise exception 'Privileged data exposed'; end if;
 if not has_function_privilege('service_role','public.cli_user_action(uuid,text,jsonb)','EXECUTE') then raise exception 'Backend cannot execute'; end if;
end $$;
rollback;
