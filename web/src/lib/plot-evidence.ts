import { parseParcels, withTimeout } from "./govmap.ts";
import type { GovMapApi, Point, Parcel } from "./govmap.ts";
import { describeGeometry, parsePolygon, planarWkt, sharedBorders } from "./plot-geometry.ts";

export type SpatialEvidence = {
  crs:"EPSG:2039";
  addressPoint:{x:number;y:number};
  parcelGeometry:string|null;
  geometryDiagnostics?:{searchResult:Record<string,unknown>;format:string;rawGeometry:unknown};
  geometryAnalysis:ReturnType<typeof describeGeometry>|null;
  neighbors:{gush:string;parcel:string;geometry:string;borders:ReturnType<typeof sharedBorders>;layers:SpatialEvidence["layers"]}[];
  layers:{layer:string;status:"received"|"unavailable";fields:Record<string,string>;features:unknown[];error?:string}[];
  topography:null;
  warnings:string[];
};
const object=(value:unknown):Record<string,unknown> => value!==null && typeof value==="object" && !Array.isArray(value)?value as Record<string,unknown>:{};
const body=(value:unknown) => object(value).data??value;

// Preserve the field's meaning and source. Numeric codes are not translated
// into land-use names without a documented code dictionary.
export function layerFacts(layer:SpatialEvidence["layers"][number]):string[] {
  if(layer.status!=="received")return [];
  const facts=new Set<string>();
  for(const feature of layer.features) {
    const attributes=object(object(feature).attributes);
    for(const [key,label] of Object.entries(layer.fields)) {
      if(!/ייעוד|יעוד|שימוש|רחוב|land.?use|designation|street/i.test(key+" "+label))continue;
      const value=attributes[key];
      if(typeof value==="string" && value.trim() && !/^\d+$/.test(value.trim()))facts.add(`${label}: ${value} (${layer.layer}, חופף לחלקה)`);
    }
  }
  return [...facts];
}

