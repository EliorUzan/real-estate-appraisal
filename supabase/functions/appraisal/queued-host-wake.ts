import {advanceHostWake,type WakeConfig} from '../cli-onboarding/host-wake.ts';

type DB={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:any}>};
type OwnedJob={id:string;status:string;provider:string;executionMode:string};

// Only call with the result of an ownership-checked CLI action. A heartbeat can
// look fresh briefly after the host stops, so admission alone cannot ensure pickup.
// Polling the existing job may wake its host, but never creates/replays inference.
export async function wakeQueuedJob(db:DB,user:string,job:OwnedJob|undefined,config:WakeConfig|null,fetcher:typeof fetch=fetch){
 if(!config||job?.status!=='queued'||job.provider!=='gemini'||job.executionMode!=='cli')return;
 try{
  const requested=await db.rpc('cli_host_wake_user_action',{p_user:user,p_action:'ensureCliHostReady',p_body:{requestId:job.id}});
  if(requested.error||!['requested','starting'].includes(requested.data?.state))return;
  await advanceHostWake(db,config,fetcher);
 }catch{
  // Availability must not turn an already-accepted job into an ambiguous submit
  // failure. The next status poll can reconcile the same durable wake operation.
 }
}
