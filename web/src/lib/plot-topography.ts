import type { Polygon, XY } from "./plot-geometry";

/** Convert Israel TM (EPSG:2039) coordinates to WGS84 coordinates. */
export function itmToWgs84(x: number, y: number): { lat: number; lon: number } {
  const lat = 31.734 + (y - 600000) / 110900;
  const lon = 35.205 + (x - 200000) / (111320 * Math.cos(lat * Math.PI / 180));
  return { lat, lon };
}

export type TopographyResult = {
  classification: "Flat" | "Slight slope" | "Sloped / Hillside";
  minElevation: number;
  maxElevation: number;
  elevationDelta: number;
  slopePercentage: number;
};

/** Sample the plot and ask Open-Meteo's public elevation endpoint for heights. */
export async function calculateTopography(polygon: Polygon): Promise<TopographyResult | null> {
  try {
    const ring = polygon[0];
    if (!ring || ring.length < 4) return null;
    const points = ring.slice(0, -1);
    const centerX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
    const centerY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
    const samplePoints: XY[] = [
      [centerX, centerY],
      points[0],
      points[Math.floor(points.length / 4)],
      points[Math.floor(points.length / 2)],
      points[Math.floor(3 * points.length / 4)],
    ];
    const coordinates = samplePoints.map(([x, y]) => itmToWgs84(x, y));
    const latitude = coordinates.map(point => point.lat.toFixed(5)).join(",");
    const longitude = coordinates.map(point => point.lon.toFixed(5)).join(",");
    const response = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${latitude}&longitude=${longitude}`);
    if (!response.ok) return null;
    const payload = await response.json() as { elevation?: unknown };
    const elevations = Array.isArray(payload.elevation) ? payload.elevation.filter((value): value is number => typeof value === "number" && Number.isFinite(value)) : [];
    if (!elevations.length) return null;
    const min = Math.min(...elevations);
    const max = Math.max(...elevations);
    const delta = max - min;
    const diameter = Math.max(...samplePoints.map(point => Math.hypot(point[0] - centerX, point[1] - centerY))) * 2 || 30;
    const slope = (delta / diameter) * 100;
    const classification: TopographyResult["classification"] = slope > 8 || delta >= 4
      ? "Sloped / Hillside"
      : slope > 3 || delta >= 1.5
        ? "Slight slope"
        : "Flat";
    return {
      classification,
      minElevation: min,
      maxElevation: max,
      elevationDelta: Math.round(delta * 10) / 10,
      slopePercentage: Math.round(slope * 10) / 10,
    };
  } catch {
    return null;
  }
}
