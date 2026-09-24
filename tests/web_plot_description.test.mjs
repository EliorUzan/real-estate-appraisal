import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePlotParcels, positiveArea, renderPlotDescription } from "../web/src/lib/plot-description.ts";
import { selectParcelSearchResult, collectPlotEvidence, layerFacts } from "../web/src/lib/plot-evidence.ts";
import { parsePolygon, describeGeometry } from "../web/src/lib/plot-geometry.ts";

test("the deployed plot agent contains the complete canonical Markdown",()=>{
  const canonical=readFileSync(new URL("../src/appraisal_assistant/agents/prompts/plot_description.md",import.meta.url),"utf8");
  const bundled=JSON.parse(readFileSync(new URL("../supabase/functions/appraisal/plot-prompt.json",import.meta.url),"utf8"));
  assert.equal(bundled.content,canonical.replace(/\r\n/g,"\n"));
});

test("collects cadastral area only when GovMap returns a valid value", () => {
  assert.deepEqual(parsePlotParcels({ status: 0, errorCode: 0, data: [
    { Values: [11140, 91, "1,003"] }, { Values: [11140, 92, null] },
  ] }), [
    { block: "11140", parcel: "91", cadastralArea: 1003 },
    { block: "11140", parcel: "92", cadastralArea: null },
  ]);
  assert.throws(() => parsePlotParcels({ status: 403, data: [] }));
  assert.equal(positiveArea("1,003.00"), 1003);
  assert.equal(positiveArea("-3"), null);
  assert.equal(positiveArea(""), null);
});

test("draft contains only verified facts and never labels mapped area as registered", () => {
  const data = {
    address: "כתובת לדוגמה", retrievedAt: "2026-09-24T00:00:00.000Z", source: "GovMap PARCEL_ALL",
    gush: "11140", parcel: "91", cadastralArea: 1003, registeredArea: null,
    topography: "", geometryShape: "", borders: [
      { direction: "מצפון", description: "חלקה בייעוד דרך" },
      { direction: "ממערב", description: "" },
    ], buildingsSummary: "", planningNotes: "", warnings: [],
  };
  const partial = renderPlotDescription(data);
  assert.match(partial, /חלקה 91 בגוש 11140/);
  assert.match(partial, /מצפון – חלקה בייעוד דרך/);
  assert.doesNotMatch(partial, /שטח רשום|מישורית|מבנים|ממערב/);
  const complete = renderPlotDescription({ ...data, registeredArea: 1003, topography: "מישורית" });
  assert.match(complete, /שטח רשום של 1,003\.00 מ״ר/);
  assert.match(complete, /הקרקע מישורית/);
});

test("GovMap parcel geometry search accepts numeric or missing result classifications", () => {
  const parcel = { block: "11140", parcel: "91" };
  assert.deepEqual(selectParcelSearchResult({ data: { results: [
    { type: 10, text: "גוש 11140 חלקה 91" },
  ] } }, parcel), { type: 10, text: "גוש 11140 חלקה 91" });
  assert.deepEqual(selectParcelSearchResult({ data: { results: [
    { layerId: "unknown", originalText: "11140 / 91" },
  ] } }, parcel), { layerId: "unknown", originalText: "11140 / 91" });
  assert.throws(() => selectParcelSearchResult({ data: { results: [] } }, parcel), /לא התקבלו/);
});

test("parcel geometry never falls back to unrelated or ambiguous results", () => {
  const parcel={block:"11140",parcel:"91"};
  assert.throws(()=>selectParcelSearchResult({results:[{text:"גוש 11140 חלקה 92"}]},parcel));
  assert.throws(()=>selectParcelSearchResult({results:[{text:"11140 / 91"},{text:"11140 / 91"}]},parcel));
});

test("geometry rejects malformed rings and separate multipolygon components",()=>{
  assert.throws(()=>parsePolygon("POLYGON EMPTY"));
  assert.throws(()=>parsePolygon("POLYGON ((200000 700000,200001 700000,200001 700001))"));
  assert.throws(()=>parsePolygon("MULTIPOLYGON (((200000 700000,200010 700000,200010 700010,200000 700000)),((200020 700020,200030 700020,200030 700030,200020 700020)))"));
  const polygon=parsePolygon("MULTIPOLYGON (((200000 700000,200020 700000,200020 700010,200000 700010,200000 700000)))");
  assert.equal(describeGeometry(polygon).graphicArea,200);
});

test("evidence retains coordinates, queries neighbour designations and leaves missing terrain unknown",async()=>{
  const subject="POLYGON ((200000 700000,200020 700000,200020 700010,200000 700010,200000 700000))";
  const neighbor="POLYGON ((200020 700000,200030 700000,200030 700010,200020 700010,200020 700000))";
  const queries=[];
  const api={
    search:async({searchText})=>({results:[{text:searchText}]}),
    getSearchResultData:async({text})=>({geom:text.endsWith("91")?subject:neighbor}),
    getLayerFilterFields:async()=>[{name:"use_name",displayName:"ייעוד"}],
    getLayerFeaturesByLocation:async(query)=>{queries.push(query);return {layers:{[query.layers[0].name]:[{attributes:{use_name:query.geometry===neighbor?"מגורים":"מסחר"}}]}};},
    intersectFeatures:async()=>({data:[{Values:[11140,91]},{Values:[11140,92]}]}),
  };
  const result=await collectPlotEvidence(api,"token",{block:"11140",parcel:"91"},{x:200005,y:700005});
  assert.equal(result.parcelGeometry,subject);
  assert.equal(result.topography,null);
  assert.equal(result.neighbors.length,1);
  assert.equal(result.neighbors[0].borders[0].direction,"ממזרח");
  assert.ok(queries.some(q=>q.geometry===neighbor));
  assert.match(layerFacts(result.neighbors[0].layers[0])[0],/מגורים/);
  assert.equal(result.neighbors[0].geometry,neighbor);
});

test("unavailable optional layers do not discard parcel geometry",async()=>{
  const api={
    search:async()=>({results:[{text:"11140 / 91"}]}),
    getSearchResultData:async()=>({geom:"POLYGON ((200000 700000,200020 700000,200020 700010,200000 700010,200000 700000))"}),
    getLayerFilterFields:async()=>{throw new Error("Forbidden");},
    intersectFeatures:async()=>({data:[]}),
  };
  const result=await collectPlotEvidence(api,"token",{block:"11140",parcel:"91"},{x:200005,y:700005});
  assert.ok(result.geometryAnalysis);
  assert.ok(result.layers.every(l=>l.status==="unavailable"));
});

test("unsupported search geometry is retained for live-domain diagnostics",async()=>{
  const raw="MULTILINESTRING ((200000 700000,200020 700000))";
  let layerRequests=0;
  const result=await collectPlotEvidence({
    search:async()=>({results:[{id:"parcel|1",type:"parcel",text:"6158 / 1291"}]}),
    getSearchResultData:async()=>({geom:raw}),
    getLayerFilterFields:async()=>{layerRequests++;return [];},
  },"token",{block:"6158",parcel:"1291"},{x:200000,y:700000});
  assert.equal(result.geometryDiagnostics.rawGeometry,raw);
  assert.equal(result.geometryDiagnostics.format,"MULTILINESTRING");
  assert.equal(result.geometryDiagnostics.searchResult.type,"parcel");
  assert.equal(result.parcelGeometry,null);
  assert.equal(result.geometryAnalysis,null);
  assert.equal(layerRequests,0);
  assert.ok(result.warnings.some(w=>w.includes("לא בוצע")));
});