export function selectParcelSearchResult(response:unknown, parcel:Parcel): Record<string,unknown> {
  const results=object(body(response)).results;
  if(!Array.isArray(results) || results.length===0)throw new Error("לא התקבלו תוצאות לחיפוש החלקה מ-GovMap.");
  const block=parcel.block.replace(/\D/g, ""), lot=parcel.parcel.replace(/\D/g, "");
  const escaped = (value:string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches=results.map(object).filter(r=>{
    const text=[r.text,r.originalText,r.data,r.header,r.title].filter(value=>typeof value==="string").join(" ");
    return new RegExp(`(^|\\D)${escaped(block)}(\\D|$)`).test(text) && new RegExp(`(^|\\D)${escaped(lot)}(\\D|$)`).test(text);
  });
  if(matches.length!==1)throw new Error("לא נמצאה התאמה יחידה לגוש והחלקה שנבחרו; לא נעשה שימוש בתוצאה אחרת.");
  return matches[0];
}
async function parcelGeometry(api:GovMapApi, token:string, parcel:Parcel, diagnose?:(data:NonNullable<SpatialEvidence["geometryDiagnostics"]>)=>void):Promise<string> {
  const found=selectParcelSearchResult(await withTimeout(api.search({searchText:`גוש ${parcel.block} חלקה ${parcel.parcel}`,apiKey:token,language:"he",maxResults:10,isAccurate:true})),parcel);
  const detail=object(body(await withTimeout(api.getSearchResultData(found,token))));
  const raw=detail.geom;
  const format=typeof raw==="string" ? (/^[0-9a-f]+$/i.test(raw.trim())?"hex-encoded geometry":raw.trim().match(/^[A-Za-z]+(?:\s+(?:ZM|Z|M)\b)?/i)?.[0]??"unknown text") : raw===null?"null":typeof raw;
  diagnose?.({searchResult:{id:found.id,type:found.type,layerId:found.layerId,objectId:found.objectId,text:found.text},format,rawGeometry:raw??null});
  if(typeof detail.geom!=="string")throw new Error("GovMap לא החזיר גיאומטריית חלקה.");
  if(!/^(?:MULTI)?POLYGON\s*(?:ZM|Z|M)?\s*\(/i.test(detail.geom.trim()))throw new Error(`הוחזרה גיאומטריה מסוג ${format}, שאינה נתמכת כמסגרת חלקה. הערך המקורי נשמר בפירוט המקורות.`);
  return detail.geom;
}

export async function collectPlotEvidence(api:GovMapApi, token:string, parcel:Parcel, point:Point,
  progress:(message:string)=>void=()=>{}, active:()=>boolean=()=>true):Promise<SpatialEvidence> {
  const evidence:SpatialEvidence={crs:"EPSG:2039",addressPoint:{x:point.x,y:point.y},parcelGeometry:null,geometryAnalysis:null,neighbors:[],layers:[],topography:null,warnings:[]};
  try {
    progress("אוסף את גבול החלקה…");
    evidence.parcelGeometry=await parcelGeometry(api,token,parcel,data=>{evidence.geometryDiagnostics=data;});
    const polygon=parsePolygon(evidence.parcelGeometry);
    const footprint=planarWkt(polygon);
    evidence.geometryAnalysis=describeGeometry(polygon);
    if(/^(?:MULTI)?POLYGON\s+Z(?:M)?\b/i.test(evidence.parcelGeometry.trim()))evidence.warnings.push("בגיאומטריית הקדסטר קיימים ערכי Z, אך מקורם כגובה קרקע אינו מאומת. אין להסיק מהם גובה או שיפוע, ובפרט אין להסיק מישוריות מערכי אפס.");
    if(!active())return evidence;
    progress("אוסף שכבות תכנון, דרכים ובינוי…");
    evidence.layers=await Promise.all(["retzefMigrashim","ways","STREET_ALL","BUILDINGS"].map(async layer=>{
      try {
        const schema=body(await withTimeout(api.getLayerFilterFields(layer,token,"he")));
        if(!Array.isArray(schema))throw new Error("שדות השכבה אינם זמינים להרשאה זו.");
        const fields:Record<string,string>={};
        for(const raw of schema.slice(0,24)){const f=object(raw);if(typeof f.name==="string")fields[f.name]=String(f.displayName??f.name);}
        if(!Object.keys(fields).length)throw new Error("לא התקבלו שדות גלויים בשכבה.");
        const response=object(body(await withTimeout(api.getLayerFeaturesByLocation({geometry:footprint,radius:0,layers:[{name:layer,fields:Object.keys(fields)}]},token))));
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
      const candidates=parseParcels(await withTimeout(api.intersectFeatures({geometry:footprint,layerName:"PARCEL_ALL",fields:["GUSH_NUM","PARCEL"],radius:0.2})))
        .filter(p=>p.block!==parcel.block || p.parcel!==parcel.parcel);
      if(candidates.length>12)evidence.warnings.push("ניתוח הגבולות הוגבל ל־12 חלקות סמוכות; רשימת הגבולות חלקית.");
      // SDK search shares a debouncer, so searches must be sequential.
      for(const neighbor of candidates.slice(0,12)) {
        if(!active())return evidence;
        try {
          const geometry=await parcelGeometry(api,token,neighbor);
          const neighborPolygon=parsePolygon(geometry);
          const borders=sharedBorders(polygon,neighborPolygon);
          if(borders.length) {
            // Designations must be queried on the neighbour, not the subject parcel.
            const layers=await Promise.all(evidence.layers.filter(l=>l.status==="received" && l.layer!=="BUILDINGS").map(async l=>{
              try {
                const response=object(body(await withTimeout(api.getLayerFeaturesByLocation({geometry:planarWkt(neighborPolygon),radius:0,layers:[{name:l.layer,fields:Object.keys(l.fields)}]},token))));
                const found=object(response.layers),key=Object.keys(found).find(k=>k.toLowerCase()===l.layer.toLowerCase());
                if(!key || !Array.isArray(found[key]))throw new Error("השכבה לא הוחזרה");
                return {...l,features:(found[key] as unknown[]).slice(0,20)};
              } catch {return {...l,status:"unavailable" as const,features:[],error:"נתוני השכן לא הוחזרו"};}
            }));
            evidence.neighbors.push({gush:neighbor.block,parcel:neighbor.parcel,geometry,borders,layers});
          }
        } catch { evidence.warnings.push(`לא אומת גבול עם גוש ${neighbor.block}, חלקה ${neighbor.parcel}.`); }
      }
    } catch { evidence.warnings.push("לא ניתן היה לשלוף את החלקות הגובלות."); }
  } catch(error){evidence.warnings.push(error instanceof Error?error.message:"שליפת גבול החלקה נכשלה.");}
  if(!evidence.geometryAnalysis)evidence.warnings.push("איסוף השכבות והגבולות לא בוצע משום שלא התקבלה גיאומטריית חלקה נתמכת.");
  evidence.warnings.push("לא מחובר מקור נתוני גובה או שיפוע; לא נשלחה בקשת גובה ואין להסיק מישוריות מקואורדינטות XY.",
    "רשומות תכנון ודרכים, ככל שהוחזרו, אינן מוכיחות ייעוד גובל בכיוון מסוים.",
    "רשומות בינוי חופפות אינן מוכיחות שימוש, מספר מבנים שלמים או שהחלקה פנויה.");
  for(const layer of evidence.layers)if(layer.status==="unavailable")evidence.warnings.push(`שכבת ${layer.layer}: ${layer.error}`);
  return evidence;
}
