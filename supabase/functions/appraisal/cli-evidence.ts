import {CliProblem,requireThat,text} from './cli-contracts.ts';
import {analyzeImportedTransactions} from './imported-transactions.ts';
import {compareDirectTransactions} from './nearby-transactions.ts';
import {verifyCollection,type CollectionMeta} from './nadlan-browser.ts';
import type {TransactionResult} from './nearby-transactions.ts';
import type {callProvider} from './providers.ts';
import {Problem} from './providers.ts';
import {collectOverTransactions,overSubject,overPromptInput,overTransactionOutput,OVER_PROMPT,type OverContext} from './over-transactions.ts';

type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj=>{requireThat(v!==null&&typeof v==='object'&&!Array.isArray(v));return v as Obj;};
function keys(value:Obj,allowed:string[]){requireThat(Object.keys(value).every(k=>allowed.includes(k)));}
const options={provider:'CLI',model:'provider-default',key:''};
type TransactionContext={kind:'nadlan';input:{query:unknown;table:unknown;sourceUrl:unknown};collection?:CollectionMeta;createdAt:string}
 | {kind:'govmap';query:unknown;evidence:unknown;createdAt:string} | OverContext;

export function plotEvidence(value:unknown,address:string,now=new Date()){
 const e=obj(value);
 requireThat(e.address===address&&e.source==='GovMap PARCEL_ALL'&&/^[1-9]\d*$/.test(String(e.gush))&&/^[1-9]\d*$/.test(String(e.parcel)));
 requireThat(typeof e.retrievedAt==='string'&&Number.isFinite(Date.parse(e.retrievedAt))&&Math.abs(now.getTime()-Date.parse(e.retrievedAt))<=30*60000);
 return e;
}

// Use the existing source validation and selection pipeline with a capture
// adapter. No provider API call occurs. The exact validated task is frozen.
export async function prepareCliTransactions(value:unknown,address:string,owner:string,collectorToken:string,now=new Date()){
 const e=obj(value);let context:TransactionContext;
 if(e.kind==='over'){
  keys(e,['kind','query']);
  try{
   const subject=overSubject(e.query,now);requireThat(subject.address===address);
   const collected=await collectOverTransactions(e.query,{now});
   requireThat(collected.selected.length>0,'NO_NEARBY_TRANSACTIONS');
   return {context:collected,prompt:OVER_PROMPT,input:overPromptInput(collected)};
  }catch(error){if(error instanceof Problem){const problem=new CliProblem('INVALID_INPUT');problem.message=error.message;throw problem;}throw error;}
 }
 if(e.kind==='nadlan'){
  keys(e,['kind','query','table','sourceUrl','collectionProof']);
  const query=obj(e.query);requireThat(query.address===address);
  text(e.table,1000000,true);text(e.sourceUrl,2000,true);
  const collection=e.collectionProof===undefined?undefined:await verifyCollection(e.collectionProof,e.table,e.sourceUrl,owner,collectorToken,now);
  context={kind:'nadlan',input:{query,table:e.table,sourceUrl:e.sourceUrl},...(collection?{collection}:{}),createdAt:now.toISOString()};
 }else{
  requireThat(e.kind==='govmap');keys(e,['kind','query','evidence']);
  const query=obj(e.query);requireThat(query.address===address);
  context={kind:'govmap',query,evidence:e.evidence,createdAt:now.toISOString()};
 }
 let captured:Parameters<typeof callProvider>[0]|undefined;
 const marker=new Error('capture-only');
 const provider:typeof callProvider=async p=>{captured=p;throw marker;};
 try{await run(context,'',provider);}catch(error){if(error!==marker)throw error;}
 requireThat(captured,'INVALID_INPUT'); // An empty source window never starts AI.
 return {context,prompt:captured.prompt,input:captured.input};
}

async function run(context:TransactionContext,raw:string,provider?:typeof callProvider):Promise<TransactionResult>{
 if(context.kind==='over')return overTransactionOutput(context,raw);
 const deps={now:new Date(context.createdAt),provider:provider??(async()=>raw)};
 return context.kind==='nadlan'
  ? analyzeImportedTransactions(context.input,options,{...deps,collection:context.collection})
  : compareDirectTransactions(context.query,context.evidence,options,deps);
}

export async function cliTransactionOutput(context:unknown,raw:string,provider:string,model:string|null){
 try{
  const result=await run(context as TransactionContext,raw);
  result.provider=provider;result.model=model??'provider-default';
  return result;
 }catch{throw new CliProblem('INVALID_OUTPUT');}
}

export function transactionReport(result:TransactionResult){
 return ['השוואת עסקאות — '+result.query.address,
  ...(result.valuation?[`אומדן אינדיקטיבי: ${result.valuation.estimate??'אין די נתונים'} ₪; טווח ${result.valuation.low??'—'}–${result.valuation.high??'—'} ₪`,result.valuation.explanation,...(result.valuation.assumptions??[])]:[]),
  ...result.transactions.map(t=>`${t.address??t.parcel??t.id} · ${t.date??''} · ${t.amount??'לא ידוע'} ₪ · ${t.area??'לא ידוע'} מ״ר\n${t.aiReason}`),
  ...(result.keyPoints??[]).map(p=>p.text),...result.warnings].join('\n\n');
}
