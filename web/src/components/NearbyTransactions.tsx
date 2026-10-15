import type {CliModel} from '../../../supabase/functions/appraisal/cli-models';
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { TransactionQuery, TransactionResult } from "../../../supabase/functions/appraisal/nearby-transactions";
import { GOVMAP_APP_ORIGIN } from "../../../supabase/functions/appraisal/govmap-transactions";
import catalog from "../catalog.json";
import { api } from "../lib/edge";
import { Icon, Models } from "./ProviderControls";
import { TransactionTable } from "./TransactionTable";
import { ImportedTransactions } from "./ImportedTransactions";
import { AutomaticComparables } from './AutomaticComparables';

import {transactionFormIssues} from '../lib/transaction-form-issues';
import {useCliAccount} from '../lib/use-cli-account';
import {useCliSubmission} from '../lib/use-cli-submission';
import {CliAccountControls} from './CliAccountControls';
import {CliSubmissionStatus} from './CliSubmissionStatus';
import {ExecutionModeControl} from './ExecutionModeControl';
import type {CliProvider} from '../lib/cli-agent';
type Execution={executionMode?:'api'|'cli';userId?:string;workspaces?:string[];defaultCliProvider?:CliProvider;defaultCliModel?:CliModel};
type Account = { defaultProvider: string; settings: { provider_id: string; model_id: string; configured: boolean }[]; nadlanConfigured?: boolean; nadlanBrowserConfigured?: boolean };
const optionalNumber = (s: string) => s === "" ? null : Number(s);

export function NearbyTransactions({ data, onSettings,...execution }: { data: Account; onSettings: () => void }&Execution) {
  const [source, setSource] = useState("over");
  const [legacyMode,setLegacyMode]=useState<'api'|'cli'>(execution.executionMode??'cli');
  return <>
    <label>מקור העסקאות<select value={source} onChange={e => setSource(e.target.value)}><option value="over">עסקאות רשות המסים / over.org.il — אוטומטי</option><option value="nadlan">Nadlan — מסלול קודם</option><option value="import">טבלה שסופקה וקישור Nadlan</option><option value="govmap">חיפוש כתובת ב־GovMap</option></select></label>
    {source!=='over'&&<ExecutionModeControl value={legacyMode} onChange={value=>setLegacyMode(value==='cli'?'cli':'api')}/>}
    {source === 'over' ? <AutomaticComparables onSettings={onSettings} {...execution}/> : source !== "govmap" ? <ImportedTransactions key={source+legacyMode} automatic={source === "nadlan"} data={data} onSettings={onSettings} {...execution} executionMode={legacyMode}/> : <GovMapNearbyTransactions key={legacyMode} data={data} onSettings={onSettings} {...execution} executionMode={legacyMode}/>}
  </>;
}

