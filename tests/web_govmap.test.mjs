import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocation, parseParcels, withTimeout } from "../web/src/lib/govmap.ts";

test("maps a unique exact match in supported GovMap envelopes", () => {
  const point = { ResultCode: 1, X: 180645.2, Y: 667120.4 };
  const expected = { x: point.X, y: point.Y, approximate: false };
  for (const response of [point, { data: point }, { data: [point], status: 0 }, { ResultCode: 1, data: [{ X: point.X, Y: point.Y }] }]) {
    assert.deepEqual(parseLocation(response), expected);
  }
});

test("does not choose a candidate for ambiguous, absent, or malformed locations", () => {
  for (const response of [null, {}, { data: [] }, { ResultCode: 3, X: 1, Y: 2 },
    { data: [{ ResultCode: 1, X: 1, Y: 2 }, { ResultCode: 1, X: 3, Y: 4 }] },
    { ResultCode: 1, X: null, Y: 2 }, { ResultCode: 1, X: 0, Y: 2 },
    { ResultCode: 1, X: NaN, Y: 2 }, { ResultCode: 1, X: 1, Y: Infinity }]) {
    assert.equal(parseLocation(response), null);
  }
  assert.throws(() => parseLocation({ errorCode: 403, data: [{ ResultCode: 1, X: 1, Y: 2 }] }));
});

test("partial address matches are explicitly marked approximate", () => {
  assert.deepEqual(parseLocation({ ResultCode: 2, X: 180645, Y: 667120 }), { x: 180645, y: 667120, approximate: true });
});

test("current SDK results select the unique complete requested address, not the first suggestion", () => {
  const exact = { ResultType: 1, ResultLable: "התחייה 2, חדרה", streetName: "התחייה",
    houseNumber: 2, settlementName: "חדרה", X: 192000, Y: 705000 };
  const other = { ...exact, ResultLable: "התחייה 20, חדרה", houseNumber: 20, X: 192010 };
  assert.deepEqual(parseLocation({ status: 0, errorCode: 0, data: [other, exact] }, "חדרה, התחייה 2"),
    { x: exact.X, y: exact.Y, approximate: false, label: exact.ResultLable });
  assert.equal(parseLocation({ data: [other, exact] }, "התחייה, חדרה"), null);
  assert.equal(parseLocation({ data: [exact, { ...exact, X: 192001 }] }, exact.ResultLable), null);
});

test("current SDK ResultType does not establish accuracy for incomplete or mismatched addresses", () => {
  const street = { ResultType: 1, ResultLable: "התחייה, חדרה", streetName: "התחייה",
    settlementName: "חדרה", X: 192000, Y: 705000 };
  assert.equal(parseLocation({ data: [street] }, street.ResultLable)?.approximate, true);
  assert.equal(parseLocation({ data: [{ ...street, houseNumber: 2 }] }, "התחייה 99, חדרה")?.approximate, true);
  assert.equal(parseLocation({ status: 1, errorCode: 0, data: null }, "כתובת חסרה"), null);
  assert.deepEqual(parseParcels({ status: 1, errorCode: 0, data: null }), []);
});

test("current ADDR index matches remain exact when optional address components are absent", () => {
  // Current public SDK shape for the sample address; ResultCode and optional
  // house/street/settlement fields are absent from this index.
  const address = { DescLayerID: "ADDR", ResultLable: "התחייה 2 חדרה", ResultType: 1,
    X: 191400.23, Y: 705819.42 };
  assert.deepEqual(parseLocation({ status: 0, errorCode: 0, data: [address] }, "התחייה 2, חדרה"),
    { x: address.X, y: address.Y, approximate: false, label: address.ResultLable });
  assert.equal(parseLocation({ data: [address] }, "התחייה 20 חדרה")?.approximate, true);
  assert.equal(parseLocation({ data: [{ ...address, DescLayerID: "STREET" }] }, address.ResultLable)?.approximate, true);
});

test("retains all intersecting parcels, deduplicates, and handles empty results", () => {
  assert.deepEqual(parseParcels({ status: 0, errorCode: 0, data: [
    { ObjectId: 1, Values: [7103, 90] }, { ObjectId: 2, Values: [7103, 92] }, { ObjectId: 3, Values: ["7103", "90"] },
  ] }), [{ block: "7103", parcel: "90" }, { block: "7103", parcel: "92" }]);
  assert.deepEqual(parseParcels({ data: [] }), []);
});

test("service errors and invalid parcel fields cannot look like valid land identifiers", () => {
  for (const response of [{ errorCode: 1, data: [] }, { status: 403, data: [] }, {},
    { data: [{ Values: ["street", "city", 32] }] }, { data: [{ Values: [null, 1] }] },
    { data: [{ Values: [1] }] }, { data: [{ Values: [1, -1] }] }]) assert.throws(() => parseParcels(response));
});

test("unresponsive SDK calls terminate and rejected calls propagate", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 10), /timed out/);
  assert.equal(await withTimeout(Promise.resolve("ready"), 100), "ready");
  await assert.rejects(withTimeout(Promise.reject(new Error("denied")), 100), /denied/);
});
