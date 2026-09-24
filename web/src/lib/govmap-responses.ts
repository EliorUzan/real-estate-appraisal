import type { GovMapApi } from "./govmap.ts";

export type GovMapResponse = { method: string; response: unknown };
const dataMethods = new Set(["geocode", "intersectFeatures", "search", "getSearchResultData", "getLayerFilterFields", "getLayerFeaturesByLocation"]);

// Retain complete data responses before presentation filters or result limits.
// Request arguments (including API credentials) are never included in evidence.
export function recordGovMapResponses(api: GovMapApi, responses: GovMapResponse[]): GovMapApi {
  return new Proxy(api, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      if (!dataMethods.has(String(property))) return value.bind(target);
      return async (...args: unknown[]) => {
        const response = await Reflect.apply(value, target, args);
        responses.push({ method: String(property), response: structuredClone(response) });
        return response;
      };
    },
  });
}
