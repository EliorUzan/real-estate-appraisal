import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { AgentResult } from "../../../supabase/functions/appraisal/nadlan-agent";
import { MAX_IMPORT_BYTES, nadlanSourceUrl, parseTransactionImport, type TransactionImport } from "../../../supabase/functions/appraisal/transaction-import";
import catalog from "../catalog.json";
import { api } from "../lib/edge";
import { Icon, Models } from "./ProviderControls";
import { TransactionTable } from "./TransactionTable";
import type { CollectedTransactions } from "../../../supabase/functions/appraisal/nadlan-browser";

import {transactionFormIssues} from '../lib/transaction-form-issues';
import {useCliAccount} from '../lib/use-cli-account';
import {useCliSubmission} from '../lib/use-cli-submission';
import {CliAccountControls} from './CliAccountControls';
import {CliSubmissionStatus} from './CliSubmissionStatus';
type Account = { defaultProvider: string; settings: { provider_id: string; model_id: string; configured: boolean }[]; nadlanBrowserConfigured?: boolean };
const message = (e: unknown) => e instanceof Error ? e.message : "הניתוח נכשל.";
const numeric = (s: string) => s === "" ? null : Number(s);
const money = (n: number) => new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(n);

export function ImportedTransactions({ data, onSettings, automatic = false, executionMode="api",userId="",workspaces=[] }: { data: Account; onSettings: () => void; automatic?: boolean;executionMode?:"api"|"cli";userId?:string;workspaces?:string[] }) {
  const cliMode=executionMode==="cli",cliAccount=useCliAccount(cliMode),cliRun=useCliSubmission(userId,"comparable_sales");
  const [workspace,setWorkspace]=useState(workspaces[0]??"");
  const modelFor = (id: string) => data.settings.find(s => s.provider_id === id)?.model_id ?? catalog.providers.find(p => p.id === id)!.models[0][1];
  const [sourceUrl, setSourceUrl] = useState(""), [table, setTable] = useState("");
  const [address, setAddress] = useState(""), [description, setDescription] = useState("");
  const [rooms, setRooms] = useState(""), [area, setArea] = useState("");
  const [floor, setFloor] = useState("");
  const [dataset, setDataset] = useState<Record<string, unknown> | null>(null);
  const [startDate, setStartDate] = useState(""), [endDate, setEndDate] = useState("");
  const [limit, setLimit] = useState("10"), [provider, setProvider] = useState(data.defaultProvider), [model, setModel] = useState(modelFor(data.defaultProvider));
  const [consent, setConsent] = useState(true), [busy, setBusy] = useState(false), [loadingFile, setLoadingFile] = useState(false), [error, setError] = useState("");
  const [preview, setPreview] = useState<TransactionImport | null>(null), [result, setResult] = useState<AgentResult | null>(null);
  const [collection, setCollection] = useState<CollectedTransactions | null>(null), [pages, setPages] = useState("5"), [stage, setStage] = useState("");
  const inFlight = useRef(false), fileVersion = useRef(0);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const configured = data.settings.some(s => s.provider_id === provider && s.configured);

  function inspect() {
    setError("");
    try { setPreview(parseTransactionImport(table)); } catch (e) { setPreview(null); setError(message(e)); }
  }
  async function readFile(file: File | undefined) {
    if (!file) return;
    const version = ++fileVersion.current;
    setError(""); setResult(null); setPreview(null); setTable(""); setLoadingFile(true);
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("הקובץ מוגבל ל־1 MB.");
      const value = await file.text();
      if (version !== fileVersion.current || !active.current) return;
      const parsed = parseTransactionImport(value);
      setTable(value); setPreview(parsed);
    } catch (e) { if (version === fileVersion.current && active.current) setError(message(e)); }
    finally { if (version === fileVersion.current && active.current) setLoadingFile(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || loadingFile || cliRun.busy) return;
    const issues=[...transactionFormIssues({rooms,area,limit,startDate,endDate,pages},automatic),!address.trim()?"יש להזין כתובת מלאה של הנכס הנבדק.":"",!consent?"יש לאשר העברת הנתונים לספק.":"",automatic&&!data.nadlanBrowserConfigured?"שירות איסוף Nadlan אינו מוגדר בשרת. ניתן לבחור טבלה שסופקה וקישור מקור.":"",!automatic&&!table.trim()?"יש להדביק טבלת עסקאות או לבחור קובץ CSV/TSV.":"",!automatic&&!sourceUrl.trim()?"יש להזין קישור מקור של Nadlan.":"",cliMode?cliAccount.issue:!configured?"יש להגדיר מפתח API לספק בהגדרות.":!model.trim()?"יש לבחור מודל AI.":"",cliMode&&!workspaces.includes(workspace)?"יש לבחור צוות פעיל לשמירת תוצאת CLI.":"",startDate&&endDate&&startDate>endDate?"תאריך ההתחלה מאוחר מתאריך הסיום.":""].filter(Boolean);
    if(issues.length){setError(issues.join(" "));return;}
    if(!(event.currentTarget as HTMLFormElement).reportValidity())return;
    if(cliMode&&cliRun.identity){setError("בקשת CLI קודמת נשמרה. בדקו את מצבה או בחרו יצירת בקשה חדשה.");return;}
    setError(""); setResult(null);
    try {
      let source = sourceUrl.trim() ? nadlanSourceUrl(sourceUrl) : "";
      if (!automatic && !source) throw new Error("יש לציין קישור מקור לטבלה שסופקה.");
      if (!consent) throw new Error("נדרש אישור לשליחת הטבלה ופרטי הנכס לספק AI.");
      inFlight.current = true; setBusy(true);
      let sourceTable = table, evidence = collection;
      if (automatic && !evidence) {
        setStage(source ? "קורא את טבלת השכונה ומתקדם בין העמודים ב־Nadlan…" : "מחפש כתובת ב־Nadlan, מקבל קישור שיתוף ואוסף את עסקאות השכונה…");
        evidence = await api<CollectedTransactions>("collectNadlanTransactions", { ...(source ? { sourceUrl: source } : { address }), maxPages: Number(pages), consent });
        if (!active.current) return; // Switching away must not initiate a subsequent paid AI request.
        setCollection(evidence); setTable(evidence.table); sourceTable = evidence.table;
      }
      if (automatic && evidence) source = evidence.sourceUrl;
      if (automatic && evidence?.collectedRows === 0) { setStage("לא נמצאו עסקאות בטבלת השכונה באתר המקור. לא הופעל ניתוח AI."); return; }
      const parsed = parseTransactionImport(sourceTable); setPreview(parsed);
      const subject = { address: address.trim(), description: description.trim() || null, floor: floor.trim() || null, rooms: numeric(rooms), area: numeric(area) };
      const provenance = evidence ? { sourceUrl: evidence.sourceUrl, sourceAddress: evidence.sourceAddress, neighborhood: evidence.neighborhood,
        retrievedAt: evidence.retrievedAt, pagesCollected: evidence.pagesCollected, totalRows: evidence.totalRows, complete: evidence.complete, warnings: evidence.warnings } : { kind: "user_import", sourceUrl: source };
      setDataset({ schemaVersion: 1, status: "collected", subject, transactions: parsed.rows, provenance });
      if(cliMode){
        setStage("מעביר את העסקאות שנאספו לסוכן CLI…");
        await cliRun.submit({schemaVersion:1,requestId:crypto.randomUUID(),connectionId:cliAccount.selected!.connection!.id,workspaceId:workspace,sectionId:"comparable_sales",address:subject.address,example:"",additionalRequest:"",modelSelection:"provider-default",consent:true,
          evidence:{kind:"nadlan",query:{...subject,description:subject.description??"",startDate,endDate,limit:Number(limit)},sourceUrl:source,table:sourceTable,...(automatic&&evidence?{collectionProof:evidence.proof}:{})}});
        return;
      }
      setStage("הסוכן מדרג את העסקאות, בוחר עד עשר דומות ומפיק ניתוח ואינדיקציה גסה כשיש די נתונים…");
      const next = await api<AgentResult>("analyzeNadlanAgent", { sourceUrl: source, table: sourceTable, provider, model, consent,
        ...(automatic && evidence ? { collectionProof: evidence.proof } : {}),
        query: { ...subject, description: subject.description ?? "", startDate, endDate, limit: Number(limit) } });
      if (active.current) { setResult(next); setDataset(next.dataset); }
    } catch (e) { setError(message(e)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="nearby-transactions" aria-labelledby="import-title">
    <h2 id="import-title">{automatic ? "סוכן עסקאות מהשכונה · ניסוי" : "ניתוח עסקאות מטבלה שסופקה"}</h2>
    <p>{automatic ? "הזינו כתובת מלאה עם עיר. הסוכן יחפש ב־Nadlan, יקבל קישור שיתוף, יאסוף עסקאות מהשכונה וינתח אותן. אפשר גם לספק קישור שיתוף ישירות. כל מאפייני הנכס מלבד הכתובת הם רשות." : "צרפו טבלת עסקאות וקישור מקור. הסוכן ידרג עסקאות דומות ויפיק נקודות לניתוח. הקישור נשמר כהפניה בלבד; אין כאן איסוף אוטומטי של Nadlan."}</p>
    {automatic && !data.nadlanBrowserConfigured && <p role="status" className="error">שירות האיסוף של Nadlan טרם הוגדר בשרת. בינתיים ניתן לבחור ״טבלה שסופקה וקישור Nadlan״.</p>}
    <form onSubmit={submit} noValidate><fieldset disabled={busy || loadingFile || cliRun.busy} className="request-fields">
      <label>קישור שיתוף של Nadlan{automatic ? " (רשות — חלופה לחיפוש כתובת)" : ""}<input type="url" dir="ltr" value={sourceUrl} onChange={e => { setSourceUrl(e.target.value); setResult(null); setCollection(null); setPreview(null); setTable(automatic ? "" : table); setStage(""); }} placeholder="https://www.nadlan.gov.il/?view=address&id=72888186&page=deals" maxLength={2000} required={!automatic}/></label>
      {automatic ? <><label>מספר עמודים לאיסוף<input type="number" min="1" max="20" value={pages} onChange={e => { setPages(e.target.value); setCollection(null); setPreview(null); setResult(null); setStage(""); }} required/></label><small>עד 20 עמודים, מהחדש לישן. רשימה חלקית תסומן במפורש. החיפוש מתייחס לשכונה שבקישור, ולא לרדיוס מהנכס.</small>{collection && <button type="button" className="secondary" onClick={() => { setCollection(null); setTable(""); setPreview(null); setResult(null); setStage(""); }}>איפוס האיסוף לקראת בקשה חדשה</button>}</> : <>
      <label>טבלת עסקאות (CSV או TSV)<textarea dir="auto" rows={6} value={table} onChange={e => { fileVersion.current++; setTable(e.target.value); setPreview(null); setResult(null); }} placeholder={'כתובת\tשטח במ״ר\tתאריך העסקה\tמחיר העסקה\tחדרים\tקומה\tגוש/חלקה/תת-חלקה'} maxLength={MAX_IMPORT_BYTES} required/></label>
      <label>או בחירת קובץ CSV/TSV<input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" onChange={e => { void readFile(e.target.files?.[0]); e.target.value = ""; }}/></label>
      <small>עד 500 שורות ו־1 MB, עם כותרות עמודות. חובה: תאריך עסקה, מחיר העסקה וכתובת או גוש/חלקה. תאריכים בפורמט יום/חודש/שנה או YYYY-MM-DD. אין הסקת עסקאות מטקסט חופשי.</small>
      <button type="button" className="secondary" onClick={inspect}>תצוגה מקדימה של הטבלה</button>
      </>}
      <label>כתובת הנכס הנבדק<input value={address} onChange={e => { setAddress(e.target.value); setResult(null); if (automatic && !sourceUrl.trim()) { setCollection(null); setPreview(null); setTable(""); setStage(""); } }} maxLength={500} placeholder="בר יוחאי 8, רמת גן" required/></label>
      <div className="two-columns">
        <label>מספר חדרים כולל סלון (רשות)<input type="number" min="0.5" max="100" step="0.5" value={rooms} onChange={e => { setRooms(e.target.value); setResult(null); }}/></label>
        <label>שטח בנוי במ״ר (רשות)<input type="number" min="0.1" max="1000000" step="0.1" value={area} onChange={e => { setArea(e.target.value); setResult(null); }}/></label>
        <label>קומה / מפלס (רשות)<input value={floor} maxLength={80} onChange={e => { setFloor(e.target.value); setResult(null); }} placeholder="למשל: 0, ראשונה, מרתף"/></label>
      </div>
      <small>מספר חדרים כולל סלון; לדוגמה שלושה חדרי שינה וסלון = 4. אין צורך למלא מידע שאינו ידוע.</small>
      <label>מאפייני הנכס והעדפות להשוואה<textarea rows={3} value={description} onChange={e => { setDescription(e.target.value); setResult(null); }} maxLength={6000} placeholder="למשל: דירה בקומה ראשונה; יש להשוות לפי השטח והחדרים ולציין מידע חסר על חניה או מעלית"/></label>
      <div className="two-columns">
        <label>עסקאות מתאריך<input type="date" value={startDate} max={endDate || new Date().toISOString().slice(0, 10)} onChange={e => { setStartDate(e.target.value); setResult(null); }}/></label>
        <label>עסקאות עד תאריך<input type="date" value={endDate} min={startDate || undefined} max={new Date().toISOString().slice(0, 10)} onChange={e => { setEndDate(e.target.value); setResult(null); }}/></label>
        <label>מספר עסקאות לבחירת המודל<input type="number" min="1" max="40" step="1" value={limit} onChange={e => { setLimit(e.target.value); setResult(null); }} required/></label>
      </div>
      <small>ברירת המחדל היא השנתיים האחרונות. המרחק מהנכס אינו מאומת. תאריכים מסננים את הטבלה שנאספה; מאפייני הנכס משמשים לבחירת עסקאות דומות.</small>
      {cliMode?<><CliAccountControls account={cliAccount} onSettings={onSettings}/>{workspaces.length>1&&<label>צוות<select value={workspace} onChange={e=>setWorkspace(e.target.value)}>{workspaces.map(w=><option key={w}>{w}</option>)}</select></label>}<p className="muted">העסקאות נאספות ממקור הנתונים הקיים; הניתוח יבוצע באמצעות החשבון האישי בסוכן CLI ויישמר בהיסטוריה. עובדות העסקאות נבדקות מול הטבלה שסופקה.</p></>:<>
      <div className="two-columns"><label>ספק AI<span className="provider-choice"><Icon provider={provider}/><select value={provider} onChange={e => { setProvider(e.target.value); setModel(modelFor(e.target.value)); }}>{catalog.providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></span></label><Models provider={provider} value={model} onChange={setModel}/></div>
      {!configured && <p className="error">יש להגדיר מפתח API לספק זה. <button type="button" className="text-button" onClick={onSettings}>פתיחת הגדרות</button></p>}
      </>}
      <label className="checkbox privacy-notice"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required/>{automatic ? "אני מאשר/ת גישה לקישור ב־Nadlan ושליחת פרטי הנכס, קישור המקור והעסקאות לספק AI הנבחר." : "אני מאשר/ת לשלוח את פרטי הנכס, קישור המקור והעסקאות שסיפקתי לספק AI הנבחר."}</label>
      <button disabled={busy || loadingFile || cliRun.busy}>{busy ? "מנתח את העסקאות…" : automatic ? collection ? "נתח את הטבלה שנאספה" : "משוך עסקאות מהשכונה ונתח" : "בחר עסקאות דומות והפק נקודות לניתוח"}</button>
    </fieldset></form>
    {cliMode&&<CliSubmissionStatus run={cliRun}/>}
    {(busy || loadingFile || (collection?.collectedRows === 0)) && <p role="status">{loadingFile ? "קורא את הקובץ…" : stage}</p>}
    {collection && <p className="muted">מקור: {collection.sourceAddress} · שכונה: {collection.neighborhood} · נאספו {collection.collectedRows} מתוך {collection.totalRows} עסקאות ב־{collection.pagesCollected} עמודים · {collection.complete ? "כל העמודים נקראו" : "איסוף חלקי"}. {collection.warnings.join(" ")}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {dataset && <p><button type="button" className="secondary" onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(dataset, null, 2)], { type: "application/json;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = "nadlan-agent-run.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>הורדת נתוני הריצה האחרונה כ־JSON</button><small>פרופיל הנכס והעסקאות נשמרים בקובץ גם אם ניתוח AI נכשל. זהו תיעוד הריצה האחרונה, לא השינויים שטרם נשלחו בטופס.</small></p>}
    {preview && <details className="import-preview" open><summary>{automatic ? "הטבלה שנאספה" : "הטבלה שסופקה"} · {preview.rows.length} עסקאות · מהחדשה לישנה</summary>
      {preview.warnings.map(w => <p key={w}>{w}</p>)}
      <div className="transaction-table-scroll import-table-scroll" tabIndex={0} role="region" aria-label="תצוגה מקדימה של עסקאות שסופקו"><table className="transaction-table">
        <caption>{automatic ? "עסקאות מהמקור" : "נתוני המשתמש"} לפני בחירת המודל; התאריכים יסוננו בעת הניתוח</caption>
        <thead><tr>{["מזהה", "כתובת / גוש וחלקה", "תאריך", "מחיר", "שטח במ״ר", "חדרים", "קומה"].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
        <tbody>{preview.rows.map(r => <tr key={r.id} id={`sale-${r.id}`}><td><bdi>{r.id}</bdi></td><th scope="row">{r.address ?? "כתובת לא ידועה"}<small>{r.parcel}</small></th><td><bdi>{r.date}</bdi></td><td>{money(r.amount)}</td><td>{r.area ?? "לא ידוע"}</td><td>{r.rooms ?? "לא ידוע"}</td><td>{r.floor ?? "לא ידוע"}</td></tr>)}</tbody>
      </table></div></details>}
    {result && <><TransactionTable result={result} agent/>
      <section className="analysis-points"><h3>אינדיקציית שווי גסה · ניסוי</h3>
        {result.valuation.estimate !== null && <p><strong>{money(result.valuation.estimate)}</strong> · טווח פיזור {money(result.valuation.low!)}–{money(result.valuation.high!)} · {result.valuation.transactionIds.length} עסקאות לחישוב</p>}
        <p>{result.valuation.explanation}</p><p className="muted">{result.valuation.method}</p>
      </section>
      <details><summary>החלטות הסוכן לכל העסקאות · {result.assessments.length}</summary><ul>{result.assessments.map(a => <li key={a.id}><bdi>{a.id}</bdi> · {a.address ?? a.parcel} · {a.similarity}/100 · {a.eligible ? result.transactions.some(t => t.id === a.id) ? "נבחרה" : "מחוץ למכסת הבחירה" : "נפסלה"}: {a.aiReason}</li>)}</ul></details>
    </>}
  </section>;
}
