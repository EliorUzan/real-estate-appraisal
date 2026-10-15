import type { TransactionResult } from "../../../supabase/functions/appraisal/nearby-transactions";
import {GovMapPanel} from './GovMapPanel';
const format = (value: number | null, money = false) => value === null ? "לא ידוע" : new Intl.NumberFormat("he-IL", money ? { style: "currency", currency: "ILS", maximumFractionDigits: 0 } : { maximumFractionDigits: 2 }).format(value);

export function TransactionTable({ result, agent = false }: { result: TransactionResult; agent?: boolean }) {
  const { query: q } = result;
  const imported = !!q.scope;
  const over = result.source === 'רשות המסים / over.org.il';
  return <section className="transaction-results" aria-labelledby="transactions-title">
    <h2 id="transactions-title">עסקאות להשוואה · {result.transactions.length}</h2>
    {over && result.valuation && <section aria-label='טווח שווי משוער'><h3>טווח שווי משוער · הערכת Claude</h3>
      {result.valuation.status==='indicative' ? <><p><strong>{format(result.valuation.low,true)}–{format(result.valuation.high,true)}</strong></p><p>אומדן מרכזי: {format(result.valuation.estimate,true)} · מבוסס על {result.valuation.transactionIds.length} עסקאות</p></> : <p>אין די עסקאות מתאימות להערכת טווח שווי.</p>}
      <p>{result.valuation.explanation}</p><ul>{(result.valuation.assumptions??[]).map((a,i)=><li key={i}>{a}</li>)}</ul><small>אומדן AI אינדיקטיבי לבדיקת השמאי; אינו שומה ואינו טווח ביטחון סטטיסטי.</small>
    </section>}
    <p>נכס נבדק: <strong>{q.address}</strong> · {imported ? "ללא אימות מרחק" : `${q.radiusMeters} מטרים`} · <bdi>{q.startDate} – {q.endDate}</bdi>{!imported && ` · ${q.dealType === "both" ? "יד ראשונה ושנייה" : q.dealType === "new" ? "יד ראשונה" : "יד שנייה"}`}</p>
    <p>נכס להשוואה: {q.rooms === null ? "חדרים לא צוינו" : `${q.rooms} חדרים`} · {q.area === null ? "שטח לא צוין" : `${q.area} מ״ר`}{q.description ? ` · ${q.description}` : ""}</p>
    <p className="muted">מקור: {result.source} · {q.scope === "imported" ? "מועד ייבוא" : "אחזור"}: {new Date(result.retrievedAt).toLocaleString("he-IL")} · מודל: <bdi>{result.model}</bdi></p>
    {result.sourceUrl && <p><a href={result.sourceUrl} target="_blank" rel="noreferrer">{over?'מאגר העסקאות הציבורי':'קישור המקור שסופק'}</a></p>}
    {over&&<p>עסקאות מגורים במדגם: {result.candidateCount} · נשלחו ל־Claude: {result.analyzedCount} · מוצגות להשוואה: {result.transactions.length}. הציון בטבלה הוא הערכת Claude לאחר הסינון.</p>}
    {imported && <p>עסקאות בתקופה: {result.candidateCount} · נשלחו לניתוח: {result.analyzedCount} · נבחרו: {result.transactions.length}</p>}
    {result.warnings.map(w => <p className="muted" key={w}>{w}</p>)}
    {result.keyPoints && result.keyPoints.length > 0 && <section className="analysis-points" aria-labelledby="analysis-title"><h3 id="analysis-title">נקודות לניתוח · הערכת AI</h3><ul>{result.keyPoints.map((point, i) => <li key={i}><p>{point.text}</p><small>הפניות לטבלת העסקאות: {point.transactionIds.map((id, j) => <span key={id}>{j > 0 ? " · " : ""}<a href={`#sale-${id}`}><bdi>{id}</bdi></a></span>)}</small></li>)}</ul></section>}
    {over ? <details className="similarity-method"><summary>כיצד נבחרו העסקאות?</summary><p>דירוג: שטח 35, חדרים 20, מרחק למרכז חלקה 30, עדכניות 15, סוג נכס 20 ושנת בנייה 10 אם נמסרה; המשקולות מנורמלות לציון 0–100. בריצות החדשות אין סף דמיון לפסילה. עד עשר המובילות נבדקות על ידי Claude, כולל התאמות משוערות לשווי. עסקאות שאינן תומכות בשווי עדיין מוצגות להקשר. מחיר המקור נשמר; תרחישי ההתאמה מופיעים בנתוני הדמיון.</p></details> : <details className="similarity-method"><summary>כיצד מחושב הדמיון?</summary><p>ציון השוואתי 0–100, ולא הסתברות או הערכת שווי: שטח 35, חדרים 25, {imported ? "" : "מיקום 25, "}מועד עסקה 15, {agent ? "קומה 10, " : ""}התאמה לתיאור חופשי 20. נכללים רק קריטריונים שנמסרו ושיש להם ראיות; המשקולות מנורמלות מחדש. כיסוי הנתונים מציג איזה חלק מהקריטריונים לחישוב היה אפשר להשוות. ציון גבוה עם כיסוי נמוך הוא השוואה חלקית.</p><p>הדמיון בשטח ובחדרים יורד לפי ההפרש היחסי. {agent ? "השיוך לשכונה לפי Nadlan באיסוף אוטומטי; אין ציון מרחק. הסוכן מעריך את כל העסקאות בתקופה, והבחירה ממוינת לפי ציון, כיסוי ואז מועד." : imported ? "המרחק אינו נכלל בציון. הבחירה וסדר העסקאות הם הערכת המודל ויכולים להיות שונים מסדר הציונים." : "ציון המרחק יורד מאותו מיקום עד קצה הרדיוס; אותו בניין מקבל התאמה מלאה במיקום."} עסקאות הקרובות לסוף התקופה מקבלות ציון מועד גבוה יותר. ההתאמה לתיאור החופשי היא הערכת AI; הפרטים המספריים נלקחים מהטבלה בלבד.</p></details>}
    {result.transactions.length > 0 && <p className="muted">אפשר לגלול את הטבלה לצדדים כדי לראות את כל פרטי ההשוואה.</p>}
    {!result.transactions.length ? <p role="status">{imported ? result.candidateCount ? "המודל לא בחר עסקאות מתאימות מתוך המדגם. עיינו בנקודות הניתוח." : "אין בטבלה שסופקה עסקאות בתקופה המבוקשת." : "לא נמצאו עסקאות בטווח המבוקש. נסו להרחיב את התקופה או הרדיוס, או לדייק את הכתובת."}</p> : <div className="transaction-table-scroll" tabIndex={0} role="region" aria-label="טבלת עסקאות להשוואה"><table className="transaction-table">
      <caption>{imported ? "העסקאות שנבחרו, לפי סדר ההתאמה שהציע המודל" : "עסקאות ממוינות לפי מידת הדמיון לנכס המבוקש"}</caption>
      <thead><tr>{["כתובת", "תאריך עסקה", "חדרים", "שטח (מ״ר)", "מחיר כולל", "מחיר למ״ר", "דמיון לנכס", "פרטי ההשוואה"].map(title => <th scope="col" key={title}>{title}</th>)}</tr></thead>
      <tbody>{result.transactions.map(t => <tr key={t.id}>
        <th scope="row">{t.address ?? "כתובת לא ידועה"}<small>{t.propertyType ?? "סוג נכס לא ידוע"}{t.floor ? ` · קומה ${t.floor}` : ""}</small>{t.parcel && <small><bdi>{t.parcel}</bdi></small>}</th>
        <td><bdi>{t.date ?? "לא ידוע"}</bdi></td><td>{format(t.rooms)}</td><td>{format(t.area)}</td><td>{format(t.amount, true)}</td><td>{format(t.pricePerSqm, true)}</td>
        <td><strong className="similarity-score">{t.similarity === null ? "אין די נתונים" : `${t.similarity}/100`}</strong><small>כיסוי נתונים: {t.coverage}%</small></td>
        <td><p>{t.aiReason}</p><details><summary>נתוני הדמיון</summary><ul>{t.comparison.map(c => <li key={c}>{c}</li>)}</ul>{t.missing.length > 0 && <p>לא ניתן להשוות: {t.missing.join("، ")}</p>}<small>מזהה ברשימת המקור: <bdi>{t.id}</bdi></small></details></td>
      </tr>)}</tbody>
    </table></div>}
    {q.address.trim()&&<>
      <h3>מפת הנכס הנבדק ופרטי גוש וחלקה</h3>
      <p className="muted">המפה ופרטי הגוש והחלקה נשלפים מ־GovMap לפי כתובת הנכס שבבקשה שהושלמה. המפה מציגה את הנכס הנבדק; כתובות עסקאות ההשוואה מופיעות בטבלה.</p>
      <GovMapPanel address={q.address.trim()}/>
    </>}
  </section>;
}
