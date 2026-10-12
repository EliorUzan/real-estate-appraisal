create index cli_connections_provider_idx on private.cli_connections(provider_id);
create index cli_hosts_active_job_idx on private.cli_hosts(active_job_id);

-- Look up deduplication before reading today's mutable prompt or availability.
create function public.cli_lookup_submission(p_user uuid,p_request uuid,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs;
begin
 select * into j from public.generation_jobs where owner_id=p_user and idempotency_key=p_request;
 if j.id is null then return jsonb_build_object('job',null); end if;
 if j.execution_mode<>'cli' or j.request_hash<>p_hash then raise exception 'REQUEST_ID_CONFLICT'; end if;
 if not private.cli_access(p_user,j.workspace_id) then raise exception 'INACTIVE_MEMBERSHIP'; end if;
 if j.deleted_at is not null then raise exception 'RESULT_EXPIRED'; end if;
 return jsonb_build_object('job',private.cli_job_view(j.id));
end $$;
revoke all on function public.cli_lookup_submission(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.cli_lookup_submission(uuid,uuid,text) to service_role;
