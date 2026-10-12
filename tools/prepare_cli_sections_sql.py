"""Prepare the reviewed section rollout SQL without changing the live database.

The reviewed patch was applied as cli_report_sections, version 20261012135720,
and its exact SQL is recorded in supabase/migrations. This helper recreates the
review artifact only; it must not edit an applied migration or apply it again.
"""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
source = (root / 'supabase/migrations/20261010171228_cli_agent_gateway.sql').read_text()
function = re.search(r'create function public\.cli_user_action\(.*?end \$\$;', source, re.S).group()
function = function.replace('create function public.cli_user_action', 'create or replace function public.cli_user_action', 1)
function = function.replace("if p_action<>'createCliJob' then raise exception 'UNSUPPORTED_CAPABILITY'; end if;", """if p_action<>'createCliJob' then raise exception 'UNSUPPORTED_CAPABILITY'; end if;
 if coalesce(p_body->>'sectionId','environment_description') not in('environment_description','plot_description','comparable_sales') then raise exception 'UNSUPPORTED_CAPABILITY'; end if;
 if p_body->>'sectionId'='plot_description' and (p_body->'plotEvidence' is null or p_body->'plotEvidence'='null'::jsonb or jsonb_typeof(p_body->'plotEvidence')<>'object' or p_body->'plotEvidence'->>'address' is distinct from p_body->>'address') then raise exception 'INVALID_INPUT';end if;
 if p_body->>'sectionId'='comparable_sales' and (p_body->'cliContext' is null or p_body->'cliContext'='null'::jsonb or jsonb_typeof(p_body->'cliContext')<>'object') then raise exception 'INVALID_INPUT';end if;""")
function = function.replace("p_user::text||'environment_description'", "p_user::text||coalesce(p_body->>'sectionId','environment_description')")
function = function.replace("section_id='environment_description' for share", "section_id=coalesce(p_body->>'sectionId','environment_description') for share")
function = function.replace('request_hash,execution_mode)', 'request_hash,execution_mode,plot_evidence,cli_context)')
function = function.replace("p_user,'environment_description',p_body->>'address'", "p_user,coalesce(p_body->>'sectionId','environment_description'),p_body->>'address'")
function = function.replace("(p_body->>'requestId')::uuid,v_hash,'cli')", "(p_body->>'requestId')::uuid,v_hash,'cli',nullif(p_body->'plotEvidence','null'::jsonb),nullif(p_body->'cliContext','null'::jsonb))")
assert 'request_hash,execution_mode,plot_evidence,cli_context)' in function
view = re.search(r'create function private\.cli_job_view\(.*?\$\$;', source, re.S).group()
view = view.replace('create function private.cli_job_view', 'create or replace function private.cli_job_view', 1)
view = view.replace("'id',j.id,'status',j.status", "'id',j.id,'sectionId',j.section_id,'status',j.status")
sql = """-- Reviewed patch: register as a Supabase migration before release.
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
""" + view + '\n' + function + '\n'
target = root / 'deploy/cli-gateway/cli-sections.sql'
target.write_text(sql)
print('Prepared CLI section rollout SQL; not applied to the live project.')
