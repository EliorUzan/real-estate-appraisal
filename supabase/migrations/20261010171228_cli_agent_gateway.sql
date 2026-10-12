-- Single-host prototype. A coarse CLI transaction lock deliberately serializes
-- mutations; section locks still precede job locks to match existing API retention.
alter table public.generation_jobs
  add column execution_mode text not null default 'api' check (execution_mode in ('api','cli')),
  add column resolved_model_id text check (char_length(resolved_model_id)<=160),
  alter column credential_version drop not null;
alter table public.generation_jobs drop constraint generation_jobs_credential_version_check;
alter table public.generation_jobs add constraint generation_jobs_credentials_by_mode check (
  (execution_mode='api' and credential_version is not null and credential_version>0)
  or (execution_mode='cli' and credential_version is null));
alter table public.generation_jobs add constraint generation_jobs_cli_no_public_lease check (
  execution_mode<>'cli' or (lease_token is null and lease_expires_at is null));
create index generation_jobs_cli_queue_idx on public.generation_jobs(created_at,id)
  where execution_mode='cli' and status='queued' and deleted_at is null;

create table private.cli_providers (
  provider_id text primary key check(provider_id in ('claude','openai','gemini')),
  enabled boolean not null default false,
  manifest_digest text check(manifest_digest ~ '^[0-9a-f]{64}$'),
  reason text not null default 'RUNTIME_SETUP_REQUIRED',
  check(not enabled or manifest_digest is not null)
);
insert into private.cli_providers(provider_id) values('claude'),('openai'),('gemini');
create table private.cli_hosts (
  id uuid primary key default gen_random_uuid(), enabled boolean not null default false,
  token_hash text not null check(token_hash ~ '^[0-9a-f]{64}$'),
  previous_token_hash text check(previous_token_hash ~ '^[0-9a-f]{64}$'), previous_token_expires_at timestamptz,
  status text not null default 'draining' check(status in ('ready','draining','quarantined')),
  last_seen_at timestamptz, manifests jsonb not null default '[]', active_job_id uuid references public.generation_jobs(id),
  check((previous_token_hash is null)=(previous_token_expires_at is null)),
  check(jsonb_typeof(manifests)='array')
);
create unique index cli_one_enabled_host on private.cli_hosts((true)) where enabled;
create table private.cli_connections (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  provider_id text not null references private.cli_providers(provider_id), host_id uuid not null references private.cli_hosts(id),
  runtime_ref text not null unique default ('cli-home-'||gen_random_uuid()::text),
  revision integer not null default 1 check(revision>0),
  status text not null default 'pending_setup' check(status in ('pending_setup','connected','reauth_required','disconnecting','disconnected','disabled')),
  last_verified_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id,provider_id), check(runtime_ref ~ '^cli-home-[0-9a-f-]{36}$')
);
create index cli_connections_host_idx on private.cli_connections(host_id,status);
create table private.cli_job_state (
  job_id uuid primary key references public.generation_jobs(id),
  connection_id uuid not null references private.cli_connections(id), connection_revision integer not null,
  host_id uuid not null references private.cli_hosts(id), attempt_number integer not null default 0 check(attempt_number in(0,1)),
  lease_token uuid, lease_expires_at timestamptz,
  phase text not null default 'queued' check(phase in('queued','claimed','launch_authorized','running','stopped','uncertain','settled')),
  container_ref text, queue_deadline_at timestamptz not null default (now()+interval '15 minutes'),
  run_deadline_at timestamptz, launch_authorized_at timestamptz, cancel_reason text,
  completion_digest text, receipt_status text, receipt_token_hash text,
  check((lease_token is null)=(lease_expires_at is null))
);
create index cli_job_state_connection_idx on private.cli_job_state(connection_id);
create index cli_job_state_host_idx on private.cli_job_state(host_id);
create table private.cli_job_payloads (
  job_id uuid primary key references public.generation_jobs(id), instructions text not null, input_text text not null,
  prompt_version integer not null, adapter_manifest_digest text not null,
  payload_digest text not null, check(octet_length(instructions||E'\n\n'||input_text)<=262144)
);
alter table private.cli_providers enable row level security;
alter table private.cli_hosts enable row level security;
alter table private.cli_connections enable row level security;
alter table private.cli_job_state enable row level security;
alter table private.cli_job_payloads enable row level security;
revoke all on private.cli_providers,private.cli_hosts,private.cli_connections,private.cli_job_state,private.cli_job_payloads from public,anon,authenticated;
grant usage on schema private to service_role;
grant all on private.cli_providers,private.cli_hosts,private.cli_connections,private.cli_job_state,private.cli_job_payloads to service_role;

