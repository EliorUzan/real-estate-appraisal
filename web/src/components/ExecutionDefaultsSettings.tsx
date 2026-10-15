import {useState,type FormEvent} from 'react';
import catalog from '../catalog.json';
import {supabase} from '../lib/supabase';
import {executionPages,type ExecutionDefaults} from '../lib/execution-defaults';
import {cliLabels,cliProviders} from '../lib/cli-status';
import {ExecutionModeControl} from './ExecutionModeControl';
import {Icon,Models} from './ProviderControls';
import {CLI_MODELS,DEFAULT_CLI_MODEL,type CliModel} from '../../../supabase/functions/appraisal/cli-models';
import {CliProviderIcon} from './CliProviderIcon';

export function ExecutionDefaultsSettings({defaults,providerModels}:{defaults:ExecutionDefaults;providerModels:Record<string,string>}){
 const [draft,setDraft]=useState(defaults),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 async function save(event:FormEvent){
  event.preventDefault();setBusy(true);setSaved(false);setError('');
  try{
   const {error}=await supabase.auth.updateUser({data:{execution_defaults:draft}});
   if(error)throw error;
   // Read back from Auth so success means the preference was persisted.
   const result=await supabase.auth.getUser();
   if(result.error)throw result.error;
   const stored=result.data.user.user_metadata.execution_defaults;
   if(!executionPages.every(({id})=>Object.entries(draft[id]).every(([key,value])=>stored?.[id]?.[key]===value)))throw new Error('לא ניתן לאמת את שמירת ברירות המחדל. נסו שוב.');
   setSaved(true);
  }catch(e){setError(e instanceof Error?e.message:'שמירת ברירות המחדל נכשלה.');}finally{setBusy(false);}
 }
 return <section className="execution-defaults" aria-labelledby="execution-defaults-title"><h2 id="execution-defaults-title">ברירות מחדל להפעלה</h2>
  <p>בחרו אופן הפעלה וספק לכל עמוד. ברירות המחדל נשמרות בחשבון וחלות בפתיחת עמוד בקשה. אפשר לשנות את הבחירה בבקשה עצמה.</p>
  <form onSubmit={save}><fieldset disabled={busy} className="request-fields">
   {executionPages.map(({id,label})=><section className="provider-card" key={id} aria-label={label}><h3>{label}</h3>
    <ExecutionModeControl value={draft[id].mode} onChange={value=>{setSaved(false);setDraft({...draft,[id]:{...draft[id],mode:value==='api'?'api':'cli'}});}}/>
    <div className="two-columns">
     <label>ספק API כברירת מחדל<span className="provider-choice"><Icon provider={draft[id].apiProvider}/><select value={draft[id].apiProvider} onChange={e=>{setSaved(false);setDraft({...draft,[id]:{...draft[id],apiProvider:e.target.value,apiModel:providerModels[e.target.value]}});}}>{catalog.providers.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></span></label>
     <Models label="מודל API כברירת מחדל" provider={draft[id].apiProvider} value={draft[id].apiModel} onChange={value=>{setSaved(false);setDraft({...draft,[id]:{...draft[id],apiModel:value}});}}/>
     <label>חשבון CLI כברירת מחדל<span className="provider-choice"><CliProviderIcon provider={draft[id].cliProvider}/><select value={draft[id].cliProvider} onChange={e=>{const provider=cliProviders.find(p=>p===e.target.value)!;setSaved(false);setDraft({...draft,[id]:{...draft[id],cliProvider:provider,cliModel:provider==='claude'?DEFAULT_CLI_MODEL:'provider-default'}});}}>{cliProviders.map(p=><option key={p} value={p}>{cliLabels[p]}</option>)}</select></span></label>
     <label>מודל CLI כברירת מחדל<select value={draft[id].cliModel} onChange={e=>{setSaved(false);setDraft({...draft,[id]:{...draft[id],cliModel:e.target.value as CliModel}});}}>{(draft[id].cliProvider==='claude'?CLI_MODELS:CLI_MODELS.filter(m=>m.id==='provider-default')).map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    </div>
   </section>)}
   <p className="muted">איסוף העסקאות האוטומטי מ־over.org.il פועל באמצעות Claude CLI בלבד. ברירות המחדל לעסקאות חלות על המסלולים הנוספים.</p>
   <button disabled={busy}>{busy?'שומר…':'שמירת ברירות מחדל'}</button>
  </fieldset></form>
  {saved&&<p role="status" className="success">ברירות המחדל נשמרו בחשבון.</p>}{error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
