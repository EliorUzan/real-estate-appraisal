export const CADASTRAL_LAYERS = ["SUB_GUSH_ALL", "PARCEL_ALL"];
export const GOVMAP_SDK_URL = "https://www.govmap.gov.il/govmap/api/govmap.api.js";

export type Point = { x: number; y: number; approximate: boolean };
export type Parcel = { block: string; parcel: string };
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};

function payload(response: unknown): unknown {
  const envelope = record(response);
  if ((envelope.errorCode != null && Number(envelope.errorCode) !== 0) ||
      (envelope.status != null && Number(envelope.status) !== 0)) {
    throw new Error("GovMap request failed");
  }
  return envelope.data ?? response;
}

export function parseLocation(response: unknown): Point | null {
  const data = payload(response);
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length !== 1) return null;
  const item = record(rows[0]);
  const code = Number(item.ResultCode ?? record(response).ResultCode);
  // Never silently focus the first candidate of an ambiguous address.
  if (code !== 1 && code !== 2) return null;
  if (typeof item.X !== "number" || typeof item.Y !== "number" ||
      !Number.isFinite(item.X) || !Number.isFinite(item.Y) || item.X <= 0 || item.Y <= 0) return null;
  return { x: item.X, y: item.Y, approximate: code === 2 };
}

export function parseParcels(response: unknown): Parcel[] {
  const rows = payload(response);
  if (!Array.isArray(rows)) throw new Error("Invalid parcel response");
  const parcels = new Map<string, Parcel>();
  for (const row of rows) {
    const values = record(row).Values;
    if (!Array.isArray(values) || values.length < 2) throw new Error("Invalid parcel fields");
    const [block, parcel] = values.map(value => typeof value === "number" || typeof value === "string" ? String(value) : "");
    if (!/^\d+$/.test(block) || !/^\d+$/.test(parcel) || Number(block) <= 0 || Number(parcel) <= 0) {
      throw new Error("Invalid parcel numbers");
    }
    parcels.set(`${block}/${parcel}`, { block, parcel });
  }
  return [...parcels.values()];
}

export async function withTimeout<T>(operation: PromiseLike<T>, milliseconds = 25000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("GovMap timed out")), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

export interface GovMapApi {
  geocodeType: { AccuracyOnly: number };
  createMap(id: string, settings: Record<string, unknown>): void | PromiseLike<unknown>;
  geocode(params: { keyword: string; type: number }): PromiseLike<unknown>;
  intersectFeatures(params: { geometry: string; layerName: string; fields: string[] }): PromiseLike<unknown>;
  zoomToXY(params: { x: number; y: number; level: number; marker: boolean }): void;
}

export function loadGovMap(): Promise<GovMapApi> {
  return withTimeout(new Promise<GovMapApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GOVMAP_SDK_URL;
    script.async = true;
    script.onload = () => {
      const api = (window as Window & { govmap?: GovMapApi }).govmap;
      if (api) resolve(api); else reject(new Error("GovMap SDK unavailable"));
    };
    script.onerror = () => reject(new Error("GovMap SDK failed to load"));
    document.head.append(script);
  }));
}
