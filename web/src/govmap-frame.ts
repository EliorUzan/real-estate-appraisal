import { CADASTRAL_LAYERS, loadGovMap, parseLocation, parseParcels, withTimeout } from "./lib/govmap";
import "./govmap-frame.css";

// GovMap issues a public browser token restricted to the approved hostnames.
// An optional build-time override supports a replacement token without a code edit.
const token = import.meta.env.VITE_GOVMAP_TOKEN?.trim() || "e7ae87c1-eccb-4410-9c28-17994e01f72a";
const address = new URLSearchParams(location.hash.slice(1)).get("address")?.trim() ?? "";
const addressElement = document.getElementById("requested-address")!;
const parcelElement = document.getElementById("parcels")!;
const status = document.getElementById("map-status")!;
const shell = document.getElementById("map-shell")!;
const retry = document.getElementById("retry")!;
addressElement.textContent = address;
retry.addEventListener("click", () => location.reload());

function fail(text: string) {
  status.textContent = text;
  status.setAttribute("role", "alert");
  retry.hidden = false;
  parcelElement.textContent = "לא זמין";
  shell.setAttribute("aria-busy", "false");
}

async function initialize() {
  if (!address || address.length > 500) {
    fail("יש להזין כתובת מלאה הכוללת יישוב, רחוב ומספר בית.");
    return;
  }
  let stage: "sdk" | "map" | "address" = "sdk";
  try {
    const api = await loadGovMap();
    stage = "map";
    // The current SDK's promise completes after the iframe handshake and token
    // authentication. Its onLoad callback additionally waits for a render-driven
    // event that can be missed or delayed; it must not gate address requests.
    await withTimeout(api.createMap("govmap", {
        token,
        layers: CADASTRAL_LAYERS,
        visibleLayers: CADASTRAL_LAYERS,
        background: "1",
        layersMode: 1,
        zoomButtons: true,
        identifyOnClick: true,
      }), 45000);
    // Label the cross-origin frame created by the SDK for assistive technology.
    document.querySelector("#govmap iframe")?.setAttribute("title", `מפת GovMap — ${address}`);
    status.textContent = "מאתר את הכתובת…";
    stage = "address";
    const point = parseLocation(await withTimeout(api.geocode({ keyword: address, type: api.geocodeType.AccuracyOnly })));
    if (!point) {
      fail("לא נמצאה כתובת חד־משמעית. יש לדייק את היישוב, הרחוב ומספר הבית בבקשה.");
      return;
    }
    api.zoomToXY({ x: point.x, y: point.y, level: 10, marker: true });
    shell.classList.add("located");
    shell.setAttribute("aria-busy", "false");
    if (point.approximate) {
      parcelElement.textContent = "לא זמין — הכתובת לא אותרה במדויק";
      status.textContent = "נמצאה התאמה חלקית בלבד. המפה מציגה את האזור המשוער; יש לדייק את הכתובת כדי לקבל גוש וחלקה.";
      return;
    }
    status.textContent = "מאתר גוש וחלקה…";
    try {
      // Query the same ITM point shown on the map, avoiding a second, potentially
      // different address match. Request every intersecting parcel, not just one.
      const parcels = parseParcels(await withTimeout(api.intersectFeatures({
        geometry: `POINT(${point.x} ${point.y})`,
        layerName: "PARCEL_ALL",
        fields: ["GUSH_NUM", "PARCEL"],
      })));
      parcelElement.textContent = parcels.length
        ? parcels.map(({ block, parcel }) => `גוש ${block}, חלקה ${parcel}`).join(" · ")
        : "לא נמצאו נתוני גוש וחלקה לכתובת זו";
      status.textContent = "המפה ממוקדת בכתובת המבוקשת. שכבות גושים וחלקות מופעלות.";
    } catch {
      parcelElement.textContent = "נתוני גוש וחלקה אינם זמינים כרגע";
      status.textContent = "הכתובת אותרה במפה, אך לא ניתן היה לקבל את נתוני הגוש והחלקה.";
      retry.hidden = false;
    }
  } catch (error) {
    console.warn("GovMap initialization failed", { stage, reason: error instanceof Error ? error.message : "Unknown error" });
    fail(stage === "address"
      ? "המפה נטענה, אך לא ניתן היה לאתר את הכתובת כרגע. נסו שוב."
      : "לא ניתן להשלים את טעינת GovMap כרגע. נסו שוב.");
  }
}

void initialize();
