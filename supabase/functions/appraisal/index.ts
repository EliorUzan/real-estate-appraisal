import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import catalog from "./catalog.json" with { type: "json" };
import { generationInput } from "./generation-input.ts";
import { cliAction } from "./cli-actions.ts";
import {wakeQueuedJob} from "./queued-host-wake.ts";
import {wakeConfig} from "../cli-onboarding/host-wake.ts";
import {cliTransactionOutput,transactionReport} from './cli-evidence.ts';
import { CLI_ACTIONS, CliProblem, errorBody } from "./cli-contracts.ts";
import { findNearbyTransactions, prepareDirectTransactionSearch, compareDirectTransactions, validateTransactionInput, resolveQuery } from "./nearby-transactions.ts";
import { analyzeImportedTransactions } from "./imported-transactions.ts";
import { runNadlanAgent } from "./nadlan-agent.ts";
import { collectNadlanTransactions, verifyCollection } from "./nadlan-browser.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
import { Problem, check, callProvider, type FileInput } from "./providers.ts";
const digest = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map(v => v.toString(16).padStart(2,"0")).join("");
function field(value: unknown, max: number, required = false): string {
  check(typeof value === "string" && value.length <= max && (!required || value.trim().length), "Invalid or missing input");
  return (value as string).trim();
}

