import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { CliProblem,errorBody,uuid,strictKeys,requireThat,text,digest,dbProblem } from "../appraisal/cli-contracts.ts";
import {validateHostHeartbeat,authorizationUrl,keys,id,requireValue,OnboardingProblem} from "../cli-onboarding/contracts.ts";
const loginActions=new Set(["claimLogin","getLoginAssignment","heartbeatLogin","registerLoginContainer","publishLoginChallenge","consumeLoginCode","beginLoginVerification","completeLogin","reconcileLogin"]);
const setupActions=new Set(["claimSetup","getSetupAssignment","heartbeatSetup","publishSetupChallenge","consumeSetupSecret","completeSetup","reconcileSetup"]);
function validateSetupWorker(b:Record<string,unknown>){
 const base=["schemaVersion","action"];
 if(["claimSetup","getSetupAssignment"].includes(String(b.action))){keys(b,base);return;}
 id(b.sessionId);
 if(b.action==='reconcileSetup'){keys(b,[...base,'sessionId','exclusive']);requireValue(b.exclusive===true);return;}
 id(b.leaseToken);const ids=[...base,'sessionId','leaseToken'];
 if(b.action==='heartbeatSetup')keys(b,ids);
 else if(b.action==='publishSetupChallenge'){
  keys(b,[...ids,'challengeId','keyId','publicKeyJwk']);id(b.challengeId);id(b.keyId);
  const jwk=keys(b.publicKeyJwk,['kty','n','e','alg','key_ops','ext']);requireValue(jwk.kty==='RSA'&&typeof jwk.n==='string'&&/^[A-Za-z0-9_-]{512}$/.test(jwk.n)&&jwk.e==='AQAB');
 }else if(b.action==='consumeSetupSecret'){keys(b,[...ids,'submissionId']);id(b.submissionId);}
 else if(b.action==='completeSetup'){
  keys(b,[...ids,'exclusive','outcome','errorCode','receiptDigest']);requireValue(b.exclusive===true&&['saved','removed','failed'].includes(String(b.outcome)));
  requireValue(typeof b.receiptDigest==='string'&&/^[0-9a-f]{64}$/.test(b.receiptDigest));
  requireValue(b.errorCode===null||['MAPS_INVALID_KEY','MAPS_QUOTA_EXCEEDED','MAPS_PROTOCOL_CHANGED','SETUP_EXPIRED','WORKER_LOST','CANCELLED','MAPS_SETUP_FAILED'].includes(String(b.errorCode)));
 }
}
function validateLoginWorker(b:Record<string,unknown>){
 const base=["schemaVersion","action"];
 if(["claimLogin","getLoginAssignment"].includes(String(b.action))){keys(b,base);return;}
 id(b.sessionId);
 if(b.action==="reconcileLogin"){keys(b,[...base,"sessionId","stopped"]);requireValue(b.stopped===true);return;}
 id(b.leaseToken);const ids=[...base,"sessionId","leaseToken"];
 if(["heartbeatLogin","beginLoginVerification"].includes(String(b.action)))keys(b,ids);
 else if(b.action==="consumeLoginCode"){keys(b,[...ids,"submissionId"]);id(b.submissionId);}
 else if(b.action==="registerLoginContainer"){
  keys(b,[...ids,"containerRef","containerKind","previousStopped"]);requireValue(["login","login_verification"].includes(String(b.containerKind))&&typeof b.previousStopped==="boolean");
  requireValue(b.containerRef==="cli-login-"+b.sessionId+(b.containerKind==="login"?"-auth":"-verify"));
 }else if(b.action==="publishLoginChallenge"){
  keys(b,[...ids,"challengeId","keyId","authorizationUrl","publicKeyJwk","expiresAt"]);id(b.challengeId);id(b.keyId);authorizationUrl(b.authorizationUrl);
  const jwk=keys(b.publicKeyJwk,["kty","n","e","alg","key_ops","ext"]);requireValue(jwk.kty==="RSA"&&typeof jwk.n==="string"&&/^[A-Za-z0-9_-]{512}$/.test(jwk.n)&&jwk.e==="AQAB");
  requireValue(typeof b.expiresAt==="string"&&Number.isFinite(Date.parse(b.expiresAt)));
 }else if(b.action==="completeLogin"){
  keys(b,[...ids,"stopped","outcome","errorCode","receiptDigest"]);requireValue(b.stopped===true&&["succeeded","quota_blocked","plan_blocked","failed"].includes(String(b.outcome)));
  requireValue(typeof b.receiptDigest==="string"&&/^[0-9a-f]{64}$/.test(b.receiptDigest));
  requireValue(b.errorCode===null||["AUTH_REQUIRED","LOGIN_PROTOCOL_CHANGED","LOGIN_EXPIRED","WORKER_LOST","CANCELLED","CLI_FAILED","INVALID_CODE","MANIFEST_MISMATCH"].includes(String(b.errorCode)));
 }
}
const headers={"Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const errors=new Set(["AUTH_REQUIRED","PLAN_REQUIRED","QUOTA_EXCEEDED","TIMEOUT","OUTPUT_LIMIT","INVALID_OUTPUT","CLI_FAILED","ACCESS_REVOKED","WORKER_LOST","OUTCOME_UNCERTAIN","CONNECTION_CHANGED","CANCELLED"]);
export async function workerHandler(req:Request){
  try{
    requireThat(req.method==="POST","UNSUPPORTED_CAPABILITY");
    const host=uuid(req.headers.get("X-CLI-Host-ID"));
    const token=req.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1];
    requireThat(token,"UNAUTHENTICATED");
    const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
    const auth=await db.rpc("cli_authenticate_host",{p_host:host,p_hash:await digest(token)});
    requireThat(!auth.error&&auth.data===true,"UNAUTHENTICATED");
    const reader=req.body?.getReader();requireThat(reader);
    let size=0;const chunks:Uint8Array[]=[];
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1048576){await reader.cancel();throw new CliProblem("INPUT_TOO_LARGE");}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    let b:Record<string,unknown>;try{b=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw new CliProblem("INVALID_INPUT");}
    const base=["schemaVersion","action"];
    requireThat(b.schemaVersion===1);
    const action=b.action;
    if(setupActions.has(String(action))){
      validateSetupWorker(b);const response=await db.rpc('cli_maps_worker_action',{p_host:host,p_action:action,p_body:b});dbProblem(response.error);return reply(response.data);
    }
    if(loginActions.has(String(action))){
      validateLoginWorker(b);
      const response=await db.rpc("cli_onboarding_worker_action",{p_host:host,p_action:action,p_body:b});dbProblem(response.error);return reply(response.data);
    }
    if(action==="heartbeatHost"){
      validateHostHeartbeat(b);
    }else if(["claim","getAssignment","getMaintenance","quarantineHost"].includes(String(action)))strictKeys(b,base);
    else if(action==="reportConnection"){
      strictKeys(b,[...base,"connectionId","revision","status"]);uuid(b.connectionId);requireThat(Number.isSafeInteger(b.revision)&&Number(b.revision)>0);
      requireThat(["connected","reauth_required","disconnected"].includes(String(b.status)));
    }else{
      const ids=[...base,"jobId","attemptNumber","leaseToken"];
      uuid(b.jobId);uuid(b.leaseToken);requireThat(b.attemptNumber===1);
      if(action==="heartbeatJob")strictKeys(b,ids);
      else if(action==="authorizeStart") {strictKeys(b,[...ids,"containerRef"]);text(b.containerRef,80,true);}
      else if(action==="reconcile") {strictKeys(b,[...ids,"containerRef","stopped"]);text(b.containerRef,80,true);requireThat(typeof b.stopped==="boolean");}
      else if(action==="complete"){
        strictKeys(b,[...ids,"containerRef","stopped","result"]);text(b.containerRef,80,true);requireThat(b.stopped===true);
        const result=b.result as Record<string,unknown>;
        strictKeys(result,["text","model","inputTokens","outputTokens","errorCode"]);
        requireThat(result.errorCode===null||errors.has(String(result.errorCode)));
        requireThat(result.errorCode===null?typeof result.text==="string"&&result.text.trim().length>0:result.text===null,"INVALID_OUTPUT");
        if(result.text!==null)requireThat(new TextEncoder().encode(text(result.text,262144,true)).length<=262144,"INPUT_TOO_LARGE");
        if(result.model!==null)text(result.model,160,true);
        for(const k of ["inputTokens","outputTokens"])requireThat(result[k]===null||(Number.isSafeInteger(result[k])&&Number(result[k])>=0&&Number(result[k])<=1e12));
        b.resultDigest=await digest(JSON.stringify({text:result.text,model:result.model,inputTokens:result.inputTokens,outputTokens:result.outputTokens,errorCode:result.errorCode}));
      }else throw new CliProblem("UNSUPPORTED_CAPABILITY");
    }
    const response=await db.rpc("cli_worker_action",{p_host:host,p_action:action,p_body:b});dbProblem(response.error);
    return reply(response.data);
  }catch(error){if(error instanceof OnboardingProblem)return reply({error:{code:error.code,message:"Login protocol request rejected",retryable:false}},error.status);return reply(errorBody(error),error instanceof CliProblem?error.status:500);}
}
if(import.meta.main)Deno.serve(workerHandler);
