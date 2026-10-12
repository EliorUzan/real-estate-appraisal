/** User-supplied CSV/TSV only. This module never retrieves the source URL. */
export type ImportedSale = {
  id: string; address: string | null; date: string; amount: number;
  area: number | null; rooms: number | null; floor: string | null;
  propertyType: string | null; parcel: string | null;
};
export type TransactionImport = { rows: ImportedSale[]; warnings: string[]; inputCount: number };
export const MAX_IMPORT_BYTES = 1_000_000;
const clean = (s: string) => s.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();

export function nadlanSourceUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000) throw new Error("יש להזין קישור שיתוף תקין מאתר Nadlan.");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("קישור המקור אינו תקין."); }
  if (url.protocol !== "https:" || url.hostname !== "www.nadlan.gov.il" || url.port || url.username || url.password || url.pathname !== "/") {
    throw new Error("נדרש קישור HTTPS של www.nadlan.gov.il בלבד.");
  }
  const view = url.searchParams.get("view"), id = url.searchParams.get("id");
  if (!["address", "neighborhood", "street", "settlement"].includes(view ?? "") || !/^\d{1,15}$/.test(id ?? "") || url.searchParams.get("page") !== "deals") {
    throw new Error("נדרש קישור לדף עסקאות של כתובת, רחוב, שכונה או יישוב.");
  }
  return `https://www.nadlan.gov.il/?view=${view}&id=${id}&page=deals`;
}

/** Quoted fields, escaped quotes and embedded newlines; no locale-dependent guessing. */
function delimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === delimiter || c === "\n") {
      row.push(clean(cell)); cell = ""; closed = false;
      if (c === "\n") { if (row.some(Boolean)) rows.push(row); row = []; }
    } else if (c === '"' && !cell && !closed) quoted = true;
    else {
      if (closed && c.trim()) throw new Error("שדה מצוטט אינו תקין. בדקו את פורמט CSV/TSV.");
      cell += c;
    }
  }
  if (quoted) throw new Error("נמצאו מרכאות שלא נסגרו בקובץ.");
  row.push(clean(cell)); if (row.some(Boolean)) rows.push(row);
  return rows;
}

type Field = Exclude<keyof ImportedSale, "id">;
const key = (s: string) => clean(s).toLowerCase().replace(/[\s"'״׳_()]/g, "");
const names: Record<Field, string[]> = {
  address: ["address", "כתובת"], date: ["date", "dealDate", "תאריך", "תאריך עסקה", "תאריך העסקה"],
  amount: ["amount", "price", "dealAmount", "מחיר העסקה", "מחיר כולל", "מחיר", "תמורה"],
  area: ["area", "assetArea", "שטח", "שטח במ״ר", "שטח (מ״ר)"], rooms: ["rooms", "assetRoomNum", "חדרים", "מספר חדרים"],
  floor: ["floor", "קומה"], propertyType: ["propertyType", "סוג נכס"], parcel: ["parcel", "גוש/חלקה/תת-חלקה", "גוש/חלקה/תת חלקה", "גוש/חלקה"],
};
const unknown = (s: string) => !s || /^(?:לא ידוע|לא צוין|null|n\/a|[-–—])$/i.test(s);
function numeric(s: string): number | null {
  if (unknown(s)) return null;
  const stripped = s.replace(/₪|ש["״]ח/g, "").trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(stripped)) throw new Error("ערך מספרי לא תקין");
  const n = Number(stripped.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) throw new Error("ערך מספרי חייב להיות חיובי");
  return n;
}
function saleDate(s: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  const value = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("תאריך עסקה לא תקין");
  return value;
}

export function parseTransactionImport(value: unknown): TransactionImport {
  if (typeof value !== "string" || new TextEncoder().encode(value).length > MAX_IMPORT_BYTES) throw new Error("הטבלה מוגבלת ל־1 MB.");
  const text = value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  const headerLine = text.split("\n", 1)[0];
  const delimiter = headerLine.includes("\t") ? "\t" : headerLine.includes(";") ? ";" : ",";
  const [header, ...body] = delimited(text, delimiter);
  if (!header || !body.length) throw new Error("יש לספק טבלת CSV/TSV עם שורת כותרות ולפחות עסקה אחת.");
  if (body.length > 500) throw new Error("ניתן לייבא עד 500 שורות בכל בקשה.");
  const indexes = Object.fromEntries(Object.entries(names).map(([field, aliases]) => {
    const matches = header.flatMap((h, i) => aliases.some(a => key(a) === key(h)) ? [i] : []);
    if (matches.length > 1) throw new Error(`כותרת כפולה: ${aliases.at(-1)}`);
    return [field, matches[0] ?? -1];
  })) as Record<Field, number>;
  if (indexes.date < 0 || indexes.amount < 0 || (indexes.address < 0 && indexes.parcel < 0)) throw new Error("חסרות עמודות חובה: תאריך עסקה, מחיר העסקה וכתובת או גוש/חלקה.");
  const rows: ImportedSale[] = [], seen = new Set<string>(); let duplicates = 0, repeatedHeaders = 0;
  for (const [i, cells] of body.entries()) {
    if (cells.length === header.length && cells.every((c, j) => key(c) === key(header[j]))) { repeatedHeaders++; continue; }
    if (cells.length !== header.length) throw new Error(`בשורה ${i + 2} מספר העמודות שונה מהכותרות. מחירים עם פסיקים ב־CSV חייבים להיות במרכאות.`);
    if (cells.some(c => c.length > 500)) throw new Error(`בשורה ${i + 2} נמצא תא ארוך מדי.`);
    const field = (f: Field) => indexes[f] < 0 ? "" : cells[indexes[f]];
    const optional = (f: Field) => unknown(field(f)) ? null : field(f);
    try {
      const address = optional("address"), parcel = optional("parcel");
      const amount = numeric(field("amount"));
      if (!amount || (!(address && address !== "0") && !parcel)) throw new Error("חסרים מחיר או זיהוי נכס");
      const row: ImportedSale = { id: `import-${i + 1}`, address: address === "0" ? null : address, parcel,
        date: saleDate(field("date")), amount, area: numeric(field("area")), rooms: numeric(field("rooms")),
        floor: optional("floor"), propertyType: optional("propertyType") };
      const fingerprint = JSON.stringify({ ...row, id: undefined });
      if (seen.has(fingerprint)) { duplicates++; continue; }
      seen.add(fingerprint); rows.push(row);
    } catch (error) { throw new Error(`שורה ${i + 2}: ${error instanceof Error ? error.message : "נתונים לא תקינים"}.`); }
  }
  if (!rows.length) throw new Error("הטבלה אינה מכילה רשומות עסקאות.");
  return { rows: rows.sort((a, b) => b.date.localeCompare(a.date)), inputCount: body.length - repeatedHeaders,
    warnings: duplicates ? [`הוסרו ${duplicates} שורות זהות. עסקאות עם תת־חלקה שונה נשמרו בנפרד.`] : [] };
}
