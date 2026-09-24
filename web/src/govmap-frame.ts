import { CADASTRAL_LAYERS, loadGovMap, parseLocation, parseParcels, withTimeout } from "./lib/govmap";
import { parsePlotParcels } from "./lib/plot-description";
import type { PlotAnalysisData, PlotBorder, PlotParcel } from "./lib/plot-description";
import { collectPlotEvidence, layerFacts } from "./lib/plot-evidence";
import type { GovMapApi, Point } from "./lib/govmap";
import "./govmap-frame.css";

const token = import.meta.env.VITE_GOVMAP_TOKEN?.trim() || "e7ae87c1-eccb-4410-9c28-17994e01f72a";
const params=new URLSearchParams(location.hash.slice(1));
const address=params.get("address")?.trim()??"";
const plotMode=params.get("mode")==="plot";
const addressElement=document.getElementById("requested-address")!;
const parcelElement=document.getElementById("parcels")!;
const status=document.getElementById("map-status")!;
const shell=document.getElementById("map-shell")!;
const retry=document.getElementById("retry")!;
const plotSection=document.getElementById("plot-section")!;
const plotSelect=document.getElementById("plot-parcel") as HTMLSelectElement;
const plotWarning=document.getElementById("plot-warning")!;
let plotParcels:PlotParcel[]=[];
let retrievedAt="";
let activeApi:GovMapApi|undefined;
let addressPoint:Point|undefined;
let collectionVersion=0;
const publish=(data:PlotAnalysisData|null)=>{if(parent!==window)parent.postMessage({type:"plot-evidence",address,data},location.origin);};
const text=(id:string,value:string)=>{document.getElementById(id)!.textContent=value;};
addressElement.textContent=address;
plotSection.hidden=!plotMode;
retry.addEventListener("click",()=>location.reload());
new ResizeObserver(()=>{if(parent!==window)parent.postMessage({type:"govmap-size",address,height:document.querySelector("main")!.getBoundingClientRect().height+16},location.origin);}).observe(document.querySelector("main")!);

plotSelect.addEventListener("change",async()=>{
  const version=++collectionVersion;
  publish(null);
  const selected=plotSelect.value===""?undefined:plotParcels[Number(plotSelect.value)];
  for(const id of ["plot-topography","plot-shape","plot-buildings","border-north","border-west","border-south","border-east"])text(id,"ממתין לאיסוף");
  (document.getElementById("plot-coordinates") as HTMLTextAreaElement).value="";
  text("plot-evidence-details","");
  text("plot-gush",selected?.block??"לא נבחרה חלקה");
  text("plot-number",selected?.parcel??"לא נבחרה חלקה");
  text("plot-area",selected?.cadastralArea?.toLocaleString("he-IL")??"לא הוחזר שטח");
  if(!selected||!activeApi||!addressPoint)return;
  // Serial SDK searches cannot overlap when the user switches parcels.
  plotSelect.disabled=true;
  try {
    const spatial=await collectPlotEvidence(activeApi,token,selected,addressPoint,message=>{if(version===collectionVersion)plotWarning.textContent=message;},()=>version===collectionVersion);
    if(version!==collectionVersion)return;
    text("plot-topography","לא הוחזרו נתוני גובה או שיפוע מ־GovMap");
    text("plot-shape",spatial.geometryAnalysis?.shape??"לא ניתן לנתח את הצורה מהנתונים שהוחזרו");
    (document.getElementById("plot-coordinates") as HTMLTextAreaElement).value=spatial.parcelGeometry??"לא הוחזר גבול חלקה";
    const buildings=spatial.layers.find(l=>l.layer==="BUILDINGS");
    text("plot-buildings",buildings?.status==="received" ? buildings.features.length+" רשומות בינוי חופפות; השימוש ומספר המבנים טעונים אימות" : "לא הוחזרו נתוני בינוי");
    const directions={"מצפון":"border-north","ממערב":"border-west","מדרום":"border-south","ממזרח":"border-east"};
    const borders:PlotBorder[]=[];
    for(const [direction,id] of Object.entries(directions)) {
      const neighbors=spatial.neighbors.filter(n=>n.borders.some(b=>b.direction===direction));
      const description=neighbors.map(n=>{
        const facts=n.layers.flatMap(layerFacts);
        return "חלקה "+n.parcel+" בגוש "+n.gush+(facts.length?" — "+facts.join("; "):" — ייעוד לא הוחזר");
      }).join(" | ");
      text(id,description||"לא אומת גבול בכיוון זה");
      borders.push({direction:direction as PlotBorder["direction"],description});
    }
    text("plot-evidence-details",JSON.stringify({layers:spatial.layers,neighbors:spatial.neighbors.map(n=>({...n,geometry:undefined})),warnings:spatial.warnings},null,2));
    const data:PlotAnalysisData={address,retrievedAt,source:"GovMap PARCEL_ALL",gush:selected.block,parcel:selected.parcel,cadastralArea:selected.cadastralArea,registeredArea:null,topography:"",geometryShape:spatial.geometryAnalysis?.shape??"",borders,buildingsSummary:"",planningNotes:"",warnings:spatial.warnings,spatial};
    plotWarning.textContent="האיסוף הסתיים. "+(spatial.warnings.length?"חלק מהנתונים חסרים או טעונים אימות; פירוט במקורות השכבות.":"הנתונים מוכנים לבדיקה.");
    publish(data);
  } catch {
    plotWarning.textContent="לא ניתן להשלים את איסוף הנתונים. בחרו שוב את החלקה לניסיון נוסף.";
  } finally {if(version===collectionVersion)plotSelect.disabled=false;}
});

function fail(text: string) {
  status.textContent = text;
  status.setAttribute("role", "alert");
  retry.hidden = false;
  parcelElement.textContent = "לא זמין";
  shell.setAttribute("aria-busy", "false");
  if(plotMode) {
    for(const id of ["plot-gush","plot-number","plot-area","plot-topography","plot-shape","plot-buildings","border-north","border-west","border-south","border-east"])document.getElementById(id)!.textContent="לא זמין — האיתור לא הושלם";
    plotWarning.textContent="לא הוחזרו נתוני חלקה. GovMap מחייב דומיין מורשה; ניתן לנסות שוב לאחר בדיקת הגישה.";
    publish(null);
  }
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
        plotWarning.textContent = plotParcels.length === 0
          ? "לא נמצאה חלקה בכתובת זו; אין אפשרות להכין טיוטה עד לאימות המיקום."
          : plotParcels.length > 1
            ? "הכתובת חופפת לכמה חלקות. יש לבחור ולאמת את החלקה הנכונה."
            : "אוסף את פרטי החלקה…";
        if (plotParcels.length === 1) { plotSelect.value = "0"; plotSelect.dispatchEvent(new Event("change")); }
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
