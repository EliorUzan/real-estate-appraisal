-- Browser native sign-in is opt-in. Preserve existing connected rows/homes.
alter table private.cli_hosts add column login_protocol text, add column setup_protocol text, add column active_login_id uuid, add column active_setup_id uuid;
alter table private.cli_hosts add constraint cli_exclusive_execution_slot
  check(num_nonnulls(active_job_id,active_login_id,active_setup_id)<=1);
alter table private.cli_connections
  add column native_authenticated_at timestamptz,
  add column verification_status text not null default 'not_checked'
    check(verification_status in('not_checked','pending','passed','quota_blocked','plan_blocked','failed')),
  add column verified_manifest_digest text;
update private.cli_connections c set native_authenticated_at=c.last_verified_at,
  verification_status='passed',verified_manifest_digest=p.manifest_digest
  from private.cli_providers p where c.provider_id=p.provider_id and c.status='connected';

create table private.cli_onboarding_config (
  host_id uuid primary key references private.cli_hosts(id),
  enabled boolean not null default false,
  allowed_owners uuid[] not null default '{}',
  protocol text not null default 'antigravity-login-v1',
  -- Reviewed login image/protocol/egress evidence is independently provisioned.
  login_manifest_digest text check(login_manifest_digest ~ '^[0-9a-f]{64}$'),
  maps_status text not null default 'not_configured',
  check(not enabled or (cardinality(allowed_owners)>0 and login_manifest_digest is not null))
);
create table private.cli_login_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  workspace_id uuid not null references public.workspaces(id),
  connection_id uuid not null references private.cli_connections(id),
  connection_revision integer not null check(connection_revision>0),
  host_id uuid not null references private.cli_hosts(id),
  request_id uuid not null, request_hash text not null,
  kind text not null check(kind in('interactive_login','verify_only')),
  state text not null check(state in('waiting_for_host','queued','starting','awaiting_code','code_received','authenticating','verifying','succeeded','verification_blocked','cancelled','expired','failed')),
  phase_version integer not null default 1,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  queue_deadline_at timestamptz not null, native_started_at timestamptz,
  challenge_expires_at timestamptz, verify_deadline_at timestamptz, completed_at timestamptz,
  challenge_id uuid, key_id uuid, authorization_url text, public_key_jwk jsonb,
  manifest_digest text not null, login_manifest_digest text not null,
  runtime_ref text not null, container_ref text, container_kind text,
  lease_hash text, lease_expires_at timestamptz, last_worker_seen_at timestamptz,
  submission_id uuid, envelope_digest text, consumed_at timestamptz,
  error_code text, completion_digest text,
  unique(owner_id,request_id),
  check((lease_hash is null)=(lease_expires_at is null)),
  check(kind<>'verify_only' or (challenge_id is null and key_id is null and authorization_url is null and public_key_jwk is null)),
  check(authorization_url is null or octet_length(authorization_url)<=8192)
);
create unique index cli_login_one_active_connection on private.cli_login_sessions(connection_id) where completed_at is null;
create unique index cli_login_one_claimed_host on private.cli_login_sessions(host_id) where lease_hash is not null and completed_at is null;
create index cli_login_queue on private.cli_login_sessions(host_id,created_at,id) where completed_at is null;
create index cli_login_owner_history on private.cli_login_sessions(owner_id,created_at);
create index cli_login_workspace on private.cli_login_sessions(workspace_id);
create table private.cli_login_requests (
 owner_id uuid not null references auth.users(id),request_id uuid not null,
 session_id uuid not null references private.cli_login_sessions(id) on delete cascade,
 request_hash text not null,created_at timestamptz not null default clock_timestamp(),primary key(owner_id,request_id)
);
create index cli_login_requests_session on private.cli_login_requests(session_id);
create table private.cli_login_envelopes (
  session_id uuid primary key references private.cli_login_sessions(id) on delete cascade,
  challenge_id uuid not null, submission_id uuid not null,
  envelope jsonb not null, envelope_digest text not null,
  created_at timestamptz not null default clock_timestamp(),
  check(octet_length(envelope::text)<=15000)
);
create table private.cli_connection_verifications (
  session_id uuid primary key references private.cli_login_sessions(id),
  connection_id uuid not null references private.cli_connections(id),
  revision integer not null, runtime_ref text not null, manifest_digest text not null,
  receipt_digest text not null, outcome text not null, verified_at timestamptz not null default clock_timestamp()
);
create index cli_connection_verifications_connection on private.cli_connection_verifications(connection_id);
alter table private.cli_hosts add constraint cli_active_login_fk foreign key(active_login_id) references private.cli_login_sessions(id);
alter table private.cli_onboarding_config enable row level security;
alter table private.cli_login_sessions enable row level security;
alter table private.cli_login_envelopes enable row level security;
alter table private.cli_login_requests enable row level security;
alter table private.cli_connection_verifications enable row level security;
revoke all on private.cli_onboarding_config,private.cli_login_sessions,private.cli_login_envelopes,private.cli_login_requests,private.cli_connection_verifications from public,anon,authenticated;
grant all on private.cli_onboarding_config,private.cli_login_sessions,private.cli_login_envelopes,private.cli_login_requests,private.cli_connection_verifications to service_role;

