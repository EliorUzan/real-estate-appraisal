-- Reviewed patch: register as a Supabase migration before release.
-- Old environment requests without sectionId remain compatible.
alter table public.generation_jobs drop constraint generation_jobs_section_id_check;
alter table public.generation_jobs add constraint generation_jobs_section_id_check
 check(section_id in('environment_description','plot_description','comparable_sales'));
alter table public.generation_jobs add column cli_context jsonb
 check(cli_context is null or (execution_mode='cli' and section_id='comparable_sales'
 and jsonb_typeof(cli_context)='object' and octet_length(cli_context::text)<=2000000));
create function private.cli_scrub_context() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.deleted_at is not null then new.cli_context:=null;end if;
 return new;
end $$;
revoke all on function private.cli_scrub_context() from public,anon,authenticated;
create trigger cli_scrub_context before update on public.generation_jobs
 for each row execute function private.cli_scrub_context();
create or replace function private.cli_job_view(p_job uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',j.id,'sectionId',j.section_id,'status',j.status,'executionMode','cli',
   'provider',case when j.provider_id='anthropic' then 'claude' else j.provider_id end,
   'modelRequested','provider-default','modelResolved',j.resolved_model_id,
   'output',case when j.status='succeeded' and j.deleted_at is null then jsonb_build_object('text',j.output_text,'data',null) end,
   'usage',jsonb_build_object('inputTokens',j.usage->'inputTokens','outputTokens',j.usage->'outputTokens'),
   'error',case when j.error_code is not null then jsonb_build_object('code',j.error_code,'retryable',false) end)
 from public.generation_jobs j where j.id=p_job and j.execution_mode='cli'
