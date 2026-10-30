import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Synthetic, in-memory PostgreSQL only. No env files, external DB or Auth calls.
test('suspension blocks workspace reads while preserving active team and owner access', async () => {
  const db = new PGlite()
  const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
  const tables = ['workspaces','workspace_members','profiles','provider_settings','attachments','generation_jobs','job_attachments','draft_revisions','draft_approvals']
  try {
    await db.exec(`create role authenticated; create role anon; create schema auth;
      grant usage on schema public,auth to authenticated;
      create function auth.uid() returns uuid language sql stable as $$
        select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
      create table workspaces(id uuid primary key,status text);
      create table workspace_members(workspace_id uuid,user_id uuid,status text);
      create table profiles(user_id uuid); create table provider_settings(user_id uuid);
      create table attachments(id uuid primary key,workspace_id uuid,owner_id uuid);
      create table generation_jobs(id uuid primary key,workspace_id uuid,deleted_at timestamptz);
      create table job_attachments(id uuid primary key,job_id uuid);
      create table draft_revisions(id uuid primary key,job_id uuid);
      create table draft_approvals(id uuid primary key,job_id uuid);`)
    for (const table of tables) await db.exec(`alter table ${table} enable row level security; grant select on ${table} to authenticated`)
    const source = await readFile(new URL('../../supabase/migrations/20260922084700_initial_web_app.sql', import.meta.url),'utf8')
    await db.exec(source.slice(source.indexOf('create policy workspace_members_self_read'),source.indexOf('insert into storage.buckets')))
    for(let n=1;n<=3;n++) await db.query('insert into workspaces values($1,$2)',[uid(n),n===2?'suspended':'active'])
    for(const [workspace,user,status] of [[1,10,'active'],[2,10,'active'],[1,20,'suspended'],[3,30,'active']]) {
      await db.query('insert into workspace_members values($1,$2,$3)',[uid(workspace),uid(user),status])
    }
    for(let n=1;n<=4;n++) {
      const workspace=n===4?1:n
      await db.query('insert into generation_jobs values($1,$2,$3)',[uid(100+n),uid(workspace),n===4?new Date().toISOString():null])
      await db.query('insert into attachments values($1,$2,$3)',[uid(200+n),uid(workspace),uid(n===3?30:n===4?20:10)])
      for(const table of ['job_attachments','draft_revisions','draft_approvals']) await db.query(`insert into ${table} values($1,$2)`,[uid(300+n),uid(100+n)])
    }
    async function readAs(user,table) {
      await db.exec('set role authenticated')
      try {
        await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:uid(user)})])
        return (await db.query(`select id from ${table} order by id`)).rows.map(r=>r.id)
      } finally { await db.exec('reset role') }
    }
    // Reproduce the missing status condition with the original, real policies.
    assert.deepEqual(await readAs(10,'generation_jobs'),[uid(101),uid(102)])
    const migration=await readFile(new URL('../../supabase/migrations/20261029214153_enforce_active_workspace_reads.sql',import.meta.url),'utf8')
    await db.exec(migration)
    await db.exec(migration) // Policy changes must be safely repeatable.
    for(const [table,id] of [['workspaces',1],['generation_jobs',101],['attachments',201],['job_attachments',301],['draft_revisions',301],['draft_approvals',301]]) {
      assert.deepEqual(await readAs(10,table),[uid(id)],`active owner: ${table}`)
      assert.deepEqual(await readAs(20,table),[],`suspended member: ${table}`)
      const other=id===1?3:id+2
      assert.deepEqual(await readAs(30,table),[uid(other)],`cross-workspace boundary: ${table}`)
      assert.deepEqual(await readAs(40,table),[],`non-member: ${table}`)
    }
    await db.query("update workspace_members set status='active' where user_id=$1",[uid(20)])
    assert.deepEqual(await readAs(20,'generation_jobs'),[uid(101)],'active teammates retain shared jobs')
    assert.deepEqual(await readAs(20,'attachments'),[uid(204)],'attachments remain owner-only')
  } finally { await db.close() }
})
