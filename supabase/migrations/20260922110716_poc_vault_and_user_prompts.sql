create table public.agent_prompts (
 user_id uuid not null references auth.users(id) on delete restrict,
 section_id text not null check(section_id in ('environment_description','property_description','planning_status','registration_rights','comparable_sales','valuation_summary')),
 content text not null check(char_length(content) between 1 and 50000),
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 primary key(user_id,section_id)
);
alter table public.agent_prompts enable row level security;
grant select on public.agent_prompts to authenticated;
grant all on public.agent_prompts to service_role;
create policy own_prompts on public.agent_prompts for select to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.workspace_members where user_id=(select auth.uid()) and status='active'));
create policy prompt_backend on public.agent_prompts for all to service_role using(true) with check(true);

create table private.provider_vault (
 user_id uuid not null references auth.users(id) on delete restrict,
 provider_id text not null,
 secret_id uuid not null references vault.secrets(id) on delete restrict,
 primary key(user_id,provider_id)
);
alter table private.provider_vault enable row level security;
create policy vault_backend on private.provider_vault for all to service_role using(true) with check(true);
grant usage on schema private,vault to service_role;
grant all on private.provider_vault to service_role;
grant select,insert,update,delete on vault.secrets to service_role;
grant select on vault.decrypted_secrets to service_role;
grant execute on function vault.create_secret(text,text,text,uuid),vault.update_secret(uuid,text,text,text,uuid) to service_role;
grant all on public.provider_settings,public.profiles,public.agent_prompts,public.generation_jobs,public.draft_revisions to service_role;
grant select on public.workspace_members,public.workspaces to service_role;

create function public.poc_save_provider(p_user uuid,p_provider text,p_model text,p_key text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare sid uuid;
begin
 if not exists(select 1 from public.workspace_members where user_id=p_user and status='active') then raise exception 'inactive user'; end if;
 if p_provider not in ('openai','gemini','anthropic','moonshot','qwen') or char_length(btrim(p_model)) not between 1 and 160 then raise exception 'invalid provider'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text || p_provider,0));
 select secret_id into sid from private.provider_vault where user_id=p_user and provider_id=p_provider;
 if nullif(btrim(p_key),'') is not null then
   if char_length(p_key) not between 8 and 4096 then raise exception 'invalid key'; end if;
   if sid is null then
     select vault.create_secret(p_key) into sid;
     insert into private.provider_vault values(p_user,p_provider,sid);
   else perform vault.update_secret(sid,p_key); end if;
 end if;
 insert into public.provider_settings(user_id,provider_id,model_id,configured,key_last4,credential_version)
 values(p_user,p_provider,p_model,sid is not null,case when nullif(p_key,'') is not null then right(p_key,4) end,case when sid is not null then 1 else 0 end)
 on conflict(user_id,provider_id) do update set model_id=excluded.model_id,configured=sid is not null,
 key_last4=coalesce(excluded.key_last4,provider_settings.key_last4),
 credential_version=provider_settings.credential_version + case when nullif(p_key,'') is not null then 1 else 0 end;
end $$;
create function public.poc_provider_secret(p_user uuid,p_provider text)
returns text language sql security invoker set search_path='' as $$
 select v.decrypted_secret from private.provider_vault k join vault.decrypted_secrets v on v.id=k.secret_id
 where k.user_id=p_user and k.provider_id=p_provider
 and exists(select 1 from public.workspace_members where user_id=p_user and status='active');
$$;

create function public.poc_save_prompt(p_user uuid,p_section text,p_content text,p_expected integer)
returns void language plpgsql security invoker set search_path='' as $$
declare current_version integer;
begin
 if not exists(select 1 from public.workspace_members where user_id=p_user and status='active') then raise exception 'inactive user'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text || p_section,0));
 select version into current_version from public.agent_prompts where user_id=p_user and section_id=p_section;
 if coalesce(current_version,0) <> p_expected then raise exception 'PROMPT_CONFLICT'; end if;
 insert into public.agent_prompts(user_id,section_id,content,version) values(p_user,p_section,p_content,1)
 on conflict(user_id,section_id) do update set content=excluded.content,version=agent_prompts.version+1,updated_at=now();
end $$;

create function public.poc_finish_job(p_job uuid,p_user uuid,p_text text)
returns void language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs;
begin
 select * into strict j from public.generation_jobs where id=p_job and owner_id=p_user for update;
 if j.status <> 'running' or not exists(select 1 from public.workspace_members where user_id=p_user and workspace_id=j.workspace_id and status='active') then raise exception 'invalid state'; end if;
 update public.generation_jobs set status='succeeded',stage='saving',output_text=p_text,completed_at=now() where id=p_job;
 insert into public.draft_revisions(job_id,workspace_id,owner_id,revision_number,text,text_sha256,created_by)
 values(j.id,j.workspace_id,j.owner_id,1,p_text,encode(public.digest(p_text,'sha256'),'hex'),p_user);
end $$;
revoke all on function public.poc_save_provider(uuid,text,text,text),public.poc_provider_secret(uuid,text),public.poc_save_prompt(uuid,text,text,integer),public.poc_finish_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.poc_save_provider(uuid,text,text,text),public.poc_provider_secret(uuid,text),public.poc_save_prompt(uuid,text,text,integer),public.poc_finish_job(uuid,uuid,text) to service_role;
