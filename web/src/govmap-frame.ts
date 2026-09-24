import { CADASTRAL_LAYERS, loadGovMap, parseLocation, parseParcels, withTimeout } from "./lib/govmap";
import { parsePlotParcels, positiveArea, renderPlotDescription } from "./lib/plot-description";
import type { PlotAnalysisData, PlotBorder, PlotParcel } from "./lib/plot-description";
import { collectPlotEvidence } from "./lib/plot-evidence";
import type { SpatialEvidence } from "./lib/plot-evidence";
import type { GovMapApi, Point } from "./lib/govmap";
import "./govmap-frame.css";

// GovMap issues a public browser token restricted to the approved hostnames.
// An optional build-time override supports a replacement token without a code edit.
const token = import.meta.env.VITE_GOVMAP_TOKEN?.trim() || "e7ae87c1-eccb-4410-9c28-17994e01f72a";
const params = new URLSearchParams(location.hash.slice(1));
const address = params.get("address")?.trim() ?? "";
const plotMode = params.get("mode") === "plot";
const addressElement = document.getElementById("requested-address")!;
const parcelElement = document.getElementById("parcels")!;
const status = document.getElementById("map-status")!;
const shell = document.getElementById("map-shell")!;
const retry = document.getElementById("retry")!;
const plotSection = document.getElementById("plot-section")!;
const plotForm = document.getElementById("plot-form") as HTMLFormElement;
const plotSelect = document.getElementById("plot-parcel") as HTMLSelectElement;
const plotArea = document.getElementById("plot-area")!;
const plotWarning = document.getElementById("plot-warning")!;
const plotOutput = document.getElementById("plot-output") as HTMLTextAreaElement;
const plotOutputLabel = document.getElementById("plot-output-label")!;
const plotCopy = document.getElementById("plot-copy")!;
let plotParcels: PlotParcel[] = [];
let retrievedAt = "";
let activeApi:GovMapApi|undefined;
let addressPoint:Point|undefined;
let spatial:SpatialEvidence|undefined;
let collectionVersion=0;
let collecting=false;
const publish=(data:PlotAnalysisData|null) => { if(parent!==window)parent.postMessage({type:"plot-evidence",address,data},location.origin); };
addressElement.textContent = address;
retry.addEventListener("click", () => location.reload());
plotSection.hidden = !plotMode;

function field(id: string): string {
  return (document.getElementById(id) as HTMLInputElement).value.trim();
}

function collectPlotData(): PlotAnalysisData | null {
  const selected = plotSelect.value === "" ? undefined : plotParcels[Number(plotSelect.value)];
  if (!selected) {
    plotWarning.textContent = "יש לבחור גוש וחלקה לפני יצירת טיוטה.";
    return null;
  }
  const areaInput = field("registered-area");
  const registeredArea = positiveArea(areaInput);
  if (areaInput && registeredArea === null) {
    plotWarning.textContent = "השטח הרשום חייב להיות מספר חיובי.";
    return null;
  }
  const borders: PlotBorder[] = [
    { direction: "מצפון", description: field("border-north") },
    { direction: "ממערב", description: field("border-west") },
    { direction: "מדרום", description: field("border-south") },
    { direction: "ממזרח", description: field("border-east") },
  ];
  const warnings = ["נתוני GovMap אינם אסמכתא לשטח הרשום או לזכויות; יש לאמת מול נסח הרישום."];
  if (registeredArea === null) warnings.push("השטח מוצג כנתון GovMap; השטח הרשום לא אומת מול נסח.");
  if (!field("topography")) warnings.push("הטופוגרפיה לא אומתה.");
  if (!field("geometry-shape")) warnings.push("צורת החלקה לא אומתה.");
  if (borders.some(border => !border.description)) warnings.push("לא אומתו כל ארבעת גבולות החלקה.");
  if (!field("buildings")) warnings.push("הבינוי הקיים לא אומת; אין להסיק שחלקה ללא בינוי.");
  return {
    address, retrievedAt, source: "GovMap PARCEL_ALL", gush: selected.block, parcel: selected.parcel,
    cadastralArea: selected.cadastralArea, registeredArea, topography: field("topography"),
    geometryShape: field("geometry-shape"), borders, buildingsSummary: field("buildings"),
    planningNotes: field("planning-notes"), warnings:[...warnings,...(spatial?.warnings??[])], spatial,
  };
}

