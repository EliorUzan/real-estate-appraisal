alter table public.profiles drop constraint profiles_default_provider_check;
alter table public.profiles add constraint profiles_default_provider_check check (default_provider in ('openai','gemini','anthropic','moonshot','qwen','groq'));
alter table public.provider_settings drop constraint provider_settings_provider_id_check;
alter table public.provider_settings add constraint provider_settings_provider_id_check check (provider_id in ('openai','gemini','anthropic','moonshot','qwen','groq'));
alter table public.generation_jobs drop constraint generation_jobs_provider_id_check;
alter table public.generation_jobs add constraint generation_jobs_provider_id_check check (provider_id in ('openai','gemini','anthropic','moonshot','qwen','groq'));
alter table private.provider_credentials drop constraint provider_credentials_provider_id_check;
alter table private.provider_credentials add constraint provider_credentials_provider_id_check check (provider_id in ('openai','gemini','anthropic','moonshot','qwen','groq'));
alter table private.cleanup_tasks drop constraint cleanup_tasks_provider_id_check;
alter table private.cleanup_tasks add constraint cleanup_tasks_provider_id_check check (provider_id in ('openai','gemini','anthropic','moonshot','qwen','groq'));

create or replace function public.poc_save_provider(p_user uuid,p_provider text,p_model text,p_key text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare sid uuid;
begin
 if not exists(select 1 from public.workspace_members where user_id=p_user and status='active') then raise exception 'inactive user'; end if;
 if p_provider not in ('openai','gemini','anthropic','moonshot','qwen','groq') or char_length(btrim(p_model)) not between 1 and 160 then raise exception 'invalid provider'; end if;
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

