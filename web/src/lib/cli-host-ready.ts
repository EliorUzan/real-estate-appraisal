import type {CliProviderStatus} from './cli-status';
import type {OnboardingStatus} from './cli-onboarding';
import {onboardingMessage} from '../../../supabase/functions/cli-onboarding/messages.ts';
export function canWakeForPrompt(provider:CliProviderStatus|undefined,status:OnboardingStatus|null,verified:boolean){
 return verified&&provider?.provider==='gemini'&&provider.enabled&&provider.connection?.status==='connected'&&status?.connectionId===provider.connection.id&&status?.nextAction==='start_host'&&status.hostState==='asleep'&&status.wake.configured;
}
export async function waitForCliHost(requestId:string,connectionId:string,options:{signal:AbortSignal;wake:(id:string)=>Promise<unknown>;status:()=>Promise<OnboardingStatus>;connections:()=>Promise<{providers:CliProviderStatus[]}>;now?:()=>number;delay?:()=>Promise<void>}){
 const now=options.now??(()=>performance.now()),start=now();
 const check=()=>{if(options.signal.aborted)throw new DOMException('Cancelled','AbortError');};
 const delay=options.delay??(()=>new Promise<void>((resolve,reject)=>{
  const cancel=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};
  const timer=setTimeout(()=>{options.signal.removeEventListener('abort',cancel);resolve();},2000);
  options.signal.addEventListener('abort',cancel,{once:true});if(options.signal.aborted)cancel();
 }));
 check();await options.wake(requestId);
 while(now()-start<180000){
  check();const [state,available]=await Promise.all([options.status(),options.connections()]);check();
  if(state.wake.state==='failed')throw new Error(onboardingMessage(state.wake.errorCode??'HOST_START_FAILED'));
  if(state.hostState==='quarantined'||state.hostState==='draining')throw new Error(onboardingMessage('HOST_RECOVERY_REQUIRED'));
  if(available.providers.some(p=>p.provider==='gemini'&&p.enabled&&p.connection?.id===connectionId&&p.connection.status==='connected'&&p.connection.available))return;
  await delay();
 }
 throw new Error(onboardingMessage('HOST_START_TIMEOUT'));
}
