import {useRef,useState} from 'react';
import type {FormEvent} from 'react';
import type {CliSection,CliProvider} from '../lib/cli-agent';
import type {CliModel} from '../../../supabase/functions/appraisal/cli-models';
import {useCliAccount} from '../lib/use-cli-account';
import {useCliSubmission} from '../lib/use-cli-submission';
import {CliAccountControls} from './CliAccountControls';
import {CliSubmissionStatus} from './CliSubmissionStatus';
import {GovMapPanel} from './GovMapPanel';
import {CollapsibleTextarea} from './CollapsibleTextarea';
import {environmentGovMap,freshGovMap} from '../lib/cli-govmap-evidence';
import {useGovMapCollection} from '../lib/use-govmap-collection';
import {PlotProgress} from './PlotProgress';
export function CliRequest({userId,workspaces,onSettings,active=true,sectionId='environment_description',defaultCliProvider='claude',defaultCliModel}:{userId:string;workspaces:string[];onSettings:()=>void;active?:boolean;sectionId:Exclude<CliSection,'comparable_sales'>;defaultCliProvider?:CliProvider;defaultCliModel?:CliModel}){
 const account=useCliAccount(active,defaultCliProvider,defaultCliModel),run=useCliSubmission(userId,sectionId);
 const [address,setAddress]=useState(''),[example,setExample]=useState(''),[additional,setAdditional]=useState(''),[consent,setConsent]=useState(true),[workspaceId,setWorkspace]=useState(workspaces[0]??'');
 const [error,setError]=useState(''),[includeMap,setIncludeMap]=useState(true);
 const map=useGovMapCollection(active),submitting=useRef(false);
 const plot=sectionId==='plot_description';
 const issues=[!address.trim()?'יש להזין כתובת נכס.':'',!workspaces.includes(workspaceId)?'יש לבחור צוות פעיל.':'',!consent?'יש לאשר העברת הנתונים לספק.':'',account.issue].filter(Boolean);
 function lookup(){if(!address.trim()){setError('יש להזין כתובת נכס כדי להציג מפה.');return;}setError('');map.lookup(address.trim());}
 async function submit(event:FormEvent){event.preventDefault();if(run.busy||submitting.current)return;if(issues.length){setError(issues.join(' '));return;}setError('');submitting.current=true;
  try{
   let evidence:unknown;
   if(plot||includeMap){
    const data=plot||!freshGovMap(map.data,address.trim())?await map.collect(address.trim()):map.data!;
    evidence=plot?data:environmentGovMap(data);
   }
   if(!plot&&!includeMap)map.lookup(address.trim());
   await run.submit({schemaVersion:1,requestId:crypto.randomUUID(),connectionId:account.selected!.connection!.id,workspaceId,sectionId,address:address.trim(),example,additionalRequest:additional,modelSelection:account.modelSelection,consent:true,...(evidence===undefined?{}:{evidence})});
  }catch(e){setError(e instanceof Error?e.message:'איסוף נתוני GovMap נכשל.');}
  finally{submitting.current=false;}
 }
 return <><p>יצירת {plot?'תיאור החלקה':'תיאור סביבת הנכס'} באמצעות חשבון CLI אישי.</p>
  {!run.identity&&<form onSubmit={submit} noValidate><fieldset disabled={run.busy||map.collecting} className='request-fields'>
   <CliAccountControls account={account} onSettings={onSettings}/>
   {workspaces.length>1&&<label>צוות<select value={workspaceId} onChange={e=>setWorkspace(e.target.value)}>{workspaces.map(w=><option key={w}>{w}</option>)}</select></label>}
   <label>כתובת הנכס (חובה)<input required maxLength={500} value={address} onChange={e=>{setAddress(e.target.value);map.lookup('');}}/></label>
   {!plot&&<button type='button' className='secondary' onClick={lookup}>הצג מפה וגוש חלקה</button>}
   {!plot&&<label className='checkbox'><input type='checkbox' checked={includeMap} onChange={e=>{setIncludeMap(e.target.checked);map.lookup(map.address);}}/>צרף נתוני GovMap לתיאור הסביבה (גוש, חלקה ושכבות זמינות)</label>}
   {!plot&&!includeMap&&<p className='muted'>נתוני GovMap לא יישלחו לסוכן בבקשה זו.</p>}
   <CollapsibleTextarea label="דוגמת סגנון (רשות)" rows={4} value={example} onChange={setExample}/>
   <CollapsibleTextarea label="הנחיות ונתונים נוספים (רשות)" rows={4} value={additional} onChange={setAdditional}/>
   <p className='muted'>הסוכן משתמש בהוראות {plot?'תיאור החלקה':'תיאור סביבת הנכס'} שנשמרו בהגדרות המתקדמות. ההנחיות כאן מתווספות אליהן.</p>
   <label className='checkbox'><input type='checkbox' checked={consent} onChange={e=>setConsent(e.target.checked)}/>אני מאשר/ת להעביר את הטקסט לספק הנבחר באמצעות החשבון שלי ולשמור את הדוח בהיסטוריית הצוות.</label>
   {account.wakeAllowed&&<p role='status'>השרת במנוחה. שליחה תפעיל אותו ותעביר את הבקשה כשהסוכן יהיה מוכן.</p>}
   <div className={plot?'plot-actions':'actions'}><button disabled={run.busy||map.collecting}>{map.collecting?'אוסף נתוני GovMap…':run.busy?'שולח…':plot?'אחזור נתוני GovMap ויצירת תיאור חלקה':'שליחה לסוכן CLI'}</button>
   {plot&&<button type='button' className='secondary plot-map-only' onClick={lookup}>אחזור נתוני GovMap בלבד</button>}</div>
  </fieldset></form>}
  {error&&<p role='alert' className='error'>{error}</p>}
  {map.collecting&&<p role='status'>אוסף נתוני GovMap לפני השליחה. אם מוצגות כמה חלקות, בחרו את החלקה במפה. <button type='button' className='secondary' onClick={()=>map.cancel('האיסוף בוטל. הבקשה לא נשלחה לסוכן.')}>ביטול איסוף</button></p>}
  {plot&&map.collecting&&<PlotProgress mode="cli" phase="collecting"/>}
  <CliSubmissionStatus run={run} plot={plot}/>
  {plot&&map.address&&<div inert={run.busy}><GovMapPanel key={map.version} address={map.address} mode='plot' onPlotData={map.receive} onError={message=>{setError(message);map.cancel(message);}}/></div>}
  {!plot&&map.address&&<GovMapPanel key={map.version} address={map.address} mode={includeMap?'environment':'map'} onPlotData={map.receive} onError={message=>{setError(message);map.cancel(message);}}/>}
 </>;
}
