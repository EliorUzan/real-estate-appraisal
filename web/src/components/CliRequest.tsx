import {useState} from 'react';
import type {FormEvent} from 'react';
import type {CliSection} from '../lib/cli-agent';
import type {PlotAnalysisData} from '../lib/plot-description';
import {useCliAccount} from '../lib/use-cli-account';
import {useCliSubmission} from '../lib/use-cli-submission';
import {CliAccountControls} from './CliAccountControls';
import {CliSubmissionStatus} from './CliSubmissionStatus';
import {GovMapPanel} from './GovMapPanel';
export function CliRequest({userId,workspaces,onSettings,active=true,sectionId='environment_description'}:{userId:string;workspaces:string[];onSettings:()=>void;active?:boolean;sectionId:Exclude<CliSection,'comparable_sales'>}){
 const account=useCliAccount(active),run=useCliSubmission(userId,sectionId);
 const [address,setAddress]=useState(''),[example,setExample]=useState(''),[additional,setAdditional]=useState(''),[consent,setConsent]=useState(true),[workspaceId,setWorkspace]=useState(workspaces[0]??'');
 const [error,setError]=useState(''),[mapAddress,setMapAddress]=useState(''),[lookupVersion,setLookupVersion]=useState(0),[plotData,setPlotData]=useState<PlotAnalysisData|null>(null);
 const plot=sectionId==='plot_description';
 const issues=[!address.trim()?'יש להזין כתובת נכס.':'',!workspaces.includes(workspaceId)?'יש לבחור צוות פעיל.':'',!consent?'יש לאשר העברת הנתונים לספק.':'',account.issue,plot&&(!plotData||plotData.address!==address.trim())?'יש לאתר את החלקה ב־GovMap ולסיים את איסוף נתוניה לפני יצירת התיאור.':''].filter(Boolean);
 function lookup(){if(!address.trim()){setError('יש להזין כתובת נכס כדי להציג מפה.');return;}setError('');setPlotData(null);setMapAddress(address.trim());setLookupVersion(v=>v+1);}
 async function submit(event:FormEvent){event.preventDefault();if(run.busy)return;if(issues.length){setError(issues.join(' '));return;}setError('');if(!plot)setMapAddress(address.trim());
  await run.submit({schemaVersion:1,requestId:crypto.randomUUID(),connectionId:account.selected!.connection!.id,workspaceId,sectionId,address:address.trim(),example,additionalRequest:additional,modelSelection:'provider-default',consent:true,...(plot?{evidence:plotData}:{})});
 }
 return <><p>יצירת {plot?'תיאור החלקה':'תיאור סביבת הנכס'} באמצעות חשבון CLI אישי.</p>
  {!run.identity&&<form onSubmit={submit} noValidate><fieldset disabled={run.busy} className='request-fields'>
   <CliAccountControls account={account} onSettings={onSettings}/>
   {workspaces.length>1&&<label>צוות<select value={workspaceId} onChange={e=>setWorkspace(e.target.value)}>{workspaces.map(w=><option key={w}>{w}</option>)}</select></label>}
   <label>כתובת הנכס (חובה)<input required maxLength={500} value={address} onChange={e=>{setAddress(e.target.value);setMapAddress('');setPlotData(null);}}/></label>
   <button type='button' className='secondary' onClick={lookup}>{plot?'אחזור נתוני חלקה מ־GovMap':'הצג מפה וגוש חלקה'}</button>
   <label>דוגמת סגנון (רשות)<textarea rows={4} maxLength={20000} value={example} onChange={e=>setExample(e.target.value)}/></label>
   <label>הנחיות ונתונים נוספים (רשות)<textarea rows={4} maxLength={20000} value={additional} onChange={e=>setAdditional(e.target.value)}/></label>
   <p className='muted'>הסוכן משתמש בהוראות {plot?'תיאור החלקה':'תיאור סביבת הנכס'} שנשמרו בהגדרות המתקדמות. ההנחיות כאן מתווספות אליהן.</p>
   <label className='checkbox'><input type='checkbox' checked={consent} onChange={e=>setConsent(e.target.checked)}/>אני מאשר/ת להעביר את הטקסט לספק הנבחר באמצעות החשבון שלי ולשמור את הדוח בהיסטוריית הצוות.</label>
   {account.wakeAllowed&&<p role='status'>השרת במנוחה. שליחה תפעיל אותו ותעביר את הבקשה כשהסוכן יהיה מוכן.</p>}
   <button disabled={run.busy}>{run.busy?'שולח…':plot?'צור תיאור חלקה באמצעות CLI':'שליחה לסוכן CLI'}</button>
  </fieldset></form>}
  {error&&<p role='alert' className='error'>{error}</p>}
  {mapAddress&&<div inert={run.busy}><GovMapPanel key={lookupVersion} address={mapAddress} mode={plot?'plot':'map'} onPlotData={setPlotData}/></div>}
  <CliSubmissionStatus run={run}/></>;
}