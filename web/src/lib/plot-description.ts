import { parseParcels } from "./govmap.ts";
import type { SpatialEvidence } from "./plot-evidence.ts";

export type PlotParcel = { block: string; parcel: string; cadastralArea: number | null };
export type PlotBorder = { direction: "מצפון" | "ממערב" | "מדרום" | "ממזרח"; description: string };
export type PlotAnalysisData = {
  address: string;
  retrievedAt: string;
  source: "GovMap PARCEL_ALL";
  gush: string;
  parcel: string;
  cadastralArea: number | null;
  registeredArea: number | null;
  topography: string;
  geometryShape: string;
  borders: PlotBorder[];
  buildingsSummary: string;
  planningNotes: string;
  warnings: string[];
  spatial?: SpatialEvidence;
};

export function parsePlotParcels(response: unknown): PlotParcel[] {
  const parcels = parseParcels(response);
  const envelope = response as { data?: unknown } | null;
  const rows = Array.isArray(envelope?.data) ? envelope.data : Array.isArray(response) ? response : [];
  const areas = new Map<string, number | null>();
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const values = (row as { Values?: unknown }).Values;
    if (!Array.isArray(values) || values.length < 2) continue;
    const key = `${values[0]}/${values[1]}`;
    const raw = values[2];
    const parsed = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw.replace(/,/g, "")) : NaN;
    const area = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    if (areas.has(key) && areas.get(key) !== area) areas.set(key, null);
    else if (!areas.has(key)) areas.set(key, area);
  }
  return parcels.map(({ block, parcel }) => ({ block, parcel, cadastralArea: areas.get(`${block}/${parcel}`) ?? null }));
}

export function positiveArea(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value.replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function renderPlotDescription(data: PlotAnalysisData): string {
  const lines = ["7.1 תיאור החלקה:"];
  const formatArea=(n:number)=>n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const area = data.registeredArea !== null ? ` בשטח רשום של ${formatArea(data.registeredArea)} מ״ר` : data.cadastralArea!==null ? ` בשטח של ${formatArea(data.cadastralArea)} מ״ר לפי שכבת הקדסטר ב־GovMap` : "";
  lines.push(`חלקה ${data.parcel} בגוש ${data.gush}${area}.`);
  if (data.topography.trim()) lines.push(`הקרקע ${data.topography.trim().replace(/\.$/, "")}.`);
  if (data.geometryShape.trim()) lines.push(`הצורה הגיאומטרית של החלקה ${data.geometryShape.trim().replace(/\.$/, "")}.`);
  const borders = data.borders.filter(border => border.description.trim());
  if (borders.length) {
    lines.push("החלקה גובלת כדלקמן:");
    for (const border of borders) lines.push(`${border.direction} – ${border.description.trim().replace(/\.$/, "")}.`);
  }
  if (data.buildingsSummary.trim()) lines.push(data.buildingsSummary.trim().replace(/\.$/, "") + ".");
  if (data.planningNotes.trim()) lines.push(`הערה: ${data.planningNotes.trim().replace(/\.$/, "")}.`);
  return lines.join("\n");
}
