import { CliProblem,validateUser,digest,clientIntent,dbProblem,decorateJob,LIMIT } from "./cli-contracts.ts";
import { generationInput } from "./generation-input.ts";
import {plotEvidence,prepareCliTransactions,cliTransactionOutput,transactionReport} from './cli-evidence.ts';

// Matches the existing SDK without coupling shared validation to its runtime.
type DB = {rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:any}>;from:(name:string)=>any};
export async function cliAction(db:DB,user:string,b:Record<string,unknown>,size:number,dependencies:{collectorToken?:string}={}){
  const action=validateUser(b,size);
  let body={...b};
  if(action==="createCliJob") {
    body.requestHash=await digest(clientIntent(b));
    const previous=await db.rpc("cli_lookup_submission",{p_user:user,p_request:b.requestId,p_hash:body.requestHash});
    dbProblem(previous.error);
    if(previous.data?.job)return {data:await presentation(db,previous.data),status:["queued","running","cancel_requested"].includes(previous.data.job.status)?202:200};
    if(b.modelSelection!=='provider-default'||(b.evidence as {kind?:string}|undefined)?.kind==='over'){
      const accounts=await db.rpc('cli_user_action',{p_user:user,p_action:'listCliConnections',p_body:{}});dbProblem(accounts.error);
      if(!accounts.data?.providers?.some((p:{provider:string;connection?:{id:string;status:string}})=>p.provider==='claude'&&p.connection?.id===b.connectionId&&p.connection.status==='connected'))throw new CliProblem('CONNECTION_CHANGED');
    }
  }
  for(let attempt=0;attempt<2;attempt++){
    if(action==="createCliJob"){
      const section=String(b.sectionId);
      const snapshot=await db.from("agent_prompts").select("content,version").eq("user_id",user).eq("section_id",section).maybeSingle();
      dbProblem(snapshot.error);
      let evidence:Record<string,unknown>|null=null,context:unknown=null;
      let frozen;
      if(section==='comparable_sales'){
        const task=await prepareCliTransactions(b.evidence,String(b.address),user,dependencies.collectorToken??'');
        context=task.context;
        const contract=task.context.kind==='over'?task.prompt:task.context.kind==='govmap'?'Return only JSON with assessments [{id,reason,descriptionScore}]. Include each supplied candidate ID exactly once.':'Return only JSON with selected [{id,reason,descriptionScore}] and keyPoints [{text,transactionIds}].';
        frozen={prompt:(task.context.kind==='over'?task.prompt:snapshot.data?.content??task.prompt)+'\n\n'+(task.context.kind==='over'?'':contract)+' Use only candidate IDs and source facts in the supplied task. No other output.',input:task.input+'\n\nAdditional request (user data):\n'+String(b.additionalRequest)};
      }else{
        if(section==='plot_description')evidence=plotEvidence(b.evidence,String(b.address));
        frozen=generationInput(section,snapshot.data?.content,String(b.address),String(b.example),String(b.additionalRequest),evidence?JSON.stringify(evidence):'');
      }
      if(new TextEncoder().encode(frozen.prompt+"\n\n"+frozen.input).length>LIMIT)throw new CliProblem("INPUT_TOO_LARGE");
      body={...body,plotEvidence:evidence,cliContext:context,instructions:frozen.prompt,inputText:frozen.input,promptVersion:snapshot.data?.version??0,payloadDigest:await digest(frozen.prompt+"\n\n"+frozen.input)};
    }
    const result=await db.rpc("cli_user_action",{p_user:user,p_action:action,p_body:body});
    if(result.error?.message==="PROMPT_CHANGED"&&attempt===0)continue;
    dbProblem(result.error);
    const data=await presentation(db,result.data);
    return {data,status:action==="requestCliConnection"||action==="disconnectCliConnection"?202:data.job&&["queued","running","cancel_requested"].includes(data.job.status)?202:200};
  }
  throw new CliProblem("PROMPT_CHANGED");
}

async function presentation(db:DB,data:any){
 if(data.job?.sectionId==='comparable_sales'&&data.job?.output?.text){
  const snapshot=await db.from('generation_jobs').select('cli_context').eq('id',data.job.id).maybeSingle();dbProblem(snapshot.error);
  try{
   const result=await cliTransactionOutput(snapshot.data?.cli_context,data.job.output.text,data.job.provider,data.job.modelResolved);
   data.job.output={text:transactionReport(result),data:result};
  }catch{data.job.status='failed';data.job.output=null;data.job.error={code:'INVALID_OUTPUT',retryable:false};}
 }
 return decorateJob(data);
}
