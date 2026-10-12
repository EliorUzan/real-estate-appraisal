import {createClient} from "npm:@supabase/supabase-js@2.49.1";
import {MAX_ONBOARDING_BODY,OnboardingProblem,validateUserAction} from "./contracts.ts";
import {onboardingMessage} from "./messages.ts";
import {wakeConfig,advanceHostWake} from "./host-wake.ts";
import {onboardingOrigins} from "./origins.ts";

export async function onboardingHandler(req:Request){
 const origin=req.headers.get("Origin");
 const origins=onboardingOrigins(Deno.env.get("CLI_ONBOARDING_ORIGINS"));
 const headers:Record<string,string>={"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin"};
 if(origin&&origins.includes(origin))Object.assign(headers,{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"});
 const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
 try{
  if(origin&&!origins.includes(origin))throw new OnboardingProblem("ORIGIN_DENIED",403);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(req.method!=="POST")throw new OnboardingProblem("INVALID_INPUT",405);
  const token=req.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if(!token)throw new OnboardingProblem("UNAUTHENTICATED",401);
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await db.auth.getUser(token);
  if(error||!user)throw new OnboardingProblem("UNAUTHENTICATED",401);
  const reader=req.body?.getReader();if(!reader)throw new OnboardingProblem("INVALID_INPUT");
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_ONBOARDING_BODY){await reader.cancel();throw new OnboardingProblem("INPUT_TOO_LARGE",413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  let value:unknown;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw new OnboardingProblem("INVALID_INPUT");}
  const b=validateUserAction(value,size);
  const config=wakeConfig(name=>Deno.env.get(name));
  if(b.action==="ensureCliHostReady"&&!config)throw new OnboardingProblem("HOST_WAKE_NOT_CONFIGURED",503);
  const mapsAction=["getMapsDemoSetup","startMapsDemoSetup","getMapsDemoChallenge","submitMapsDemoKey","cancelMapsDemoSetup","removeMapsDemoKey"].includes(String(b.action));
  const response=await db.rpc(mapsAction?"cli_maps_user_action":b.action==="ensureCliHostReady"?"cli_host_wake_user_action":"cli_onboarding_user_action",{p_user:user.id,p_action:b.action,p_body:b});
  if(response.error){
   const code=response.error.message;
   const statuses:Record<string,number>={UNAUTHENTICATED:401,INACTIVE_MEMBERSHIP:403,ONBOARDING_DISABLED:403,OPERATOR_REQUIRED:403,NOT_FOUND:404,REQUEST_ID_CONFLICT:409,CONNECTION_CHANGED:409,CONNECTION_BUSY:409,VERIFICATION_REQUIRED:409,LOGIN_EXPIRED:410,SETUP_EXPIRED:410,QUEUE_FULL:429,WORKER_UNAVAILABLE:503,AUTH_REQUIRED:409,HOST_WAKE_NOT_CONFIGURED:503,HOST_RECOVERY_REQUIRED:503};
   if(!(code in statuses))throw new OnboardingProblem("REQUEST_FAILED",500);
   throw new OnboardingProblem(code,statuses[code]);
  }
  const data=response.data;
  // Status polling reconciles an already-authorized wake after its initial HTTP
  // request, including readiness and timeout. It cannot create a wake operation.
  if(b.action==="ensureCliHostReady"||b.action==="getCliOnboarding")await advanceHostWake(db,config);
  if(b.action==="getCliOnboarding"){
   const wake=await db.rpc("cli_host_wake_user_action",{p_user:user.id,p_action:"getCliHostWake",p_body:{}});
   if(!wake.error)data.wake={configured:!!config&&wake.data.permitted,state:wake.data.state,errorCode:wake.data.errorCode};
  }
  if(data?.session?.error)data.session.error.message=onboardingMessage(data.session.error.code);
  return reply(data,["startCliLogin","verifyCliConnection","submitCliLoginCode","cancelCliLogin"].includes(String(b.action))?202:200);
 }catch(error){
  const problem=error instanceof OnboardingProblem?error:new OnboardingProblem("REQUEST_FAILED",500);
  return reply({error:{code:problem.code,message:onboardingMessage(problem.code),retryable:false}},problem.status);
 }
}
if(import.meta.main)Deno.serve(onboardingHandler);
