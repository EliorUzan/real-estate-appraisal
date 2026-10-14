import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectOverTransactions,overSubject,selectOverSales,overPromptInput,overTransactionOutput} from '../supabase/functions/appraisal/over-transactions.ts';
import {cliTransactionOutput,transactionReport} from '../supabase/functions/appraisal/cli-evidence.ts';
const now=new Date('2026-10-14T10:00:00Z');
const input={city:'רמת גן',street:'בר יוחאי',house:'8',area:80,rooms:3,propertyType:'דירה בבית קומות',radiusMeters:500};
const subject=overSubject(input,now),origin={lat:32.064338,lon:34.824461};
const parcel=(helka=1203,point=origin)=>({parcel_key:`6145-0-${helka}`,identity:{gush:6145,helka,point,settlement:{name:'רמת גן',code:8600},addresses:[{street:'בר יוחאי',house:8,neighbourhood:'אזור לדוגמה',...point}]}});
const sale=(sub=1,patch={})=>({date:'2026-09-01',amount:2400000,declared_amount:2400000,area_sqm:80,rooms:3,year_built:1980,portion_fraction:1,nature:'דירה בבית קומות',settlement:'רמת גן',settlement_code:'8600',gush:'6145',helka:'1203',sub_parcel:String(sub),...patch});
const context=(selected)=>({kind:'over',version:1,subject,query:{...subject,limit:10,dealType:'both'},selected,retrievedAt:now.toISOString(),candidateCount:selected.length,warnings:[],point:origin,parcelKey:'6145-0-1203'});
const response=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});

