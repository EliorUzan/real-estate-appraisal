import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const db=new PGlite();
try{
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth;create schema private;create schema extensions;create table auth.users(id uuid primary key);
 create function extensions.digest(value text,algorithm text) returns bytea language sql immutable as $$ select sha256(convert_to(value,'UTF8')) $$;
 create function extensions.digest(value bytea,algorithm text) returns bytea language sql immutable as $$ select sha256(value) $$;`);
 const initial=await read('supabase/migrations/20260922084700_initial_web_app.sql');
 for(const name of ['member_role','member_status','job_status','job_stage']){
  const statement=initial.match(new RegExp(`create type public\\.${name} as enum \\([\\s\\S]*?\\);`))?.[0];if(!statement)throw new Error(`Missing baseline enum ${name}`);await db.exec(statement);
 }
 for(const name of ['workspaces','workspace_members','generation_jobs','draft_revisions']){
  const statement=initial.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];if(!statement)throw new Error(`Missing baseline table ${name}`);await db.exec(statement);
 }
 const prompts=(await read('supabase/migrations/20260922110716_poc_vault_and_user_prompts.sql')).match(/create table public\.agent_prompts \([\s\S]*?\n\);/)?.[0];await db.exec(prompts);
 await db.exec(await read('supabase/migrations/20260924090000_add_plot_description_section.sql'));
 const retention=await read('supabase/migrations/20260926210539_plot_history_retention.sql');
 await db.exec(retention.split('create function private.prune_section_history')[0]);
 const prune=retention.match(/create function private\.prune_section_history[\s\S]*?end \$\$;/i)?.[0];await db.exec(prune);
 for(const name of ['20261010171228_cli_agent_gateway.sql','20261010175543_cli_gateway_recovery.sql','20261010175851_cli_gateway_receipts.sql','20261012073802_cli_browser_onboarding.sql','20261012081118_cli_codespace_wake.sql','20261012084402_cli_maps_demo_provisioning.sql']){
  await db.exec(await read('supabase/migrations/'+name));console.log(`Migration valid: ${name}`);
 }
 await db.exec(await read('supabase/migrations/20261012135720_cli_report_sections.sql'));console.log('CLI section migration valid');
 for(const path of ['tests/cli_gateway_db.sql','tests/cli_login_db.sql','tests/cli_maps_wake_db.sql','tests/cli_sections_db.sql']){await db.exec(await read(path));console.log(`Postgres protocol passed: ${path}`);}
 console.log('Isolated Postgres tests passed. PGlite is single-session; external two-session races remain a separate release check.');
}catch(e){console.error('Postgres test failed:',e.message,e.detail??'',e.where??'');if(e.position&&e.query){const at=Number(e.position)-1;console.error('Position',at,'line',e.query.slice(0,at).split('\n').length,e.query.slice(Math.max(0,at-120),at+100));}process.exitCode=1;}finally{await db.close();}
