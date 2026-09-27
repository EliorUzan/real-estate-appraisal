import { loadGovMap, parseLocation, withTimeout } from "./lib/govmap";
import { collectGovMapTransactions } from "./lib/govmap-transactions";
import { GOVMAP_APP_ORIGIN } from "../../supabase/functions/appraisal/govmap-transactions";
import "./govmap-frame.css";

const params = new URLSearchParams(location.hash.slice(1));
const address = params.get("address")?.trim() ?? "", radius = Number(params.get("radius"));
const requestId = params.get("request") ?? "";
const status = document.getElementById("status")!;
document.getElementById("address")!.textContent = address;
const publish = (payload: Record<string, unknown>) => {
  if (parent !== window) parent.postMessage({ type: "govmap-transactions", requestId, ...payload }, location.origin);
};
async function collect() {
  try {
    if (location.origin !== GOVMAP_APP_ORIGIN) throw new Error("הרשאת GovMap מוגדרת לדומיין היישום המאושר בלבד. יש לבצע את האיסוף באתר הפעיל, ולא ב־localhost או בקישור תצוגה מקדימה.");
    if (!address || address.length > 500 || !requestId || !Number.isInteger(radius) || radius < 1 || radius > 5000) throw new Error("פרטי חיפוש לא תקינים.");
    const token = import.meta.env.VITE_GOVMAP_TOKEN?.trim() || "e7ae87c1-eccb-4410-9c28-17994e01f72a";
    const api = await loadGovMap();
    await withTimeout(api.createMap("govmap", { token, layers: ["PARCEL_ALL"], background: "1", layersMode: 1, zoomButtons: true }), 45000);
    status.textContent = "מאתר כתובת באמצעות הרשאת GovMap הקיימת…";
    const point = parseLocation(await withTimeout(api.geocode({ keyword: address, type: api.geocodeType.FullResult })), address);
    if (!point || point.approximate) throw new Error("לא נמצאה התאמה מדויקת ויחידה לכתובת. יש לציין יישוב, רחוב ומספר בית; לא נבחרה אוטומטית תוצאת החיפוש הראשונה.");
    api.zoomToXY({ x: point.x, y: point.y, level: 10, marker: true });
    const evidence = await collectGovMapTransactions({ api, token, address, point, radius, progress: message => { status.textContent = message; } });
    status.textContent = `התקבלו ${evidence.rows.length} רשומות עסקאות. מעביר לבדיקה ולהשוואה…`;
    publish({ evidence });
  } catch (error) {
    const message = error instanceof Error ? error.message : "איסוף העסקאות נכשל.";
    status.textContent = message; status.setAttribute("role", "alert"); publish({ error: message });
  }
}
void collect();
