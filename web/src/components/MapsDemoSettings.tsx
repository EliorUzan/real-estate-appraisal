import {useEffect,useRef,useState} from 'react';
import {edgeApi} from '../lib/edge';
import {sealSecret} from '../lib/sealed-secret';
import type {LoginChallenge,SealedEnvelope} from '../lib/cli-onboarding';
import {onboardingMessage} from '../../../supabase/functions/cli-onboarding/messages.ts';
type SetupSession={id:string;kind:string;state:string;phaseVersion:number;version:number;expiresAt:string;canSubmitKey:boolean;errorCode:string|null};
type Status={operator:boolean;status:string;canProvision:boolean;session:SetupSession|null};
const terminal=(s:string)=>['succeeded','cancelled','failed','expired'].includes(s);
const labels:Record<string,string>={not_configured:'לא מוגדר',compatibility_pending:'המפתח נשמר. הפעלת MCP ממתינה לבדיקת תאימות.',ready:'זמין',quota_exhausted:'המכסה נוצלה',invalid_key:'המפתח אינו תקין',unavailable:'לא זמין'};
const call=<T,>(action:string,body:Record<string,unknown>={},signal?:AbortSignal)=>edgeApi<T>('cli-onboarding',action,{schemaVersion:1,...body},signal);
export function MapsDemoSettings(){
 const [status,setStatus]=useState<Status|null>(null),[key,setKey]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const challenge=useRef<Omit<LoginChallenge,'authorizationUrl'>|null>(null),requestId=useRef<string|null>(null),guard=useRef(false),pending=useRef<{sessionId:string;challengeId:string;submissionId:string;envelope:SealedEnvelope}|null>(null);
 useEffect(()=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;let inFlight=false;
  async function load(){if(controller.signal.aborted||document.hidden||inFlight)return;inFlight=true;try{
   const next=await call<Status>('getMapsDemoSetup',{},controller.signal);if(controller.signal.aborted)return;setStatus(next);
   if(next.session?.canSubmitKey){const value=await call<Omit<LoginChallenge,'authorizationUrl'>>('getMapsDemoChallenge',{sessionId:next.session.id},controller.signal);if(!controller.signal.aborted)challenge.current=value;}
   else {challenge.current=null;pending.current=null;setKey('');}
   if(next.operator&&!controller.signal.aborted)timer=setTimeout(load,next.session&&!terminal(next.session.state)?2000:15000);
  }catch{/* Optional operator feature is hidden when not deployed. */}finally{inFlight=false;}}
  function resume(){if(timer)clearTimeout(timer);void load();}
  void load();document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);
  return()=>{controller.abort();if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);};
 },[revision]);
 useEffect(()=>()=>{challenge.current=null;pending.current=null;},[]);
 async function run(action:()=>Promise<void>){if(guard.current)return;guard.current=true;setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:'הפעולה נכשלה.');}finally{guard.current=false;setBusy(false);setRevision(v=>v+1);}}
 if(!status?.operator)return null;
 const session=status.session,waiting=session&&!terminal(session.state);
 return <section className='account-settings' aria-label='Google Maps Demo'><h2>Google Maps Demo · הגדרת מפעיל</h2>
  <p role='status'>{labels[status.status]??'בדיקת שירות המפות בהכנה'}</p>
  <p>המשתמשים מקבלים גישה לשירות המשותף ואינם זקוקים למפתח מפות אישי. כרגע משתמשים במפתח Demo בלבד.</p>
  <a href='https://developers.google.com/maps/demo-key' target='_blank' rel='noopener noreferrer'>פתיחת הגדרת Google Maps Demo ↗</a>
  {!waiting&&<><label className='checkbox'><input type='checkbox' checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>המפתח נוצר דרך Google Maps Demo, ללא הפעלת חיוב.</label><button type='button' disabled={busy||!status.canProvision||!confirmed} onClick={()=>void run(async()=>{requestId.current??=crypto.randomUUID();await call('startMapsDemoSetup',{requestId:requestId.current,confirmDemo:true});requestId.current=null;})}>הגדרת מפתח Demo</button></>}
  {!status.canProvision&&<p className='muted'>הגדרת המפתח תהיה זמינה כששרת ההגדרות מופעל ומוכן.</p>}
  {waiting&&<p role='status'>{session.state==='queued'?'ממתינים לסיום העבודה הפעילה…':session.state==='awaiting_key'?'אפשר להדביק את מפתח ה-Demo.':'בודקים ושומרים את המפתח…'}</p>}
  {session?.canSubmitKey&&<form onSubmit={e=>{e.preventDefault();void run(async()=>{
   if(!pending.current){if(!/^AIza[A-Za-z0-9_-]{35}$/.test(key.trim())||!challenge.current)throw new Error('הזינו מפתח Google Maps Demo תקין.');const c=challenge.current,submissionId=crypto.randomUUID();pending.current={sessionId:c.sessionId,challengeId:c.challengeId,submissionId,envelope:await sealSecret(key.trim(),c,submissionId,'maps-demo')};setKey('');}
   const p=pending.current;await call('submitMapsDemoKey',p);pending.current=null;
  });}}><label>מפתח Google Maps Demo<input type='password' dir='ltr' autoComplete='off' value={key} maxLength={128} onChange={e=>setKey(e.target.value)} disabled={busy||!!pending.current}/></label><button disabled={busy||(!key.trim()&&!pending.current)}>שמירה ובדיקה</button></form>}
  {waiting&&<button type='button' className='secondary' disabled={busy} onClick={()=>void run(async()=>{await call('cancelMapsDemoSetup',{sessionId:session.id});setKey('');pending.current=null;})}>ביטול ההגדרה</button>}
  {!waiting&&status.status!=='not_configured'&&<button type='button' className='secondary' disabled={busy||!status.canProvision} onClick={()=>void run(async()=>{await call('removeMapsDemoKey',{requestId:crypto.randomUUID()});})}>הסרת מפתח המפות</button>}
  {session?.errorCode&&<p role='alert' className='error'>{onboardingMessage(session.errorCode)}</p>}{error&&<p role='alert' className='error'>{error}</p>}
 </section>;
}
