// GovMap's documented SDK geometry uses Israel TM (metres), EPSG:2039.
export type XY = [number, number];
export type Polygon = XY[][];
export type Direction = "מצפון" | "ממערב" | "מדרום" | "ממזרח";
const cross = (o: XY, a: XY, b: XY) => (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);

export function parsePolygon(wkt: string): Polygon {
  let normalized=wkt.trim();
  const header=/^(MULTIPOLYGON|POLYGON)\s*(ZM|Z|M)?\s*(?=\()/i.exec(normalized);
  if(!header)throw new Error("נדרש פוליגון חלקה תקין; גיאומטריה אחרת לא נותחה.");
  const dimensions=header[2]?.toUpperCase();
  const coordinateCount=dimensions==="ZM"?4:dimensions?3:2;
  normalized=header[1].toUpperCase()+normalized.slice(header[0].length);
  if(/^MULTIPOLYGON/i.test(normalized)) {
    if(/\)\s*\)\s*,\s*\(\s*\(/.test(normalized))throw new Error("לחלקה כמה מתחמים נפרדים; נדרש ניתוח גיאומטרי נפרד לכל מתחם.");
    normalized=normalized.replace(/^MULTIPOLYGON\s*\(/i,"POLYGON").replace(/\)\s*$/,"");
  }
  if (!/^POLYGON\s*\(\s*\([^()]+\)(\s*,\s*\([^()]+\))*\s*\)$/i.test(normalized)) throw new Error("נדרש פוליגון חלקה תקין; גיאומטריה אחרת לא נותחה.");
  const rings=[...normalized.matchAll(/\(([^()]+)\)/g)].map(match => match[1].split(",").map(pair => {
    const values = pair.trim().split(/\s+/).map(Number);
    if (values.length !== coordinateCount || !values.every(Number.isFinite)) throw new Error("קואורדינטות חלקה לא תקינות.");
    const [x,y] = values;
    if (x < 0 || x > 500000 || y < 100000 || y > 1000000) throw new Error("מערכת הקואורדינטות אינה תואמת EPSG:2039.");
    return [x,y] as XY;
  }));
  if (rings.some(ring => ring.length < 4 || ring.length > 10000 || ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1])) throw new Error("גבול החלקה אינו טבעת סגורה.");
  return rings;
}

// Query horizontal footprints using 2D WKT, while retaining the original XYZ
// response separately. Cadastral Z values have no verified terrain provenance.
export function planarWkt(polygon:Polygon):string {
  return `POLYGON (${polygon.map(ring=>`(${ring.map(([x,y])=>`${x} ${y}`).join(", ")})`).join(", ")})`;
}

const area = (ring: XY[]) => Math.abs(ring.slice(1).reduce((sum,p,i) => sum+cross(ring[0],ring[i],p),0))/2;
function hull(points: XY[]): XY[] {
  const sorted = [...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const chain = (list: XY[]) => { const result: XY[]=[]; for (const p of list) { while(result.length>1 && cross(result.at(-2)!,result.at(-1)!,p)<=0)result.pop(); result.push(p); } return result.slice(0,-1); };
  return [...chain(sorted),...chain(sorted.reverse())];
}
export function describeGeometry(polygon: Polygon) {
  const ring = polygon[0], convex = hull(ring.slice(0,-1));
  const graphicArea = area(ring)-polygon.slice(1).reduce((sum,r)=>sum+area(r),0);
  if (graphicArea <= 0 || convex.length < 3) throw new Error("שטח פוליגון לא תקין.");
  let boxArea = Infinity, aspect = 0;
  for(let i=0;i<convex.length;i++) {
    const a=convex[i], b=convex[(i+1)%convex.length], angle=Math.atan2(b[1]-a[1],b[0]-a[0]);
    const rotated=convex.map(p=>[p[0]*Math.cos(angle)+p[1]*Math.sin(angle),-p[0]*Math.sin(angle)+p[1]*Math.cos(angle)]);
    const width=Math.max(...rotated.map(p=>p[0]))-Math.min(...rotated.map(p=>p[0]));
    const height=Math.max(...rotated.map(p=>p[1]))-Math.min(...rotated.map(p=>p[1]));
    if(width*height<boxArea){boxArea=width*height;aspect=Math.min(width,height)/Math.max(width,height);}
  }
  const coverage=graphicArea/boxArea;
  const shape = polygon.length===1 && coverage>=0.95 ? (aspect>=0.9?"מעין רבועה":"מעין מלבנית") : "רב־צלעית בלתי סדירה";
  return { graphicArea, boxCoverage:coverage, shape, method:"minimum-oriented-bounding-box", crs:"EPSG:2039" as const };
}

// Positive shared edge length excludes neighbours touching only at a corner.
// Tolerance accommodates small discrepancies in the cadastral outlines.
export function sharedBorders(target: Polygon, neighbor: Polygon): {direction:Direction; meters:number}[] {
  const ring=target[0];
  const orientation=Math.sign(ring.slice(1).reduce((sum,p,i)=>sum+cross(ring[0],ring[i],p),0));
  const lengths=new Map<Direction,number>();
  for(let i=0;i<ring.length-1;i++) {
    const a=ring[i],b=ring[i+1], dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    if(!length)continue;
    const intervals:[number,number][]=[];
    for(const other of neighbor) for(let j=0;j<other.length-1;j++) {
      const c=other[j],d=other[j+1];
      if(Math.abs(cross(a,b,c))/length>0.2 || Math.abs(cross(a,b,d))/length>0.2)continue;
      const t=(p:XY)=>((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length;
      const start=Math.max(0,Math.min(t(c),t(d))),end=Math.min(length,Math.max(t(c),t(d)));
      if(end>start)intervals.push([start,end]);
    }
    intervals.sort((x,y)=>x[0]-y[0]);
    let end=0,shared=0;
    for(const interval of intervals){shared+=Math.max(0,interval[1]-Math.max(interval[0],end));end=Math.max(end,interval[1]);}
    if(shared<1)continue;
    // Outward edge normals remain meaningful for concave parcels, unlike a
    // vector from the average vertex (which can lie outside the parcel).
    const x=dy*orientation,y=-dx*orientation;
    const direction:Direction=Math.abs(y)>=Math.abs(x)?(y>=0?"מצפון":"מדרום"):(x>=0?"ממזרח":"ממערב");
    lengths.set(direction,(lengths.get(direction)??0)+shared);
  }
  return [...lengths].map(([direction,meters])=>({direction,meters}));
}