create function private.cli_end_login(p_id uuid,p_state text,p_error text) returns void
language plpgsql security invoker set search_path='' as $$
begin
 update private.cli_login_sessions set state=p_state,error_code=p_error,completed_at=clock_timestamp(),updated_at=clock_timestamp(),
   phase_version=phase_version+1,authorization_url=null,public_key_jwk=null,key_id=null
 where id=p_id and completed_at is null;
 delete from private.cli_login_envelopes where session_id=p_id;
 -- Retain host reservation and lease identity until confirmed runtime cleanup.
end $$;
create function private.cli_expire_logins() returns void
language plpgsql security invoker set search_path='' as $$
declare s private.cli_login_sessions;
begin
 for s in select * from private.cli_login_sessions where completed_at is null loop
  if not private.cli_access(s.owner_id,s.workspace_id) then perform private.cli_end_login(s.id,'cancelled','ACCESS_REVOKED');
  elsif not exists(select 1 from private.cli_connections where id=s.connection_id and revision=s.connection_revision and status not in('disconnecting','disconnected','disabled')) then
    perform private.cli_end_login(s.id,'cancelled','CONNECTION_CHANGED');
  elsif (s.state in('waiting_for_host','queued') and s.queue_deadline_at<=clock_timestamp())
    or (s.state in('starting','awaiting_code','code_received','authenticating') and s.native_started_at+interval '300 seconds'<=clock_timestamp())
    or (s.state in('awaiting_code','code_received') and s.challenge_expires_at<=clock_timestamp())
    or (s.state='verifying' and s.verify_deadline_at<=clock_timestamp()) then perform private.cli_end_login(s.id,'expired','LOGIN_EXPIRED');
  elsif s.lease_expires_at<=clock_timestamp() then perform private.cli_end_login(s.id,'failed','WORKER_LOST'); end if;
 end loop;
 delete from private.cli_login_envelopes e using private.cli_login_sessions expired where expired.id=e.session_id and expired.completed_at is not null;
 update private.cli_login_sessions set authorization_url=null,public_key_jwk=null,key_id=null where completed_at is not null;
 delete from private.cli_connection_verifications v using private.cli_login_sessions expired
   where v.session_id=expired.id and expired.completed_at<clock_timestamp()-interval '7 days'
     and not exists(select 1 from private.cli_hosts h where h.active_login_id=expired.id);
 delete from private.cli_login_sessions expired where completed_at<clock_timestamp()-interval '7 days'
   and not exists(select 1 from private.cli_hosts h where h.active_login_id=expired.id);
end $$;
create function private.cli_login_view(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',s.id,'provider','gemini','kind',s.kind,'state',s.state,'phaseVersion',s.phase_version,
   'connectionRevision',s.connection_revision,'expiresAt',coalesce(s.verify_deadline_at,s.challenge_expires_at,s.native_started_at+interval '300 seconds',s.queue_deadline_at),
   'serverNow',clock_timestamp(),'canSubmitCode',s.state='awaiting_code' and s.completed_at is null and s.lease_expires_at>clock_timestamp() and s.challenge_expires_at>clock_timestamp(),
   'error',case when s.error_code is not null then jsonb_build_object('code',s.error_code) end)
 from private.cli_login_sessions s where s.id=p_id
