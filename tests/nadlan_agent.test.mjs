import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runNadlanAgent, subjectProperty, pilotValuation } from '../supabase/functions/appraisal/nadlan-agent.ts';
import { chooseAddress, shareSourceUrl } from '../deploy/nadlan-browser/address-resolver.mjs';
import { collectionRequest } from '../deploy/nadlan-browser/collector.mjs';
import { collectNadlanTransactions, verifyCollection } from '../supabase/functions/appraisal/nadlan-browser.ts';

const url = 'https://www.nadlan.gov.il/?view=address&id=72888186&page=deals';
const now = new Date('2026-09-28T12:00:00Z');
const opts = { provider: 'gemini', model: 'test', key: 'test-secret' };
const table = n => 'address,date,price,area,rooms,floor,propertyType,parcel\n' + Array.from({length:n},(_,i)=>`רחוב ${i},2026-07-01,${2000000+i*10000},80,4,ראשונה,דירה בבית קומות,1-2-${i}`).join('\n');
const input = n => ({ sourceUrl: url, table: table(n), query: { address: 'נכס 1 עיר', area: 80, rooms: 4, floor: 'ראשונה', description: 'דירת מגורים', limit: 10 } });
function response(payload) {
  if (payload.stage === 'assess') return { assessments: payload.candidates.map(r=>({id:r.id,eligible:true,valuationEligible:true,reason:'נתוני שטח וחדרים תואמים; מצב לא ידוע',floorScore:payload.subject.floor ? 100 : null,descriptionScore:payload.subject.description ? 100 : null})) };
  return { keyPoints: [{text:'המחירים שונים למרות שטח זהה; יש לבדוק מאפיינים חסרים.',transactionIds:payload.selected.map(r=>r.id)}],valuationExplanation:'החישוב ראשוני ללא התאמות.' };
}
const provider = async p => JSON.stringify(response(JSON.parse(p.input)));

