import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../lib/edge";
import type { PlotAnalysisData } from "../lib/plot-description";

type Job = {id:string;address:string;section_id:string;workspace_id:string;provider_id:string;model_id:string;status:string;error_code?:string;created_at:string};
type Detail = {id:string;output_text:string|null;plot_evidence:PlotAnalysisData|null;additional_request:string};
const sections=[{id:"plot_description",label:"תיאור החלקה"},{id:"environment_description",label:"תיאור סביבת הנכס"}];
const errorMessage=(e:unknown)=>e instanceof Error?e.message:"לא ניתן לטעון את הרשומה";

function Snapshot({data,id}:{data:PlotAnalysisData;id:string}){
  const [notice,setNotice]=useState("");
  const json=JSON.stringify(data,null,2);
  return <section className="history-evidence"><h3>נתוני GovMap שנשלחו לסוכן</h3>
    <p>גוש {data.gush} · חלקה {data.parcel}{data.cadastralArea!=null?` · שטח לפי GovMap: ${data.cadastralArea.toLocaleString("he-IL")} מ״ר`:""}</p>
    <p className="muted">צילום הנתונים שנשמר בעת הבקשה{data.retrievedAt?` · ${new Date(data.retrievedAt).toLocaleString("he-IL")}`:""}. הצפייה אינה מבצעת פנייה חדשה ל־GovMap.</p>
    <details><summary>הצגת הנתונים הגולמיים וניתוח החלקה</summary><textarea dir="ltr" aria-label="נתוני GovMap שמורים" readOnly value={json} rows={14}/></details>
    <div className="actions"><button className="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(json);setNotice("הנתונים הועתקו");}catch{setNotice("יש לפתוח את הנתונים ולהעתיק ידנית");}}}>העתקת נתוני GovMap</button>
      <button className="secondary" onClick={()=>{const url=URL.createObjectURL(new Blob([json],{type:"application/json;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=`govmap-${id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>הורדת JSON</button></div>
    {notice&&<p role="status">{notice}</p>}
  </section>;
}

function HistoryItem({job,renderReport}:{job:Job;renderReport:(text:string)=>ReactNode}){
  const [open,setOpen]=useState(false),[detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!open||detail)return;
    let active=true;
    api<{job:Detail}>("historyDetail",{id:job.id}).then(r=>{if(active){setDetail(r.job);setError("");}}).catch(e=>{if(active)setError(errorMessage(e));});
    return()=>{active=false;};
  },[open,detail,job.id,retry]);
  const status=({succeeded:"הושלם",running:"בטיפול",failed:"נכשל",needs_review:"דרושה בדיקה"} as Record<string,string>)[job.status]??job.status;
  return <details className="history-item" onToggle={e=>{if(e.target===e.currentTarget)setOpen(e.currentTarget.open);}}>
    <summary><span>{job.address}</span><span className={`history-status ${job.status}`}>{status}</span><small>{new Date(job.created_at).toLocaleString("he-IL")}</small></summary>
    {open&&<><p><bdi>{job.provider_id} / {job.model_id}</bdi></p>
      {error?<p role="alert" className="error">{error} <button className="secondary" onClick={()=>{setError("");setRetry(v=>v+1);}}>ניסיון נוסף</button></p>:!detail?<p role="status">טוען את הדוח השמור…</p>:<>
        {detail.output_text?renderReport(detail.output_text):<p>{job.status==="running"?"הבקשה עדיין בטיפול. יש לבדוק את התוצאה לפני הפעלה חוזרת.":job.error_code??"לא נשמרה טיוטה."}</p>}
        {detail.additional_request&&<details><summary>הבקשות שנשלחו לסוכן</summary><p className="history-request">{detail.additional_request}</p></details>}
        {job.section_id==="plot_description"&&(detail.plot_evidence?<Snapshot data={detail.plot_evidence} id={job.id}/>:<p className="muted">נתוני GovMap לא נשמרו עבור רשומה זו. שמירת הנתונים זמינה לבקשות חדשות.</p>)}
      </>}
    </>}
  </details>;
}

export function History({renderReport}:{renderReport:(text:string)=>ReactNode}){
  const [jobs,setJobs]=useState<Job[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(true),[section,setSection]=useState("plot_description"),[version,setVersion]=useState(0);
  useEffect(()=>{let active=true;api<{jobs:Job[]}>("history").then(r=>{if(active){setJobs(r.jobs);setError("");}}).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[version]);
  const visible=jobs.filter(j=>j.section_id===section);
  return <><div className="title-row"><h1>היסטוריית הצוות</h1><button disabled={busy} onClick={()=>{setBusy(true);setVersion(v=>v+1);}}>רענון</button></div>
    <p className="muted">נשמרות 10 הרשומות האחרונות בכל פרק לכל צוות. תוכן רשומות ישנות מוסר אוטומטית. מומלץ להוריד דוחות ונתונים שברצונכם לשמור.</p>
    <div className="history-sections" role="group" aria-label="סוג הדוח בהיסטוריה">{sections.map(s=><button key={s.id} aria-pressed={section===s.id} className={section===s.id?"":"secondary"} onClick={()=>setSection(s.id)}>{s.label} <span>({jobs.filter(j=>j.section_id===s.id).length})</span></button>)}</div>
    <h2>{sections.find(s=>s.id===section)?.label}</h2>
    {error&&<p role="alert" className="error">{error}</p>}
    {busy?<p role="status">טוען…</p>:!visible.length?<p>עדיין אין בקשות שמורות לפרק זה.</p>:visible.map(j=><HistoryItem key={`${version}:${j.id}`} job={j} renderReport={renderReport}/>)}
  </>;
}
