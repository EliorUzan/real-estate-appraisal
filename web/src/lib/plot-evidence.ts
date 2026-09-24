import { parseParcels, withTimeout } from "./govmap.ts";
import type { GovMapApi, Point, Parcel } from "./govmap.ts";
import { describeGeometry, parsePolygon, sharedBorders } from "./plot-geometry.ts";

export type SpatialEvidence = {
  crs:"EPSG:2039";
  addressPoint:{x:number;y:number};
  parcelGeometry:string|null;
  geometryAnalysis:ReturnType<typeof describeGeometry>|null;
  neighbors:{gush:string;parcel:string;borders:ReturnType<typeof sharedBorders>}[];
  layers:{layer:string;status:"received"|"unavailable";fields:Record<string,string>;features:unknown[];error?:string}[];
  topography:null;
  warnings:string[];
};
const object=(value:unknown):Record<string,unknown> => value!==null && typeof value==="object" && !Array.isArray(value)?value as Record<string,unknown>:{};
const body=(value:unknown) => object(value).data??value;

export function selectParcelSearchResult(response:unknown, parcel:Parcel): Record<string,unknown> {
  const results=object(body(response)).results;
  if(!Array.isArray(results))throw new Error("תשובת חיפוש החלקה אינה תקינה.");
  const block=parcel.block.replace(/\D/g, ""), lot=parcel.parcel.replace(/\D/g, "");
  const matches=results.map(object).filter(r=>{
    const kind=String(r.type??r.layerId??"").toLowerCase();
    const text=[r.text,r.originalText,r.data].filter(value=>typeof value==="string").join(" ");
    if(!text || !new RegExp(`\\b${block}\\b`).test(text) || !new RegExp(`\\b${lot}\\b`).test(text))return false;
    return kind==="" || kind.includes("parcel") || kind.includes("gush");
  });
  if(matches.length!==1)throw new Error("לא נמצאה התאמה יחידה לגיאומטריית הגוש והחלקה שנבחרו.");
  return matches[0];
}
async function parcelGeometry(api:GovMapApi, token:string, parcel:Parcel):Promise<string> {
  const found=selectParcelSearchResult(await withTimeout(api.search({searchText:`גוש ${parcel.block} חלקה ${parcel.parcel}`,apiKey:token,language:"he",maxResults:10,isAccurate:true})),parcel);
  const detail=object(body(await withTimeout(api.getSearchResultData(found,token))));
  if(typeof detail.geom!=="string")throw new Error("GovMap לא החזיר גיאומטריית חלקה.");
  parsePolygon(detail.geom); // Reject non-polygon and mismatched coordinate systems.
  return detail.geom;
}

export async function collectPlotEvidence(api:GovMapApi, token:string, parcel:Parcel, point:Point,
  progress:(message:string)=>void=()=>{}, active:()=>boolean=()=>true):Promise<SpatialEvidence> {
  const evidence:SpatialEvidence={crs:"EPSG:2039",addressPoint:{x:point.x,y:point.y},parcelGeometry:null,geometryAnalysis:null,neighbors:[],layers:[],topography:null,warnings:[]};
  try {
    progress("אוסף את גבול החלקה…");
    evidence.parcelGeometry=await parcelGeometry(api,token,parcel);
    const polygon=parsePolygon(evidence.parcelGeometry);
    evidence.geometryAnalysis=describeGeometry(polygon);
    if(!active())return evidence;
    progress("אוסף שכבות תכנון, דרכים ובינוי…");
    evidence.layers=await Promise.all(["retzefMigrashim","ways","STREET_ALL","BUILDINGS"].map(async layer=>{
      try {
        const schema=body(await withTimeout(api.getLayerFilterFields(layer,token,"he")));
        if(!Array.isArray(schema))throw new Error("שדות השכבה אינם זמינים להרשאה זו.");
        const fields:Record<string,string>={};
        for(const raw of schema.slice(0,24)){const f=object(raw);if(typeof f.name==="string")fields[f.name]=String(f.displayName??f.name);}
        if(!Object.keys(fields).length)throw new Error("לא התקבלו שדות גלויים בשכבה.");
        const response=object(body(await withTimeout(api.getLayerFeaturesByLocation({geometry:evidence.parcelGeometry!,radius:0,layers:[{name:layer,fields:Object.keys(fields)}]},token))));
        const layers=object(response.layers);
        const key=Object.keys(layers).find(k=>k.toLowerCase()===layer.toLowerCase());
        if(!key || !Array.isArray(layers[key]))throw new Error("השכבה לא נכללה בתשובת GovMap.");
        const features=layers[key] as unknown[];
        if(features.length>=100)evidence.warnings.push(`שכבת ${layer} עשויה להיות מוגבלת במספר תוצאות; אין להסיק ספירה מלאה.`);
        return {layer,status:"received" as const,fields,features:features.slice(0,100)};
      } catch(error){return {layer,status:"unavailable" as const,fields:{},features:[],error:error instanceof Error?error.message:"השליפה נכשלה"};}
    }));
    if(!active())return evidence;
    progress("בודק חלקות גובלות…");
    try {
      const candidates=parseParcels(await withTimeout(api.intersectFeatures({geometry:evidence.parcelGeometry,layerName:"PARCEL_ALL",fields:["GUSH_NUM","PARCEL"],radius:0.2})))
        .filter(p=>p.block!==parcel.block || p.parcel!==parcel.parcel);
      if(candidates.length>12)evidence.warnings.push("ניתוח הגבולות הוגבל ל־12 חלקות סמוכות; רשימת הגבולות חלקית.");
      // SDK search shares a debouncer, so searches must be sequential.
      for(const neighbor of candidates.slice(0,12)) {
        if(!active())return evidence;
        try {
          const borders=sharedBorders(polygon,parsePolygon(await parcelGeometry(api,token,neighbor)));
          if(borders.length)evidence.neighbors.push({gush:neighbor.block,parcel:neighbor.parcel,borders});
        } catch { evidence.warnings.push(`לא אומת גבול עם גוש ${neighbor.block}, חלקה ${neighbor.parcel}.`); }
      }
    } catch { evidence.warnings.push("לא ניתן היה לשלוף את החלקות הגובלות."); }
  } catch(error){evidence.warnings.push(error instanceof Error?error.message:"שליפת גבול החלקה נכשלה.");}
  evidence.warnings.push("לא התקבלו נתוני גובה או שיפוע; אין לקבוע שהקרקע מישורית על סמך מפת גבולות.",
    "שכבות תכנון ודרכים נאספו בחיתוך עם החלקה; הן אינן מוכיחות ייעוד גובל בכיוון מסוים.",
    "רשומות בינוי חופפות אינן מוכיחות שימוש, מספר מבנים שלמים או שהחלקה פנויה.");
  for(const layer of evidence.layers)if(layer.status==="unavailable")evidence.warnings.push(`שכבת ${layer.layer}: ${layer.error}`);
  return evidence;
}
