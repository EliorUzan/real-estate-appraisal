import {useCallback,useEffect,useRef,useState} from 'react';
import {cli,type CliJob,type CliSection,type CliSubmission} from './cli-agent';
import {onboarding} from './cli-onboarding';
import {waitForCliHost} from './cli-host-ready';
import {ApiError} from './edge';
type Identity={requestId:string;jobId?:string;workspaceId:string};
const remember=(key:string,value:Identity|null)=>{try{if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{/* Keep the in-memory receipt. */}};
export const cliPendingKey=(user:string,section:CliSection)=>'cli-pending:'+user+(section==='environment_description'?'':':'+section);
export function useCliSubmission(user:string,section:CliSection){
 const key=cliPendingKey(user,section);
 const [identity,setIdentity]=useState<Identity|null>(()=>{try{const x=JSON.parse(sessionStorage.getItem(key)??'null');return x&&typeof x.requestId==='string'&&typeof x.workspaceId==='string'?x:null;}catch{return null;}});
 const [job,setJob]=useState<CliJob|null>(null),[busy,setBusy]=useState(false),[waking,setWaking]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('');
 const payload=useRef<CliSubmission|null>(null),guard=useRef(false),abort=useRef<AbortController|null>(null);
 useEffect(()=>()=>abort.current?.abort(),[]);
 useEffect(()=>{
  if(!identity||identity.jobId||busy)return;const controller=new AbortController();
  cli.lookup(identity.requestId,controller.signal).then(r=>{if(controller.signal.aborted)return;setJob(r.job);const next={...identity,jobId:r.job.id};remember(key,next);setIdentity(next);}).catch(e=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:'לא ניתן לאתר את הבקשה.');if(e instanceof ApiError&&[404,410].includes(e.status))setDone(true);}});
  return()=>controller.abort();
 },[identity,busy,key]);
 const markTerminal=useCallback(()=>setDone(true),[]);
 const submit=useCallback(async(request:CliSubmission)=>{
  if(guard.current)return;guard.current=true;setBusy(true);setError('');
  const frozen=payload.current??structuredClone(request);payload.current=frozen;
  const next={requestId:frozen.requestId,workspaceId:frozen.workspaceId};remember(key,next);setIdentity(next);setDone(false);
  try{
   const controller=new AbortController();abort.current=controller;
   const connections=await cli.connections(controller.signal);
   const provider=connections.providers.find(p=>p.connection?.id===frozen.connectionId)?.provider;
   if(!provider)throw new Error('חשבון CLI שנבחר אינו זמין. רעננו את רשימת החשבונות.');
   const state=await onboarding.status(controller.signal,provider).catch(()=>null);
   if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
   if(state?.connectionId===frozen.connectionId&&state.nextAction==='start_host'&&state.wake.configured){
    setWaking(true);
    await waitForCliHost(frozen.requestId,frozen.connectionId,{signal:controller.signal,wake:id=>onboarding.wake(id,provider),status:()=>onboarding.status(controller.signal,provider),connections:()=>cli.connections(controller.signal)});
    if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
   }
   const r=await cli.submit(frozen);setJob(r.job);const accepted={...next,jobId:r.job.id};remember(key,accepted);setIdentity(accepted);
  }catch(e){
   if(e instanceof DOMException&&e.name==='AbortError'){remember(key,null);payload.current=null;setIdentity(null);setError('השליחה בוטלה לפני העברה לסוכן. הטיוטה נשמרה.');}
   else{setError(e instanceof Error?e.message:'השליחה לא אושרה. יש לבדוק את מצב הבקשה.');if(e instanceof ApiError&&e.status<500)setDone(true);}
  }finally{setBusy(false);setWaking(false);guard.current=false;abort.current=null;}
 },[key]);
 function reset(){remember(key,null);payload.current=null;setIdentity(null);setJob(null);setDone(false);setError('');}
 return {identity,job,busy,waking,done,error,submit,reset,markTerminal,cancelWake:()=>abort.current?.abort(),retry:()=>payload.current?submit(payload.current):undefined,canRetry:!!payload.current&&!identity?.jobId};
}
