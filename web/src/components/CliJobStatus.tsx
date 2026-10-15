import { useEffect,useState } from "react";
import { ApiError } from "../lib/edge";
import { cli,cliLabels,terminal,type CliJob } from "../lib/cli-agent";
import {TransactionTable} from './TransactionTable';
import {CLI_MODELS} from '../../../supabase/functions/appraisal/cli-models';
import {CliActivity,CliProgress} from './CliActivity';
const labels:Record<string,string>={queued:"ממתין בתור",running:"הסוכן עובד",cancel_requested:"ממתין לאישור עצירת הסוכן",succeeded:"הושלם",failed:"נכשל",cancelled:"בוטל",expired:"פג תוקף",needs_review:"תוצאת ההפעלה דורשת בדיקה"};
export function CliJobStatus({jobId,initial,onTerminal}:{jobId:string;initial:CliJob|null;onTerminal:()=>void}){
  const [job,setJob]=useState<CliJob|null>(initial),[error,setError]=useState(""),[cancelling,setCancelling]=useState(false),[refresh,setRefresh]=useState(0);
  useEffect(()=>{
    let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,inFlight=false,failures=0,finished=false;
    const controller=new AbortController();
    async function poll(){
      if(disposed||inFlight||document.hidden||finished)return;
      inFlight=true;
      try{const r=await cli.job(jobId,controller.signal);if(disposed)return;setJob(r.job);setError("");failures=0;if(terminal(r.job.status)){finished=true;onTerminal();return;}}
      catch(e){if(disposed)return;setError(e instanceof Error?e.message:"הקשר לשרת אבד. הבקשה לא מופעלת מחדש.");failures++;if(e instanceof ApiError&&[401,403,404,410].includes(e.status)){finished=true;onTerminal();return;}}
      finally{inFlight=false;}
      if(!disposed)timer=setTimeout(poll,Math.min(30000,5000*2**failures));
    }
    function resume(){if(timer)clearTimeout(timer);void poll();}
    void poll();document.addEventListener("visibilitychange",resume);window.addEventListener("online",resume);
    return()=>{disposed=true;controller.abort();if(timer)clearTimeout(timer);document.removeEventListener("visibilitychange",resume);window.removeEventListener("online",resume);};
  },[jobId,refresh,onTerminal]);
  async function cancel(){setCancelling(true);try{const r=await cli.cancel(jobId);setJob(r.job);setError("");if(terminal(r.job.status))onTerminal();setRefresh(v=>v+1);}catch(e){setError(e instanceof Error?e.message:"הביטול לא אושר");}finally{setCancelling(false);}}
  const stopped=!!job&&terminal(job.status),succeeded=job?.status==='succeeded';
  return <section className="account-settings" aria-label="מצב בקשת CLI"><CliActivity active={!stopped&&!error} tone={error||stopped&&!succeeded?'warning':succeeded?'success':'neutral'}>{error?'לא ניתן לעדכן את מצב הבקשה':job?labels[job.status]??job.status:"בודק את מצב הבקשה…"}</CliActivity>{job&&!error&&<CliProgress status={job.status}/>}<small><bdi>{jobId}</bdi></small>
    {job&&<p>{cliLabels[job.provider]} · נבחר: {CLI_MODELS.find(m=>m.id===job.modelRequested)?.label??job.modelRequested}{job.modelResolved&&<> · הופעל: <bdi>{job.modelResolved}</bdi></>}</p>}
    {job?.error&&<p role="alert" className="error">{job.error.message}</p>}{error&&<p role="alert" className="error">{error}</p>}
    <div className="actions">{job&&!terminal(job.status)&&<button type="button" className="secondary" disabled={cancelling||job.status==="cancel_requested"} onClick={cancel}>ביטול הבקשה</button>}<button type="button" className="secondary" onClick={()=>setRefresh(v=>v+1)}>בדיקת מצב</button></div>
    {job?.output?.data?<TransactionTable result={job.output.data}/>:job?.output&&<><h2>טיוטת הדוח</h2><p className="muted">יש לבדוק את העובדות לפני שימוש בדוח.</p><textarea readOnly aria-label="טיוטת CLI" value={job.output.text} rows={20}/><button type="button" onClick={()=>navigator.clipboard.writeText(job.output!.text).catch(()=>setError("ההעתקה נכשלה. ניתן להעתיק מהתיבה."))}>העתקת הטיוטה</button></>}
  </section>;
}
