import type { TransactionResult } from "../../../supabase/functions/appraisal/nearby-transactions";
const format = (value: number | null, money = false) => value === null ? "לא ידוע" : new Intl.NumberFormat("he-IL", money ? { style: "currency", currency: "ILS", maximumFractionDigits: 0 } : { maximumFractionDigits: 2 }).format(value);

export function TransactionTable({ result }: { result: TransactionResult }) {
  const { query: q } = result;
  return <section className="transaction-results" aria-labelledby="transactions-title">
    <h2 id="transactions-title">עסקאות להשוואה · {result.transactions.length}</h2>
    <p>החיפוש שבוצע: <strong>{q.address}</strong> · {q.radiusMeters} מטרים · <bdi>{q.startDate} – {q.endDate}</bdi> · {q.dealType === "both" ? "יד ראשונה ושנייה" : q.dealType === "new" ? "יד ראשונה" : "יד שנייה"}</p>
    <p>נכס להשוואה: {q.rooms === null ? "חדרים לא צוינו" : `${q.rooms} חדרים`} · {q.area === null ? "שטח לא צוין" : `${q.area} מ״ר`}{q.description ? ` · ${q.description}` : ""}</p>
    <p className="muted">מקור: {result.source} · אחזור: {new Date(result.retrievedAt).toLocaleString("he-IL")} · מודל: <bdi>{result.model}</bdi></p>
    {result.warnings.map(w => <p className="muted" key={w}>{w}</p>)}
    <details className="similarity-method"><summary>כיצד מחושב הדמיון?</summary><p>ציון השוואתי 0–100, ולא הסתברות או הערכת שווי: שטח 35, חדרים 25, מיקום 25, מועד עסקה 15 והתאמה לתיאור חופשי 20. נכללים רק קריטריונים שנמסרו ושיש להם ראיות; המשקולות מנורמלות מחדש. כיסוי הנתונים מציג איזה חלק מההשוואה היה אפשר לבצע. ציון גבוה עם כיסוי נמוך הוא השוואה חלקית.</p><p>הדמיון בשטח ובחדרים יורד לפי ההפרש היחסי. ציון המרחק יורד מאותו מיקום עד קצה הרדיוס; אותו בניין מקבל התאמה מלאה במיקום. עסקאות הקרובות לסוף התקופה מקבלות ציון מועד גבוה יותר. ההתאמה לתיאור החופשי היא הערכת AI; הפרטים המספריים נלקחים מהמקור בלבד.</p></details>
    {result.transactions.length > 0 && <p className="muted">אפשר לגלול את הטבלה לצדדים כדי לראות את כל פרטי ההשוואה.</p>}
    {!result.transactions.length ? <p role="status">לא נמצאו עסקאות בטווח המבוקש. נסו להרחיב את התקופה או הרדיוס, או לדייק את הכתובת.</p> : <div className="transaction-table-scroll" tabIndex={0} role="region" aria-label="טבלת עסקאות להשוואה"><table className="transaction-table">
      <caption>עסקאות ממוינות לפי מידת הדמיון לנכס המבוקש</caption>
      <thead><tr>{["כתובת", "תאריך עסקה", "חדרים", "שטח (מ״ר)", "מחיר כולל", "מחיר למ״ר", "דמיון לנכס", "פרטי ההשוואה"].map(title => <th scope="col" key={title}>{title}</th>)}</tr></thead>
      <tbody>{result.transactions.map(t => <tr key={t.id}>
        <th scope="row">{t.address ?? "כתובת לא ידועה"}<small>{t.propertyType ?? "סוג נכס לא ידוע"}{t.floor ? ` · קומה ${t.floor}` : ""}</small></th>
        <td><bdi>{t.date ?? "לא ידוע"}</bdi></td><td>{format(t.rooms)}</td><td>{format(t.area)}</td><td>{format(t.amount, true)}</td><td>{format(t.pricePerSqm, true)}</td>
        <td><strong className="similarity-score">{t.similarity === null ? "אין די נתונים" : `${t.similarity}/100`}</strong><small>כיסוי נתונים: {t.coverage}%</small></td>
        <td><p>{t.aiReason}</p><details><summary>נתוני הדמיון</summary><ul>{t.comparison.map(c => <li key={c}>{c}</li>)}</ul>{t.missing.length > 0 && <p>לא ניתן להשוות: {t.missing.join("، ")}</p>}<small>מזהה ברשימת המקור: <bdi>{t.id}</bdi></small></details></td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
