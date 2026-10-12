-- Recovery reads never claim a fresh job. Keep synchronous API finalizers scoped to API.
create or replace function public.cli_worker_action(p_host uuid,p_action text,p_body jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h private.cli_hosts; c private.cli_connections; s private.cli_job_state; j public.generation_jobs;
  p private.cli_job_payloads; v_reason text; v_digest text; v_result jsonb; v_status public.job_status; v_token uuid;
begin
 perform pg_advisory_xact_lock(732184621094::bigint);
 select * into h from private.cli_hosts where id=p_host and enabled for update;
 if h.id is null then raise exception 'UNAUTHENTICATED'; end if;
 if p_action='quarantineHost' then
   update private.cli_hosts set status='quarantined' where id=h.id;
   return jsonb_build_object('acknowledged',true);
 end if;
 if p_action='heartbeatHost' then
   update private.cli_hosts set last_seen_at=clock_timestamp(),manifests=p_body->'manifests' where id=h.id;
   return jsonb_build_object('drain',h.status<>'ready');
 end if;
 if p_action='getMaintenance' then
   return jsonb_build_object('connections',coalesce((select jsonb_agg(jsonb_build_object('id',id,'provider',provider_id,'status',status,'revision',revision,'runtimeRef',runtime_ref))
     from private.cli_connections where host_id=h.id and status in('pending_setup','disconnecting')),'[]'::jsonb));
 end if;
 if p_action='reportConnection' then
   select * into c from private.cli_connections where id=(p_body->>'connectionId')::uuid and host_id=h.id for update;
   if c.id is null then raise exception 'NOT_FOUND'; end if;
   if c.revision<>(p_body->>'revision')::integer then raise exception 'CONNECTION_CHANGED'; end if;
   if exists(select 1 from private.cli_job_state x join public.generation_jobs g on g.id=x.job_id
     where x.connection_id=c.id and (g.completed_at is null or x.phase='uncertain')) then raise exception 'CONNECTION_CHANGED'; end if;
   if (p_body->>'status'='connected' and c.status not in('pending_setup','reauth_required'))
     or (p_body->>'status'='disconnected' and c.status<>'disconnecting') then raise exception 'CONNECTION_CHANGED'; end if;
   update private.cli_connections set status=p_body->>'status',last_verified_at=case when p_body->>'status'='connected' then clock_timestamp() else last_verified_at end,updated_at=now() where id=c.id;
   return jsonb_build_object('ok',true);
 end if;
 if p_action in('claim','getAssignment') then
   if h.active_job_id is not null then
     select * into s from private.cli_job_state where job_id=h.active_job_id;
     return jsonb_build_object('job',jsonb_build_object('jobId',s.job_id,'attemptNumber',s.attempt_number,'leaseToken',s.lease_token,'phase',s.phase,'recoveryRequired',true,'containerRef',s.container_ref));
   end if;
   if p_action='getAssignment' then return jsonb_build_object('job',null); end if;
   if h.status<>'ready' or h.last_seen_at<=clock_timestamp()-interval '30 seconds' then return jsonb_build_object('job',null); end if;
   for j in select g.* from public.generation_jobs g join private.cli_job_state x on x.job_id=g.id
     where x.host_id=h.id and g.status='queued' order by g.created_at,g.id loop
     select * into s from private.cli_job_state where job_id=j.id;
     select * into c from private.cli_connections where id=s.connection_id for update;
     select * into p from private.cli_job_payloads where job_id=j.id;
     v_reason:=null;
     if s.queue_deadline_at<=clock_timestamp() then v_reason:='QUEUE_EXPIRED';
     elsif not private.cli_access(j.owner_id,j.workspace_id) then v_reason:='ACCESS_REVOKED';
     elsif c.status<>'connected' or c.revision<>s.connection_revision then v_reason:='CONNECTION_CHANGED';
     elsif not exists(select 1 from private.cli_providers where provider_id=c.provider_id and enabled and manifest_digest=p.adapter_manifest_digest)
       or not h.manifests ? p.adapter_manifest_digest then v_reason:='WORKER_UNAVAILABLE'; end if;
     if v_reason is not null then perform private.cli_settle(j.id,'expired',v_reason,null,null,null); continue; end if;
     perform pg_advisory_xact_lock(hashtextextended(j.workspace_id::text||':'||j.section_id,0));
     perform 1 from public.generation_jobs where id=j.id and status='queued' for update skip locked;
     if not found then continue; end if;
     v_token:=gen_random_uuid();
     update private.cli_job_state set attempt_number=1,lease_token=v_token,lease_expires_at=clock_timestamp()+interval '60 seconds',phase='claimed' where job_id=j.id;
     update public.generation_jobs set status='running',started_at=clock_timestamp(),attempt=1 where id=j.id;
     update private.cli_hosts set active_job_id=j.id where id=h.id;
     return jsonb_build_object('job',jsonb_build_object('jobId',j.id,'attemptNumber',1,'leaseToken',v_token,'phase','claimed',
       'provider',c.provider_id,'runtimeRef',c.runtime_ref,'instructions',p.instructions,'inputText',p.input_text,'manifestDigest',p.adapter_manifest_digest));
   end loop;
   return jsonb_build_object('job',null);
 end if;
 select * into s from private.cli_job_state where job_id=(p_body->>'jobId')::uuid and host_id=h.id;
 if s.job_id is null or s.attempt_number<>(p_body->>'attemptNumber')::integer then raise exception 'NOT_FOUND'; end if;
 v_token:=(p_body->>'leaseToken')::uuid;
 v_result:=p_body->'result';
 v_digest:=p_body->>'resultDigest';
 if p_action='complete' and s.receipt_status is not null then
   if s.receipt_token_hash is distinct from encode(extensions.digest(v_token::text,'sha256'),'hex') or s.completion_digest is distinct from v_digest then raise exception 'REQUEST_ID_CONFLICT'; end if;
   return jsonb_build_object('acknowledged',true,'status',s.receipt_status);
 end if;
 if p_action='reconcile' then
   -- Stop proof is a supervisor observation; no replacement attempt is authorized.
   if p_body->>'stopped'<>'true' then
     update private.cli_hosts set status='quarantined' where id=h.id;
     return jsonb_build_object('acknowledged',false);
   end if;
   select * into j from public.generation_jobs where id=s.job_id;
   if j.completed_at is null then perform private.cli_settle(j.id,'needs_review','OUTCOME_UNCERTAIN',null,null,v_token); end if;
   update private.cli_job_state set phase='settled',lease_token=null,lease_expires_at=null where job_id=s.job_id;
   update private.cli_hosts set active_job_id=null,status='draining' where id=h.id;
   return jsonb_build_object('acknowledged',true);
 end if;
 if h.active_job_id is distinct from s.job_id or s.lease_token is distinct from v_token then raise exception 'CONNECTION_CHANGED'; end if;
 select * into c from private.cli_connections where id=s.connection_id for update;
 select * into j from public.generation_jobs where id=s.job_id;
 v_reason:=null;
 if s.lease_expires_at<=clock_timestamp() then v_reason:='OUTCOME_UNCERTAIN';
 elsif j.status='cancel_requested' then v_reason:=coalesce(s.cancel_reason,'CANCELLED');
 elsif not private.cli_access(j.owner_id,j.workspace_id) then v_reason:='ACCESS_REVOKED';
 elsif c.status<>'connected' or c.revision<>s.connection_revision then v_reason:='CONNECTION_CHANGED';
 elsif s.run_deadline_at<=clock_timestamp() then v_reason:='TIMEOUT';
 elsif h.status<>'ready' then v_reason:='OUTCOME_UNCERTAIN'; end if;
 if p_action='authorizeStart' then
   if p_body->>'containerRef'<>'cli-job-'||j.id::text||'-1' then raise exception 'UNSUPPORTED_CAPABILITY'; end if;
   if v_reason is not null or s.phase<>'claimed' then return jsonb_build_object('authorized',false,'reason',coalesce(v_reason,'OUTCOME_UNCERTAIN')); end if;
   update private.cli_job_state set phase='launch_authorized',container_ref=p_body->>'containerRef',launch_authorized_at=clock_timestamp(),run_deadline_at=clock_timestamp()+interval '300 seconds',lease_expires_at=clock_timestamp()+interval '60 seconds' where job_id=j.id;
   return jsonb_build_object('authorized',true);
 end if;
 if p_action='heartbeatJob' then
   if v_reason is null then
     update private.cli_job_state set lease_expires_at=clock_timestamp()+interval '60 seconds',phase=case when phase='launch_authorized' then 'running' else phase end where job_id=j.id;
     update private.cli_hosts set last_seen_at=clock_timestamp() where id=h.id;
   end if;
   return jsonb_build_object('stop',v_reason is not null,'reason',v_reason);
 end if;
 if p_action<>'complete' or p_body->>'stopped'<>'true' then raise exception 'UNSUPPORTED_CAPABILITY'; end if;
 if s.container_ref is not null and s.container_ref<>p_body->>'containerRef' then raise exception 'CONNECTION_CHANGED'; end if;
 if v_reason='OUTCOME_UNCERTAIN' then v_status:='needs_review';
 elsif v_reason in('CANCELLED','CONNECTION_CHANGED') then v_status:='cancelled';
 elsif v_reason is not null then v_status:='failed';
 elsif v_result->>'errorCode' is not null then v_reason:=v_result->>'errorCode';v_status:=case when v_reason='OUTCOME_UNCERTAIN' then 'needs_review'::public.job_status when v_reason='CANCELLED' then 'cancelled'::public.job_status else 'failed'::public.job_status end;
 else
   if s.phase not in('launch_authorized','running') or length(btrim(v_result->>'text'))=0 or v_result->>'text' is null or octet_length(v_result->>'text')>262144 then raise exception 'INVALID_OUTPUT'; end if;
   v_status:='succeeded';
 end if;
 perform private.cli_settle(j.id,v_status,v_reason,v_result,v_digest,v_token);
 update private.cli_hosts set active_job_id=null,last_seen_at=clock_timestamp(),status=case when v_status='needs_review' then 'quarantined' else status end where id=h.id;
 return jsonb_build_object('acknowledged',true,'status',v_status);
end $$;

create or replace function public.poc_finish_job(p_job uuid,p_user uuid,p_text text)
returns void language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs;
begin
  select * into strict j from public.generation_jobs where id=p_job and owner_id=p_user;
  -- Always serialize the group before locking an individual job, including failures.
  perform pg_advisory_xact_lock(hashtextextended(j.workspace_id::text || ':' || j.section_id, 0));
  select * into strict j from public.generation_jobs where id=p_job and owner_id=p_user for update;
  if j.execution_mode <> 'api' or j.status <> 'running' or not exists(select 1 from public.workspace_members
    where user_id=p_user and workspace_id=j.workspace_id and status='active') then raise exception 'invalid state'; end if;
  update public.generation_jobs set status='succeeded',stage='saving',output_text=p_text,completed_at=clock_timestamp() where id=p_job;
  insert into public.draft_revisions(job_id,workspace_id,owner_id,revision_number,text,text_sha256,created_by)
    values(j.id,j.workspace_id,j.owner_id,1,p_text,encode(extensions.digest(p_text,'sha256'),'hex'),p_user);
  perform private.prune_section_history(j.workspace_id,j.section_id);
end $$;

create or replace function public.poc_fail_job(p_job uuid,p_user uuid,p_uncertain boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs;
begin
  select * into strict j from public.generation_jobs where id=p_job and owner_id=p_user;
  perform pg_advisory_xact_lock(hashtextextended(j.workspace_id::text || ':' || j.section_id, 0));
  select * into strict j from public.generation_jobs where id=p_job and owner_id=p_user for update;
  -- A failed response after successful persistence must never overwrite success.
  if j.execution_mode <> 'api' or j.status <> 'running' then return; end if;
  update public.generation_jobs set status=case when p_uncertain then 'needs_review'::public.job_status else 'failed'::public.job_status end,
    completed_at=clock_timestamp(),error_code=case when p_uncertain then 'PROVIDER_OUTCOME_UNCERTAIN' else 'PROVIDER_ERROR' end
    where id=p_job;
  perform private.prune_section_history(j.workspace_id,j.section_id);
end $$;
revoke all on function public.poc_finish_job(uuid,uuid,text),public.poc_fail_job(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.poc_finish_job(uuid,uuid,text),public.poc_fail_job(uuid,uuid,boolean) to service_role;
