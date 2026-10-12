import {useEffect,useRef,useState,type FormEvent} from "react";
import {useCliConnectionController} from "../lib/cli-connection-context";
import {onboarding,LOGIN_TERMINAL,type SealedEnvelope} from "../lib/cli-onboarding";
import {sealLoginCode} from "../lib/sealed-secret";
const labels:Record<string,string>={waiting_for_host:"מפעילים את שרת הסוכן…",queued:"ממתינים לסיום הבקשה הפעילה…",starting:"מכינים כניסה ל-Google…",awaiting_code:"השלימו כניסה ב-Google והדביקו את קוד האישור.",code_received:"קוד האישור התקבל. משלימים את הכניסה…",authenticating:"משלימים את הכניסה…",verifying:"הכניסה נשמרה. בודקים שהסוכן זמין…",succeeded:"החשבון מחובר",verification_blocked:"הכניסה נשמרה, אך הסוכן אינו זמין כרגע.",cancelled:"תהליך החיבור בוטל.",expired:"זמן החיבור פג.",failed:"תהליך החיבור הופסק."};
export function CliConnectionWizard(){
 const ctx=useCliConnectionController(),dialog=useRef<HTMLDialogElement>(null);
 const [code,setCode]=useState(""),[sending,setSending]=useState(false),[error,setError]=useState("");
 const pending=useRef<{sessionId:string;challengeId:string;submissionId:string;envelope:SealedEnvelope}|null>(null),guard=useRef(false);
 const visible=!!ctx?.visible,session=ctx?.session,challenge=ctx?.challenge;
 useEffect(()=>{if(visible){dialog.current?.showModal();}else{dialog.current?.close();setCode("");pending.current=null;setError("");}},[visible]);
 useEffect(()=>{setCode("");pending.current=null;setError("");},[session?.id,challenge?.challengeId]);
 async function submit(event:FormEvent){event.preventDefault();if(!ctx||!session||!challenge||guard.current)return;guard.current=true;setSending(true);setError("");
  try{
   if(!pending.current){const submissionId=crypto.randomUUID();const envelope=await sealLoginCode(code,challenge,submissionId);pending.current={sessionId:session.id,challengeId:challenge.challengeId,submissionId,envelope};setCode("");}
   const p=pending.current;const result=await onboarding.submit(p.sessionId,p.challengeId,p.submissionId,p.envelope);ctx.setSession(result.session);pending.current=null;
  }catch(e){setError(e instanceof Error?e.message:"לא ניתן להעביר את הקוד. בדקו את מצב החיבור לפני ניסיון נוסף.");ctx.refresh();}
  finally{guard.current=false;setSending(false);}
 }
 if(!ctx)return null;
 const terminal=!!session&&LOGIN_TERMINAL.has(session.state);
 return <dialog ref={dialog} className="cli-login-dialog" dir="rtl" aria-labelledby="cli-login-title" onCancel={e=>{e.preventDefault();ctx.close();}}>
  <div className="title-row"><h2 id="cli-login-title">חיבור חשבון Antigravity</h2><button type="button" className="secondary" onClick={ctx.close}>סגירה</button></div>
  <p>נכנסים לחשבון Google האישי בדפדפן. החיבור נשמר לבקשות הבאות. אין צורך בטרמינל.</p>
  {!session&&<><p>לאחר הכניסה נשלחת בקשת בדיקה קצרה כדי לוודא שהסוכן זמין בחשבון שלכם.</p><button type="button" disabled={ctx.busy||ctx.status?.enabled!==true} onClick={()=>void ctx.start()}>התחלת חיבור</button></>}
  {session&&<p role="status" aria-live="polite">{labels[session.state]}</p>}
  {visible&&challenge&&session?.canSubmitCode&&<>
   <a className="cli-provider-link" href={challenge.authorizationUrl} target="_blank" rel="noopener noreferrer">המשך לכניסה ב-Google ↗</a>
   <p className="muted">אם החלון לא נפתח, לחצו על הקישור שוב. העתיקו מ-Google את קוד האישור בלבד.</p>
   <form onSubmit={submit}><label>קוד אישור חד-פעמי<input type="password" dir="ltr" autoComplete="off" autoCapitalize="none" spellCheck={false} value={code} maxLength={8192} onChange={e=>setCode(e.target.value)} disabled={sending||!!pending.current}/></label><button disabled={sending||(!code.trim()&&!pending.current)}>{sending?"מעביר קוד…":pending.current?"בדיקה ושליחה חוזרת":"השלמת החיבור"}</button></form>
   <p className="muted">הקוד אינו סיסמה או מפתח API. זמן החיבור מוגבל; אם הוא פג, התחילו חיבור חדש.</p>
  </>}
  {session?.error&&<p role="alert" className="error">{session.error.message??session.error.code}</p>}
  {(error||ctx.error)&&<p role="alert" className="error">{error||ctx.error}</p>}
  {ctx.status?.enabled===false&&<p role="status">חיבור בדפדפן טרם הופעל עבור החשבון הזה.</p>}
  {session&&!terminal&&<button type="button" className="secondary" disabled={ctx.busy||sending} onClick={()=>void ctx.cancel()}>ביטול החיבור</button>}
  {terminal&&session.state!=="succeeded"&&<button type="button" disabled={ctx.busy} onClick={()=>void ctx.start()}>{session.state==="verification_blocked"?"בדיקת זמינות ללא כניסה נוספת":"התחלת חיבור חדש"}</button>}
  {session?.state==="succeeded"&&<button type="button" onClick={ctx.close}>חזרה לבקשה</button>}
 </dialog>;
}
