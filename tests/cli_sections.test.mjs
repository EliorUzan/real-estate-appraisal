import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareCliTransactions,cliTransactionOutput,plotEvidence,environmentEvidence} from '../supabase/functions/appraisal/cli-evidence.ts';
import {environmentGovMap,freshGovMap} from '../web/src/lib/cli-govmap-evidence.ts';
import {cliAction} from '../supabase/functions/appraisal/cli-actions.ts';
import {clientIntent,validateUser} from '../supabase/functions/appraisal/cli-contracts.ts';
import {signCollection} from '../supabase/functions/appraisal/nadlan-browser.ts';
const now=new Date('2026-10-12T13:00:00Z'),address='כתובת בדיקה';
const table='כתובת\tתאריך העסקה\tמחיר העסקה\tשטח במ״ר\tחדרים\nכתובת מקור\t2026-09-01\t2000000\t80\t3';
const sourceUrl='https://www.nadlan.gov.il/?view=address&id=123&page=deals';
const evidence={kind:'nadlan',table,sourceUrl,query:{address,startDate:'2026-01-01',endDate:'2026-10-12',limit:10}};
const output=JSON.stringify({selected:[{id:'import-1',reason:'השוואה לפי המקור',descriptionScore:null,amount:1}],keyPoints:[{text:'פרטי המקור בלבד',transactionIds:['import-1']}]});

test('CLI preparation calls no provider API and completion preserves source facts',async()=>{
 const task=await prepareCliTransactions(evidence,address,'owner','',now);
 assert.ok(task.prompt.includes('Return ONLY JSON'));assert.ok(task.input.includes('import-1'));
 assert.ok(!JSON.stringify(task.context).includes('collectionProof'));
 const result=await cliTransactionOutput(task.context,output,'gemini','test-model');
 assert.equal(result.transactions[0].amount,2000000);assert.equal(result.transactions[0].area,80);assert.equal(result.provider,'gemini');
 assert.equal(result.source,'ייבוא משתמש / Nadlan');
});

test('invented IDs, malformed output, mismatched subject and empty windows are rejected',async()=>{
 const task=await prepareCliTransactions(evidence,address,'owner','',now);
 for(const text of ['plain invented report',output.replaceAll('import-1','made-up')])await assert.rejects(cliTransactionOutput(task.context,text,'gemini',null),e=>e.code==='INVALID_OUTPUT');
 await assert.rejects(prepareCliTransactions(evidence,'other-address','owner','',now));
 await assert.rejects(prepareCliTransactions({...evidence,query:{...evidence.query,startDate:'2026-10-01'}},address,'owner','',now));
});

test('signed collector provenance is checked once then frozen without its credentials',async()=>{
 const token='synthetic-collector-token-32-characters';
 const meta={sourceUrl,sourceAddress:address,neighborhood:'שכונת בדיקה',retrievedAt:now.toISOString(),pagesCollected:1,totalRows:1,collectedRows:1,complete:true,warnings:[]};
 const collectionProof=await signCollection(meta,table,'owner',token,now);
 const task=await prepareCliTransactions({...evidence,collectionProof},address,'owner',token,now);
 assert.equal(task.context.collection.neighborhood,meta.neighborhood);
 assert.ok(!JSON.stringify(task.context).includes(token));assert.ok(!JSON.stringify(task.context).includes(collectionProof));
 await assert.rejects(prepareCliTransactions({...evidence,collectionProof},address,'different-owner',token,now));
});

test('plot evidence must be fresh and match the requested address and cadastral identifiers',()=>{
 const plot={address,source:'GovMap PARCEL_ALL',gush:'100',parcel:'2',retrievedAt:now.toISOString()};
 assert.equal(plotEvidence(plot,address,now),plot);
 for(const patch of [{address:'other'},{parcel:'0'},{retrievedAt:'2020-01-01'}])assert.throws(()=>plotEvidence({...plot,...patch},address,now));
});

test('section evidence participates in CLI identity and unsupported options stay rejected',()=>{
 const id='849698ca-b7d6-4dbd-b48b-406ef8405a6b';
 const request={action:'createCliJob',schemaVersion:1,requestId:id,connectionId:id,workspaceId:id,sectionId:'plot_description',address,example:'',additionalRequest:'',modelSelection:'provider-default',consent:true,evidence:{parcel:'2'}};
 assert.equal(validateUser(request,100),'createCliJob');
 assert.notEqual(clientIntent(request),clientIntent({...request,evidence:{parcel:'3'}}));
 assert.throws(()=>validateUser({...request,command:'arbitrary shell'},100));
 assert.equal(validateUser({...request,sectionId:'environment_description'},100),'createCliJob');
 assert.throws(()=>environmentEvidence(request.evidence,address,now));
});

const mapData={address,source:'GovMap PARCEL_ALL',gush:'100',parcel:'2',retrievedAt:now.toISOString(),cadastralArea:123,
 borders:[],warnings:['No verified neighborhood name'],rawGovMapResponses:[{secret:'not needed'}],
 spatial:{crs:'EPSG:2039',addressPoint:{x:200000,y:700000},parcelGeometry:'large geometry',geometryDiagnostics:{rawGeometry:'large'},geometryAnalysis:null,
 layers:[{layer:'BUILDINGS',status:'received',fields:{name:'name'},features:[{attributes:{name:'source building'},geometry:'large'}]}],neighbors:[],topography:null,warnings:[]}};
test('environment map data preserves observed facts and warnings, excluding transport and geometry copies',()=>{
 const e=environmentGovMap(mapData);
 assert.equal(e.spatial.layers[0].features[0].attributes.name,'source building');
 assert.equal(e.warnings[0],'No verified neighborhood name');
 assert.ok(!JSON.stringify(e).includes('large'));assert.ok(!JSON.stringify(e).includes('secret'));
 assert.equal(environmentEvidence(e,address,now).collectionMethod,'domain_browser_sdk');
 for(const patch of [{address:'wrong'},{retrievedAt:'2020-01-01'},{gush:'0'},{kind:'arbitrary'},{collectionMethod:'server_verified'}])assert.throws(()=>environmentEvidence({...e,...patch},address,now));
 assert.equal(freshGovMap(mapData,address,now.getTime()),true);
 assert.equal(freshGovMap(mapData,'wrong',now.getTime()),false);
 assert.equal(freshGovMap(mapData,address,now.getTime()+26*60000),false);
});

test('environment evidence reaches the frozen CLI task without replacing the saved agent instructions',async()=>{
 const id='849698ca-b7d6-4dbd-b48b-406ef8405a6b';
 const e=environmentGovMap({...mapData,retrievedAt:new Date().toISOString()});
 const request={action:'createCliJob',schemaVersion:1,requestId:id,connectionId:id,workspaceId:id,sectionId:'environment_description',address,example:'',additionalRequest:'',modelSelection:'provider-default',consent:true,evidence:e};
 let frozen;
 const db={rpc:async(name,args)=>{if(name==='cli_lookup_submission')return {data:null,error:null};frozen=args.p_body;return {data:{job:{id,status:'queued'}},error:null};},from:()=>({select(){return this;},eq(){return this;},async maybeSingle(){return {data:{content:'saved personal instructions',version:4},error:null};}})};
 await cliAction(db,'owner',request,1000);
 assert.equal(frozen.instructions,'saved personal instructions');
 assert.ok(frozen.inputText.includes('source building'));
 assert.ok(frozen.inputText.includes('not independently verified'));
 assert.equal(frozen.plotEvidence.gush,'100');
 assert.notEqual(clientIntent(request),clientIntent({...request,evidence:undefined}));
});
