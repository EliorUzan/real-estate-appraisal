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
test('selection retains size and residential-type differences but excludes invalid rights, location and dates',()=>{
 const raw=[sale(),sale(2,{portion_fraction:.5}),sale(3,{area_sqm:150}),sale(4,{rooms:5}),sale(5,{nature:'דירת גן'}),sale(6,{helka:'999'}),sale(7,{date:'2023-01-01'}),sale(8,{settlement:'ירושלים',settlement_code:'3000'}),sale(9,{amount:0}),sale(10,{area_sqm:null}),sale(11,{declared_amount:1200000})];
 const selected=selectOverSales(raw,[parcel()],subject,origin,'6145-0-1203');assert.equal(selected.length,4);
 assert.equal(selected[0].pricePerSqm,30000);assert.equal(selected[0].distanceMeters,0);assert.equal(selected[0].floor,null);
 assert.ok(selected[0].comparison.some(x=>x.includes('אין ודאות')));
});
test('actual parcel distance is used; duplicate share rows and conflicting asset/day records cannot inflate the sample',()=>{
 assert.equal(selectOverSales([sale()],[parcel(1203,{lat:32.08,lon:34.83})],subject,origin,'6145-0-1203').length,0);
 assert.equal(selectOverSales([sale(),sale()],[parcel()],subject,origin,'6145-0-1203').length,1);
 assert.equal(selectOverSales([sale(),sale(1,{amount:2300000,declared_amount:2300000})],[parcel()],subject,origin,'6145-0-1203').length,0);
 assert.equal(selectOverSales([sale()],[parcel(),{...parcel(),parcel_key:'6145-1-1203'}],subject,origin,'6145-0-1203').length,0);
});
test('construction mismatch, unusual prices and low similarity remain available for analysis',()=>{
 assert.equal(selectOverSales([sale(1,{year_built:2028})],[parcel()],{...subject,yearBuilt:1980},origin,'6145-0-1203').length,1);
 const selected=selectOverSales([sale(1),sale(2),sale(3),sale(4),sale(5,{amount:20000000,declared_amount:20000000})],[parcel()],subject,origin,'6145-0-1203');
 assert.equal(selected.length,5);
 assert.equal(selectOverSales([sale(1,{area_sqm:60,rooms:2,date:'2024-10-15'})],[parcel(1203,{lat:32.068,lon:34.824461})],subject,origin,'6145-0-1203').length,1);
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
 assert.equal(result.version,2);
 assert.equal(urls[2].searchParams.has('nature'),false);
 assert.equal(urls[2].searchParams.has('min_rooms'),false);
});
test('new workflow retains all rows, allows a weak single comparable and computes adjustment scenarios from source prices',()=>{
 const v=valid();v.assessments.forEach((a,i)=>{a.accepted=i===0;a.similarity=40;a.adjustment=i===0?{lowPercent:-30,highPercent:-10,reason:'פער גיל; הנחת התאמה לבדיקה'}:null;});
 v.valuation.transactionIds=[selected[0].id];
 const result=overTransactionOutput({...context(selected),version:2},JSON.stringify(v));
 assert.equal(result.transactions.length,3);assert.equal(result.transactions[0].amount,2400000);
 assert.equal(result.valuation.low,1680000);assert.equal(result.valuation.high,2160000);
 assert.ok(result.transactions[0].comparison.some(s=>s.includes('-30%')));
 assert.ok(result.warnings.some(s=>s.includes('מדגם דל')));
 const typo=JSON.stringify(v).replace(/("transactionIds":\[[^\[\]]*\])(?=,)/,'$1"');
 const recovered=overTransactionOutput({...context(selected),version:2},typo);
 assert.deepEqual(recovered.valuation,result.valuation);
 assert.ok(recovered.warnings.some(s=>s.includes('מרכאה')));
 assert.throws(()=>overTransactionOutput({...context(selected),version:2},typo.replace(selected[0].id,'invented')));
 for(const adjustment of [{lowPercent:-100,highPercent:0,reason:'invalid'},{lowPercent:20,highPercent:10,reason:'invalid'},null]){
  v.assessments[0].adjustment=adjustment;assert.throws(()=>overTransactionOutput({...context(selected),version:2},JSON.stringify(v)));
 }
});
test('new workflow still shows all nearby evidence when no numerical adjustment is defensible',()=>{
 const v=valid();v.assessments.forEach(a=>{a.accepted=false;a.similarity=20;a.adjustment=null;});
 v.valuation={...v.valuation,status:'insufficient_data',low:null,high:null,estimate:null,transactionIds:[]};
 const result=overTransactionOutput({...context(selected),version:2},JSON.stringify(v));
 assert.equal(result.transactions.length,3);assert.equal(result.valuation.estimate,null);
 assert.ok(result.transactions.every(t=>t.aiReason.includes('אינה משמשת')));
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

// Public /api/nadlan/address shape observed for the reported address on 27 Oct.
const yehudInput={...input,city:'יהוד-מונוסון',street:'דוד מרכוס',house:'20'};
const yehudParcel={parcel_key:'6685-0-154',identity:{gush:6685,helka:154,point:{lat:32.03497115636164,lon:34.889106348102736},settlement:{code:9400,name:'יהוד'},addresses:[{street:'מרכוס דוד',house:20,suffix:null,lat:32.03492046965214,lon:34.88921261256602}]}};
const yehudAddress={settlement_code:9400,settlement_name:'יהוד-מונוסון',street_name:'מרכוס דוד',house_num:20,house_suffix:null,parcel_key:'6685-0-154',parcel_match:'pip',lat:32.03492046965214,lon:34.88921261256602};
const parcelInput={lookupMode:'parcel',gush:'6685',parcel:'154',area:80,rooms:3,propertyType:input.propertyType,radiusMeters:500};
const parcelRecord={...yehudParcel,identity:{...yehudParcel.identity,gush_suffix:0}};
test('parcel input is canonical and requires no address; invalid IDs and lookup modes are rejected',()=>{
 const s=overSubject({...parcelInput,gush:'006685',parcel:'000154',city:'untrusted old city',street:'old street',house:'2'},now);
 assert.equal(s.address,'גוש 6685, חלקה 154');assert.equal(s.city,'');assert.equal(s.street,'');assert.equal(s.house,'');
 assert.equal(overSubject({...parcelInput,gushSuffix:'0'},now).address,'גוש 6685, חלקה 154, תת־גוש 0');
 for(const patch of [{gush:''},{gush:'0'},{gush:'-1'},{parcel:'1e3'},{parcel:'1/2'},{gush:'12345678'},{gushSuffix:'-1'},{gushSuffix:0},{lookupMode:'unknown'}])assert.throws(()=>overSubject({...parcelInput,...patch},now));
});
test('parcel collector uses exact parcel center without geocoding or requiring a street address',async()=>{
 const urls=[];
 const noAddress={...parcelRecord,identity:{...parcelRecord.identity,addresses:[]}};
 const result=await collectOverTransactions(parcelInput,{now,fetcher:async url=>{
  urls.push(new URL(url));
  if(url.includes('/nadlan/parcel/'))return response({data:[noAddress]});
  if(url.includes('/point?'))return response({data:[noAddress]});
  return response({data:[sale(1,{gush:'6685',helka:'154',settlement:'יהוד',settlement_code:'9400'})]});
 }});
 assert.equal(urls[0].pathname,'/api/nadlan/parcel/6685/154');assert.equal(urls[0].searchParams.has('suffix'),false);
 assert.ok(urls.every(u=>!u.pathname.includes('/address')&&u.origin==='https://www.over.org.il'));
 assert.deepEqual(result.point,parcelRecord.identity.point);assert.equal(result.subject.city,'יהוד');
 assert.equal(result.subject.address,'גוש 6685, חלקה 154');assert.equal(result.query.address,result.subject.address);
 assert.equal(result.parcelKey,'6685-0-154');assert.equal(result.selected.length,1);
 assert.ok(result.warnings.some(w=>w.includes('לא נבחרה כתובת')));
});
test('parcel lookup rejects absent, mismatched, ambiguous and unusable source locations before sales collection',async()=>{
 const otherSuffix={...parcelRecord,parcel_key:'6685-1-154',identity:{...parcelRecord.identity,gush_suffix:1}};
 for(const rows of [[],[yehudParcel],[{...parcelRecord,parcel_key:'6685-0-155'}],[{...parcelRecord,identity:{...parcelRecord.identity,helka:155}}],[parcelRecord,otherSuffix],[{...parcelRecord,identity:{...parcelRecord.identity,point:null}}]]){
  let calls=0;await assert.rejects(collectOverTransactions(parcelInput,{now,fetcher:async()=>{calls++;return response({data:rows});}}));assert.equal(calls,1);
 }
 let first;
 const r=await collectOverTransactions({...parcelInput,gushSuffix:'1'},{now,fetcher:async url=>{
  if(!first)first=new URL(url);
  return response({data:url.includes('/nadlan/parcel/')?[parcelRecord,otherSuffix]:[]});
 }});
 assert.equal(first.searchParams.get('suffix'),'1');assert.equal(r.parcelKey,'6685-1-154');
});
test('verified address-register join resolves Yehud and reversed street names through sale collection',async()=>{
 const urls=[];
 const result=await collectOverTransactions(yehudInput,{now,fetcher:async url=>{
  urls.push(new URL(url));
  if(url.includes('/address?'))return response({data:[yehudParcel],addresses:[yehudAddress]});
  if(url.includes('/point?'))return response({data:[yehudParcel]});
  return response({data:[sale(1,{gush:'6685',helka:'154',settlement:'יהוד',settlement_code:'9400'})]});
 }});
 assert.equal(result.parcelKey,'6685-0-154');assert.equal(result.selected.length,1);
 assert.equal(result.subject.city,'יהוד-מונוסון');assert.equal(result.subject.street,'דוד מרכוס');
 assert.deepEqual(result.point,{lat:yehudAddress.lat,lon:yehudAddress.lon});
 assert.equal(urls[2].searchParams.get('settlement'),'יהוד');
});
test('address-register join rejects wrong city, partial street, house, locality code and parcel links',async()=>{
 for(const patch of [{settlement_name:'רמת גן'},{street_name:'דוד'},{house_num:21},{house_suffix:'א'},{settlement_code:8600},{parcel_key:'6685-0-155'},{parcel_match:'nearest'},{lat:null}]){
  let calls=0;
  await assert.rejects(collectOverTransactions(yehudInput,{now,fetcher:async()=>{calls++;return response({data:[yehudParcel],addresses:[{...yehudAddress,...patch}]});}}),/לא נמצאה התאמה מאומתת/);
  assert.equal(calls,1,'mismatches stop before collecting sales');
 }
 const second={...yehudParcel,parcel_key:'6685-0-155',identity:{...yehudParcel.identity,helka:155}};
 await assert.rejects(collectOverTransactions(yehudInput,{now,fetcher:async()=>response({data:[yehudParcel,second],addresses:[yehudAddress,{...yehudAddress,parcel_key:second.parcel_key}]})}),/נמצאו כמה חלקות/);
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

test('recovers valuation narratives placed at the root without weakening source validation',async()=>{
 const ctx={...context(selected),version:2}, v=valid();
 v.assessments.forEach(a=>{a.adjustment={lowPercent:-10,highPercent:10,reason:'Comparison uncertainty'};});
 const expected=await cliTransactionOutput(ctx,JSON.stringify(v),'claude',null);
 v.explanation=v.valuation.explanation;v.assumptions=v.valuation.assumptions;
 delete v.valuation.explanation;delete v.valuation.assumptions;
 assert.deepEqual(await cliTransactionOutput(ctx,JSON.stringify(v),'claude',null),expected);
 v.valuation.explanation='Conflicting explanation';
 assert.throws(()=>overTransactionOutput(ctx,JSON.stringify(v)));
 delete v.valuation.explanation;v.assumptions='invalid';
 assert.throws(()=>overTransactionOutput(ctx,JSON.stringify(v)));
 v.assumptions=expected.valuation.assumptions;v.valuation.transactionIds=['invented'];
 assert.throws(()=>overTransactionOutput(ctx,JSON.stringify(v)));
});
