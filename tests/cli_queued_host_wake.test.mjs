import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wakeQueuedJob} from '../supabase/functions/appraisal/queued-host-wake.ts';
import {advanceHostWake} from '../supabase/functions/cli-onboarding/host-wake.ts';
const config={token:'test-only',name:'personal-test',owner:'owner',repository:'owner/repo'};
const job={id:'saved-job',status:'queued',provider:'gemini',executionMode:'cli'};

test('queued job with a stale heartbeat wakes the host without replaying inference',async()=>{
 const calls=[];const http=[];
 const db={rpc:async(name,args)=>{calls.push([name,args]);
  if(name==='cli_host_wake_user_action')return {data:{state:'requested'}};
  if(args.p_action==='claim')return {data:{wake:{operationId:'op',leaseToken:'lease',startRequested:false}}};
  if(args.p_action==='markStart')return {data:{authorized:true}};
  return {data:{state:'starting'}};
 }};
 await wakeQueuedJob(db,'owner-id',job,config,async(url,init)=>{http.push([url,init.method]);return new Response(JSON.stringify({name:config.name,owner:{login:config.owner},repository:{full_name:config.repository},state:'Shutdown'}));});
 assert.equal(calls[0][1].p_body.requestId,job.id);
 assert.equal(calls[0][1].p_user,'owner-id');
 assert.deepEqual(http.map(x=>x[1]),['GET','POST']);
 assert.ok(calls.every(([name])=>['cli_host_wake_user_action','cli_host_wake_control'].includes(name)));
});

test('active/completed jobs, unavailable configuration, and refused wake never start a machine',async()=>{
 let calls=0;const db={rpc:async()=>{calls++;return {error:{message:'HOST_RECOVERY_REQUIRED'}};}};
 const fetcher=async()=>{throw new Error('Must not reach GitHub');};
 for(const status of ['running','cancel_requested','succeeded','failed'])await wakeQueuedJob(db,'owner-id',{...job,status},config,fetcher);
 await wakeQueuedJob(db,'owner-id',job,null,fetcher);
 assert.equal(calls,0);
 await wakeQueuedJob(db,'owner-id',job,config,fetcher);assert.equal(calls,1);
});

test('fresh heartbeat avoids GitHub; network failure does not lose the accepted job',async()=>{
 await wakeQueuedJob({rpc:async()=>({data:{state:'ready'}})},'owner-id',job,config,async()=>{assert.fail('Healthy host must not call GitHub');});
 await assert.doesNotReject(wakeQueuedJob({rpc:async()=>{throw new Error('transport');}},'owner-id',job,config));
});

test('intermediate GitHub states wait for a real heartbeat without another start',async()=>{
 for(const state of ['Queued','Provisioning','Updating','FutureTransitionalState','Failed']){
  const calls=[];
  const db={rpc:async(name,args)=>{calls.push(args);return {data:args.p_action==='claim'?{wake:{operationId:'op',leaseToken:'lease',startRequested:true}}:{}};}};
  await advanceHostWake(db,config,async(url,init)=>{assert.equal(init.method,'GET');return Response.json({name:config.name,owner:{login:config.owner},repository:{full_name:config.repository},state});});
  assert.equal(calls.at(-1).p_body.errorCode,state==='Failed'?'HOST_RECOVERY_REQUIRED':null);
  assert.ok(!calls.some(x=>x.p_action==='markStart'));
 }
});
