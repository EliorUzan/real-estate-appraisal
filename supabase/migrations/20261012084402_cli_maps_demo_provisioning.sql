-- Optional administrator-only demo credential provisioning. Never enables MCP jobs.
alter table private.cli_onboarding_config add column operator_owners uuid[] not null default '{}',
 add column maps_provisioning_enabled boolean not null default false,add column maps_credential_version integer not null default 0;
create table private.cli_setup_sessions (
 id uuid primary key default gen_random_uuid(),host_id uuid not null references private.cli_hosts(id),
 owner_id uuid not null references auth.users(id),request_id uuid not null,kind text not null check(kind in('maps-demo','remove-maps')),
 state text not null check(state in('queued','awaiting_key','key_received','verifying','succeeded','cancelled','failed','expired')),
 version integer not null,phase_version integer not null default 1,
 created_at timestamptz not null default clock_timestamp(),deadline_at timestamptz not null,completed_at timestamptz,
 challenge_id uuid,key_id uuid,public_key_jwk jsonb,submission_id uuid,envelope_digest text,envelope jsonb,
 lease_hash text,lease_expires_at timestamptz,receipt_digest text,error_code text,
 unique(owner_id,request_id),check(envelope is null or octet_length(envelope::text)<=15000)
);
create unique index cli_setup_one_active_host on private.cli_setup_sessions(host_id) where completed_at is null;
create index cli_setup_owner on private.cli_setup_sessions(owner_id,created_at);
alter table private.cli_hosts add constraint cli_active_setup_fk foreign key(active_setup_id) references private.cli_setup_sessions(id);
create index cli_hosts_active_login_idx on private.cli_hosts(active_login_id);
create index cli_hosts_active_setup_idx on private.cli_hosts(active_setup_id);
alter table private.cli_setup_sessions enable row level security;
revoke all on private.cli_setup_sessions from public,anon,authenticated;
grant all on private.cli_setup_sessions to service_role;
create function private.cli_setup_view(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',id,'kind',kind,'state',state,'version',version,'phaseVersion',phase_version,'expiresAt',deadline_at,
  'errorCode',error_code,'canSubmitKey',state='awaiting_key' and completed_at is null and deadline_at>clock_timestamp() and lease_expires_at>clock_timestamp())
 from private.cli_setup_sessions where id=p_id
$$;
create function private.cli_expire_setups() returns void language plpgsql security invoker set search_path='' as $$
begin
 update private.cli_setup_sessions s set state='expired',error_code='SETUP_EXPIRED',completed_at=clock_timestamp(),phase_version=phase_version+1,envelope=null,public_key_jwk=null,key_id=null
 where completed_at is null and (deadline_at<=clock_timestamp() or lease_expires_at<=clock_timestamp() or not exists(
   select 1 from private.cli_onboarding_config cfg where cfg.host_id=s.host_id and cfg.maps_provisioning_enabled and s.owner_id=any(cfg.operator_owners))
   or not exists(select 1 from public.workspace_members m join public.workspaces w on w.id=m.workspace_id where m.user_id=s.owner_id and m.status='active' and w.status='active'));
 delete from private.cli_setup_sessions s where completed_at<clock_timestamp()-interval '7 days' and not exists(select 1 from private.cli_hosts h where h.active_setup_id=s.id);
