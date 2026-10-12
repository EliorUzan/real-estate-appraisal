import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canWakeForPrompt,waitForCliHost} from '../web/src/lib/cli-host-ready.ts';
const provider={provider:'gemini',enabled:true,connection:{id:'owned',status:'connected',available:false,revision:1}};
const status={connectionId:'owned',nextAction:'start_host',hostState:'asleep',wake:{configured:true,state:'starting',errorCode:null}};
test('Send can wake only a verified saved Google connection on an asleep permitted host',()=>{
 assert.equal(canWakeForPrompt(provider,status,true),true);
 assert.equal(canWakeForPrompt(provider,{...status,connectionId:'different'},true),false);
 for(const change of [{verified:false},{hostState:'quarantined'},{nextAction:'reconnect'},{configured:false},{connectionStatus:'reauth_required'}]){
  assert.ok(!canWakeForPrompt({...provider,connection:{...provider.connection,status:change.connectionStatus??'connected'}},{...status,hostState:change.hostState??status.hostState,nextAction:change.nextAction??status.nextAction,wake:{...status.wake,configured:change.configured??true}},change.verified??true));
 }
});
test('wake waits for the owned connection heartbeat and never submits a model request itself',async()=>{
 let time=0,wakes=0,reads=0;
 await waitForCliHost('same-request','owned',{signal:new AbortController().signal,wake:async id=>{assert.equal(id,'same-request');wakes++;},status:async()=>status,connections:async()=>({providers:[{...provider,connection:{...provider.connection,available:++reads>=2}}]}),now:()=>time,delay:async()=>{time+=2000;}});
 assert.equal(wakes,1);assert.equal(reads,2);
});
test('cancellation and startup timeout happen before inference admission',async()=>{
 const controller=new AbortController();controller.abort();let starts=0;
 const options={signal:controller.signal,wake:async()=>{starts++;},status:async()=>status,connections:async()=>({providers:[provider]})};
 await assert.rejects(waitForCliHost('r','owned',options),e=>e.name==='AbortError');assert.equal(starts,0);
 let time=0;
 await assert.rejects(waitForCliHost('r','owned',{...options,signal:new AbortController().signal,now:()=>time,delay:async()=>{time+=181000;}}),/זמן|חרגה/);
});
