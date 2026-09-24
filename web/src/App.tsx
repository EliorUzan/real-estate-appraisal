import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "./lib/edge";
import { supabase } from "./lib/supabase";
import catalog from "./catalog.json";
import { GovMapPanel } from "./components/GovMapPanel";
import type { PlotAnalysisData } from "./lib/plot-description";

type Setting = { provider_id:string; model_id:string; configured:boolean; key_last4:string|null };
type Prompt = { section_id:string; content:string; version:number };
type Bootstrap = { settings:Setting[]; prompts:Prompt[]; members:{workspace_id:string;role:string}[]; defaultProvider:string };
type Job = { id:string; address:string; status:string; output_text?:string; provider_id:string; model_id:string; created_at:string; error_code?:string };
const message = (error:unknown) => error instanceof Error ? error.message : "הפעולה נכשלה";
const defaultPrompt = (section:string) => section==="environment_description" ? catalog.defaultPrompt : section==="plot_description"
  ? "# תיאור החלקה · סעיף 7.1\n\nכתוב בעברית מקצועית ותמציתית את סעיף תיאור החלקה לשומת מקרקעין. השתמש אך ורק בנתוני govmap_spatial_evidence ובעובדות שסופקו. אין להמציא שטח רשום, טופוגרפיה, גבולות, שימושים, מבנים או ייעודים; נתוני GovMap הם נתוני עזר ויש לציין אי-ודאות מהותית תחת הערה לשמאי. הצג רק טקסט מוכן להעתקה לשומה."
  : "# "+catalog.sections.find(s=>s.id===section)?.label+"\n\nפרק זה טרם מומש. ניתן להכין כאן הוראות אישיות לשימוש עתידי.";