create function private.cli_access(p_user uuid,p_workspace uuid) returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.workspace_members m join public.workspaces w on w.id=m.workspace_id
    where m.user_id=p_user and m.workspace_id=p_workspace and m.status='active' and w.status='active')
$$;
create function private.cli_job_view(p_job uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',j.id,'status',j.status,'executionMode','cli',
   'provider',case when j.provider_id='anthropic' then 'claude' else j.provider_id end,
   'modelRequested','provider-default','modelResolved',j.resolved_model_id,
   'output',case when j.status='succeeded' and j.deleted_at is null then jsonb_build_object('text',j.output_text,'data',null) end,
   'usage',jsonb_build_object('inputTokens',j.usage->'inputTokens','outputTokens',j.usage->'outputTokens'),
   'error',case when j.error_code is not null then jsonb_build_object('code',j.error_code,'retryable',false) end)
 from public.generation_jobs j where j.id=p_job and j.execution_mode='cli'
$$;
create function private.cli_settle(p_job uuid,p_status public.job_status,p_error text,p_result jsonb,p_digest text,p_token uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs;
begin
 select * into strict j from public.generation_jobs where id=p_job;
 perform pg_advisory_xact_lock(hashtextextended(j.workspace_id::text||':'||j.section_id,0));
 select * into strict j from public.generation_jobs where id=p_job for update;
 if j.completed_at is not null then
   -- Maintenance may already have fenced a lost attempt. A stopped completion
   -- records a receipt without publishing its late answer.
   update private.cli_job_state set phase='settled',lease_token=null,lease_expires_at=null,
     receipt_token_hash=case when p_token is not null then encode(extensions.digest(p_token::text,'sha256'),'hex') end,
     completion_digest=p_digest,receipt_status=j.status::text
   where job_id=p_job and receipt_status is null;
   delete from private.cli_job_payloads where job_id=p_job;
   perform private.prune_section_history(j.workspace_id,j.section_id);
   return;
 end if;
 update public.generation_jobs set status=p_status,error_code=p_error,completed_at=clock_timestamp(),stage='saving',
   output_text=case when p_status='succeeded' then p_result->>'text' end,
   resolved_model_id=case when p_status='succeeded' then p_result->>'model' end,
   usage=case when p_status='succeeded' then jsonb_build_object('inputTokens',p_result->'inputTokens','outputTokens',p_result->'outputTokens') else '{}'::jsonb end
 where id=p_job;
 if p_status='succeeded' then
   insert into public.draft_revisions(job_id,workspace_id,owner_id,revision_number,text,text_sha256,created_by)
   values(j.id,j.workspace_id,j.owner_id,1,p_result->>'text',encode(extensions.digest(p_result->>'text','sha256'),'hex'),j.owner_id);
 end if;
 update private.cli_job_state set phase='settled',lease_token=null,lease_expires_at=null,
   receipt_token_hash=case when p_token is not null then encode(extensions.digest(p_token::text,'sha256'),'hex') end,
   completion_digest=p_digest,receipt_status=p_status::text where job_id=p_job;
 delete from private.cli_job_payloads where job_id=p_job;
 perform private.prune_section_history(j.workspace_id,j.section_id);
 -- Pruning by either API or CLI can remove public content; scrub matching private snapshots.
 delete from private.cli_job_payloads p using public.generation_jobs old where p.job_id=old.id and old.deleted_at is not null;
end $$;

-- Browser authority is derived in the authenticated Edge handler. These entry
-- points are callable only with the backend service role, never a user JWT.
create function public.cli_user_action(p_user uuid,p_action text,p_body jsonb) returns jsonb
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
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||'environment_description',0));
 select version into v_version from public.agent_prompts where user_id=p_user and section_id='environment_description' for share;
 if coalesce(v_version,0)<>(p_body->>'promptVersion')::integer then raise exception 'PROMPT_CHANGED'; end if;
 if octet_length((p_body->>'instructions')||E'\n\n'||(p_body->>'inputText'))>262144 then raise exception 'INPUT_TOO_LARGE'; end if;
 insert into public.generation_jobs(workspace_id,owner_id,section_id,address,example_text,additional_request,provider_id,model_id,
   credential_version,prompt_hash,consent_version,consented_at,idempotency_key,request_hash,execution_mode)
 values((p_body->>'workspaceId')::uuid,p_user,'environment_description',p_body->>'address',p_body->>'example',p_body->>'additionalRequest',
   case when c.provider_id='claude' then 'anthropic' else c.provider_id end,'cli-default',null,p_body->>'payloadDigest','cli-v1',now(),
   (p_body->>'requestId')::uuid,v_hash,'cli') returning id into v_id;
 insert into private.cli_job_state(job_id,connection_id,connection_revision,host_id) values(v_id,c.id,c.revision,h.id);
 insert into private.cli_job_payloads values(v_id,p_body->>'instructions',p_body->>'inputText',coalesce(v_version,0),v_provider.manifest_digest,p_body->>'payloadDigest');
 return jsonb_build_object('job',private.cli_job_view(v_id));