export async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response(null,{headers});
  if (req.method !== "POST") return reply({error:"Method not allowed"},405);
  try {
    const token = req.headers.get("Authorization")?.replace(/^Bearer /,"");
    if (!token) throw new Problem(401,"Sign in to continue");
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:authError} = await db.auth.getUser(token);
    if (authError || !user) throw new Problem(401,"Your session expired. Sign in again.");
    const {data:members,error:memberError} = await db.from("workspace_members").select("workspace_id,role,workspaces!inner(status)").eq("user_id",user.id).eq("status","active").eq("workspaces.status","active");
    if (memberError || !members?.length) throw new Problem(403,"Your account is not an active member of this team.");
    // Bound streamed input as well as Content-Length; raw files live only in request memory.
    const reader = req.body?.getReader(); let size=0; const chunks: Uint8Array[]=[];
    if (!reader) throw new Problem(400,"Missing body");
    for (;;) { const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>15000000){await reader.cancel();throw new Problem(413,"Request exceeds the 10 MB file limit");} chunks.push(value); }
    const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const b = JSON.parse(new TextDecoder().decode(bytes));
    if (CLI_ACTIONS.has(b?.action)) {
      try { const result=await cliAction(db,user.id,b,size,{collectorToken:Deno.env.get('NADLAN_BROWSER_TOKEN')});await wakeQueuedJob(db,user.id,result.data.job,wakeConfig(name=>Deno.env.get(name)));return reply(result.data,result.status); }
      catch(error){return reply(errorBody(error,typeof b.requestId==="string"?b.requestId:undefined),error instanceof CliProblem?error.status:500);}
    }
    const failDb = (error: unknown) => { if(error) throw new Problem(500,"Database operation failed. Changes were not confirmed."); };
    if (b.action === "createUser") {
      if(!members.some(m=>m.workspace_id===b.workspace && m.role==="admin"))throw new Problem(403,"Only a workspace administrator can create users.");
      const email=field(b.email,254,true).toLowerCase();
      check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),"Invalid email address");
      check(typeof b.password==="string" && b.password.length>=6 && b.password.length<=128,"Password must be 6–128 characters");
      const created=await db.auth.admin.createUser({email,password:b.password,email_confirm:true});
      if(created.error)throw new Problem(400,"The account could not be created. The email may already exist or the password may not meet policy.");
      const id=created.data.user.id;
      const membership=await db.from("workspace_members").insert({workspace_id:b.workspace,user_id:id,role:"member",status:"active"});
      if(membership.error){await db.auth.admin.deleteUser(id);throw new Problem(500,"Team setup failed; no active account was created.");}
      const profile=await db.from("profiles").insert({user_id:id,default_provider:"openai"});
      if(profile.error)throw new Problem(500,"Account exists, but its profile setup failed. Contact the administrator.");
      return reply({ok:true,email});
    }
    if (b.action === "bootstrap") {
      const [settings,prompts,profile] = await Promise.all([
        db.from("provider_settings").select("provider_id,model_id,configured,key_last4").eq("user_id",user.id),
        db.from("agent_prompts").select("section_id,content,version,updated_at").eq("user_id",user.id),
        db.from("profiles").select("default_provider").eq("user_id",user.id).maybeSingle(),
      ]);
      failDb(settings.error || prompts.error || profile.error);
      return reply({settings:settings.data,prompts:prompts.data,members,defaultProvider:profile.data?.default_provider ?? "openai",nadlanConfigured:!!Deno.env.get("NADLAN_MCP_URL"),nadlanBrowserConfigured:!!Deno.env.get("NADLAN_BROWSER_URL") && !!Deno.env.get("NADLAN_BROWSER_TOKEN")});
    }
    if (b.action === "saveProvider") {
      check(catalog.providers.some(p=>p.id===b.provider), "Unknown provider");
      const model=field(b.model,160,true);
      const key=b.key ? field(b.key,4096,true) : null;
      if(key) check(key.length>=8 && !/\s/.test(key),"API key format is invalid");
      const {error}=await db.rpc("poc_save_provider",{p_user:user.id,p_provider:b.provider,p_model:model,p_key:key});
      failDb(error);
      const setting=await db.from("provider_settings").select("provider_id,model_id,configured,key_last4").eq("user_id",user.id).eq("provider_id",b.provider).single();
      failDb(setting.error); return reply(setting.data);
    }
    if (b.action === "defaultProvider") {
      check(catalog.providers.some(p=>p.id===b.provider),"Unknown provider");
      const {error}=await db.from("profiles").upsert({user_id:user.id,default_provider:b.provider},{onConflict:"user_id"}); failDb(error); return reply({ok:true});
    }
    if (b.action === "savePrompt") {
        check(b.section === "plot_description" || catalog.sections.some(s=>s.id===b.section),"Unknown section");
      const content=field(b.content,50000,true);
      check(Number.isInteger(b.version) && b.version>=0,"Invalid version");
      const {error}=await db.rpc("poc_save_prompt",{p_user:user.id,p_section:b.section,p_content:content,p_expected:b.version});
      if(error?.message.includes("PROMPT_CONFLICT")) throw new Problem(409,"This agent was edited in another tab. Reload its latest version before saving.");
      failDb(error);
      return reply({section_id:b.section,content,version:b.version+1});
    }
    if (b.action === "history") {
      const results=await Promise.all(members.flatMap(m=>["environment_description","plot_description","comparable_sales"].map(section=>
        db.from("generation_jobs").select("id,address,section_id,workspace_id,provider_id,model_id,status,error_code,created_at,owner_id,execution_mode,resolved_model_id")
          .eq("workspace_id",m.workspace_id).eq("section_id",section).is("deleted_at",null)
          .order("created_at",{ascending:false}).order("id",{ascending:false}).limit(10))));
      results.forEach(r=>failDb(r.error));
      return reply({jobs:results.flatMap(r=>r.data??[]).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id))});
    }
    if (b.action === "historyDetail") {
      const id=field(b.id,36,true);
      check(/^[0-9a-f-]{36}$/.test(id),"Invalid history id");
      const {data,error}=await db.from("generation_jobs").select("id,output_text,plot_evidence,additional_request,section_id,provider_id,resolved_model_id,cli_context")
        .eq("id",id).in("workspace_id",members.map(m=>m.workspace_id)).is("deleted_at",null).maybeSingle();
      failDb(error);
      if(!data)throw new Problem(404,"הרשומה אינה זמינה או הוסרה בהתאם למגבלת ההיסטוריה. רעננו את הרשימה.");
      if(data.section_id==='comparable_sales'&&data.output_text){
        try{const result=await cliTransactionOutput(data.cli_context,data.output_text,data.provider_id,data.resolved_model_id);return reply({job:{id:data.id,output_text:transactionReport(result),plot_evidence:null,additional_request:data.additional_request,transaction_result:result}});}
        catch{return reply({job:{id:data.id,output_text:null,plot_evidence:null,additional_request:data.additional_request,analysis_error:'תשובת הסוכן לא עברה אימות מול עסקאות המקור.'}});}
      }
      const {cli_context:_context,...detail}=data;void _context;return reply({job:detail});
    }
    if (b.action === "collectNadlanTransactions") {
      check(b.consent === true, "יש לאשר את האיסוף מ־Nadlan ואת שליחת הנתונים לספק AI.");
      return reply(await collectNadlanTransactions(b, user.id, {endpoint:Deno.env.get("NADLAN_BROWSER_URL") ?? "",token:Deno.env.get("NADLAN_BROWSER_TOKEN") ?? ""}));
    }
    if (["nearbyTransactions", "prepareNearbyTransactions", "compareNearbyTransactions", "analyzeImportedTransactions", "analyzeNadlanAgent"].includes(b.action)) {
      check(b.consent === true, "יש לאשר את שליחת הנתונים לספקים המוצגים בטופס.");
      if(b.action==='prepareNearbyTransactions'&&b.executionMode==='cli')return reply(resolveQuery(validateTransactionInput(b.query),{}));
      check(catalog.providers.some(p => p.id === b.provider), "Unknown provider");
      const model = field(b.model, 160, true);
      const query = validateTransactionInput(b.query);
      const secret = await db.rpc("poc_provider_secret", {p_user:user.id,p_provider:b.provider});
      failDb(secret.error);
      check(secret.data, "יש לשמור מפתח API לספק הנבחר בהגדרות.");
      const aiOptions = { provider: b.provider, model, key: secret.data };
      if (b.action === "analyzeImportedTransactions" || b.action === "analyzeNadlanAgent") {
        const collection = b.collectionProof === undefined ? undefined : await verifyCollection(b.collectionProof, b.table, b.sourceUrl, user.id, Deno.env.get("NADLAN_BROWSER_TOKEN") ?? "");
        const analyze = b.action === "analyzeNadlanAgent" ? runNadlanAgent : analyzeImportedTransactions;
        return reply(await analyze({ query, sourceUrl: b.sourceUrl, table: b.table }, aiOptions, { collection }));
      }
      if (b.action === "prepareNearbyTransactions") return reply(await prepareDirectTransactionSearch(query, aiOptions));
      if (b.action === "compareNearbyTransactions") return reply(await compareDirectTransactions(query, b.evidence, aiOptions));
      // This is an ephemeral appraiser helper, never a generation_job or report revision.
      return reply(await findNearbyTransactions(query, {provider:b.provider,model,key:secret.data,
        endpoint:Deno.env.get("NADLAN_MCP_URL") ?? "",token:Deno.env.get("NADLAN_MCP_TOKEN") ?? ""}));
    }
    if (b.action !== "generate") throw new Problem(400,"Unknown action");
      check(["environment_description","plot_description"].includes(b.section),"This section is not yet implemented in the desktop or web app.");
    // Keep user requests within the database limit. Structured mapping evidence
    // travels separately so it cannot overflow additional_request.
    const address=field(b.address,500,true), example=field(b.example??"",20000), additional=field(b.additional??"",20000);
    const plotEvidence=b.section==="plot_description" ? field(b.plotEvidence,1000000,true) : "";
    if(plotEvidence){
      const evidence=JSON.parse(plotEvidence);
      check(evidence.address===address && /^\d+$/.test(String(evidence.gush)) && /^\d+$/.test(String(evidence.parcel)),"Parcel evidence does not match the requested address");
    }
    check(b.consent===true,"Confirm sending the supplied information to the selected AI provider.");
    check(/^[0-9a-f-]{36}$/.test(b.requestId),"Invalid request id");
    check(members.some(m=>m.workspace_id===b.workspace),"Invalid workspace");
    check(catalog.providers.some(p=>p.id===b.provider),"Unknown provider");
    const model=field(b.model,160,true);
    const files: FileInput[]=b.files??[];
    check(Array.isArray(files) && files.length<=5,"Maximum 5 files");
    let total=0;
    for(const f of files){
      field(f.name,255,true); check(["example","additional"].includes(f.role),"Invalid file role");
      check(["application/pdf","text/plain"].includes(f.type) && typeof f.data==="string","Unsupported file type");
      const binary=atob(f.data); total+=binary.length;
      if(f.type==="application/pdf")check(binary.startsWith("%PDF-"),"Invalid PDF");
    }
    check(total<=10*1024*1024,"Files exceed 10 MB");
    const requestHash=await digest(JSON.stringify({workspace:b.workspace,section:b.section,address,example,additional,plotEvidence,provider:b.provider,model,files,search:!!b.search}));
    const previous=await db.from("generation_jobs").select("id,status,output_text,request_hash,deleted_at").eq("owner_id",user.id).eq("idempotency_key",b.requestId).maybeSingle();
    failDb(previous.error);
    if(previous.data){
      if(previous.data.request_hash!==requestHash)throw new Problem(409,"Request ID already used with different content");
      if(previous.data.deleted_at)throw new Problem(410,"This request has expired from history. No new AI request was made.");
      return reply({job:previous.data});
    }
    const [{data:setting,error:settingError},{data:promptRow,error:promptError}]=await Promise.all([
      db.from("provider_settings").select("credential_version,configured").eq("user_id",user.id).eq("provider_id",b.provider).maybeSingle(),
      db.from("agent_prompts").select("content").eq("user_id",user.id).eq("section_id",b.section).maybeSingle(),
    ]);
    failDb(settingError||promptError);
    check(setting?.configured,"Save an API key for this provider in Settings first.");
    const secret=await db.rpc("poc_provider_secret",{p_user:user.id,p_provider:b.provider});failDb(secret.error);
    check(secret.data,"No saved API key for this provider.");
    const {prompt,input}=generationInput(b.section,promptRow?.content,address,example,additional,plotEvidence);
    const created=await db.from("generation_jobs").insert({
      workspace_id:b.workspace,owner_id:user.id,section_id:b.section,address,example_text:example,additional_request:additional,
      plot_evidence:plotEvidence?JSON.parse(plotEvidence):null,
      provider_id:b.provider,model_id:model,credential_version:setting!.credential_version,prompt_hash:await digest(prompt),
      consent_version:"provider-transmission-v1",consented_at:new Date().toISOString(),idempotency_key:b.requestId,request_hash:requestHash,
      status:"running",stage:"calling_provider",attempt:1,started_at:new Date().toISOString(),
    }).select("id").single();
    if(created.error?.code==="23505") throw new Problem(409,"This request is already running. Check History.");
    failDb(created.error);
    const jobId=created.data!.id;
    let providerReturned=false;
    try {
      const output=await callProvider({provider:b.provider,model,key:secret.data,prompt,input,files,search:!!b.search});
      providerReturned=true;
      const done=await db.rpc("poc_finish_job",{p_job:jobId,p_user:user.id,p_text:output});failDb(done.error);
      return reply({job:{id:jobId,status:"succeeded",output_text:output}});
    } catch(error) {
      const uncertain=providerReturned || !(error instanceof Problem);
      await db.rpc("poc_fail_job",{p_job:jobId,p_user:user.id,p_uncertain:uncertain});
      if(uncertain)throw new Problem(504,"The request could not be confirmed. Check History before starting another request; the provider may have charged it.");
      throw error;
    }
  } catch(error) {
    return reply({error:error instanceof Problem ? error.message : "Request failed. Check your inputs and try again."},error instanceof Problem?error.status:400);
  }
}
if (import.meta.main) Deno.serve(handler);