test('subject requires only address, preserves floor zero, rooms already include living room', () => {
  assert.deepEqual(subjectProperty({address:' רחוב 1 '}),{address:'רחוב 1',area:null,rooms:null,floor:null,description:null});
  assert.equal(subjectProperty({address:'a',floor:0,rooms:3.5}).floor,'0');
  assert.equal(subjectProperty({address:'a',rooms:3.5}).rooms,3.5);
  for (const patch of [{address:''},{area:NaN},{rooms:-1},{floor:{}},{description:3}]) assert.throws(()=>subjectProperty({address:'a',...patch}));
});
test('canonical agent Markdown and bundled prompt stay synchronized', async () => {
  const md = await readFile(new URL('../docs/NADLAN_AGENT.md',import.meta.url),'utf8');
  const packed = JSON.parse(await readFile(new URL('../supabase/functions/appraisal/nadlan-agent-prompt.json',import.meta.url),'utf8'));
  assert.equal(packed.content,md.replace(/\r\n/g,'\n'));
});
test('address resolution requires unique full match; share output validates host and URL', () => {
  assert.equal(chooseAddress('בר-יוחאי 8, רמת גן',['בר יוחאי 8 רמת גן כתובת']),'בר יוחאי 8 רמת גן כתובת');
  for(const options of [[],['בר יוחאי 9 רמת גן כתובת'],['בר יוחאי 8 רמת גן רחוב'],['בר יוחאי 8 רמת גן כתובת','בר יוחאי 8 רמת גן כתובת']]) assert.throws(()=>chooseAddress('בר יוחאי 8 רמת גן',options));
  assert.equal(shareSourceUrl('https://api.whatsapp.com/send?text='+encodeURIComponent('קישור:\n'+url)),url);
  assert.throws(()=>shareSourceUrl('https://evil.test/send?text='+encodeURIComponent(url)));
  assert.throws(()=>shareSourceUrl('https://api.whatsapp.com/send?text='+encodeURIComponent(url.replace('address','settlement'))));
  assert.deepEqual(collectionRequest({address:'בר יוחאי 8 רמת גן'}),{address:'בר יוחאי 8 רמת גן',maxPages:5});
});
test('agent assesses every candidate across batches; immutable source, cited summary, reproducible baseline', async () => {
  let calls=0,assessed=0;
  const result = await runNadlanAgent(input(45),opts,{now,provider:async p=>{
    const data=JSON.parse(p.input); calls++;
    assert.equal(p.search,false); assert.ok(!p.input.includes(opts.key));
    if(data.stage==='assess') assessed+=data.candidates.length;
    const out=response(data); if(out.assessments) out.assessments.forEach(r=>{r.amount=1;r.address='fabricated';});
    return JSON.stringify(out);
  }});
  assert.equal(calls,3); assert.equal(assessed,45); assert.equal(result.assessments.length,45); assert.equal(result.transactions.length,10);
  assert.notEqual(result.transactions[0].amount,1); assert.notEqual(result.transactions[0].address,'fabricated');
  assert.equal(result.transactions[0].propertyType,'דירה בבית קומות');
  assert.equal(result.valuation.status,'indicative'); assert.equal(result.valuation.transactionIds.length,10);
  assert.ok(result.valuation.low<=result.valuation.estimate && result.valuation.estimate<=result.valuation.high);
  assert.ok(!JSON.stringify(result.dataset).includes(opts.key)); assert.equal(result.dataset.transactions.length,45);
});
test('address-only analysis is valid without inventing total valuation; out-of-date rows never call AI', async () => {
  const result=await runNadlanAgent({...input(3),query:{address:'a'}},opts,{now,provider});
  assert.equal(result.subject.area,null); assert.equal(result.valuation.estimate,null); assert.equal(result.transactions.length,3);
  const empty=await runNadlanAgent({...input(3),query:{address:'a',startDate:'2026-08-01'}},opts,{now,provider:()=>assert.fail('Paid call for empty window')});
  assert.equal(empty.assessments.length,0); assert.equal(empty.dataset.transactions.length,3);
});
test('malformed, duplicate, missing or invented assessments and unsupported scores fail closed', async () => {
  const mutations=[r=>{r.assessments[0].id='invented';},r=>{r.assessments[1]=r.assessments[0];},r=>{r.assessments.pop();},r=>{r.assessments[0].floorScore=101;},r=>{r.assessments[0].eligible=false;},r=>{delete r.assessments[0].reason;}];
  for(const change of mutations) await assert.rejects(runNadlanAgent(input(3),opts,{now,provider:async p=>{const r=response(JSON.parse(p.input));change(r);return JSON.stringify(r);}}),e=>e.status===502);
  await assert.rejects(runNadlanAgent({...input(3),query:{address:'a'}},opts,{now,provider:async p=>{const r=response(JSON.parse(p.input));r.assessments[0].floorScore=90;return JSON.stringify(r);}}));
});
test('all excluded yields no summary call; fewer than ten remain fewer, summary cannot cite unselected', async () => {
  let calls=0;
  const result=await runNadlanAgent(input(3),opts,{now,provider:async p=>{calls++;const r=response(JSON.parse(p.input));r.assessments.forEach(a=>{a.eligible=false;a.valuationEligible=false;});return JSON.stringify(r);}});
  assert.equal(calls,1); assert.equal(result.transactions.length,0); assert.equal(result.assessments.length,3);
  const small=await runNadlanAgent(input(2),opts,{now,provider});assert.equal(small.transactions.length,2);assert.equal(small.valuation.status,'insufficient_data');
  await assert.rejects(runNadlanAgent({...input(3),query:{...input(3).query,limit:1}},opts,{now,provider:async p=>{const d=JSON.parse(p.input),r=response(d);if(d.stage==='summarize')r.keyPoints[0].transactionIds=['not-selected'];return JSON.stringify(r);}}));
});
test('non-apartments never use apartment valuation baseline and oversized data is rejected before AI', async () => {
  assert.equal(pilotValuation(subjectProperty(input(3).query),[{eligible:true,valuationEligible:true,area:80,amount:1,propertyType:'משרד'}]).status,'insufficient_data');
  await assert.rejects(runNadlanAgent(input(201),opts,{now,provider:()=>assert.fail()}),e=>e.status===400);
});
test('address request accepts only resolved address share URL and signs it for the user', async () => {
  const token='secret'.repeat(8),tableText=table(3);
  const result=await collectNadlanTransactions({address:'נכס 1 עיר'},'owner',{endpoint:'https://collector.example/collect',token},async(_url,req)=>{
    assert.deepEqual(JSON.parse(req.body),{address:'נכס 1 עיר',maxPages:5});
    return Response.json({sourceUrl:url,table:tableText,sourceAddress:'נכס 1 עיר',neighborhood:'שכונה',retrievedAt:now.toISOString(),pagesCollected:1,totalRows:3,collectedRows:3,complete:true,warnings:[]});
  },now);
  assert.equal(result.sourceUrl,url); assert.equal((await verifyCollection(result.proof,tableText,url,'owner',token,now)).sourceUrl,url);
});