end $$;

create function public.cli_authenticate_host(p_host uuid,p_hash text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from private.cli_hosts where id=p_host and enabled and (token_hash=p_hash or
   (previous_token_hash=p_hash and previous_token_expires_at>clock_timestamp())))
$$;
create function public.cli_worker_action(p_host uuid,p_action text,p_body jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h private.cli_hosts; c private.cli_connections; s private.cli_job_state; j public.generation_jobs;
  p private.cli_job_payloads; v_reason text; v_digest text; v_result jsonb; v_status public.job_status; v_token uuid;
begin
 perform pg_advisory_xact_lock(732184621094::bigint);
 select * into h from private.cli_hosts where id=p_host and enabled for update;
 if h.id is null then raise exception 'UNAUTHENTICATED'; end if;
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
 if p_action='claim' then
   if h.active_job_id is not null then
     select * into s from private.cli_job_state where job_id=h.active_job_id;
     return jsonb_build_object('job',jsonb_build_object('jobId',s.job_id,'attemptNumber',s.attempt_number,'leaseToken',s.lease_token,'phase',s.phase,'recoveryRequired',true,'containerRef',s.container_ref));
   end if;
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

create function public.cli_maintenance() returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs; s private.cli_job_state; n integer:=0;
begin
 perform pg_advisory_xact_lock(732184621094::bigint);
 for s in select * from private.cli_job_state where phase<>'settled' order by job_id loop
   select * into j from public.generation_jobs where id=s.job_id;
   if j.status='queued' and s.queue_deadline_at<=clock_timestamp() then
     perform private.cli_settle(j.id,'expired','QUEUE_EXPIRED',null,null,null);n:=n+1;
   elsif j.completed_at is null and s.lease_expires_at<=clock_timestamp() then
     perform pg_advisory_xact_lock(hashtextextended(j.workspace_id::text||':'||j.section_id,0));
     update public.generation_jobs set status='needs_review',completed_at=clock_timestamp(),error_code='OUTCOME_UNCERTAIN' where id=j.id;
     update private.cli_job_state set phase='uncertain',cancel_reason='OUTCOME_UNCERTAIN' where job_id=j.id;
     update private.cli_hosts set status='quarantined' where id=s.host_id;
     -- Keep host slot and lease identity until the supervisor proves termination.
     n:=n+1;
   end if;
 end loop;
 delete from private.cli_job_payloads p using public.generation_jobs g where p.job_id=g.id
   and (g.deleted_at is not null or g.completed_at<clock_timestamp()-interval '24 hours');
 return jsonb_build_object('processed',n);
end $$;

-- Functions are private by privilege even though PostgREST needs public wrappers.
revoke all on function private.cli_access(uuid,uuid),private.cli_job_view(uuid),private.cli_settle(uuid,public.job_status,text,jsonb,text,uuid),
 public.cli_user_action(uuid,text,jsonb),public.cli_authenticate_host(uuid,text),public.cli_worker_action(uuid,text,jsonb),public.cli_maintenance() from public,anon,authenticated;
grant execute on function private.cli_access(uuid,uuid),private.cli_job_view(uuid),private.cli_settle(uuid,public.job_status,text,jsonb,text,uuid),
 public.cli_user_action(uuid,text,jsonb),public.cli_authenticate_host(uuid,text),public.cli_worker_action(uuid,text,jsonb),public.cli_maintenance() to service_role;

-- Existing synchronous API finalizers must not finalize CLI jobs accidentally.
create function private.cli_protect_api_finalizer() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.execution_mode='cli' and old.execution_mode='api' then raise exception 'execution mode is immutable'; end if;
 if old.execution_mode='cli' and new.execution_mode<>'cli' then raise exception 'execution mode is immutable'; end if;
 return new;
end $$;
create trigger cli_execution_mode_immutable before update on public.generation_jobs for each row execute function private.cli_protect_api_finalizer();
revoke all on function private.cli_protect_api_finalizer() from public,anon,authenticated;