$$;
create or replace function public.cli_user_action(p_user uuid,p_action text,p_body jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c private.cli_connections; h private.cli_hosts; j public.generation_jobs;
  v_id uuid; v_hash text; v_version integer; v_provider private.cli_providers;
begin
 perform pg_advisory_xact_lock(732184621094::bigint);
 if p_action='listCliConnections' then
   return jsonb_build_object('providers',(select jsonb_agg(jsonb_build_object('provider',p.provider_id,'enabled',p.enabled,'reason',p.reason,
     'connection',(select jsonb_build_object('id',x.id,'provider',x.provider_id,'status',x.status,'revision',x.revision,
       'available',x.status='connected' and p.enabled and host.enabled and host.status='ready' and host.last_seen_at>clock_timestamp()-interval '30 seconds',
       'lastVerifiedAt',x.last_verified_at) from private.cli_connections x join private.cli_hosts host on host.id=x.host_id
       where x.owner_id=p_user and x.provider_id=p.provider_id))) from private.cli_providers p));
 end if;
 if p_action='requestCliConnection' then
   select * into c from private.cli_connections where owner_id=p_user and provider_id=p_body->>'provider';
   if c.id is not null and c.status not in('disconnected','reauth_required','disabled') then
     return jsonb_build_object('connection',jsonb_build_object('id',c.id,'provider',c.provider_id,'status',c.status,'revision',c.revision,'available',false));
   end if;
   select * into h from private.cli_hosts where enabled for update;
   if h.id is null then raise exception 'WORKER_UNAVAILABLE'; end if;
   insert into private.cli_connections(owner_id,provider_id,host_id) values(p_user,p_body->>'provider',h.id)
     on conflict(owner_id,provider_id) do update set status='pending_setup',revision=private.cli_connections.revision+1,updated_at=now()
     returning * into c;
   return jsonb_build_object('connection',jsonb_build_object('id',c.id,'provider',c.provider_id,'status',c.status,'revision',c.revision,'available',false));
 end if;
 if p_action='getCliJob' or p_action='lookupCliJob' or p_action='cancelCliJob' then
   select * into j from public.generation_jobs where owner_id=p_user and execution_mode='cli' and
     (case when p_action='lookupCliJob' then idempotency_key=(p_body->>'requestId')::uuid else id=(p_body->>'jobId')::uuid end);
   if j.id is null then raise exception 'NOT_FOUND'; end if;
   if not private.cli_access(p_user,j.workspace_id) then raise exception 'INACTIVE_MEMBERSHIP'; end if;
   if j.deleted_at is not null then raise exception 'RESULT_EXPIRED'; end if;
   if p_action='cancelCliJob' and j.completed_at is null then
     if j.status='queued' then
       perform private.cli_settle(j.id,'cancelled','CANCELLED',null,null,null);
     else
       perform pg_advisory_xact_lock(hashtextextended(j.workspace_id::text||':'||j.section_id,0));
       update public.generation_jobs set status='cancel_requested' where id=j.id and completed_at is null;
       update private.cli_job_state set cancel_reason='CANCELLED' where job_id=j.id;
     end if;
   end if;
   return jsonb_build_object('job',private.cli_job_view(j.id));
 end if;
 if p_action='disconnectCliConnection' then
   select * into c from private.cli_connections where id=(p_body->>'connectionId')::uuid and owner_id=p_user for update;
   if c.id is null then raise exception 'NOT_FOUND'; end if;
   if c.status not in('disconnected','disconnecting') then
     update private.cli_connections set status='disconnecting',revision=revision+1,updated_at=now() where id=c.id;
     for j in select g.* from public.generation_jobs g join private.cli_job_state s on s.job_id=g.id
       where s.connection_id=c.id and g.completed_at is null order by g.workspace_id,g.section_id,g.id loop
       if j.status='queued' then perform private.cli_settle(j.id,'cancelled','CONNECTION_CHANGED',null,null,null);
       else
         perform pg_advisory_xact_lock(hashtextextended(j.workspace_id::text||':'||j.section_id,0));
         update public.generation_jobs set status='cancel_requested' where id=j.id;
         update private.cli_job_state set cancel_reason='CONNECTION_CHANGED' where job_id=j.id;
       end if;
     end loop;
   end if;
   return jsonb_build_object('ok',true);
 end if;
 if p_action<>'createCliJob' then raise exception 'UNSUPPORTED_CAPABILITY'; end if;
 if coalesce(p_body->>'sectionId','environment_description') not in('environment_description','plot_description','comparable_sales') then raise exception 'UNSUPPORTED_CAPABILITY'; end if;
 if p_body->>'sectionId'='plot_description' and (p_body->'plotEvidence' is null or p_body->'plotEvidence'='null'::jsonb or jsonb_typeof(p_body->'plotEvidence')<>'object' or p_body->'plotEvidence'->>'address' is distinct from p_body->>'address') then raise exception 'INVALID_INPUT';end if;
 if p_body->>'sectionId'='comparable_sales' and (p_body->'cliContext' is null or p_body->'cliContext'='null'::jsonb or jsonb_typeof(p_body->'cliContext')<>'object') then raise exception 'INVALID_INPUT';end if;
 v_hash:=p_body->>'requestHash';
 select * into j from public.generation_jobs where owner_id=p_user and idempotency_key=(p_body->>'requestId')::uuid;
 if j.id is not null then
   if j.execution_mode<>'cli' or j.request_hash<>v_hash then raise exception 'REQUEST_ID_CONFLICT'; end if;
   if not private.cli_access(p_user,j.workspace_id) then raise exception 'INACTIVE_MEMBERSHIP'; end if;
   if j.deleted_at is not null then raise exception 'RESULT_EXPIRED'; end if;
   return jsonb_build_object('job',private.cli_job_view(j.id));
 end if;
 if not private.cli_access(p_user,(p_body->>'workspaceId')::uuid) then raise exception 'INACTIVE_MEMBERSHIP'; end if;
 select * into c from private.cli_connections where id=(p_body->>'connectionId')::uuid and owner_id=p_user for update;
 if c.id is null then raise exception 'NOT_FOUND'; end if;
 select * into h from private.cli_hosts where id=c.host_id for update;
 select * into v_provider from private.cli_providers where provider_id=c.provider_id;
 if c.status<>'connected' then raise exception 'CONNECTION_CHANGED'; end if;
 if not v_provider.enabled or not h.enabled or h.status<>'ready' or h.last_seen_at is null or h.last_seen_at<=clock_timestamp()-interval '30 seconds'
   or not h.manifests ? v_provider.manifest_digest then raise exception 'WORKER_UNAVAILABLE'; end if;
 if (select count(*) from public.generation_jobs where owner_id=p_user and execution_mode='cli' and completed_at is null)>=2
   or (select count(*) from private.cli_job_state s join public.generation_jobs g on g.id=s.job_id where s.host_id=h.id and g.status='queued')>=20 then raise exception 'QUEUE_FULL'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||coalesce(p_body->>'sectionId','environment_description'),0));
 select version into v_version from public.agent_prompts where user_id=p_user and section_id=coalesce(p_body->>'sectionId','environment_description') for share;
 if coalesce(v_version,0)<>(p_body->>'promptVersion')::integer then raise exception 'PROMPT_CHANGED'; end if;
 if octet_length((p_body->>'instructions')||E'\n\n'||(p_body->>'inputText'))>262144 then raise exception 'INPUT_TOO_LARGE'; end if;
 insert into public.generation_jobs(workspace_id,owner_id,section_id,address,example_text,additional_request,provider_id,model_id,
   credential_version,prompt_hash,consent_version,consented_at,idempotency_key,request_hash,execution_mode,plot_evidence,cli_context)
 values((p_body->>'workspaceId')::uuid,p_user,coalesce(p_body->>'sectionId','environment_description'),p_body->>'address',p_body->>'example',p_body->>'additionalRequest',
   case when c.provider_id='claude' then 'anthropic' else c.provider_id end,'cli-default',null,p_body->>'payloadDigest','cli-v1',now(),
   (p_body->>'requestId')::uuid,v_hash,'cli',nullif(p_body->'plotEvidence','null'::jsonb),nullif(p_body->'cliContext','null'::jsonb)) returning id into v_id;
 insert into private.cli_job_state(job_id,connection_id,connection_revision,host_id) values(v_id,c.id,c.revision,h.id);
 insert into private.cli_job_payloads values(v_id,p_body->>'instructions',p_body->>'inputText',coalesce(v_version,0),v_provider.manifest_digest,p_body->>'payloadDigest');
 return jsonb_build_object('job',private.cli_job_view(v_id));
end $$;