test('requires enough subject attributes; no invented address, invalid dates or arbitrary property types',()=>{
 assert.equal(subject.address,'בר יוחאי 8, רמת גן');
 for(const patch of [{city:''},{house:'x'},{area:0},{area:'80'},{rooms:0},{propertyType:'מגורים'},{radiusMeters:2000},{startDate:'2026-02-30'},{endDate:'2027-01-01'}])assert.throws(()=>overSubject({...input,...patch},now));
});
test('strict similarity selection excludes partial rights, incompatible size/type, missing location, wrong city and date',()=>{
 const raw=[sale(),sale(2,{portion_fraction:.5}),sale(3,{area_sqm:150}),sale(4,{rooms:5}),sale(5,{nature:'דירת גן'}),sale(6,{helka:'999'}),sale(7,{date:'2023-01-01'}),sale(8,{settlement:'ירושלים',settlement_code:'3000'}),sale(9,{amount:0}),sale(10,{area_sqm:null}),sale(11,{declared_amount:1200000})];
 const selected=selectOverSales(raw,[parcel()],subject,origin,'6145-0-1203');assert.equal(selected.length,1);
 assert.equal(selected[0].pricePerSqm,30000);assert.equal(selected[0].distanceMeters,0);assert.equal(selected[0].floor,null);
 assert.ok(selected[0].comparison.some(x=>x.includes('אין ודאות')));
});
test('actual parcel distance is used; duplicate share rows and conflicting asset/day records cannot inflate the sample',()=>{
 assert.equal(selectOverSales([sale()],[parcel(1203,{lat:32.08,lon:34.83})],subject,origin,'6145-0-1203').length,0);
 assert.equal(selectOverSales([sale(),sale()],[parcel()],subject,origin,'6145-0-1203').length,1);
 assert.equal(selectOverSales([sale(),sale(1,{amount:2300000,declared_amount:2300000})],[parcel()],subject,origin,'6145-0-1203').length,0);
 assert.equal(selectOverSales([sale()],[parcel(),{...parcel(),parcel_key:'6145-1-1203'}],subject,origin,'6145-0-1203').length,0);
});
test('known construction mismatch, extreme prices and low similarity are excluded',()=>{
 assert.equal(selectOverSales([sale(1,{year_built:2028})],[parcel()],{...subject,yearBuilt:1980},origin,'6145-0-1203').length,0);
 const selected=selectOverSales([sale(1),sale(2),sale(3),sale(4),sale(5,{amount:20000000,declared_amount:20000000})],[parcel()],subject,origin,'6145-0-1203');
 assert.equal(selected.length,4);
 assert.equal(selectOverSales([sale(1,{area_sqm:60,rooms:2,date:'2024-10-15'})],[parcel(1203,{lat:32.068,lon:34.824461})],subject,origin,'6145-0-1203').length,0);
});
test('collector resolves address automatically and sends exactly the top ten in a single frozen input',async()=>{
 const urls=[];
 const result=await collectOverTransactions(input,{now,fetcher:async url=>{
  urls.push(new URL(url));
  if(url.includes('/address?'))return response({data:[parcel()]});
  if(url.includes('/point?'))return response({data:[parcel()]});
  return response({data:Array.from({length:14},(_,i)=>sale(i+1)),total:14});
 }});
 assert.equal(result.selected.length,10);assert.equal(result.candidateCount,14);
 const frozen=JSON.parse(overPromptInput(result));assert.equal(frozen.candidates.length,10);
 assert.equal(urls.length,3);assert.equal(urls[2].searchParams.get('date_from'),'2024-10-14');
 assert.ok(urls.every(u=>u.origin==='https://www.over.org.il'));
});
test('collection follows a second page, deduplicates and warns at its bounded cap',async()=>{
 const offsets=[];
 const result=await collectOverTransactions(input,{now,fetcher:async url=>{
  if(url.includes('/address?')||url.includes('/point?'))return response({data:[parcel()]});
  const offset=Number(new URL(url).searchParams.get('offset'));offsets.push(offset);
  return response({data:Array.from({length:200},(_,i)=>sale(i+1)),total:900,total_capped:true});
 }});
 assert.deepEqual(offsets,[0,200]);assert.equal(result.candidateCount,200);assert.equal(result.selected.length,10);
 assert.ok(result.warnings.some(w=>w.includes('400')));
});
test('ambiguous lookup and source failures stop before any model request',async()=>{
 await assert.rejects(collectOverTransactions(input,{now,fetcher:async()=>response({data:[parcel(),parcel(1204)]})}),/חלקה יחידה/);
 await assert.rejects(collectOverTransactions(input,{now,fetcher:async()=>new Response('',{status:429})}),/429/);
 await assert.rejects(collectOverTransactions(input,{now,fetcher:async()=>response({data:'broken'})}),/מבנה/);
});
const selected=selectOverSales([sale(1),sale(2),sale(3)],[parcel()],subject,origin,'6145-0-1203');
const valid=()=>({assessments:selected.map(r=>({id:r.id,accepted:true,similarity:85,reason:'שטח וחדרים תואמים; הקומה אינה ידועה',amount:1})),valuation:{status:'indicative',low:2200000,high:2600000,estimate:2400000,currency:'ILS',transactionIds:selected.map(r=>r.id),explanation:'מחיר למ״ר היסטורי של 30,000 ₪ כפול 80 מ״ר, עם אי ודאות לגבי מצב ומועד.',assumptions:['אין מידע מאומת על קומה או מצב']}});
test('Claude reviews every candidate once; prices remain source facts and the validated range survives job/history serialization',async()=>{
 const result=await cliTransactionOutput(context(selected),JSON.stringify(valid()),'claude','resolved-model');
 assert.equal(result.transactions[0].amount,2400000);assert.equal(result.valuation.low,2200000);assert.equal(result.model,'resolved-model');
 assert.ok(transactionReport(result).includes('2200000'));
});
test('rejects fabricated IDs, duplicate assessments, incomplete reviews and invalid or unsupported valuation ranges',()=>{
 const bad=[];let v=valid();v.assessments[0].id='invented';bad.push(v);
 v=valid();v.assessments[1].id=v.assessments[0].id;bad.push(v);
 v=valid();v.assessments.pop();bad.push(v);
 v=valid();v.valuation.low=2700000;bad.push(v);
 v=valid();v.valuation.transactionIds=['invented'];bad.push(v);
 v=valid();v.assessments[0].accepted=false;bad.push(v);
 v=valid();v.valuation.low='2200000';bad.push(v);
 for(const output of bad)assert.throws(()=>overTransactionOutput(context(selected),JSON.stringify(output)));
});
test('Claude can refuse to value and reject weak comparables without inventing replacements',()=>{
 const v=valid();v.assessments[0].accepted=false;
 v.valuation={...v.valuation,status:'insufficient_data',low:null,high:null,estimate:null,transactionIds:[]};
 const r=overTransactionOutput(context(selected),JSON.stringify(v));assert.equal(r.transactions.length,2);assert.equal(r.valuation.status,'insufficient_data');assert.ok(r.warnings.some(w=>w.includes('נפסלה')));
});
