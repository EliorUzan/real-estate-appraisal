import type {ReactNode} from 'react';

export function CliActivity({children,active=false,tone='neutral'}:{children:ReactNode;active?:boolean;tone?:'neutral'|'success'|'warning'}){
 return <p role="status" className={`cli-activity cli-activity-${tone}`}>
  {active?<span className="cli-spinner" aria-hidden="true"/>:<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10" cy="10" r="8"/>{tone==='success'?<path d="m6 10 3 3 5-6"/>:tone==='warning'?<path d="M10 5v6m0 3v1"/>:<path d="M10 5v5l3 2"/>}</svg>}
  <span>{children}</span>
 </p>;
}

const stages=['הכנה ושליחה','בתור','הסוכן עובד','התוצאה מוכנה'];
const stageByStatus:Record<string,number>={waking:0,sending:0,queued:1,running:2,succeeded:3};

export function CliProgress({status}:{status:string}){
 const current=stageByStatus[status];
 if(current===undefined)return null;
 return <RequestProgress stages={stages} current={current} complete={status==='succeeded'} label="שלבי בקשת CLI"/>;
}

export function RequestProgress({stages,current,complete=false,label}:{stages:readonly string[];current:number;complete?:boolean;label:string}){
 return <ol className="cli-progress" style={{gridTemplateColumns:`repeat(${stages.length},minmax(0,1fr))`}} aria-label={label}>
  {stages.map((label,index)=><li key={label} className={index<current||complete?'is-complete':index===current?'is-current':''} aria-current={index===current?'step':undefined}>
   <span className="cli-progress-segment" aria-hidden="true"/><span>{label}</span>
  </li>)}
 </ol>;
}
