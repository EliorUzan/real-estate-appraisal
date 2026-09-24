import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlotParcels, positiveArea, renderPlotDescription } from "../web/src/lib/plot-description.ts";

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
