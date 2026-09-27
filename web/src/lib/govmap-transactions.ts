import type { GovMapApi, Point } from "./govmap.ts";
import { withTimeout } from "./govmap.ts";
import { asRecord, isSale, transactionRows, unwrapGovMap, validItm } from "../../../supabase/functions/appraisal/govmap-transactions.ts";
import type { GovMapEvidence } from "../../../supabase/functions/appraisal/govmap-transactions.ts";

const BASE = "https://www.govmap.gov.il/api/real-estate";
type Options = { api: GovMapApi; token: string; address: string; point: Point; radius: number;
  progress?: (message: string) => void; fetcher?: typeof fetch; pause?: () => Promise<void> };

export async function collectGovMapTransactions(options: Options): Promise<GovMapEvidence> {
  const { api, token, address, point, radius } = options;
  if (!validItm(point) || point.approximate || !Number.isInteger(radius) || radius < 1 || radius > 5000) throw new Error("נדרשת כתובת מדויקת ורדיוס תקין.");
  const warnings: string[] = [];
  const finish = (rows: Record<string, unknown>[]): GovMapEvidence => ({ source: "GovMap browser", address,
    point: { x: point.x, y: point.y }, retrievedAt: new Date().toISOString(), rows, warnings });
  // First try the same token-aware SDK layer methods used by plot_description.
  options.progress?.("בודק גישה לשכבת העסקאות באמצעות ההרשאה הקיימת…");
  try {
    const schema = unwrapGovMap(await withTimeout(api.getLayerFilterFields("nadlan", token, "he")));
    const fields = Array.isArray(schema) ? schema.map(asRecord).map(f => f.name).filter((v): v is string => typeof v === "string").slice(0, 80) : [];
    if (fields.includes("dealAmount") && fields.includes("dealDate")) {
      const response = asRecord(unwrapGovMap(await withTimeout(api.getLayerFeaturesByLocation({ geometry: `POINT(${point.x} ${point.y})`, radius, layers: [{ name: "nadlan", fields }] }, token))));
      const layers = asRecord(response.layers), key = Object.keys(layers).find(k => k.toLowerCase() === "nadlan");
      if (key && Array.isArray(layers[key])) {
        const rows = (layers[key] as unknown[]).map(v => ({ ...asRecord(asRecord(v).attributes), ...asRecord(asRecord(v).properties), ...asRecord(v) }));
        if (rows.length && rows.every(isSale)) {
          warnings.push("האחזור בוצע דרך שכבת GovMap; מגבלת התוצאות של השכבה עשויה להשפיע על השלמות.");
          return finish(rows.slice(0, 500));
        }
      }
    }
  } catch { /* SDK may expose parcel data without exposing a transaction layer. */ }
  warnings.push("שכבת העסקאות בהרשאת SDK לא החזירה שורות מכר; בוצע ניסיון דרך ממשק העסקאות הישיר.");
  // The internal endpoints have no documented API-key argument. Never place the
  // browser token in a guessed header/query parameter or forge Origin/Referer.
  const fetcher = options.fetcher ?? fetch;
  const pause = options.pause ?? (() => new Promise<void>(resolve => setTimeout(resolve, 1000)));
  const get = async (path: string): Promise<unknown> => {
    await pause();
    let response: Response;
    try { response = await fetcher(`${BASE}/${path}`, { signal: AbortSignal.timeout(25000), credentials: "omit" }); }
    catch { throw new Error("לא ניתן לקרוא את ממשק העסקאות של GovMap מהדפדפן (רשת, CORS או פסק זמן). הרשאת המפה אינה מבטיחה גישה לעסקאות."); }
    if (!response.ok) throw new Error(`GovMap דחה את בקשת העסקאות (HTTP ${response.status}). לא נשלחו עסקאות ל־AI.`);
    if (!response.headers.get("content-type")?.includes("json")) throw new Error("GovMap החזיר תוכן שאינו JSON; האיסוף נעצר.");
    const body = await response.text();
    if (body.length > 1500000) throw new Error("תשובת GovMap גדולה מדי. צמצמו את הרדיוס.");
    return JSON.parse(body);
  };
  options.progress?.("מאתר פוליגונים עם עסקאות בסביבת הנכס…");
  const metadata = unwrapGovMap(await get(`deals/${point.x},${point.y}/${radius}`));
  if (!Array.isArray(metadata)) throw new Error("מבנה תשובת איתור העסקאות השתנה; לא ניתן להמשיך.");
  const ids = [...new Set(metadata.map(asRecord).map(r => r.polygon_id).filter(v => (typeof v === "string" || typeof v === "number") && String(v).length > 0 && String(v).length <= 200).map(String))];
  if (metadata.length && !ids.length) throw new Error("לא הוחזרו מזהי פוליגונים תקינים.");
  if (ids.length > 10) warnings.push("האחזור מוגבל ל־10 פוליגונים. צמצמו את הרדיוס לקבלת כיסוי ממוקד יותר.");
  const rows: Record<string, unknown>[] = [], seen = new Set<string>();
  for (const id of ids.slice(0, 10)) {
    options.progress?.(`אוסף עסקאות (${rows.length} שורות התקבלו)…`);
    // dealType is intentionally omitted: its historical 1/2 contract is not
    // verified on the current API. Exact date/type/radius filtering is local.
    const response = await get(`street-deals/${encodeURIComponent(id)}?limit=100`);
    const batch = transactionRows(response);
    if (batch.length >= 100 || Number(asRecord(response).totalCount) > batch.length) warnings.push("מקור העסקאות החזיר עמוד חלקי; התוצאות אינן ממצות. מומלץ לצמצם את החיפוש.");
    for (const r of batch) {
      const key = JSON.stringify([r.objectid ?? r.dealId, r.dealDate, r.dealAmount, r.streetName, r.houseNumber, r.assetArea, r.assetRoomNum, r.floor]);
      if (!seen.has(key)) { seen.add(key); rows.push(r); }
      if (rows.length === 500) { warnings.push("האחזור נעצר לאחר 500 עסקאות."); return finish(rows); }
    }
  }
  return finish(rows);
}