end $$;
create function public.cli_maps_user_action(p_user uuid,p_action text,p_body jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare cfg private.cli_onboarding_config; h private.cli_hosts; s private.cli_setup_sessions; hash text;
begin
 perform pg_advisory_xact_lock(732184621094::bigint);perform private.cli_expire_setups();
 select * into h from private.cli_hosts where enabled;select * into cfg from private.cli_onboarding_config where host_id=h.id;
 if not exists(select 1 from public.workspace_members m join public.workspaces w on w.id=m.workspace_id where m.user_id=p_user and m.status='active' and w.status='active') then raise exception 'INACTIVE_MEMBERSHIP';end if;
 if p_action='getMapsDemoSetup' then
  if not coalesce(p_user=any(cfg.operator_owners),false) then return jsonb_build_object('operator',false,'status',coalesce(cfg.maps_status,'not_configured'),'session',null,'canProvision',false);end if;
  select * into s from private.cli_setup_sessions where host_id=h.id and owner_id=p_user order by created_at desc limit 1;
  return jsonb_build_object('operator',true,'status',cfg.maps_status,'session',private.cli_setup_view(s.id),
    'canProvision',cfg.maps_provisioning_enabled and h.setup_protocol='maps-setup-v1' and h.status='ready' and h.last_seen_at>clock_timestamp()-interval '30 seconds');
 end if;
 if not coalesce(cfg.maps_provisioning_enabled and p_user=any(cfg.operator_owners),false) then raise exception 'OPERATOR_REQUIRED';end if;
 if p_action in('startMapsDemoSetup','removeMapsDemoKey') then
  select * into s from private.cli_setup_sessions where owner_id=p_user and request_id=(p_body->>'requestId')::uuid;
  if s.id is not null then
   if s.kind<>(case when p_action='removeMapsDemoKey' then 'remove-maps' else 'maps-demo' end) then raise exception 'REQUEST_ID_CONFLICT';end if;
   return jsonb_build_object('session',private.cli_setup_view(s.id));end if;
  select * into s from private.cli_setup_sessions where host_id=h.id and completed_at is null;
  if s.id is not null then
   if s.kind<>(case when p_action='removeMapsDemoKey' then 'remove-maps' else 'maps-demo' end) then raise exception 'CONNECTION_BUSY';end if;
   return jsonb_build_object('session',private.cli_setup_view(s.id));end if;
  if h.setup_protocol is distinct from 'maps-setup-v1' or h.status<>'ready' or h.last_seen_at<=clock_timestamp()-interval '30 seconds' then raise exception 'WORKER_UNAVAILABLE';end if;
  if (select count(*) from private.cli_setup_sessions where owner_id=p_user and created_at>clock_timestamp()-interval '1 hour')>=10 then raise exception 'QUEUE_FULL';end if;
  insert into private.cli_setup_sessions(host_id,owner_id,request_id,kind,state,version,deadline_at)
   values(h.id,p_user,(p_body->>'requestId')::uuid,case when p_action='removeMapsDemoKey' then 'remove-maps' else 'maps-demo' end,'queued',cfg.maps_credential_version+1,clock_timestamp()+interval '6 minutes') returning * into s;
  if p_action='removeMapsDemoKey' then update private.cli_onboarding_config set maps_status='not_configured' where host_id=h.id;end if;
  return jsonb_build_object('session',private.cli_setup_view(s.id));
 end if;
 select * into s from private.cli_setup_sessions where id=(p_body->>'sessionId')::uuid and owner_id=p_user;
 if s.id is null then raise exception 'NOT_FOUND';end if;
 if p_action='cancelMapsDemoSetup' then
  update private.cli_setup_sessions set state='cancelled',error_code='CANCELLED',completed_at=clock_timestamp(),phase_version=phase_version+1,envelope=null,public_key_jwk=null,key_id=null where id=s.id and completed_at is null;
  return jsonb_build_object('session',private.cli_setup_view(s.id));
 elsif p_action='getMapsDemoChallenge' then
  if s.state<>'awaiting_key' or s.completed_at is not null or s.lease_expires_at<=clock_timestamp() then raise exception 'SETUP_EXPIRED';end if;
  return jsonb_build_object('sessionId',s.id,'connectionRevision',s.version,'challengeId',s.challenge_id,'keyId',s.key_id,'publicKeyJwk',s.public_key_jwk,'expiresAt',s.deadline_at);
 elsif p_action='submitMapsDemoKey' then
  hash:=encode(extensions.digest((p_body->'envelope')::text,'sha256'),'hex');
  if s.submission_id is not null then
   if s.challenge_id is distinct from (p_body->>'challengeId')::uuid or s.submission_id is distinct from (p_body->>'submissionId')::uuid or s.envelope_digest<>hash then raise exception 'REQUEST_ID_CONFLICT';end if;
   return jsonb_build_object('session',private.cli_setup_view(s.id));end if;
  if s.kind<>'maps-demo' or s.state<>'awaiting_key' or s.completed_at is not null or s.lease_expires_at<=clock_timestamp() then raise exception 'SETUP_EXPIRED';end if;
  if s.challenge_id is distinct from (p_body->>'challengeId')::uuid or s.key_id is distinct from (p_body->'envelope'->>'keyId')::uuid then raise exception 'CONNECTION_CHANGED';end if;
  update private.cli_setup_sessions set envelope=p_body->'envelope',envelope_digest=hash,submission_id=(p_body->>'submissionId')::uuid,state='key_received',phase_version=phase_version+1 where id=s.id;
  return jsonb_build_object('session',private.cli_setup_view(s.id));
 end if;
 raise exception 'UNSUPPORTED_CAPABILITY';
end $$;
create function public.cli_maps_worker_action(p_host uuid,p_action text,p_body jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h private.cli_hosts; cfg private.cli_onboarding_config; s private.cli_setup_sessions; token uuid;
begin
 perform pg_advisory_xact_lock(732184621094::bigint);perform private.cli_expire_setups();
 select * into h from private.cli_hosts where id=p_host and enabled for update;if h.id is null then raise exception 'UNAUTHENTICATED';end if;
 select * into cfg from private.cli_onboarding_config where host_id=h.id;
 if p_action='getSetupAssignment' then select * into s from private.cli_setup_sessions where id=h.active_setup_id;
  return jsonb_build_object('setup',case when s.id is not null then jsonb_build_object('sessionId',s.id,'version',s.version,'kind',s.kind,'recoveryRequired',true) end);
 elsif p_action='claimSetup' then
  if h.active_setup_id is not null then return public.cli_maps_worker_action(p_host,'getSetupAssignment','{}');end if;
  if h.active_job_id is not null or h.active_login_id is not null or h.status<>'ready' or h.setup_protocol is distinct from 'maps-setup-v1' then return jsonb_build_object('setup',null);end if;
  select * into s from private.cli_setup_sessions where host_id=h.id and state='queued' and completed_at is null order by created_at limit 1;
  if s.id is null then return jsonb_build_object('setup',null);end if;
  token:=gen_random_uuid();update private.cli_setup_sessions set lease_hash=encode(extensions.digest(token::text,'sha256'),'hex'),lease_expires_at=clock_timestamp()+interval '60 seconds' where id=s.id;
  update private.cli_hosts set active_setup_id=s.id where id=h.id;
  return jsonb_build_object('setup',jsonb_build_object('sessionId',s.id,'version',s.version,'kind',s.kind,'leaseToken',token));
 end if;
 select * into s from private.cli_setup_sessions where id=(p_body->>'sessionId')::uuid and host_id=h.id;if s.id is null then raise exception 'NOT_FOUND';end if;
 if p_action='reconcileSetup' then
  if h.active_setup_id is distinct from s.id then return jsonb_build_object('acknowledged',s.completed_at is not null,'state',s.state);end if;
  if p_body->>'exclusive'<>'true' then raise exception 'STOP_UNCONFIRMED';end if;
  update private.cli_setup_sessions set state='failed',error_code='WORKER_LOST',completed_at=clock_timestamp(),phase_version=phase_version+1,envelope=null,public_key_jwk=null,key_id=null where id=s.id and completed_at is null;
  update private.cli_hosts set active_setup_id=null where id=h.id;return jsonb_build_object('acknowledged',true,'state',(select state from private.cli_setup_sessions where id=s.id));
 end if;
 if s.lease_hash is distinct from encode(extensions.digest(p_body->>'leaseToken','sha256'),'hex') then raise exception 'CONNECTION_CHANGED';end if;
 if p_action='completeSetup' and s.receipt_digest is not null then
  if s.receipt_digest<>p_body->>'receiptDigest' then raise exception 'REQUEST_ID_CONFLICT';end if;return jsonb_build_object('acknowledged',true,'state',s.state);end if;
 if h.active_setup_id is distinct from s.id then raise exception 'CONNECTION_CHANGED';end if;
 if p_action='completeSetup' then
  if p_body->>'exclusive'<>'true' then raise exception 'STOP_UNCONFIRMED';end if;
  if s.completed_at is null and s.lease_expires_at>clock_timestamp() and h.status='ready' then
   if p_body->>'outcome'='saved' and s.state='verifying' then
    update private.cli_onboarding_config set maps_status='compatibility_pending',maps_credential_version=s.version where host_id=h.id;
   elsif p_body->>'outcome'='removed' and s.kind='remove-maps' then update private.cli_onboarding_config set maps_status='not_configured' where host_id=h.id;
   elsif p_body->>'outcome'<>'failed' then raise exception 'CONNECTION_CHANGED';end if;
   update private.cli_setup_sessions set state=case when p_body->>'outcome' in('saved','removed') then 'succeeded' else 'failed' end,
     error_code=p_body->>'errorCode',completed_at=clock_timestamp(),phase_version=phase_version+1 where id=s.id;
  end if;
  update private.cli_setup_sessions set envelope=null,public_key_jwk=null,key_id=null,receipt_digest=p_body->>'receiptDigest' where id=s.id;
  update private.cli_hosts set active_setup_id=null where id=h.id;return jsonb_build_object('acknowledged',true,'state',(select state from private.cli_setup_sessions where id=s.id));
 end if;
 if s.completed_at is not null or s.lease_expires_at<=clock_timestamp() or h.status<>'ready' then raise exception 'SETUP_EXPIRED';end if;
 if p_action='heartbeatSetup' then
  update private.cli_setup_sessions set lease_expires_at=clock_timestamp()+interval '60 seconds' where id=s.id;
  update private.cli_hosts set last_seen_at=clock_timestamp() where id=h.id;
  return jsonb_build_object('state',s.state,'submissionId',s.submission_id,'envelope',s.envelope);
 elsif p_action='publishSetupChallenge' then
  if s.state<>'queued' or s.kind<>'maps-demo' then raise exception 'CONNECTION_CHANGED';end if;
  update private.cli_setup_sessions set state='awaiting_key',challenge_id=(p_body->>'challengeId')::uuid,key_id=(p_body->>'keyId')::uuid,public_key_jwk=p_body->'publicKeyJwk',deadline_at=least(deadline_at,clock_timestamp()+interval '180 seconds'),phase_version=phase_version+1 where id=s.id;
  return jsonb_build_object('acknowledged',true);
 elsif p_action='consumeSetupSecret' then
  if s.state='verifying' and s.submission_id=(p_body->>'submissionId')::uuid then return jsonb_build_object('acknowledged',true,'alreadyConsumed',true);end if;
  if s.state<>'key_received' or s.submission_id is distinct from (p_body->>'submissionId')::uuid then raise exception 'CONNECTION_CHANGED';end if;
  update private.cli_setup_sessions set state='verifying',envelope=null,phase_version=phase_version+1 where id=s.id;
  return jsonb_build_object('acknowledged',true,'alreadyConsumed',false);
 end if;
 raise exception 'UNSUPPORTED_CAPABILITY';
end $$;
revoke all on function private.cli_setup_view(uuid),private.cli_expire_setups(),public.cli_maps_user_action(uuid,text,jsonb),public.cli_maps_worker_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.cli_setup_view(uuid),private.cli_expire_setups(),public.cli_maps_user_action(uuid,text,jsonb),public.cli_maps_worker_action(uuid,text,jsonb) to service_role;
-- Existing minute schedule also scrubs abandoned sealed Maps payloads offline.
create or replace function public.cli_maintenance() returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(732184621094::bigint);
 perform private.cli_expire_logins();perform private.cli_expire_setups();
 return private.cli_maintenance_legacy();
end $$;
