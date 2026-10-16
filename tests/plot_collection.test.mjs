import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlotCollection} from '../web/src/lib/plot-collection.ts';
import {plotProgress} from '../web/src/lib/plot-progress.ts';

const evidence=address=>({address,retrievedAt:new Date().toISOString()});
test('AI waits for current GovMap evidence for the requested address',async()=>{
 const collector=createPlotCollection();let submissions=0;
 const result=collector.start('requested address').then(data=>{submissions++;return data;});
 collector.receive(null);
 collector.receive(evidence('different address'));
 collector.receive({...evidence('requested address'),retrievedAt:'2000-01-01T00:00:00Z'});
 collector.receive({...evidence('requested address'),retrievedAt:new Date(Date.now()-60000).toISOString()});
 await Promise.resolve();assert.equal(submissions,0);
 const data=evidence('requested address');collector.receive(data);
 assert.equal(await result,data);assert.equal(submissions,1);
 collector.receive(data);await Promise.resolve();assert.equal(submissions,1);
});
test('map-only results cannot submit to AI or resolve a later request',async()=>{
 const collector=createPlotCollection();collector.receive(evidence('map-only'));
 let submitted=false;
 const result=collector.start('new request').then(()=>{submitted=true;});
 await Promise.resolve();assert.equal(submitted,false);
 collector.receive(evidence('new request'));await result;assert.equal(submitted,true);
});
test('collection cancellation, errors and timeout prevent AI submission',async()=>{
 for(const reason of ['cancelled by user','page changed','GovMap failed']){
  const collector=createPlotCollection();let submitted=false;
  const result=collector.start('address').then(()=>{submitted=true;});
  collector.cancel(reason);await assert.rejects(result,{message:reason});
  collector.receive(evidence('address'));assert.equal(submitted,false);
 }
 const collector=createPlotCollection(5);
 await assert.rejects(collector.start('address'),/לא הושלם בזמן/);
});
test('a new collection cannot consume the prior address result',async()=>{
 const collector=createPlotCollection();const old=collector.start('old');
 const rejected=assert.rejects(old,/הקודם בוטל/);
 const current=collector.start('current');await rejected;
 collector.receive(evidence('old'));collector.receive(evidence('current'));
 assert.equal((await current).address,'current');
});
test('plot progress follows actual API and CLI stages and never completes a failed request',()=>{
 assert.equal(plotProgress('api','collecting').current,0);
 assert.equal(plotProgress('api','running').current,1);
 assert.equal(plotProgress('api','succeeded').complete,true);
 for(const [phase,index] of [['collecting',0],['waking',1],['sending',1],['queued',2],['running',3],['succeeded',4]])assert.equal(plotProgress('cli',phase).current,index);
 for(const mode of ['api','cli'])for(const phase of ['failed','cancelled','expired','needs_review','unknown'])assert.equal(plotProgress(mode,phase),null);
});
