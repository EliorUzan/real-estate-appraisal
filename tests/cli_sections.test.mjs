import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareCliTransactions,cliTransactionOutput,plotEvidence} from '../supabase/functions/appraisal/cli-evidence.ts';
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
 assert.throws(()=>validateUser({...request,sectionId:'environment_description'},100));
});
