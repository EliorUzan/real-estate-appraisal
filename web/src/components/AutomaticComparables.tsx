import {useRef,useState,type FormEvent} from 'react';
import {useCliAccount} from '../lib/use-cli-account';
import {useCliSubmission} from '../lib/use-cli-submission';
import {CliSubmissionStatus} from './CliSubmissionStatus';
import {CliModelControl} from './CliModelControl';
import {connectionHelp} from '../lib/cli-status';
import {OVER_TYPES,overSubject} from '../../../supabase/functions/appraisal/over-transactions';
import type {CliModel} from '../../../supabase/functions/appraisal/cli-models';
import type {CliProvider} from '../lib/cli-agent';

export function AutomaticComparables({userId='',workspaces=[],onSettings,defaultCliModel,defaultCliProvider}:{userId?:string;workspaces?:string[];onSettings:()=>void;defaultCliModel?:CliModel;defaultCliProvider?:CliProvider}){
 const account=useCliAccount(true,'claude',defaultCliProvider==='claude'?defaultCliModel:undefined),run=useCliSubmission(userId,'comparable_sales'),guard=useRef(false);
 const [city,setCity]=useState(''),[street,setStreet]=useState(''),[house,setHouse]=useState('');
 const [area,setArea]=useState(''),[rooms,setRooms]=useState(''),[yearBuilt,setYearBuilt]=useState(''),[floor,setFloor]=useState('');
 const [propertyType,setPropertyType]=useState<string>(OVER_TYPES[0]),[description,setDescription]=useState('');
 const [radius,setRadius]=useState('500'),[startDate,setStartDate]=useState(''),[endDate,setEndDate]=useState('');
 const [workspace,setWorkspace]=useState(workspaces[0]??''),[consent,setConsent]=useState(false),[error,setError]=useState('');
 async function submit(event:FormEvent){
  event.preventDefault();if(guard.current||run.busy)return;setError('');
  try{
   if(account.issue)throw new Error(account.issue);
   if(account.provider!=='claude'||!account.selected?.connection)throw new Error('נדרש חשבון Claude CLI מחובר.');
   if(!workspaces.includes(workspace))throw new Error('יש לבחור צוות פעיל.');
   if(!consent)throw new Error('יש לאשר את שליחת פרטי הנכס למאגר ול־Claude.');
   if(run.identity)throw new Error('קיימת בקשה שמורה. בדקו את תוצאתה ובחרו יצירת בקשה חדשה לפני שליחה נוספת.');
   const query=overSubject({city,street,house,area:Number(area),rooms:Number(rooms),yearBuilt:yearBuilt?Number(yearBuilt):null,floor,propertyType,description,startDate,endDate,radiusMeters:Number(radius)});
   guard.current=true;
   await run.submit({schemaVersion:1,requestId:crypto.randomUUID(),connectionId:account.selected.connection.id,workspaceId:workspace,sectionId:'comparable_sales',address:query.address,example:'',additionalRequest:'',modelSelection:account.modelSelection,consent:true,evidence:{kind:'over',query}});
  }catch(e){setError(e instanceof Error?e.message:'הבקשה לא הושלמה.');}finally{guard.current=false;}
 }
 return <section aria-labelledby='automatic-comparables-title'>
  <h2 id='automatic-comparables-title'>עסקאות דומות והערכת טווח שווי</h2>
  <p>מאתרים עסקאות אוטומטית בארכיון רשות המסים של over.org.il. אין צורך בקישור. עד עשר העסקאות המדורגות ראשונות נשלחות ל־Claude CLI לבדיקה ולהערכת טווח שווי.</p>
  <p className='muted'>נבחרות עד עשר עסקאות מגורים במיקום ובתקופה המבוקשים, לפי דמיון בשטח, חדרים, סוג נכס, גיל הבניין ומרחק. כשחסרות השוואות קרובות משתמשים גם בעסקאות פחות דומות, עם התאמות שווי מנומקות ואי־ודאות מוגברת. שנת הבנייה אינה מסננת עסקאות.</p>
  <form onSubmit={submit}><fieldset disabled={run.busy} className='request-fields'>
   <div className='two-columns'>
    <label>יישוב<input required maxLength={100} value={city} onChange={e=>setCity(e.target.value)} placeholder='רמת גן'/></label>
    <label>רחוב<input required maxLength={120} value={street} onChange={e=>setStreet(e.target.value)} placeholder='בר יוחאי'/></label>
    <label>מספר בית<input required maxLength={10} value={house} onChange={e=>setHouse(e.target.value)} placeholder='8'/></label>
    <label>סוג נכס<select value={propertyType} onChange={e=>setPropertyType(e.target.value)}>{OVER_TYPES.map(t=><option key={t}>{t}</option>)}</select></label>
    <label>שטח רשום במ״ר<input type='number' min={10} max={2000} step='0.1' required value={area} onChange={e=>setArea(e.target.value)}/></label>
    <label>מספר חדרים<input type='number' min={1} max={20} step='0.5' required value={rooms} onChange={e=>setRooms(e.target.value)}/></label>
    <label>שנת בנייה (רשות)<input type='number' min={1800} max={new Date().getFullYear()+10} value={yearBuilt} onChange={e=>setYearBuilt(e.target.value)}/></label>
    <label>קומה (רשות)<input maxLength={80} value={floor} onChange={e=>setFloor(e.target.value)}/></label>
    <label>רדיוס במטרים<input type='number' min={50} max={1000} required value={radius} onChange={e=>setRadius(e.target.value)}/></label>
    <label>עסקאות מתאריך<input type='date' max={endDate||new Date().toISOString().slice(0,10)} value={startDate} onChange={e=>setStartDate(e.target.value)}/></label>
    <label>עסקאות עד תאריך<input type='date' min={startDate||undefined} max={new Date().toISOString().slice(0,10)} value={endDate} onChange={e=>setEndDate(e.target.value)}/></label>
   </div>
   <small>ללא תאריכים: שנתיים אחרונות. שטח וחדרים נדרשים לסינון ולהערכת שווי.</small>
   <label>תיאור הנכס ופרטים נוספים<textarea rows={4} maxLength={6000} value={description} onChange={e=>setDescription(e.target.value)} placeholder='מצב, חניה, מעלית, מרפסת ופרטים נוספים לבדיקה'/></label>
   <p><strong>Claude CLI</strong> · בקשת ניתוח אחת לאחר האיסוף והסינון.</p><CliModelControl account={account}/>
   {account.selected&&<p role='status'>{account.wakeAllowed?'החשבון מחובר והשרת במנוחה. שליחה תפעיל אותו אוטומטית לפני הניתוח.':connectionHelp(account.selected)}</p>}
   <div className='actions'><button type='button' className='secondary' onClick={onSettings}>ניהול חשבון Claude CLI</button><button type='button' className='secondary' disabled={account.loading} onClick={account.refresh}>רענון זמינות</button></div>
   {workspaces.length>1&&<label>צוות<select value={workspace} onChange={e=>setWorkspace(e.target.value)}>{workspaces.map(w=><option key={w}>{w}</option>)}</select></label>}
   <label className='checkbox privacy-notice'><input type='checkbox' checked={consent} onChange={e=>setConsent(e.target.checked)} required/>אני מאשר/ת לשלוח את הכתובת ופרטי החיפוש ל־over.org.il ואת פרטי הנכס והעסקאות שנבחרו לחשבון Claude CLI, ולשמור את התוצאה בהיסטוריית הצוות.</label>
   <button disabled={run.busy||!!run.identity}>{run.busy?'אוסף עסקאות ומכין ניתוח…':'איסוף עסקאות והערכת שווי עם Claude'}</button>
  </fieldset></form>
  {run.busy&&<p role='status'>מאמתים חשבון, מאתרים חלקה ועסקאות ובוחרים עד עשר השוואות. האיסוף עשוי לארוך כדקה; אין צורך ללחוץ שוב.</p>}
  {error&&<p className='error' role='alert'>{error}</p>}
  <CliSubmissionStatus run={run}/>
 </section>;
}
