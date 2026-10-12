import { useState } from "react";
import { cli,cliLabels,type CliProvider } from "../lib/cli-agent";
import { connectionLabel,connectionHelp } from "../lib/cli-status";
import { useCliConnections } from "../lib/use-cli-connections";
import { CliHostNotice } from './CliHostNotice';
import {useCliConnectionController} from "../lib/cli-connection-context";
export function CliConnections(){
  const onboarding=useCliConnectionController();
  const {providers,loading,verified,error:availabilityError,refresh}=useCliConnections();
  const [error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function change(provider:CliProvider,disconnect=false){setBusy(true);setError("");try{const connection=providers.find(p=>p.provider===provider)?.connection;if(disconnect&&connection)await cli.disconnect(connection.id);else await cli.connect(provider);refresh();}catch(e){setError(e instanceof Error?e.message:"החיבור נכשל");}finally{setBusy(false);}}
  return <section className="account-settings" aria-label="חשבונות CLI"><div className="title-row"><h2>חשבונות CLI אישיים · ניסוי</h2><button type="button" className="secondary" disabled={busy||loading} onClick={refresh}>רענון מצב</button></div>
    <p>{onboarding?.status?.enabled?"חיבור Antigravity מתבצע באמצעות כניסה רשמית ל-Google בדפדפן. החיבור נשמר לבקשות הבאות.":"החיבורים הקיימים נשמרים. כניסה עצמאית לחשבון Google עדיין אינה פעילה. חיבור חשבון נוסף דורש כרגע הגדרה בסיוע המפעיל; בקשת חיבור אינה מפעילה כניסה אוטומטית."}</p>
    <div className="providers">{providers.map(p=><section className="provider-card" key={p.provider}><h3>{cliLabels[p.provider]}</h3><p role="status">{loading?"בודק מצב…":!verified?"מצב לא זמין":connectionLabel(p)}</p>
      {verified&&!loading&&<p className="muted">{connectionHelp(p)}</p>}
      {verified&&!loading&&<CliHostNotice provider={p}/>}
      <div className="actions">{p.provider==='gemini'&&onboarding?.status?.enabled?<><button type="button" disabled={busy||loading||!verified||['none','wait','contact_operator'].includes(onboarding.status.nextAction)} onClick={()=>onboarding.status?.nextAction==='start_host'?void onboarding.wake():onboarding.open()}>{onboarding.status.nextAction==='start_host'?"הפעלת שרת הסוכן":onboarding.status.nextAction==='resume_login'?"המשך החיבור":onboarding.status.nextAction==='verify_connection'?"בדיקת זמינות":"חיבור חשבון Google"}</button></>:p.provider==='gemini'&&p.connection?.status!=='connected'?<p role="status">{p.connection?.status==='pending_setup'?"בקשת החיבור ממתינה להגדרת המפעיל; לא התחילה כניסה ל־Google.":"חיבור Google בסיוע המפעיל — הכניסה העצמאית עדיין אינה זמינה."}</p>:<button type="button" disabled={busy||loading||!verified||p.reason==='STATUS_UNAVAILABLE'||!!p.connection&&!['disconnected','reauth_required','disabled'].includes(p.connection.status)} onClick={()=>change(p.provider)}>{p.connection?.status==='reauth_required'?"בקשת חיבור מחדש":p.connection?.status==='pending_setup'?"בקשת החיבור התקבלה":"בקשת חיבור חשבון"}</button>}
      {p.connection&&!['disconnected','disconnecting'].includes(p.connection.status)&&<button type="button" className="secondary" disabled={busy||loading||!verified} onClick={()=>change(p.provider,true)}>ניתוק החשבון</button>}</div></section>)}</div>
    {(error||availabilityError)&&<p role="alert" className="error">{error||availabilityError}</p>}
  </section>;
}