function Icon({provider}:{provider:string}) {
  if(provider==="openai" || provider==="gemini" || provider==="groq")return <img className="provider-icon" alt={provider==="openai"?"ChatGPT":provider==="groq"?"Groq":"Gemini"} src={"/icons/"+(provider==="openai"?"chatgpt":provider)+".svg"}/>;
  return <span className={"provider-icon monogram "+provider} aria-hidden="true">{provider==="anthropic"?"✳":provider==="moonshot"?"K":"Q"}</span>;
}
function Models({provider,value,onChange}:{provider:string;value:string;onChange:(v:string)=>void}) {
  const models=catalog.providers.find(p=>p.id===provider)?.models??[];
  return <label>מזהה מודל<select aria-label="בחירת מודל" dir="ltr" value={models.some(m=>m[1]===value)?value:"custom"} onChange={e=>onChange(e.target.value==="custom"?"":e.target.value)}>
    {models.map(([label,id])=><option key={id} value={id}>{label}</option>)}<option value="custom">מודל אחר…</option>
  </select><input aria-label="מזהה מודל" dir="ltr" value={value} maxLength={160} onChange={e=>onChange(e.target.value)} required/><small>הזמינות תלויה בחשבון הספק. אפשר לבחור מודל מהרשימה או להזין מזהה אחר.</small></label>;
}
function Login(){
  const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError("");try{
    const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});
    if(error)throw error;
    history.replaceState(null,"",window.location.pathname);
  }catch(e){setError(message(e));}finally{setBusy(false);}}
  return <main className="login-shell" dir="rtl"><section className="login-card"><p className="eyebrow">עוזר להערכת מקרקעין</p><h1>כניסה לצוות</h1><p>התחברו באמצעות האימייל והסיסמה שקיבלתם ממנהל הצוות.</p>
    <form onSubmit={submit}><label>כתובת אימייל<input type="email" dir="ltr" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
    <label>סיסמה<input type="password" dir="ltr" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
    <button disabled={busy}>{busy?"מתחבר…":"כניסה"}</button></form>{error&&<p role="alert" className="error">{error}</p>}
  </section></main>;
}
function AccountSettings({data}:{data:Bootstrap}){
  const [password,setPassword]=useState(""),[email,setEmail]=useState(""),[newPassword,setNewPassword]=useState(""),[notice,setNotice]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function changePassword(e:FormEvent){e.preventDefault();setBusy(true);setError("");setNotice("");try{
    const {error}=await supabase.auth.updateUser({password});if(error)throw error;setPassword("");setNotice("הסיסמה עודכנה.");
  }catch(e){setError(message(e));}finally{setBusy(false);}}
  async function create(e:FormEvent){e.preventDefault();setBusy(true);setError("");setNotice("");try{
    await api("createUser",{email:email.trim(),password:newPassword,workspace:data.members.find(m=>m.role==="admin")!.workspace_id});
    setNotice("המשתמש נוצר ויכול להתחבר מיד באמצעות האימייל והסיסמה.");setEmail("");setNewPassword("");
  }catch(e){setError(message(e));}finally{setBusy(false);}}
  return <section className="account-settings"><h2>החשבון שלי</h2><form onSubmit={changePassword}><label>סיסמה חדשה לחשבון שלי<input type="password" dir="ltr" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} minLength={6} required/></label><button disabled={busy}>עדכון הסיסמה שלי</button></form>
    {data.members.some(m=>m.role==="admin")&&<><h2>ניהול משתמשים</h2><p>יצירת משתמש חדש בצוות. המשתמש יקבל גישה להיסטוריה המשותפת ולמפתחות AI אישיים.</p><form onSubmit={create}>
      <label>אימייל למשתמש החדש<input type="email" dir="ltr" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>סיסמה למשתמש החדש<input type="password" dir="ltr" autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} minLength={6} required/></label><button disabled={busy}>יצירת משתמש</button></form></>}
    {notice&&<p role="status" className="success">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
  </section>;
}
function ProviderCard({provider,setting,onSaved}:{provider:typeof catalog.providers[number];setting?:Setting;onSaved:(s:Setting)=>void}){
  const [key,setKey]=useState(""),[model,setModel]=useState(setting?.model_id??provider.models[0][1]),[busy,setBusy]=useState(false),[status,setStatus]=useState(""),[error,setError]=useState("");
  useEffect(()=>{if(setting?.model_id)setModel(setting.model_id);},[setting?.model_id]);
  async function save(e:FormEvent){e.preventDefault();setBusy(true);setError("");setStatus("");try{
    const saved=await api<Setting>("saveProvider",{provider:provider.id,model,key});onSaved(saved);setKey("");setStatus("ההגדרות נשמרו ב-Supabase.");
  }catch(e){setError(message(e));}finally{setBusy(false);}}
  return <section className="provider-card"><h2><Icon provider={provider.id}/>{provider.label}</h2><form onSubmit={save}>
    <label>מפתח API<input aria-label={provider.label+" API key"} type="password" autoComplete="new-password" dir="ltr" placeholder={setting?.configured?"••••••••••••"+setting.key_last4:"הזינו מפתח API"} value={key} onChange={e=>setKey(e.target.value)} maxLength={4096}/></label>
    <p className={setting?.configured?"success":"muted"}>{setting?.configured?<>✓ מפתח שמור <bdi>••••{setting.key_last4}</bdi> · להשארת המפתח הקיים, השאירו את השדה ללא שינוי.</>:"טרם הוגדר מפתח"}</p>
    <Models provider={provider.id} value={model} onChange={setModel}/><button disabled={busy||!model.trim()}>{busy?"שומר…":"שמירת הגדרות"}</button>
    {status&&<p role="status" className="success">{status}</p>}{error&&<p role="alert" className="error">{error}</p>}
  </form></section>;
}
function PromptEditor({section,prompt,onSaved}:{section:string;prompt?:Prompt;onSaved:(p:Prompt)=>void}){
  const [content,setContent]=useState(prompt?.content??defaultPrompt(section)),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState(""),[error,setError]=useState("");
  async function save(){setBusy(true);setError("");setStatus("");try{const saved=await api<Prompt>("savePrompt",{section,content,version:prompt?.version??0});onSaved(saved);setEditing(false);setStatus("קובץ הסוכן נשמר בחשבון שלך. הבקשה הבאה תשתמש בו.");}catch(e){setError(message(e));}finally{setBusy(false);}}
  return <div className="prompt-editor"><p><bdi>{section}.md</bdi> · {prompt?"גרסה "+prompt.version:"ברירת המחדל"}</p>
    <textarea aria-label="תוכן קובץ הסוכן" rows={18} readOnly={!editing} value={content} maxLength={50000} onChange={e=>setContent(e.target.value)}/>
    <div className="actions">{editing?<><button onClick={save} disabled={busy||!content.trim()}>שמירת קובץ הסוכן</button><button className="secondary" disabled={busy} onClick={()=>{setContent(prompt?.content??defaultPrompt(section));setEditing(false);}}>ביטול</button><button className="secondary" disabled={busy} onClick={()=>setContent(defaultPrompt(section))}>טעינת ברירת מחדל לעריכה</button></>:<button onClick={()=>setEditing(true)}>עריכה</button>}</div>
    {status&&<p className="success" role="status">{status}</p>}{error&&<p className="error" role="alert">{error}</p>}
  </div>;
}
function Settings({data,setData}:{data:Bootstrap;setData:(d:Bootstrap)=>void}){
  const [section,setSection]=useState("environment_description"),[error,setError]=useState("");
  const [importing,setImporting]=useState(false),[importStatus,setImportStatus]=useState("");
  async function importDesktop(){setImporting(true);setError("");try{
    const {data:{session}}=await supabase.auth.getSession();
    const response=await fetch("/__desktop/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:session?.access_token})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||"הייבוא נכשל");
    setData(await api<Bootstrap>("bootstrap"));
    setImportStatus("יובאו: "+(result.imported.join(", ")||"לא נמצאו מפתחות")+(result.failed.length?". לא יובאו: "+result.failed.join(", "):""));
  }catch(e){setError(message(e));}finally{setImporting(false);}}
  return <><h1>הגדרות</h1><p>המפתחות מוצפנים ב-Supabase Vault. המפתח המלא אינו נשלח בחזרה לדפדפן.</p>
    {import.meta.env.DEV&&<div className="actions"><button onClick={importDesktop} disabled={importing}>{importing?"מייבא…":"ייבוא מפתחות מהיישום השולחני"}</button></div>}
    {importStatus&&<p role="status" className="success">{importStatus}</p>}
    <label>ספק ברירת מחדל<select value={data.defaultProvider} onChange={async e=>{const provider=e.target.value;try{await api("defaultProvider",{provider});setData({...data,defaultProvider:provider});setError("");}catch(e){setError(message(e));}}}>{catalog.providers.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
    {error&&<p role="alert" className="error">{error}</p>}
    <div className="providers">{catalog.providers.map(p=><ProviderCard key={p.id} provider={p} setting={data.settings.find(s=>s.provider_id===p.id)} onSaved={s=>setData({...data,settings:[...data.settings.filter(x=>x.provider_id!==s.provider_id),s]})}/>)}</div>
    <AccountSettings data={data}/><details className="advanced"><summary>הגדרות מתקדמות · Advanced settings</summary><h2>קובצי סוכנים אישיים</h2><p>ההוראות פרטיות לחשבון שלך. רק פרקים הזמינים גם ביישום השולחני ניתנים ליצירה.</p>
      <label>פרק הדוח<select value={section} onChange={e=>setSection(e.target.value)}>{catalog.sections.map(s=><option disabled={!s.available} key={s.id} value={s.id}>{s.label}{s.available?"":" — בהכנה"}</option>)}</select></label>
      <PromptEditor key={section} section={section} prompt={data.prompts.find(p=>p.section_id===section)} onSaved={p=>setData({...data,prompts:[...data.prompts.filter(x=>x.section_id!==p.section_id),p]})}/>
    </details></>;
}
async function encodeFile(file:File,role:string){
  if(file.size>10*1024*1024)throw new Error("גודל הקבצים המרבי הוא 10 MB");
  const type=/\.pdf$/i.test(file.name)?"application/pdf":/\.(txt|md|csv)$/i.test(file.name)?"text/plain":"";
  if(!type)throw new Error("נתמכים כרגע PDF, TXT, MD ו-CSV.");
  const bytes=new Uint8Array(await file.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return {name:file.name,type,data:btoa(binary),role};
}
function NewRequest({data,onSettings}:{data:Bootstrap;onSettings:()=>void}){
  const [provider,setProvider]=useState(data.defaultProvider),[model,setModel]=useState(data.settings.find(s=>s.provider_id===data.defaultProvider)?.model_id??catalog.providers.find(p=>p.id===data.defaultProvider)!.models[0][1]);
  const [address,setAddress]=useState(""),[example,setExample]=useState(""),[additional,setAdditional]=useState(""),[section,setSection]=useState("environment_description"),[workspace,setWorkspace]=useState(data.members[0].workspace_id);
  const [exampleFiles,setExampleFiles]=useState<File[]>([]),[additionalFiles,setAdditionalFiles]=useState<File[]>([]),[consent,setConsent]=useState(true),[search,setSearch]=useState(false);
  const [busy,setBusy]=useState(false),[output,setOutput]=useState(""),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [mapAddress,setMapAddress]=useState("");
  const [plotData,setPlotData]=useState<PlotAnalysisData|null>(null);
  const [plotGenerateRequested,setPlotGenerateRequested]=useState(false);
  const searchAvailable=["openai","gemini","anthropic"].includes(provider)||(provider==="groq"&&["openai/gpt-oss-20b","openai/gpt-oss-120b"].includes(model));
  const pdfAvailable=["openai","gemini","anthropic"].includes(provider);
  const configured=data.settings.find(s=>s.provider_id===provider)?.configured;
  async function generate(e:FormEvent){e.preventDefault();setMapAddress(address.trim());setBusy(true);setError("");setNotice("");setOutput("");try{
    const all=[...exampleFiles,...additionalFiles];if(all.length>5||all.reduce((n,f)=>n+f.size,0)>10*1024*1024)throw new Error("מותר לצרף עד 5 קבצים ובסך הכול עד 10 MB.");
    if(!pdfAvailable&&all.some(f=>/\.pdf$/i.test(f.name)))throw new Error("הספק שנבחר תומך בקובצי TXT, MD ו-CSV בלבד. יש להסיר קובצי PDF או לבחור ספק אחר.");
    const files=await Promise.all([...exampleFiles.map(f=>encodeFile(f,"example")),...additionalFiles.map(f=>encodeFile(f,"additional"))]);
    const result=await api<{job:Job}>("generate",{requestId:crypto.randomUUID(),workspace,section,address,example,additional,provider,model,consent,search:search&&searchAvailable,files});
    if(result.job.status!=="succeeded")throw new Error("הבקשה בטיפול. בדקו את ההיסטוריה.");
    setOutput(result.job.output_text??"");setNotice("הטיוטה נוצרה ונשמרה בהיסטוריית הצוות.");
  }catch(e){setError(message(e));}finally{setBusy(false);}}
  async function generatePlotWithAi(dataOverride:PlotAnalysisData|null=plotData){
    if(!dataOverride || !configured || !model.trim())return;
    setBusy(true);setError("");setNotice("");setOutput("");
    try {
      const all=[...exampleFiles,...additionalFiles];
      if(all.length>5||all.reduce((n,f)=>n+f.size,0)>10*1024*1024)throw new Error("מותר לצרף עד 5 קבצים ובסך הכול עד 10 MB.");
      if(!pdfAvailable&&all.some(f=>/\.pdf$/i.test(f.name)))throw new Error("הספק שנבחר תומך בקובצי TXT, MD ו-CSV בלבד. יש להסיר קובצי PDF או לבחור ספק אחר.");
      const files=await Promise.all([...exampleFiles.map(f=>encodeFile(f,"example")),...additionalFiles.map(f=>encodeFile(f,"additional"))]);
      const evidence=JSON.stringify({govmap_spatial_evidence:dataOverride},null,2);
      const combinedAdditional=(additional.trim()?additional.trim()+"\n\n":"")+"--- Verified plot data from GovMap (govmap_spatial_evidence) ---\n"+evidence;
      const result=await api<{job:Job}>("generate",{requestId:crypto.randomUUID(),workspace,section:"plot_description",address:dataOverride.address,example,additional:combinedAdditional,provider,model,consent,search:search&&searchAvailable,files});
      if(result.job.status!=="succeeded")throw new Error("הבקשה בטיפול. בדקו את ההיסטוריה.");
      setOutput(result.job.output_text??"");setNotice("הניסוח נוצר ונשמר בהיסטוריית הצוות.");
    } catch(e){setError(message(e));} finally {setBusy(false);}
  }
  async function submit(e:FormEvent){
    e.preventDefault();
    if(section==="plot_description"){
      setMapAddress(address.trim());
      if(plotData && !configured){setError("יש להגדיר מפתח API לספק שנבחר בהגדרות.");return;}
      if(plotData) await generatePlotWithAi(plotData);
      else setPlotGenerateRequested(true);
      return;
    }
    await generate(e);
  }
  return <><div className="title-row"><div><p className="eyebrow">{section==="plot_description"?"איסוף נתונים מ־GovMap":"כתיבה שמאית בעזרת AI"}</p><h1>בקשה חדשה</h1></div><span className="shared-badge">היסטוריה משותפת לצוות</span></div>
    <form onSubmit={submit}><fieldset disabled={busy} className="request-fields">
      <label>פרק הדוח<select value={section} onChange={e=>{setSection(e.target.value);setMapAddress("");setOutput("");setPlotData(null);setPlotGenerateRequested(false);}}>{catalog.sections.map(s=><option disabled={!s.available} value={s.id} key={s.id}>{s.label}{s.available?"":" — בהכנה"}</option>)}</select></label>
      {data.members.length>1&&<label>סביבת עבודה<select value={workspace} onChange={e=>setWorkspace(e.target.value)}>{data.members.map(m=><option key={m.workspace_id}>{m.workspace_id}</option>)}</select></label>}
      <label>כתובת הנכס<input value={address} onChange={e=>setAddress(e.target.value)} required maxLength={500} placeholder="לדוגמה: התחייה 2, חדרה"/></label>
      <div className="two-columns"><label>ספק AI<span className="provider-choice"><Icon provider={provider}/><select value={provider} onChange={e=>{const id=e.target.value;setProvider(id);setModel(data.settings.find(s=>s.provider_id===id)?.model_id??catalog.providers.find(p=>p.id===id)!.models[0][1]);if(id==="moonshot"||id==="qwen")setSearch(false);}}>{catalog.providers.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></span></label><Models provider={provider} value={model} onChange={setModel}/></div>
      {!configured&&<p className="error">יש להגדיר מפתח API לספק זה. <button type="button" className="text-button" onClick={onSettings}>פתיחת הגדרות</button></p>}
      <label>דוגמה לסגנון הרצוי<textarea rows={5} value={example} onChange={e=>setExample(e.target.value)} maxLength={20000}/></label>
      <label>קובצי דוגמה<input type="file" multiple accept={pdfAvailable?".pdf,.txt,.md,.csv":".txt,.md,.csv"} onChange={e=>setExampleFiles(Array.from(e.target.files??[]))}/></label>
      <label>בקשה נוספת<textarea rows={3} value={additional} onChange={e=>setAdditional(e.target.value)} maxLength={20000}/></label>
      <label>קבצים נוספים<input type="file" multiple accept={pdfAvailable?".pdf,.txt,.md,.csv":".txt,.md,.csv"} onChange={e=>setAdditionalFiles(Array.from(e.target.files??[]))}/></label>
      <small>עד 5 קבצים, 10 MB בסך הכול. PDF נתמך ב-ChatGPT, Gemini ו-Claude. הקבצים נשלחים לעיבוד בזיכרון ואינם נשמרים באחסון.</small>
      <label className="checkbox"><input type="checkbox" checked={search&&searchAvailable} disabled={!searchAvailable} onChange={e=>setSearch(e.target.checked)}/>חיפוש מידע עדכני באינטרנט (במודלים תומכים; עשוי להוסיף עלות)</label>
      <label className="checkbox privacy-notice"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} required/>אני מאשר/ת לשלוח את התוכן והקבצים לספק שנבחר ולשמור את הטיוטה בהיסטוריית הצוות.</label>
    </fieldset><div className="actions"><button disabled={busy||!address.trim()||!model.trim()||(section!=="plot_description"&&!configured)}>{busy?"יוצר טיוטה… נא להמתין":"צור טיוטה"}</button>{section!=="plot_description"&&<button type="button" className="secondary" disabled={!address.trim()} onClick={()=>setMapAddress(address.trim())}>הצג מפה לכתובת</button>}</div></form>
    {busy&&<p role="status">הבקשה נשלחה לעיבוד. אין לסגור את החלון עד לקבלת תשובה.</p>}{error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status" className="success">{notice}</p>}
    {output&&<Report text={output}/>} {mapAddress&&<GovMapPanel address={mapAddress} mode={section==="plot_description"?"plot":"map"} onPlotData={data=>{setPlotData(data);if(data&&plotGenerateRequested){setPlotGenerateRequested(false);void generatePlotWithAi(data);}}}/>}</>;
}
function Report({text}:{text:string}){
  const [copied,setCopied]=useState(false),[error,setError]=useState("");
  return <section className="report"><h2>טיוטה לבדיקה</h2><p className="muted">יש לבדוק את העובדות והניסוח לפני שילוב בשומה.</p><textarea aria-label="טיוטת הדוח" value={text} readOnly rows={15}/><div className="actions"><button onClick={async()=>{try{await navigator.clipboard.writeText(text);setCopied(true);}catch{setError("לא ניתן להעתיק אוטומטית. סמנו את הטקסט והעתיקו.");}}}>{copied?"הועתק":"העתקה"}</button><button className="secondary" onClick={()=>{const url=URL.createObjectURL(new Blob(["\ufeff"+text],{type:"text/plain;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="appraisal-draft.txt";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>הורדת טקסט</button></div>{error&&<p role="alert">{error}</p>}</section>;
}
function HistoryItem({job}:{job:Job}){
  const [open,setOpen]=useState(false);
  return <details className="history-item" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>{job.address} · {new Date(job.created_at).toLocaleString("he-IL")} · {({succeeded:"הושלם",running:"בטיפול",failed:"נכשל",needs_review:"דרושה בדיקה"} as Record<string,string>)[job.status]??job.status}</summary>
    {open&&<><p><bdi>{job.provider_id} / {job.model_id}</bdi></p>{job.output_text?<Report text={job.output_text}/>:<p>{job.status==="running"?"הבקשה עדיין מסומנת בטיפול. אם חלפו כמה דקות, אין להפעיל שוב לפני בדיקת חיוב הספק.":job.error_code??"לא נשמרה טיוטה."}</p>}<GovMapPanel address={job.address}/></>}
  </details>;
}
function History(){
  const [jobs,setJobs]=useState<Job[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(true);
  async function refresh(){setBusy(true);try{const r=await api<{jobs:Job[]}>("history");setJobs(r.jobs);setError("");}catch(e){setError(message(e));}finally{setBusy(false);}}
  useEffect(()=>{void refresh();},[]);
  return <><div className="title-row"><h1>היסטוריית הצוות</h1><button onClick={refresh} disabled={busy}>רענון</button></div>{error&&<p role="alert" className="error">{error}</p>}{busy?<p role="status">טוען…</p>:!jobs.length?<p>עדיין אין בקשות שמורות.</p>:jobs.map(job=><HistoryItem key={job.id} job={job}/>)}</>;
}
function Workspace({session}:{session:Session}){
  const [view,setView]=useState<"new"|"history"|"settings">("new"),[data,setData]=useState<Bootstrap|null>(null),[error,setError]=useState("");
  useEffect(()=>{let active=true;api<Bootstrap>("bootstrap").then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[]);
  return <div dir="rtl"><header><span className="brand">עוזר להערכת מקרקעין</span><nav aria-label="ניווט ראשי"><button className={view==="new"?"nav-active":""} onClick={()=>setView("new")}>בקשה חדשה</button><button className={view==="history"?"nav-active":""} onClick={()=>setView("history")}>היסטוריה</button></nav><span className="account"><bdi>{session.user.email}</bdi><button className="quiet-button" onClick={()=>supabase.auth.signOut()}>יציאה</button></span><button className={"gear "+(view==="settings"?"nav-active":"")} aria-label="הגדרות" title="הגדרות" onClick={()=>setView("settings")}><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.325 4.317a1.125 1.125 0 0 1 1.088-.817h1.174c.53 0 .996.35 1.088.857l.196 1.084c.056.311.252.57.537.719.257.135.5.293.724.47.254.2.598.238.888.103l1.009-.47a1.125 1.125 0 0 1 1.487.49l.587 1.016c.274.474.11 1.08-.365 1.354l-.918.53a1.125 1.125 0 0 0-.562.974v.746c0 .402.215.774.562.974l.918.53c.475.274.639.88.365 1.354l-.587 1.016a1.125 1.125 0 0 1-1.487.49l-1.009-.47a1.125 1.125 0 0 0-.888.103c-.224.177-.467.335-.724.47a1.125 1.125 0 0 0-.537.719l-.196 1.084a1.125 1.125 0 0 1-1.088.857h-1.174a1.125 1.125 0 0 1-1.088-.817l-.196-1.084a1.125 1.125 0 0 0-.537-.719 5.23 5.23 0 0 1-.724-.47 1.125 1.125 0 0 0-.888-.103l-1.009.47a1.125 1.125 0 0 1-1.487-.49l-.587-1.016a1.125 1.125 0 0 1 .365-1.354l.918-.53a1.125 1.125 0 0 0 .562-.974v-.746c0-.402-.215-.774-.562-.974l-.918-.53a1.125 1.125 0 0 1-.365-1.354l.587-1.016a1.125 1.125 0 0 1 1.487-.49l1.009.47a1.125 1.125 0 0 0 .888-.103c.224-.177.467-.335.724-.47.285-.15.481-.408.537-.719l.196-1.084Z"/><circle cx="12" cy="12" r="3"/></svg></button></header>
    <main className="workspace"><section className="content-card">{error?<><p className="error" role="alert">{error}</p><button onClick={()=>location.reload()}>ניסיון נוסף</button></>:!data?<p role="status">טוען את החשבון…</p>:view==="settings"?<Settings data={data} setData={setData}/>:view==="history"?<History/>:<NewRequest data={data} onSettings={()=>setView("settings")}/>}</section></main>
  </div>;
}
export function App(){
  const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
  useEffect(()=>{supabase.auth.getSession().then(({data,error})=>{setSession(data.session);setLoading(false);if(error)setError(error.message);});const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,s)=>{setSession(s);setLoading(false);});return()=>subscription.unsubscribe();},[]);
  if(loading)return <p dir="rtl">טוען…</p>;if(error)return <p role="alert">{error}</p>;
  return session?<Workspace session={session}/>:<Login/>;
}