function GovMapNearbyTransactions({ data, onSettings,executionMode="cli",userId="",workspaces=[],defaultCliProvider='claude',defaultCliModel }: { data: Account; onSettings: () => void }&Execution) {
  const cliMode=executionMode==="cli",cliAccount=useCliAccount(cliMode,defaultCliProvider,defaultCliModel),cliRun=useCliSubmission(userId,"comparable_sales");
  const [workspace,setWorkspace]=useState(workspaces[0]??"");
  const modelFor = (id: string) => data.settings.find(s => s.provider_id === id)?.model_id ?? catalog.providers.find(p => p.id === id)!.models[0][1];
  const [provider, setProvider] = useState(data.defaultProvider), [model, setModel] = useState(modelFor(data.defaultProvider));
  const [address, setAddress] = useState(""), [description, setDescription] = useState("");
  const [rooms, setRooms] = useState(""), [area, setArea] = useState(""), [radius, setRadius] = useState("");
  const [startDate, setStartDate] = useState(""), [endDate, setEndDate] = useState("");
  const [dealType, setDealType] = useState(""), [limit, setLimit] = useState("20"), [consent, setConsent] = useState(true);
  const [result, setResult] = useState<TransactionResult | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const [collection, setCollection] = useState<{ requestId: string; query: TransactionQuery;connectionId?:string;workspaceId?:string;modelSelection?:CliModel } | null>(null);
  const submitCli=cliRun.submit;
  const [stage, setStage] = useState("");
  const approvedDomain = location.origin === GOVMAP_APP_ORIGIN;
  const configured = data.settings.some(s => s.provider_id === provider && s.configured);

  useEffect(() => {
    if (!collection) return;
    let active = true, received = false;
    const finish = () => { if (active) { inFlight.current = false; setBusy(false); setCollection(null); } };
    const timer = setTimeout(() => { if (!received && active) { setError("איסוף העסקאות ארך זמן רב מדי. צמצמו את הרדיוס ונסו שוב."); finish(); } }, 300000);
    const receive = async (event: MessageEvent) => {
      if (received || event.origin !== location.origin || event.source !== frame.current?.contentWindow ||
          event.data?.type !== "govmap-transactions" || event.data.requestId !== collection.requestId) return;
      received = true; clearTimeout(timer);
      try {
        if (typeof event.data.error === "string") throw new Error(event.data.error);
        setStage("העסקאות התקבלו. בודק את הנתונים ומשווה באמצעות המודל שנבחר…");
        if(collection.connectionId&&collection.workspaceId){
          await submitCli({schemaVersion:1,requestId:crypto.randomUUID(),connectionId:collection.connectionId,workspaceId:collection.workspaceId,sectionId:"comparable_sales",address:collection.query.address,example:"",additionalRequest:"",modelSelection:collection.modelSelection??"provider-default",consent:true,evidence:{kind:"govmap",query:collection.query,evidence:event.data.evidence}});
          return;
        }
        const next = await api<TransactionResult>("compareNearbyTransactions", { provider, model, consent, query: collection.query, evidence: event.data.evidence });
        if (active) setResult(next);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "השוואת העסקאות נכשלה."); }
      finally { finish(); }
    };
    window.addEventListener("message", receive);
    return () => { active = false; clearTimeout(timer); window.removeEventListener("message", receive); };
  }, [collection, provider, model, consent,submitCli]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || cliRun.busy) return;
    const issues=[...transactionFormIssues({rooms,area,limit,startDate,endDate,radius}),!address.trim()&&!description.trim()?"יש להזין כתובת או תיאור מיקום הנכס.":"",cliMode&&!address.trim()?"בחיפוש CLI יש להזין כתובת מלאה בשדה הכתובת.":"",!consent?"יש לאשר העברת נתוני החיפוש לספקים.":"",cliMode?cliAccount.issue:!configured?"יש להגדיר מפתח API לספק בהגדרות.":!model.trim()?"יש לבחור מודל AI.":"",!approvedDomain?"איסוף GovMap זמין באתר המאושר בלבד; פתחו את הקישור לאתר הפעיל.":"",cliMode&&!workspaces.includes(workspace)?"יש לבחור צוות פעיל.":""].filter(Boolean);
    if(issues.length){setError(issues.join(" "));return;}
    if(!(event.currentTarget as HTMLFormElement).reportValidity())return;
    if(cliMode&&cliRun.identity){setError("בקשת CLI קודמת נשמרה. בדקו את מצבה או בחרו יצירת בקשה חדשה.");return;}
    if (!approvedDomain) { setError("איסוף GovMap זמין בדומיין המאושר בלבד."); return; }
    if (startDate && endDate && startDate > endDate) { setError("תאריך ההתחלה מאוחר מתאריך הסיום."); return; }
    inFlight.current = true; setBusy(true); setError(""); setResult(null);
    setStage("מכין את פרטי החיפוש…");
    try {
      const query = await api<TransactionQuery>("prepareNearbyTransactions", { provider, model, consent, ...(cliMode?{executionMode:"cli"}:{}), query: {
        address, description, rooms: optionalNumber(rooms), area: optionalNumber(area), radiusMeters: optionalNumber(radius), startDate, endDate, dealType, limit: Number(limit),
      } });
      setStage("אוסף עסקאות ישירות מ־GovMap באמצעות הדפדפן…");
      setCollection({ requestId: crypto.randomUUID(), query,...(cliMode?{connectionId:cliAccount.selected!.connection!.id,workspaceId:workspace,modelSelection:cliAccount.modelSelection}:{}) });
    } catch (e) { setError(e instanceof Error ? e.message : "אחזור העסקאות נכשל."); inFlight.current = false; setBusy(false); }
  }

  return <section className="nearby-transactions" aria-labelledby="nearby-title">
    <h2 id="nearby-title">משוך עסקאות מהסביבה</h2>
    <p className="muted">כלי עזר להשוואת עסקאות. מלאו את הפרטים הידועים לכם; אפשר לציין את המיקום גם בטקסט החופשי. {cliMode?"תוצאת CLI נשמרת בהיסטוריה עם עסקאות המקור.":"התוצאות מוצגות בטבלה ואינן נשמרות כדוח."}</p>
    {!approvedDomain && <p role="status" className="error">הרשאת GovMap מוגדרת ל־<a href={GOVMAP_APP_ORIGIN}>אתר היישום הפעיל</a>. האיסוף אינו זמין ב־localhost או בתצוגה מקדימה; יש לפרוס שם את הגרסה המעודכנת.</p>}
    <form onSubmit={submit} noValidate><fieldset disabled={busy || cliRun.busy} className="request-fields">
      <label>כתובת או אזור הנכס<input value={address} onChange={e => setAddress(e.target.value)} maxLength={500} placeholder="לדוגמה: דיזנגוף 50, תל אביב"/></label>
      <div className="two-columns">
        <label>מספר חדרים<input type="number" min="0.5" max="100" step="0.5" value={rooms} onChange={e => setRooms(e.target.value)} placeholder="לא חובה"/></label>
        <label>שטח הנכס במ״ר<input type="number" min="0.1" max="1000000" step="0.1" value={area} onChange={e => setArea(e.target.value)} placeholder="לא חובה"/></label>
      </div>
      <label>תיאור הנכס והעדפות לחיפוש<textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} maxLength={6000} placeholder="סוג הנכס, קומה, מצב, חניה, תקופה רצויה וכל פרט נוסף שיעזור להשוואה"/></label>
      <div className="two-columns">
        <label>עסקאות מתאריך<input type="date" value={startDate} max={endDate || new Date().toISOString().slice(0, 10)} onChange={e => setStartDate(e.target.value)}/></label>
        <label>עסקאות עד תאריך<input type="date" value={endDate} min={startDate || undefined} max={new Date().toISOString().slice(0, 10)} onChange={e => setEndDate(e.target.value)}/></label>
        <label>רדיוס חיפוש במטרים<input type="number" min="1" max="5000" step="1" value={radius} onChange={e => setRadius(e.target.value)} placeholder="500, אלא אם צוין בתיאור"/></label>
        <label>סוג עסקה<select value={dealType} onChange={e => setDealType(e.target.value)}><option value="">לפי הבקשה (ברירת מחדל: הכל)</option><option value="both">יד ראשונה ויד שנייה</option><option value="new">יד ראשונה</option><option value="used">יד שנייה</option></select></label>
        <label>מספר תוצאות מרבי<input type="number" min="1" max="40" step="1" value={limit} onChange={e => setLimit(e.target.value)} required/></label>
      </div>
      <small>ללא תקופה או רדיוס בבקשה: שנתיים אחרונות ו־500 מטרים. שדות מפורשים קודמים לתיאור החופשי. חדרים ושטח משמשים לדירוג דמיון, לא לסינון קשיח.</small>
      {cliMode&&<small>במצב CLI יש להזין את הכתובת בשדה הכתובת. תקופה ורדיוס נקבעים מהשדות המפורשים או מברירות המחדל; התיאור החופשי משמש להשוואה.</small>}
      {cliMode?<><CliAccountControls account={cliAccount} onSettings={onSettings}/>{workspaces.length>1&&<label>צוות<select value={workspace} onChange={e=>setWorkspace(e.target.value)}>{workspaces.map(w=><option key={w}>{w}</option>)}</select></label>}</>:<>
      <div className="two-columns"><label>ספק AI<span className="provider-choice"><Icon provider={provider}/><select value={provider} onChange={e => {setProvider(e.target.value); setModel(modelFor(e.target.value));}}>{catalog.providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></span></label><Models provider={provider} value={model} onChange={setModel}/></div>
      {!configured && <p className="error">יש להגדיר מפתח API לספק זה. <button type="button" className="text-button" onClick={onSettings}>פתיחת הגדרות</button></p>}
      </>}
      <label className="checkbox privacy-notice"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required/>אני מאשר/ת לשלוח את פרטי החיפוש ל־GovMap ואת פרטי הנכס והעסקאות שהתקבלו לספק AI הנבחר.</label>
      <button disabled={busy || cliRun.busy}>{busy ? "מאתר ומשווה עסקאות…" : "משוך עסקאות מהסביבה"}</button>
    </fieldset></form>
    {cliMode&&<CliSubmissionStatus run={cliRun}/>}
    {busy && <p role="status">{stage}</p>}
    {collection && <iframe ref={frame} title="איסוף עסקאות מ־GovMap" style={{ width: "100%", minHeight: 440, border: 0 }} src={`/govmap-transactions.html#${new URLSearchParams({ address: collection.query.address, radius: String(collection.query.radiusMeters), request: collection.requestId })}`}/>}
    {error && <p role="alert" className="error">{error}</p>}
    {result && <TransactionTable result={result}/>}
  </section>;
}