plotSelect.addEventListener("change", async () => {
  const version=++collectionVersion;
  spatial=undefined;
  collecting=false;
  publish(null);
  for(const id of ["registered-area","topography","geometry-shape","border-north","border-west","border-south","border-east","buildings","planning-notes"])(document.getElementById(id) as HTMLInputElement).value="";
  const selected = plotSelect.value === "" ? undefined : plotParcels[Number(plotSelect.value)];
  plotArea.textContent = selected
    ? selected.cadastralArea === null ? "שטח קדסטרי משכבת GovMap: לא זמין."
      : `שטח קדסטרי משכבת GovMap: ${selected.cadastralArea.toLocaleString("en-US")} מ״ר (לבדיקה מול נסח).`
    : "";
  plotOutputLabel.hidden = true;
  plotCopy.hidden = true;
  if(!selected || !activeApi || !addressPoint)return;
  collecting=true;
  const result=await collectPlotEvidence(activeApi,token,selected,addressPoint,message=>{if(version===collectionVersion)plotWarning.textContent=message;},()=>version===collectionVersion);
  if(version!==collectionVersion)return;
  spatial=result;
  collecting=false;
  if(spatial.geometryAnalysis && !field("geometry-shape"))(document.getElementById("geometry-shape") as HTMLInputElement).value=spatial.geometryAnalysis.shape;
  const directions={"מצפון":"border-north","ממערב":"border-west","מדרום":"border-south","ממזרח":"border-east"};
  for(const [direction,id] of Object.entries(directions)) {
    const neighbors=spatial.neighbors.filter(n=>n.borders.some(b=>b.direction===direction));
    if(!field(id))(document.getElementById(id) as HTMLInputElement).value=neighbors.map(n=>`חלקה ${n.parcel} בגוש ${n.gush}`).join("; ");
  }
  const data=collectPlotData();
  plotWarning.textContent=data?.warnings.join(" ")??"";
  publish(data);
});
plotForm.addEventListener("input", () => { plotOutputLabel.hidden = true; plotCopy.hidden = true; if(!collecting && plotSelect.value!=="")publish(collectPlotData()); });
plotForm.addEventListener("submit", event => {
  event.preventDefault();
  const data = collectPlotData();
  if (!data) return;
  plotOutput.value = renderPlotDescription(data);
  plotWarning.textContent = data.warnings.join(" ");
  plotOutputLabel.hidden = false;
  plotCopy.hidden = false;
});
document.getElementById("plot-json")!.addEventListener("click", () => {
  const data = collectPlotData();
  if (!data) return;
  plotWarning.textContent = data.warnings.join(" ");
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `plot-description-${data.gush}-${data.parcel}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
plotCopy.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(plotOutput.value); plotCopy.textContent = "הועתק"; }
  catch { plotWarning.textContent = "לא ניתן להעתיק אוטומטית. סמנו את הטקסט והעתיקו."; }
});

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
    activeApi=api;
    stage = "map";
    // Keep the iframe visible while waiting: onLoad requires a rendered map.
    // Supplying it also makes the SDK promise await application/layer readiness,
    // preventing an early parcel query from returning a false empty result.
    await withTimeout(api.createMap("govmap", {
        token,
        layers: CADASTRAL_LAYERS,
        visibleLayers: CADASTRAL_LAYERS,
        background: "1",
        layersMode: 1,
        zoomButtons: true,
        identifyOnClick: true,
        onLoad: () => { status.textContent = "מאתר את הכתובת…"; },
      }), 45000);
    // Label the cross-origin frame created by the SDK for assistive technology.
    document.querySelector("#govmap iframe")?.setAttribute("title", `מפת GovMap — ${address}`);
    stage = "address";
    const point = parseLocation(await withTimeout(api.geocode({ keyword: address, type: api.geocodeType.FullResult })), address);
    if (!point) {
      fail("לא נמצאה כתובת חד־משמעית. יש לדייק את היישוב, הרחוב ומספר הבית בבקשה.");
      return;
    }
    api.zoomToXY({ x: point.x, y: point.y, level: 10, marker: true });
    shell.classList.add("located");
    shell.setAttribute("aria-busy", "false");
    if (point.approximate) {
      parcelElement.textContent = "לא זמין — הכתובת לא אותרה במדויק";
      status.textContent = `נמצאה התאמה חלקית בלבד${point.label ? `: ${point.label}` : ""}. המפה מציגה את האזור המשוער; יש לדייק את הכתובת כדי לקבל גוש וחלקה.`;
      return;
    }
    addressPoint=point;
    status.textContent = "מאתר גוש וחלקה…";
    try {
      // Query the same ITM point shown on the map, avoiding a second, potentially
      // different address match. Request every intersecting parcel, not just one.
      const query = { geometry: `POINT(${point.x} ${point.y})`, layerName: "PARCEL_ALL" };
      let parcels;
      if (plotMode) {
        try {
          plotParcels = parsePlotParcels(await withTimeout(api.intersectFeatures({
            ...query, fields: ["GUSH_NUM", "PARCEL", "LEGAL_AREA"],
          })));
        } catch {
          plotParcels = parsePlotParcels(await withTimeout(api.intersectFeatures({
            ...query, fields: ["GUSH_NUM", "PARCEL"],
          })));
        }
        retrievedAt = new Date().toISOString();
        parcels = plotParcels;
        plotSelect.replaceChildren(new Option("בחרו חלקה", ""));
        plotParcels.forEach((parcel, index) => plotSelect.add(new Option(`גוש ${parcel.block}, חלקה ${parcel.parcel}`, String(index))));
        if (plotParcels.length === 1) { plotSelect.value = "0"; plotSelect.dispatchEvent(new Event("change")); }
        plotWarning.textContent = plotParcels.length === 0
          ? "לא נמצאה חלקה בכתובת זו; אין אפשרות להכין טיוטה עד לאימות המיקום."
          : plotParcels.length > 1
            ? "הכתובת חופפת לכמה חלקות. יש לבחור ולאמת את החלקה הנכונה."
            : "GovMap מספק כאן זיהוי ושטח קדסטרי ככל שזמין. יתר השדות דורשים אימות נפרד.";
      } else {
        parcels = parseParcels(await withTimeout(api.intersectFeatures({
          ...query, fields: ["GUSH_NUM", "PARCEL"],
        })));
      }
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
