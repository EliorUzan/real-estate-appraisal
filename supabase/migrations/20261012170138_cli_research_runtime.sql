-- Give Google research a ten-minute maximum; native research stops at 570s.
-- Existing leases, ownership checks, cancellation and at-most-once start remain intact.
create or replace function public.cli_worker_action(p_host uuid,p_action text,p_body jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_result jsonb;
begin
 perform pg_advisory_xact_lock(732184621094::bigint);
 if p_action='heartbeatHost' then update private.cli_hosts set login_protocol=p_body->>'loginProtocol',setup_protocol=p_body->>'setupProtocol' where id=p_host;end if;
 if p_action='claim' and exists(select 1 from private.cli_hosts where id=p_host and (active_login_id is not null or active_setup_id is not null)) then return jsonb_build_object('job',null);end if;
 if p_action='reportConnection' and p_body->>'status'='connected' and exists(select 1 from private.cli_connections c join private.cli_onboarding_config cfg on cfg.host_id=c.host_id where c.id=(p_body->>'connectionId')::uuid and c.provider_id='gemini' and cfg.enabled) then raise exception 'ONBOARDING_REQUIRED';end if;
 if p_action='reportConnection' and exists(select 1 from private.cli_login_sessions s join private.cli_hosts h on h.active_login_id=s.id where s.connection_id=(p_body->>'connectionId')::uuid) then raise exception 'CONNECTION_BUSY';end if;
 v_result:=private.cli_worker_action_legacy(p_host,p_action,p_body);
 -- Only a freshly authorized attempt may set its deadline. Retries/heartbeats cannot renew it.
 if p_action='authorizeStart' and v_result->>'authorized'='true' then
   update private.cli_job_state s set run_deadline_at=s.launch_authorized_at+interval '600 seconds'
   from private.cli_connections c
   where s.job_id=(p_body->>'jobId')::uuid and s.connection_id=c.id
     and c.provider_id='gemini' and s.host_id=p_host and s.phase='launch_authorized';
 end if;
 return v_result;
end $$;
revoke all on function public.cli_worker_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.cli_worker_action(uuid,text,jsonb) to service_role;
