export const CADASTRAL_LAYERS = ["SUB_GUSH_ALL", "PARCEL_ALL"];
export const GOVMAP_SDK_URL = "https://www.govmap.gov.il/govmap/api/govmap.api.js";

export type Point = { x: number; y: number; approximate: boolean; label?: string };
export type Parcel = { block: string; parcel: string };
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};

function payload(response: unknown): unknown {
  const envelope = record(response);
  // The current SDK uses status 1 with no data for an empty search/intersection.
  if (envelope.status === 1 && envelope.errorCode === 0 && envelope.data === null) return [];
  if ((envelope.errorCode != null && Number(envelope.errorCode) !== 0) ||
      (envelope.status != null && Number(envelope.status) !== 0)) {
    throw new Error("GovMap request failed");
  }
  return envelope.data ?? response;
}

function normalizeAddress(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC")
    .replace(/[\u0591-\u05c7]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).sort().join(" ") : "";
}

export function parseLocation(response: unknown, requestedAddress = ""): Point | null {
  const data = payload(response);
  const rows = Array.isArray(data) ? data : [data];
  const requested = normalizeAddress(requestedAddress);
  // ResultType in the current SDK is a result category, NOT an accuracy code.
  // Request FullResult and select only a unique complete address matching the
  // user's input; AccuracyOnly currently discards all but the first candidate.
  const isExactAddress = (item: RecordValue) => item.ResultType === 1 &&
    // GovMap's current address index returns ADDR results without the optional
    // street/settlement/house fields. Street-only results use a different layer.
    (item.DescLayerID === "ADDR" ||
      (typeof item.streetName === "string" && item.streetName.trim() !== "" &&
       typeof item.settlementName === "string" && item.settlementName.trim() !== "" &&
       /[1-9]/.test(String(item.houseNumber ?? "")))) && requested !== "" &&
    [item.ResultLable, `${item.streetName} ${item.houseNumber} ${item.entryLetter ?? ""} ${item.settlementName}`]
      .some(label => normalizeAddress(label) === requested);
  const exact = rows.map(record).filter(isExactAddress);
  if (exact.length > 1 || (exact.length === 0 && rows.length !== 1)) return null;
  const item = exact[0] ?? record(rows[0]);
  const code = Number(item.ResultCode ?? record(response).ResultCode);
  // Never silently focus the first candidate of an ambiguous address.
  const currentFormat = item.ResultCode == null && record(response).ResultCode == null &&
    item.ResultType === 1 && typeof item.ResultLable === "string";
  if (!currentFormat && code !== 1 && code !== 2) return null;
  if (typeof item.X !== "number" || typeof item.Y !== "number" ||
      !Number.isFinite(item.X) || !Number.isFinite(item.Y) || item.X <= 0 || item.Y <= 0) return null;
  return { x: item.X, y: item.Y, approximate: currentFormat ? exact.length !== 1 : code === 2,
    ...(currentFormat ? { label: item.ResultLable as string } : {}) };
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
  geocodeType: { FullResult: number; AccuracyOnly: number };
  createMap(id: string, settings: Record<string, unknown>): PromiseLike<void>;
  geocode(params: { keyword: string; type: number }): PromiseLike<unknown>;
  intersectFeatures(params: { geometry: string; layerName: string; fields: string[]; radius?: number }): PromiseLike<unknown>;
  search(params: { searchText:string; apiKey:string; language:"he"; maxResults:number; isAccurate:boolean }): PromiseLike<unknown>;
  getSearchResultData(result: Record<string,unknown>, token:string): PromiseLike<unknown>;
  getLayerFilterFields(layer:string, token:string, language:"he"): PromiseLike<unknown>;
  getLayerFeaturesByLocation(params:{geometry:string; radius:number; layers:{name:string;fields:string[]}[]}, token:string): PromiseLike<unknown>;
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