$$;
create function public.cli_onboarding_user_action(p_user uuid,p_action text,p_body jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s private.cli_login_sessions; c private.cli_connections; h private.cli_hosts; cfg private.cli_onboarding_config;
  p private.cli_providers; w uuid; token uuid; hash text; v_kind text; v_id uuid; action text; envelope jsonb;
begin
 perform pg_advisory_xact_lock(732184621094::bigint);
 perform private.cli_expire_logins();
 select m.workspace_id into w from public.workspace_members m join public.workspaces ws on ws.id=m.workspace_id
   where m.user_id=p_user and m.status='active' and ws.status='active' order by m.workspace_id limit 1;
 if w is null then raise exception 'INACTIVE_MEMBERSHIP'; end if;
 select * into c from private.cli_connections where owner_id=p_user and provider_id='gemini';
 select * into h from private.cli_hosts where enabled;
 select * into cfg from private.cli_onboarding_config where host_id=h.id;
 select * into p from private.cli_providers where provider_id='gemini';
 if p_action='getCliOnboarding' then
  select * into s from private.cli_login_sessions where owner_id=p_user and completed_at is null order by created_at desc limit 1;
  action:=case
    when c.status='connected' and c.verification_status='passed' and c.verified_manifest_digest=p.manifest_digest and h.status='ready' and p.enabled then
      case when h.last_seen_at>clock_timestamp()-interval '30 seconds' then 'none' else 'start_host' end
    when not coalesce(cfg.enabled and p_user=any(cfg.allowed_owners),false) then 'contact_operator'
    when s.id is not null then 'resume_login'
    when c.status='reauth_required' then 'reconnect'
    when c.native_authenticated_at is not null and (c.verification_status in('quota_blocked','plan_blocked','failed','pending') or c.verified_manifest_digest is distinct from p.manifest_digest) then 'verify_connection'
    when c.status='connected' and (h.status<>'ready' or not p.enabled) then 'contact_operator'
    when c.status='connected' and (h.last_seen_at is null or h.last_seen_at<=clock_timestamp()-interval '30 seconds') then 'start_host'
    when c.status='connected' then 'none'
    when c.status='disconnecting' then 'wait' else 'connect' end;
  return jsonb_build_object('enabled',coalesce(cfg.enabled and p_user=any(cfg.allowed_owners),false),'nextAction',action,
    'hostState',case when h.id is null then 'not_configured' when h.status<>'ready' then h.status when h.last_seen_at>clock_timestamp()-interval '30 seconds' then 'ready' else 'asleep' end,
    'authState',case when c.status='connected' then 'authenticated' when c.native_authenticated_at is not null then 'verification_pending' else coalesce(c.status,'not_connected') end,
    'connectionId',c.id,'session',private.cli_login_view(s.id),'maps',jsonb_build_object('status',coalesce(cfg.maps_status,'not_configured')),
    'wake',jsonb_build_object('configured',false,'state','not_configured','errorCode',null));
 end if;
 if p_action='getActiveCliLogin' then
  select id into v_id from private.cli_login_sessions where owner_id=p_user and completed_at is null order by created_at desc limit 1;
  return jsonb_build_object('session',private.cli_login_view(v_id));
 end if;
 if p_action in('startCliLogin','verifyCliConnection') then
  if not coalesce(cfg.enabled and p_user=any(cfg.allowed_owners),false) then raise exception 'ONBOARDING_DISABLED'; end if;
  if h.status<>'ready' or not p.enabled then raise exception 'WORKER_UNAVAILABLE'; end if;
  if c.id is not null and c.host_id is distinct from h.id then raise exception 'CONNECTION_CHANGED';end if;
  v_kind:=case when p_action='verifyCliConnection' then 'verify_only' else 'interactive_login' end;
  hash:=encode(extensions.digest(jsonb_build_array(p_action,p_body->>'connectionId','gemini')::text,'sha256'),'hex');
  select session.* into s from private.cli_login_sessions session join private.cli_login_requests r on r.session_id=session.id where r.owner_id=p_user and r.request_id=(p_body->>'requestId')::uuid;
  if s.id is not null then
   if (select request_hash from private.cli_login_requests where owner_id=p_user and request_id=(p_body->>'requestId')::uuid)<>hash then raise exception 'REQUEST_ID_CONFLICT'; end if;
   return jsonb_build_object('session',private.cli_login_view(s.id));
  end if;
  if (select count(*) from private.cli_login_requests where owner_id=p_user and created_at>clock_timestamp()-interval '1 hour')>=50 then raise exception 'QUEUE_FULL';end if;
  if c.id is not null then
   if p_action='verifyCliConnection' and c.id::text<>p_body->>'connectionId' then raise exception 'NOT_FOUND'; end if;
   select * into s from private.cli_login_sessions where connection_id=c.id and completed_at is null;
   if s.id is not null then
    insert into private.cli_login_requests(owner_id,request_id,session_id,request_hash) values(p_user,(p_body->>'requestId')::uuid,s.id,hash);
    return jsonb_build_object('session',private.cli_login_view(s.id));
   end if;
   if exists(select 1 from private.cli_job_state x join public.generation_jobs j on j.id=x.job_id where x.connection_id=c.id and (j.completed_at is null or x.phase='uncertain'))
     or exists(select 1 from private.cli_hosts where active_login_id in(select id from private.cli_login_sessions where connection_id=c.id)) then raise exception 'CONNECTION_BUSY'; end if;
   if c.status in('disconnecting','disabled') or (c.status='connected' and v_kind<>'verify_only') then raise exception 'CONNECTION_CHANGED'; end if;
   if c.native_authenticated_at is not null and v_kind='interactive_login' then raise exception 'VERIFICATION_REQUIRED'; end if;
  elsif v_kind='verify_only' then raise exception 'NOT_FOUND'; end if;
  if v_kind='verify_only' and c.native_authenticated_at is null then raise exception 'AUTH_REQUIRED'; end if;
  if (select count(*) from private.cli_login_sessions where owner_id=p_user and created_at>clock_timestamp()-interval '1 hour')>=5
    or (select count(*) from private.cli_login_sessions where owner_id=p_user and created_at>clock_timestamp()-interval '1 day')>=20
    or (select count(*) from private.cli_login_sessions where host_id=h.id and completed_at is null)>=10 then raise exception 'QUEUE_FULL'; end if;
  if c.id is null then insert into private.cli_connections(owner_id,provider_id,host_id) values(p_user,'gemini',h.id) returning * into c;
  elsif v_kind='interactive_login' and c.status in('disconnected','reauth_required') then
   update private.cli_connections set status='pending_setup',revision=revision+1,native_authenticated_at=null,verification_status='not_checked',updated_at=clock_timestamp() where id=c.id returning * into c;
  end if;
  insert into private.cli_login_sessions(owner_id,workspace_id,connection_id,connection_revision,host_id,request_id,request_hash,kind,state,queue_deadline_at,manifest_digest,login_manifest_digest,runtime_ref)
   values(p_user,w,c.id,c.revision,h.id,(p_body->>'requestId')::uuid,hash,v_kind,
     case when h.last_seen_at>clock_timestamp()-interval '30 seconds' then 'queued' else 'waiting_for_host' end,
     clock_timestamp()+case when h.last_seen_at>clock_timestamp()-interval '30 seconds' then interval '360 seconds' else interval '180 seconds' end,
     p.manifest_digest,cfg.login_manifest_digest,c.runtime_ref) returning * into s;
  insert into private.cli_login_requests(owner_id,request_id,session_id,request_hash) values(p_user,(p_body->>'requestId')::uuid,s.id,hash);
  update private.cli_connections set verification_status='pending',status='pending_setup' where id=c.id;
  return jsonb_build_object('session',private.cli_login_view(s.id));
 end if;
 select * into s from private.cli_login_sessions where id=(p_body->>'sessionId')::uuid and owner_id=p_user;
 if s.id is null then raise exception 'NOT_FOUND'; end if;
 if p_action='getCliLogin' then return jsonb_build_object('session',private.cli_login_view(s.id)); end if;
 if p_action='cancelCliLogin' then
  perform private.cli_end_login(s.id,'cancelled','CANCELLED');
  return jsonb_build_object('session',private.cli_login_view(s.id));
 end if;
 -- A lost acknowledgement may be retried after code consumption or termination.
 if p_action='submitCliLoginCode' and s.submission_id is not null then
  hash:=encode(extensions.digest((p_body->'envelope')::text,'sha256'),'hex');
  if s.challenge_id is distinct from (p_body->>'challengeId')::uuid or s.submission_id is distinct from (p_body->>'submissionId')::uuid or s.envelope_digest<>hash then raise exception 'REQUEST_ID_CONFLICT';end if;
  return jsonb_build_object('session',private.cli_login_view(s.id));
 end if;
 if s.completed_at is not null then raise exception 'LOGIN_EXPIRED'; end if;
 if s.lease_expires_at is null or s.lease_expires_at<=clock_timestamp() then raise exception 'WORKER_UNAVAILABLE'; end if;
 if p_action='getCliLoginChallenge' then
  if s.state<>'awaiting_code' then raise exception 'CONNECTION_CHANGED'; end if;
  return jsonb_build_object('sessionId',s.id,'connectionRevision',s.connection_revision,'challengeId',s.challenge_id,'keyId',s.key_id,
    'authorizationUrl',s.authorization_url,'publicKeyJwk',s.public_key_jwk,'expiresAt',s.challenge_expires_at);
 end if;
 if p_action='submitCliLoginCode' then
  envelope:=p_body->'envelope';hash:=encode(extensions.digest(envelope::text,'sha256'),'hex');
  if s.challenge_id is distinct from (p_body->>'challengeId')::uuid or s.key_id is distinct from (envelope->>'keyId')::uuid then raise exception 'CONNECTION_CHANGED'; end if;
  if s.submission_id is not null then
   if s.submission_id is distinct from (p_body->>'submissionId')::uuid or s.envelope_digest<>hash then raise exception 'REQUEST_ID_CONFLICT'; end if;
   return jsonb_build_object('session',private.cli_login_view(s.id));
  end if;
  if s.state<>'awaiting_code' or s.challenge_expires_at<=clock_timestamp() then raise exception 'LOGIN_EXPIRED'; end if;
  insert into private.cli_login_envelopes(session_id,challenge_id,submission_id,envelope,envelope_digest)
    values(s.id,s.challenge_id,(p_body->>'submissionId')::uuid,envelope,hash);
  update private.cli_login_sessions set state='code_received',submission_id=(p_body->>'submissionId')::uuid,envelope_digest=hash,phase_version=phase_version+1,updated_at=clock_timestamp() where id=s.id;
  return jsonb_build_object('session',private.cli_login_view(s.id));
 end if;
 raise exception 'UNSUPPORTED_CAPABILITY';
end $$;

create function public.cli_onboarding_worker_action(p_host uuid,p_action text,p_body jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h private.cli_hosts; s private.cli_login_sessions; c private.cli_connections; cfg private.cli_onboarding_config; token uuid; v_id uuid; result text; payload jsonb;
begin
 perform pg_advisory_xact_lock(732184621094::bigint);
 perform private.cli_expire_logins();
 select * into h from private.cli_hosts where id=p_host and enabled for update;
 if h.id is null then raise exception 'UNAUTHENTICATED'; end if;
 select * into cfg from private.cli_onboarding_config where host_id=h.id;
 if p_action='getLoginAssignment' then
  select * into s from private.cli_login_sessions where id=h.active_login_id;
  return jsonb_build_object('login',case when s.id is not null then jsonb_build_object('sessionId',s.id,'containerRef',s.container_ref,'containerKind',s.container_kind,'runtimeRef',s.runtime_ref,'recoveryRequired',true) end);
 end if;
 if p_action='claimLogin' then
  if h.active_login_id is not null then return public.cli_onboarding_worker_action(p_host,'getLoginAssignment','{}'); end if;
  if h.active_job_id is not null or h.active_setup_id is not null or h.status<>'ready' or not coalesce(cfg.enabled,false) or h.login_protocol is distinct from cfg.protocol then return jsonb_build_object('login',null); end if;
  update private.cli_login_sessions set state='queued',queue_deadline_at=clock_timestamp()+interval '360 seconds',phase_version=phase_version+1
    where host_id=h.id and state='waiting_for_host' and completed_at is null;
  select * into s from private.cli_login_sessions where host_id=h.id and state='queued' and completed_at is null order by created_at,id limit 1;
  if s.id is null then return jsonb_build_object('login',null); end if;
  if not s.owner_id=any(cfg.allowed_owners) or s.login_manifest_digest<>cfg.login_manifest_digest or not h.manifests ? s.manifest_digest then
   perform private.cli_end_login(s.id,'failed','MANIFEST_MISMATCH');return jsonb_build_object('login',null); end if;
  token:=gen_random_uuid();
  update private.cli_login_sessions set state='starting',native_started_at=clock_timestamp(),lease_hash=encode(extensions.digest(token::text,'sha256'),'hex'),lease_expires_at=clock_timestamp()+interval '60 seconds',last_worker_seen_at=clock_timestamp(),phase_version=phase_version+1 where id=s.id;
  update private.cli_hosts set active_login_id=s.id,last_seen_at=clock_timestamp() where id=h.id;
  return jsonb_build_object('login',jsonb_build_object('sessionId',s.id,'connectionId',s.connection_id,'connectionRevision',s.connection_revision,'kind',s.kind,'runtimeRef',s.runtime_ref,
    'manifestDigest',s.manifest_digest,'loginManifestDigest',s.login_manifest_digest,'leaseToken',token));
 end if;
 select * into s from private.cli_login_sessions where id=(p_body->>'sessionId')::uuid and host_id=h.id;
 if s.id is null then raise exception 'NOT_FOUND'; end if;
 if p_action='reconcileLogin' then
  if h.active_login_id is distinct from s.id then return jsonb_build_object('acknowledged',s.completed_at is not null); end if;
  if p_body->>'stopped'<>'true' then update private.cli_hosts set status='quarantined' where id=h.id;return jsonb_build_object('acknowledged',false);end if;
  perform private.cli_end_login(s.id,'failed','WORKER_LOST');
  update private.cli_hosts set active_login_id=null where id=h.id;
  update private.cli_login_sessions set lease_hash=null,lease_expires_at=null where id=s.id;
  return jsonb_build_object('acknowledged',true);
 end if;
 if s.lease_hash is distinct from encode(extensions.digest(p_body->>'leaseToken','sha256'),'hex') then raise exception 'CONNECTION_CHANGED'; end if;
 if p_action='completeLogin' and s.completion_digest is not null then
  if s.completion_digest is distinct from p_body->>'receiptDigest' then raise exception 'REQUEST_ID_CONFLICT';end if;
  return jsonb_build_object('acknowledged',true,'state',s.state);
 end if;
 if h.active_login_id is distinct from s.id then raise exception 'CONNECTION_CHANGED'; end if;
 if p_action='heartbeatLogin' then
  if s.completed_at is not null or h.status<>'ready' or not coalesce(cfg.enabled,false) or not s.owner_id=any(cfg.allowed_owners) then return jsonb_build_object('stop',true,'reason',coalesce(s.error_code,'ACCESS_REVOKED'));end if;
  update private.cli_login_sessions set lease_expires_at=clock_timestamp()+interval '60 seconds',last_worker_seen_at=clock_timestamp() where id=s.id;
  update private.cli_hosts set last_seen_at=clock_timestamp() where id=h.id;
  select envelope into payload from private.cli_login_envelopes where session_id=s.id;
  return jsonb_build_object('stop',false,'state',s.state,'submissionId',s.submission_id,'challengeId',s.challenge_id,'envelope',payload);
 end if;
 if p_action='completeLogin' then
  if p_body->>'stopped'<>'true' then raise exception 'STOP_UNCONFIRMED'; end if;
  result:=p_body->>'outcome';
  if s.completed_at is null and s.lease_expires_at>clock_timestamp() and h.status='ready' then
   select * into c from private.cli_connections where id=s.connection_id and revision=s.connection_revision;
   if c.id is null or c.host_id is distinct from h.id or c.runtime_ref<>s.runtime_ref then perform private.cli_end_login(s.id,'cancelled','CONNECTION_CHANGED');
   elsif not coalesce(cfg.enabled and s.owner_id=any(cfg.allowed_owners),false) or cfg.login_manifest_digest is distinct from s.login_manifest_digest then
    perform private.cli_end_login(s.id,'cancelled','ACCESS_REVOKED');
   elsif result='succeeded' and s.state='verifying' and s.container_kind='login_verification'
     and s.container_ref='cli-login-'||s.id::text||'-verify'
     and exists(select 1 from private.cli_providers where provider_id='gemini' and enabled and manifest_digest=s.manifest_digest) then
    update private.cli_connections set status='connected',native_authenticated_at=coalesce(native_authenticated_at,clock_timestamp()),last_verified_at=clock_timestamp(),verification_status='passed',verified_manifest_digest=s.manifest_digest,updated_at=clock_timestamp() where id=c.id;
    insert into private.cli_connection_verifications(session_id,connection_id,revision,runtime_ref,manifest_digest,receipt_digest,outcome) values(s.id,c.id,c.revision,s.runtime_ref,s.manifest_digest,p_body->>'receiptDigest',result);
    perform private.cli_end_login(s.id,'succeeded',null);
   elsif result in('quota_blocked','plan_blocked') and s.state='verifying' then
    update private.cli_connections set status='pending_setup',native_authenticated_at=coalesce(native_authenticated_at,clock_timestamp()),verification_status=result where id=c.id;
    perform private.cli_end_login(s.id,'verification_blocked',case when result='quota_blocked' then 'QUOTA_EXCEEDED' else 'PLAN_REQUIRED' end);
   else
    if p_body->>'errorCode'='AUTH_REQUIRED' then update private.cli_connections set status='reauth_required',native_authenticated_at=null,verification_status='failed' where id=c.id;end if;
    perform private.cli_end_login(s.id,'failed',coalesce(p_body->>'errorCode','CLI_FAILED'));
   end if;
  end if;
  if (select completed_at from private.cli_login_sessions where id=s.id) is null then perform private.cli_end_login(s.id,'failed','WORKER_LOST');end if;
  update private.cli_login_sessions set completion_digest=p_body->>'receiptDigest' where id=s.id;
  update private.cli_hosts set active_login_id=null,last_seen_at=clock_timestamp() where id=h.id;
  -- Keep only hashed lease for an idempotent stopped-completion receipt.
  return jsonb_build_object('acknowledged',true,'state',(select state from private.cli_login_sessions where id=s.id));
 end if;
 if s.completed_at is not null or s.lease_expires_at<=clock_timestamp() or h.status<>'ready' then raise exception 'LOGIN_EXPIRED';end if;
 if p_action='registerLoginContainer' then
  if p_body->>'containerKind' not in('login','login_verification') or p_body->>'containerRef'<>'cli-login-'||s.id::text||(case when p_body->>'containerKind'='login' then '-auth' else '-verify' end) then raise exception 'INVALID_INPUT'; end if;
  if s.container_ref is not null and p_body->>'previousStopped'<>'true' then raise exception 'STOP_UNCONFIRMED';end if;
  update private.cli_login_sessions set container_ref=p_body->>'containerRef',container_kind=p_body->>'containerKind' where id=s.id;
  return jsonb_build_object('authorized',true);
 elsif p_action='publishLoginChallenge' then
  if s.state<>'starting' or s.kind<>'interactive_login' or s.container_kind<>'login' then raise exception 'CONNECTION_CHANGED';end if;
  update private.cli_login_sessions set state='awaiting_code',challenge_id=(p_body->>'challengeId')::uuid,key_id=(p_body->>'keyId')::uuid,
    authorization_url=p_body->>'authorizationUrl',public_key_jwk=p_body->'publicKeyJwk',challenge_expires_at=least((p_body->>'expiresAt')::timestamptz,s.native_started_at+interval '300 seconds'),phase_version=phase_version+1 where id=s.id;
  return jsonb_build_object('acknowledged',true);
 elsif p_action='consumeLoginCode' then
  if s.state='authenticating' and s.submission_id=(p_body->>'submissionId')::uuid then return jsonb_build_object('acknowledged',true,'alreadyConsumed',true);end if;
  if s.state<>'code_received' or s.submission_id is distinct from (p_body->>'submissionId')::uuid then raise exception 'CONNECTION_CHANGED';end if;
  delete from private.cli_login_envelopes where session_id=s.id;
  update private.cli_login_sessions set state='authenticating',consumed_at=clock_timestamp(),phase_version=phase_version+1 where id=s.id;
  return jsonb_build_object('acknowledged',true,'alreadyConsumed',false);
 elsif p_action='beginLoginVerification' then
  if s.state not in('starting','authenticating') then raise exception 'CONNECTION_CHANGED';end if;
  update private.cli_login_sessions set state='verifying',authorization_url=null,public_key_jwk=null,key_id=null,verify_deadline_at=clock_timestamp()+interval '90 seconds',phase_version=phase_version+1 where id=s.id;
  update private.cli_connections set native_authenticated_at=clock_timestamp() where id=s.connection_id and revision=s.connection_revision;
  return jsonb_build_object('acknowledged',true);
 end if;
 raise exception 'UNSUPPORTED_CAPABILITY';
end $$;

-- Wrap reviewed inference RPCs instead of copying historical implementations.
alter function public.cli_user_action(uuid,text,jsonb) rename to cli_user_action_legacy;
alter function public.cli_user_action_legacy(uuid,text,jsonb) set schema private;
create function public.cli_user_action(p_user uuid,p_action text,p_body jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c private.cli_connections;
begin
 perform pg_advisory_xact_lock(732184621094::bigint);
 if p_action='requestCliConnection' and p_body->>'provider'='gemini' and exists(select 1 from private.cli_onboarding_config where enabled) then raise exception 'ONBOARDING_REQUIRED';end if;
 if p_action='createCliJob' then
  select * into c from private.cli_connections where id=(p_body->>'connectionId')::uuid and owner_id=p_user;
  -- Preserve legacy idempotent result lookup before new-admission checks.
  if c.provider_id='gemini' and exists(select 1 from private.cli_onboarding_config where host_id=c.host_id and enabled)
   and not exists(select 1 from public.generation_jobs where owner_id=p_user and idempotency_key=(p_body->>'requestId')::uuid)
   and (c.verification_status<>'passed' or c.verified_manifest_digest is distinct from (select manifest_digest from private.cli_providers where provider_id='gemini')) then raise exception 'CONNECTION_CHANGED';end if;
 end if;
 if p_action='disconnectCliConnection' then
  select * into c from private.cli_connections where id=(p_body->>'connectionId')::uuid and owner_id=p_user;
  if c.id is not null then
   perform private.cli_end_login(id,'cancelled','CONNECTION_CHANGED') from private.cli_login_sessions where connection_id=c.id and completed_at is null;
   update private.cli_connections set native_authenticated_at=null,verification_status='not_checked' where id=c.id;
  end if;
 end if;
 return private.cli_user_action_legacy(p_user,p_action,p_body);
end $$;
alter function public.cli_worker_action(uuid,text,jsonb) rename to cli_worker_action_legacy;
alter function public.cli_worker_action_legacy(uuid,text,jsonb) set schema private;
create function public.cli_worker_action(p_host uuid,p_action text,p_body jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(732184621094::bigint);
 if p_action='heartbeatHost' then update private.cli_hosts set login_protocol=p_body->>'loginProtocol',setup_protocol=p_body->>'setupProtocol' where id=p_host;end if;
 if p_action='claim' and exists(select 1 from private.cli_hosts where id=p_host and (active_login_id is not null or active_setup_id is not null)) then return jsonb_build_object('job',null);end if;
 if p_action='reportConnection' and p_body->>'status'='connected' and exists(select 1 from private.cli_connections c join private.cli_onboarding_config cfg on cfg.host_id=c.host_id where c.id=(p_body->>'connectionId')::uuid and c.provider_id='gemini' and cfg.enabled) then raise exception 'ONBOARDING_REQUIRED';end if;
 if p_action='reportConnection' and exists(select 1 from private.cli_login_sessions s join private.cli_hosts h on h.active_login_id=s.id where s.connection_id=(p_body->>'connectionId')::uuid) then raise exception 'CONNECTION_BUSY';end if;
 return private.cli_worker_action_legacy(p_host,p_action,p_body);
end $$;
alter function public.cli_maintenance() rename to cli_maintenance_legacy;
alter function public.cli_maintenance_legacy() set schema private;
create function public.cli_maintenance() returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(732184621094::bigint);
 perform private.cli_expire_logins();
 return private.cli_maintenance_legacy();
end $$;
revoke all on function public.cli_onboarding_user_action(uuid,text,jsonb),public.cli_onboarding_worker_action(uuid,text,jsonb),public.cli_user_action(uuid,text,jsonb),public.cli_worker_action(uuid,text,jsonb),public.cli_maintenance(),private.cli_end_login(uuid,text,text),private.cli_expire_logins(),private.cli_login_view(uuid),private.cli_user_action_legacy(uuid,text,jsonb),private.cli_worker_action_legacy(uuid,text,jsonb),private.cli_maintenance_legacy() from public,anon,authenticated;
grant execute on function public.cli_onboarding_user_action(uuid,text,jsonb),public.cli_onboarding_worker_action(uuid,text,jsonb),public.cli_user_action(uuid,text,jsonb),public.cli_worker_action(uuid,text,jsonb),public.cli_maintenance(),private.cli_end_login(uuid,text,text),private.cli_expire_logins(),private.cli_login_view(uuid),private.cli_user_action_legacy(uuid,text,jsonb),private.cli_worker_action_legacy(uuid,text,jsonb),private.cli_maintenance_legacy() to service_role;
