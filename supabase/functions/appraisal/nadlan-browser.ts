import { Problem, check } from "./providers.ts";
import { MAX_IMPORT_BYTES, nadlanSourceUrl, parseTransactionImport } from "./transaction-import.ts";

export type CollectionMeta = { sourceUrl: string; sourceAddress: string; neighborhood: string; retrievedAt: string;
  pagesCollected: number; totalRows: number; collectedRows: number; complete: boolean; warnings: string[] };
export type CollectedTransactions = CollectionMeta & { table: string; proof: string };
const encode = (s: string) => new TextEncoder().encode(s);
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, "0")).join("");
const digest = async (s: string) => hex(await crypto.subtle.digest("SHA-256", encode(s)));
const hmacKey = (secret: string) => crypto.subtle.importKey("raw", encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const toBase64 = (s: string) => btoa(Array.from(encode(s), c => String.fromCharCode(c)).join(""));
const fromBase64 = (s: string) => new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
const obj = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function signCollection(meta: CollectionMeta, table: string, owner: string, secret: string, now = new Date()): Promise<string> {
  if (secret.length < 32) throw new Problem(503, "שירות איסוף Nadlan אינו מוגדר.");
  const payload = toBase64(JSON.stringify({ version: 1, meta, tableHash: await digest(table), owner, expiresAt: now.getTime() + 30 * 60_000 }));
  return `${payload}.${hex(await crypto.subtle.sign("HMAC", await hmacKey(secret), encode(payload)))}`;
}

export async function verifyCollection(proof: unknown, table: unknown, sourceUrl: unknown, owner: string, secret: string, now = new Date()): Promise<CollectionMeta> {
  try {
    if (typeof proof !== "string" || proof.length > 30_000 || typeof table !== "string" || table.length > MAX_IMPORT_BYTES || secret.length < 32) throw new Error();
    const [payload, signature, extra] = proof.split(".");
    if (extra !== undefined || !/^[a-f0-9]{64}$/.test(signature)) throw new Error();
    const bytes = Uint8Array.from(signature.match(/../g)!, c => parseInt(c, 16));
    if (!await crypto.subtle.verify("HMAC", await hmacKey(secret), bytes, encode(payload))) throw new Error();
    const value = JSON.parse(fromBase64(payload));
    if (value.version !== 1 || value.owner !== owner || !Number.isFinite(value.expiresAt) || value.expiresAt < now.getTime() || value.tableHash !== await digest(table) || value.meta.sourceUrl !== nadlanSourceUrl(sourceUrl)) throw new Error();
    return value.meta as CollectionMeta;
  } catch { throw new Problem(400, "אימות האיסוף פג או שהטבלה/הקישור השתנו. בצעו איסוף מחדש לפני הניתוח."); }
}

export async function collectNadlanTransactions(value: unknown, owner: string, config: { endpoint: string; token: string }, fetcher = fetch, now = new Date()): Promise<CollectedTransactions> {
  const input = obj(value); let sourceUrl: string | undefined;
  if (input.sourceUrl) {
    try { sourceUrl = nadlanSourceUrl(input.sourceUrl); } catch (e) { throw new Problem(400, (e as Error).message); }
    check(new URL(sourceUrl).searchParams.get("view") === "address", "איסוף אוטומטי דורש קישור שיתוף של כתובת ב־Nadlan.");
  } else check(typeof input.address === "string" && !!input.address.trim() && input.address.length <= 500, "יש להזין כתובת לחיפוש.");
  const maxPages = input.maxPages ?? 5;
  check(typeof maxPages === "number" && Number.isInteger(maxPages) && maxPages >= 1 && maxPages <= 20, "מספר העמודים חייב להיות 1–20.");
  let endpoint;
  try { endpoint = new URL(config.endpoint); } catch { throw new Problem(503, "שירות איסוף Nadlan טרם הוגדר בשרת. ניתן להשתמש בייבוא טבלה."); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || config.token.length < 32) throw new Problem(503, "הגדרות שירות איסוף Nadlan אינן תקינות.");
  let response;
  try { response = await fetcher(endpoint.href, { method: "POST", redirect: "error", signal: AbortSignal.timeout(130_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` }, body: JSON.stringify({ ...(sourceUrl ? { sourceUrl } : { address: input.address }), maxPages }) }); }
  catch { throw new Problem(502, "שירות האיסוף לא השיב בזמן. לא נוצרו עסקאות ולא הופעל ניתוח AI."); }
  if (!response.ok) {
    if (response.status === 429) throw new Problem(429, "שירות האיסוף מטפל בבקשה אחרת. נסו שוב בעוד זמן קצר.");
    throw new Problem(502, "לא ניתן להשלים חיפוש ואיסוף. בדקו כתובת מלאה עם עיר, או הדביקו קישור שיתוף של Nadlan. ייתכן גם אימות באתר או שינוי במבנה העמוד. ניתוח AI לא הופעל.");
  }
  const reader = response.body?.getReader(); if (!reader) throw new Problem(502, "שירות האיסוף החזיר תשובה ריקה.");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const { value: part, done } = await reader.read(); if (done) break; size += part.length; if (size > MAX_IMPORT_BYTES + 40_000) { await reader.cancel(); throw new Problem(502, "תשובת האיסוף גדולה מדי."); } chunks.push(part); }
  let data;
  try {
    const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
    data = obj(JSON.parse(new TextDecoder().decode(bytes)));
    const resolvedUrl = nadlanSourceUrl(data.sourceUrl);
    if (new URL(resolvedUrl).searchParams.get("view") !== "address" || (sourceUrl && resolvedUrl !== sourceUrl)) throw new Error();
    sourceUrl = resolvedUrl;
    if (typeof data.table !== "string" || new TextEncoder().encode(data.table).length > MAX_IMPORT_BYTES ||
      typeof data.sourceAddress !== "string" || !data.sourceAddress.trim() || data.sourceAddress.length > 500 ||
      typeof data.neighborhood !== "string" || !data.neighborhood.trim() || data.neighborhood.length > 500 ||
      typeof data.retrievedAt !== "string" || !Number.isFinite(Date.parse(data.retrievedAt)) || Math.abs(Date.parse(data.retrievedAt) - now.getTime()) > 10 * 60_000 ||
      !Number.isInteger(data.pagesCollected) || Number(data.pagesCollected) < 1 || Number(data.pagesCollected) > Number(maxPages) ||
      !Number.isInteger(data.totalRows) || Number(data.totalRows) < 0 || !Number.isInteger(data.collectedRows) || Number(data.collectedRows) < 0 || Number(data.collectedRows) > 500 || Number(data.collectedRows) > Number(data.totalRows) ||
      typeof data.complete !== "boolean" || !Array.isArray(data.warnings) || data.warnings.length > 10 || data.warnings.some(w => typeof w !== "string" || w.length > 1000)) throw new Error();
    if (data.complete && data.collectedRows !== data.totalRows) throw new Error();
    if (data.collectedRows === 0) { if (data.totalRows !== 0 || !data.complete) throw new Error(); }
    else if (parseTransactionImport(data.table).rows.length !== data.collectedRows) throw new Error();
  } catch { throw new Problem(502, "שירות האיסוף החזיר נתונים לא תקינים. הניתוח לא הופעל."); }
  const meta: CollectionMeta = { sourceUrl, sourceAddress: data.sourceAddress as string, neighborhood: data.neighborhood as string,
    retrievedAt: data.retrievedAt as string, pagesCollected: data.pagesCollected as number, totalRows: data.totalRows as number,
    collectedRows: data.collectedRows as number, complete: data.complete as boolean, warnings: data.warnings as string[] };
  return { ...meta, table: data.table as string, proof: await signCollection(meta, data.table as string, owner, config.token, now) };
}
