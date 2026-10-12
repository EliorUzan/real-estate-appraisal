// Fixed owner Codespace only. The GitHub credential never reaches the worker/browser.
type DB={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:any}>};
export type WakeConfig={token:string;name:string;owner:string;repository:string};
export function wakeConfig(get:(name:string)=>string|undefined):WakeConfig|null{
 const token=get("CLI_CODESPACE_GITHUB_TOKEN"),name=get("CLI_CODESPACE_NAME"),owner=get("CLI_CODESPACE_OWNER"),repository=get("CLI_CODESPACE_REPOSITORY");
 if(!token||!name||!owner||!repository)return null;
 if(!/^[a-z0-9-]{1,100}$/.test(name)||! /^[A-Za-z0-9-]{1,39}$/.test(owner)||! /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))return null;
 return {token,name,owner,repository};
}
class WakeFailure extends Error{constructor(public code:string){super(code);}}
export async function advanceHostWake(db:DB,config:WakeConfig|null,fetcher:typeof fetch=fetch){
 if(!config)return;
 const claimed=await db.rpc("cli_host_wake_control",{p_action:"claim",p_body:{}});if(claimed.error||!claimed.data?.wake)return;
 const wake=claimed.data.wake,ids={operationId:wake.operationId,leaseToken:wake.leaseToken};let errorCode:string|null=null;
 try{
  const request=async(method:string,suffix="")=>{
   const response=await fetcher("https://api.github.com/user/codespaces/"+config.name+suffix,{method,redirect:"error",signal:AbortSignal.timeout(10000),headers:{Authorization:"Bearer "+config.token,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2026-03-10"}});
   if(!response.ok)throw new WakeFailure(response.status===401?"HOST_AUTH_REQUIRED":response.status===404?"HOST_NOT_FOUND":response.status===403?"HOST_PERMISSION_OR_ALLOWANCE":response.status===429?"HOST_RATE_LIMITED":"HOST_START_FAILED");
   const text=await response.text();if(text.length>65536)throw new WakeFailure("HOST_START_FAILED");
   return text?JSON.parse(text):{};
  };
  const current=await request("GET");
  if(current.name!==config.name||current.owner?.login!==config.owner||current.repository?.full_name!==config.repository)throw new WakeFailure("HOST_SCOPE_MISMATCH");
  if(current.state==="Shutdown"&&!wake.startRequested){
   const marked=await db.rpc("cli_host_wake_control",{p_action:"markStart",p_body:ids});
   if(marked.error)throw new WakeFailure("HOST_START_FAILED");
   if(marked.data?.authorized)await request("POST","/start");
  }else if(typeof current.state!=="string"||["Failed","Deleted","Archived","Moved"].includes(current.state))throw new WakeFailure("HOST_RECOVERY_REQUIRED");
  // GitHub can return additional transitional states during startup. Do not
  // start again or declare readiness from those states: wait within the durable
  // deadline for the approved worker heartbeat. Unknown states cannot widen
  // access or submit inference; only Shutdown authorizes the one start above.
 }catch(e){errorCode=e instanceof WakeFailure?e.code:"HOST_START_FAILED";}
 // A fresh approved worker heartbeat is the only readiness proof.
 await db.rpc("cli_host_wake_control",{p_action:"finish",p_body:{...ids,errorCode}});
}
