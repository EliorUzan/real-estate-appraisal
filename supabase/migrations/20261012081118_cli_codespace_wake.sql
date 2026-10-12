alter table private.cli_onboarding_config add column wake_enabled boolean not null default false;
create table private.cli_host_wakes (
 host_id uuid primary key references private.cli_hosts(id), operation_id uuid not null unique default gen_random_uuid(),
 requested_by uuid not null references auth.users(id), request_id uuid not null,
 state text not null check(state in('requested','starting','ready','failed')),
 created_at timestamptz not null default clock_timestamp(), deadline_at timestamptz not null,
 start_requested_at timestamptz, lease_token uuid, lease_expires_at timestamptz, error_code text,
 check((lease_token is null)=(lease_expires_at is null))
);
create index cli_host_wakes_requester on private.cli_host_wakes(requested_by);
alter table private.cli_host_wakes enable row level security;
revoke all on private.cli_host_wakes from public,anon,authenticated;
grant all on private.cli_host_wakes to service_role;
create function public.cli_host_wake_user_action(p_user uuid,p_action text,p_body jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h private.cli_hosts; cfg private.cli_onboarding_config; operation private.cli_host_wakes;
begin
 perform pg_advisory_xact_lock(732184621094::bigint);
 select * into h from private.cli_hosts where enabled;
 select * into cfg from private.cli_onboarding_config where host_id=h.id;
 if not exists(select 1 from public.workspace_members m join public.workspaces w on w.id=m.workspace_id where m.user_id=p_user and m.status='active' and w.status='active') then raise exception 'INACTIVE_MEMBERSHIP';end if;
 select * into operation from private.cli_host_wakes where host_id=h.id;
 if p_action='getCliHostWake' then
  return jsonb_build_object('permitted',coalesce(cfg.wake_enabled and p_user=any(cfg.allowed_owners),false),
    'state',coalesce(operation.state,'idle'),'errorCode',operation.error_code,'deadlineAt',operation.deadline_at);
 end if;
 if p_action<>'ensureCliHostReady' then raise exception 'UNSUPPORTED_CAPABILITY';end if;
 if not coalesce(cfg.wake_enabled and p_user=any(cfg.allowed_owners),false) then raise exception 'HOST_WAKE_NOT_CONFIGURED';end if;
 if h.status<>'ready' or h.active_job_id is not null or h.active_login_id is not null or h.active_setup_id is not null then raise exception 'HOST_RECOVERY_REQUIRED';end if;
 if not exists(select 1 from private.cli_connections c where c.host_id=h.id and c.owner_id=p_user and c.provider_id='gemini' and c.status='connected')
   and not exists(select 1 from private.cli_login_sessions s where s.host_id=h.id and s.owner_id=p_user and s.state='waiting_for_host' and s.completed_at is null) then raise exception 'CONNECTION_CHANGED';end if;
 if h.last_seen_at>clock_timestamp()-interval '30 seconds' then return jsonb_build_object('state','ready');end if;
 if operation.state in('requested','starting') and operation.deadline_at>clock_timestamp() then return jsonb_build_object('state',operation.state);end if;
 if operation.requested_by=p_user and operation.request_id=(p_body->>'requestId')::uuid then return jsonb_build_object('state',operation.state,'errorCode',operation.error_code);end if;
 insert into private.cli_host_wakes(host_id,requested_by,request_id,state,deadline_at)
 values(h.id,p_user,(p_body->>'requestId')::uuid,'requested',clock_timestamp()+interval '180 seconds')
 on conflict(host_id) do update set operation_id=gen_random_uuid(),requested_by=excluded.requested_by,request_id=excluded.request_id,
   state='requested',created_at=clock_timestamp(),deadline_at=excluded.deadline_at,start_requested_at=null,lease_token=null,lease_expires_at=null,error_code=null;
 return jsonb_build_object('state','requested');
end $$;
create function public.cli_host_wake_control(p_action text,p_body jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare operation private.cli_host_wakes; h private.cli_hosts; token uuid;
begin
 perform pg_advisory_xact_lock(732184621094::bigint);
 update private.cli_host_wakes set state='failed',error_code='HOST_START_TIMEOUT',lease_token=null,lease_expires_at=null where state in('requested','starting') and deadline_at<=clock_timestamp();
 if p_action='claim' then
  select * into operation from private.cli_host_wakes where state in('requested','starting') and (lease_expires_at is null or lease_expires_at<=clock_timestamp()) order by created_at limit 1;
  if operation.host_id is null then return jsonb_build_object('wake',null);end if;
  token:=gen_random_uuid();update private.cli_host_wakes set lease_token=token,lease_expires_at=clock_timestamp()+interval '60 seconds' where host_id=operation.host_id;
  return jsonb_build_object('wake',jsonb_build_object('operationId',operation.operation_id,'leaseToken',token,'startRequested',operation.start_requested_at is not null));
 end if;
 select * into operation from private.cli_host_wakes where operation_id=(p_body->>'operationId')::uuid and lease_token=(p_body->>'leaseToken')::uuid and lease_expires_at>clock_timestamp() and state in('requested','starting');
 if operation.host_id is null then raise exception 'CONNECTION_CHANGED';end if;
 select * into h from private.cli_hosts where id=operation.host_id;
 if h.status<>'ready' or not h.enabled then
  update private.cli_host_wakes set state='failed',error_code='HOST_RECOVERY_REQUIRED',lease_token=null,lease_expires_at=null where host_id=h.id;
  return jsonb_build_object('state','failed');
 end if;
 if p_action='markStart' then
  if operation.start_requested_at is not null then return jsonb_build_object('authorized',false);end if;
  update private.cli_host_wakes set start_requested_at=clock_timestamp(),state='starting' where host_id=h.id;
  return jsonb_build_object('authorized',true);
 elsif p_action='finish' then
  update private.cli_host_wakes set state=case when p_body->>'errorCode' is not null then 'failed'
   when h.last_seen_at>clock_timestamp()-interval '30 seconds' and h.manifests ? (select manifest_digest from private.cli_providers where provider_id='gemini' and enabled) then 'ready' else 'starting' end,
   error_code=p_body->>'errorCode',lease_token=null,lease_expires_at=null where host_id=h.id returning * into operation;
  return jsonb_build_object('state',operation.state,'errorCode',operation.error_code);
 end if;
 raise exception 'UNSUPPORTED_CAPABILITY';
end $$;
revoke all on function public.cli_host_wake_user_action(uuid,text,jsonb),public.cli_host_wake_control(text,jsonb) from public,anon,authenticated;
grant execute on function public.cli_host_wake_user_action(uuid,text,jsonb),public.cli_host_wake_control(text,jsonb) to service_role;
