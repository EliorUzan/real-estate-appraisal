// Shared, dependency-free validation for browser-collected GovMap evidence.
// Browser evidence is user-supplied data, not a server-authenticated GovMap response.
export const GOVMAP_APP_ORIGIN = "https://real-estate-appraisal-sage.vercel.app";
export type ItmPoint = { x: number; y: number };
export type GovMapEvidence = {
  source: "GovMap browser"; address: string; point: ItmPoint; retrievedAt: string;
  rows: Record<string, unknown>[]; warnings: string[];
};
export const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function validItm(p: ItmPoint): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 500000 && p.y >= 100000 && p.y <= 1000000;
}

/** Only recognize explicit source sale fields; polygon counts are never sales. */
export function isSale(value: unknown): boolean {
  const r = asRecord(value);
  return r.dealAmount != null && typeof r.dealDate === "string";
}

export function unwrapGovMap(value: unknown): unknown {
  const r = asRecord(value);
  if (r.error || r.success === false || (r.errorCode != null && Number(r.errorCode) !== 0) ||
      (r.status != null && Number(r.status) !== 0)) throw new Error("GovMap החזיר שגיאה; לא התקבלו נתוני עסקאות.");
  return r.data ?? value;
}

export function transactionRows(value: unknown): Record<string, unknown>[] {
  const data = unwrapGovMap(value);
  if (!Array.isArray(data) || data.some(r => !isSale(r))) throw new Error("תשובת GovMap אינה טבלת עסקאות. נתוני פוליגונים אינם עסקאות.");
  return data.map(asRecord);
}

/** Approximate building location; reject unknown CRS instead of guessing. */
export function transactionPoint(shape: unknown): ItmPoint | null {
  if (typeof shape !== "string" || shape.length > 100000) return null;
  const point = /^POINT\s*\(\s*([\d.+-]+)\s+([\d.+-]+)\s*\)$/i.exec(shape.trim());
  if (point) { const p = { x: Number(point[1]), y: Number(point[2]) }; return validItm(p) ? p : null; }
  const number = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
  const pair = `${number}\\s+${number}`;
  const ring = `\\(\\s*${pair}(?:\\s*,\\s*${pair}){3,}\\s*\\)`;
  const polygon = `\\(\\s*${ring}(?:\\s*,\\s*${ring})*\\s*\\)`;
  if (!new RegExp(`^(?:POLYGON\\s*${polygon}|MULTIPOLYGON\\s*\\(\\s*${polygon}(?:\\s*,\\s*${polygon})*\\s*\\))$`, "i").test(shape.trim())) return null;
  const pairs = [...shape.matchAll(/([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)(?=\s*[,\)])/g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
  if (pairs.length < 4 || pairs.length > 10000 || !pairs.every(validItm)) return null;
  return { x: (Math.min(...pairs.map(p => p.x)) + Math.max(...pairs.map(p => p.x))) / 2,
    y: (Math.min(...pairs.map(p => p.y)) + Math.max(...pairs.map(p => p.y))) / 2 };
}

export function validateGovMapEvidence(value: unknown, address: string, now = new Date()): GovMapEvidence {
  const e = asRecord(value), p = asRecord(e.point);
  if (JSON.stringify(value ?? null).length > 1500000 || e.source !== "GovMap browser" || e.address !== address ||
      typeof p.x !== "number" || typeof p.y !== "number" || !validItm(p as ItmPoint) ||
      typeof e.retrievedAt !== "string" || !Number.isFinite(Date.parse(e.retrievedAt)) ||
      Math.abs(now.getTime() - Date.parse(e.retrievedAt)) > 30 * 60000 ||
      !Array.isArray(e.rows) || e.rows.length > 500 || e.rows.some(r => !isSale(r))) {
    throw new Error("נתוני העסקאות חסרים, פגי תוקף או אינם תואמים לכתובת. יש לבצע איסוף מחדש.");
  }
  return { source: "GovMap browser", address, point: { x: p.x, y: p.y }, retrievedAt: e.retrievedAt,
    rows: e.rows.map(asRecord), warnings: Array.isArray(e.warnings) ? e.warnings.filter((w): w is string => typeof w === "string").slice(0, 20).map(w => w.slice(0, 300)) : [] };
}
