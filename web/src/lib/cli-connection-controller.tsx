import {useCallback,useEffect,useRef,useState,type ReactNode} from "react";
import {CliConnectionContext} from "./cli-connection-context";
import {useCliConnections} from "./use-cli-connections";
import {onboarding,LOGIN_TERMINAL,authorizationUrl,type LoginSession,type LoginChallenge,type OnboardingStatus} from "./cli-onboarding";
import {CliConnectionWizard} from "../components/CliConnectionWizard";
export function CliConnectionProvider({children}:{children:ReactNode}){
 const connections=useCliConnections();
 const [status,setStatus]=useState<OnboardingStatus|null>(null),[session,setSessionState]=useState<LoginSession|null>(null),[challenge,setChallenge]=useState<LoginChallenge|null>(null);
 const [visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[revision,setRevision]=useState(0);
 const requested=useRef<string|null>(null),guard=useRef(false),prompted=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const setSession=useCallback((value:LoginSession)=>setSessionState(old=>old?.id===value.id&&old.phaseVersion>=value.phaseVersion?old:value),[]);
 const refresh=useCallback(()=>setRevision(v=>v+1),[]);
 const open=useCallback(()=>{setVisible(true);setError("");refresh();},[refresh]);
 const close=useCallback(()=>{setVisible(false);setChallenge(null);},[]);
 const firstUse=useCallback(()=>{if(!prompted.current&&status?.enabled&&status.nextAction==="connect"){prompted.current=true;open();}},[status,open]);
 useEffect(()=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;let inFlight=false;
  async function poll(){
   if(controller.signal.aborted||document.hidden||inFlight)return;inFlight=true;
   try{
    const current=await onboarding.status(controller.signal);if(controller.signal.aborted)return;setStatus(current);
    if(current.session)setSession(current.session);
    // The endpoint is optional during rollout; preserve existing inference if unavailable.
   }catch{/* Wizard actions expose actionable errors; background rollout probes stay quiet. */}finally{inFlight=false;}
   if(!controller.signal.aborted)timer=setTimeout(poll,15000);
  }
  function resume(){if(timer)clearTimeout(timer);void poll();}
  void poll();document.addEventListener("visibilitychange",resume);window.addEventListener("online",resume);
  return()=>{controller.abort();if(timer)clearTimeout(timer);document.removeEventListener("visibilitychange",resume);window.removeEventListener("online",resume);};
 },[revision,setSession]);
 const sessionId=session?.id,sessionState=session?.state,refreshConnections=connections.refresh;
 useEffect(()=>{
  if(!sessionId||!sessionState||LOGIN_TERMINAL.has(sessionState)){setChallenge(null);if(sessionId){refreshConnections();refresh();}return;}
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;let inFlight=false;
  async function poll(){
   if(controller.signal.aborted||document.hidden||inFlight)return;inFlight=true;
   try{
    const result=await onboarding.session(sessionId!,controller.signal);if(controller.signal.aborted)return;setSession(result.session);
    if(visible&&result.session.canSubmitCode){
     const next=await onboarding.challenge(result.session.id,controller.signal);authorizationUrl(next.authorizationUrl);
     if(!controller.signal.aborted)setChallenge(next);
    }else setChallenge(null);
    setError("");
   }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"לא ניתן לבדוק את החיבור.");}finally{inFlight=false;}
   if(!controller.signal.aborted)timer=setTimeout(poll,2000);
  }
  function resume(){if(timer)clearTimeout(timer);void poll();}
  void poll();document.addEventListener("visibilitychange",resume);window.addEventListener("online",resume);
  return()=>{controller.abort();if(timer)clearTimeout(timer);document.removeEventListener("visibilitychange",resume);window.removeEventListener("online",resume);};
 // Stable identity/state dependencies prevent restarting polling after every response.
 },[sessionId,sessionState,visible,setSession,refreshConnections,refresh]);
 async function run(action:()=>Promise<void>){if(guard.current)return;guard.current=true;setBusy(true);setError("");try{await action();}catch(e){if(mounted.current)setError(e instanceof Error?e.message:"הפעולה נכשלה.");}finally{guard.current=false;if(mounted.current)setBusy(false);}}
 async function start(){await run(async()=>{
  requested.current??=crypto.randomUUID();
  const current=await onboarding.status();if(!mounted.current)return;setStatus(current);
  if(current.session){setSession(current.session);return;}
  const result=current.nextAction==="verify_connection"&&current.connectionId?await onboarding.verify(current.connectionId,requested.current):await onboarding.start(requested.current);
  if(mounted.current){setSession(result.session);requested.current=null;refresh();}
  if(result.session.state==='waiting_for_host'&&current.wake.configured)await onboarding.wake(crypto.randomUUID());
 });}
 async function cancel(){await run(async()=>{if(session){const r=await onboarding.cancel(session.id);if(mounted.current)setSession(r.session);}requested.current=null;setChallenge(null);refresh();});}
 async function wake(){await run(async()=>{await onboarding.wake(crypto.randomUUID());refresh();connections.refresh();});}
 return <CliConnectionContext.Provider value={{connections,status,session,challenge,visible,busy,error,open,close,start,cancel,wake,refresh,setSession,firstUse}}>{children}<CliConnectionWizard/></CliConnectionContext.Provider>;
}
