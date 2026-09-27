import { test } from "node:test";
import assert from "node:assert/strict";
import { NadlanMcp } from "../supabase/functions/appraisal/nadlan-mcp.ts";
import { findNearbyTransactions, normalizeTransactions, resolveQuery, scoreTransaction, validateTransactionInput } from "../supabase/functions/appraisal/nearby-transactions.ts";

const now = new Date("2026-09-27T10:00:00Z");
const input = { address: "דיזנגוף 50 תל אביב", rooms: 4, area: 100, startDate: "2025-01-01", endDate: "2026-09-27", radiusMeters: 500, limit: 20 };
const query = resolveQuery(input, {}, now);
const row = { street_name: "דיזנגוף", house_number: "50", settlement_name_heb: "תל אביב", deal_date: "2026-09-27", deal_amount: 3000000, asset_area: 100, rooms: 4, distance_meters: 0, deal_source: "same_building" };
const options = { provider: "gemini", model: "selected-model", key: "private", endpoint: "https://nadlan.example/mcp" };

test("optional attributes and free text are supported; explicit fields win over model guesses", () => {
  assert.doesNotThrow(() => validateTransactionInput({ description: "דירה בירושלים" }));
  const q = resolveQuery({ description: "4 חדרים בתל אביב", rooms: 3 }, { address: "תל אביב", rooms: 4 }, now);
  assert.equal(q.rooms, 3); assert.equal(q.area, null); assert.equal(q.radiusMeters, 500); assert.equal(q.startDate, "2024-09-27");
  assert.throws(() => validateTransactionInput({ rooms: 4 }));
  for (const patch of [{ area: 0 }, { area: true }, { rooms: -1 }, { radiusMeters: 5001 }, { startDate: "2026-02-30" }, { endDate: "2024-01-01" }]) {
    assert.throws(() => resolveQuery({ ...input, ...patch }, {}, now));
  }
  assert.throws(() => resolveQuery(input, { dealType: "invented" }, now));
  assert.throws(() => resolveQuery({ ...input, endDate: "2027-01-01" }, {}, now));
});

test("source fields, exact date/radius filters, deduplication and computed price per sqm", () => {
  const rows = normalizeTransactions([row, row, { ...row, deal_date: "2024-12-31" }, { ...row, deal_date: null }, { ...row, deal_date: "2026-09-28" }, { ...row, deal_source: "street", distance_meters: 501 }], query);
  assert.equal(rows.length, 1); assert.equal(rows[0].address, "דיזנגוף 50 תל אביב"); assert.equal(rows[0].pricePerSqm, 30000);
  assert.equal(normalizeTransactions([{ ...row, asset_area: 0, price_per_sqm: 999999 }], query)[0].pricePerSqm, null);
  const aliased = normalizeTransactions([{ address: "source address", dealDate: "2025-01-01", dealAmount: "1,500,000", assetArea: 50, assetRoomNum: 2 }], query)[0];
  assert.equal(aliased.amount, 1500000); assert.equal(aliased.rooms, 2); assert.equal(aliased.area, 50);
});

test("similarity differentiates comparable properties and exposes missing evidence", () => {
  const t = normalizeTransactions([row], query)[0];
  const same = scoreTransaction(t, query);
  assert.equal(same.similarity, 100); assert.equal(same.coverage, 100);
  assert.ok(scoreTransaction({ ...t, area: 200, rooms: 2, distanceMeters: 450, sourceKind: "street" }, query).similarity < same.similarity);
  const missing = scoreTransaction({ ...t, area: null, rooms: null, distanceMeters: null, sourceKind: "" }, query);
  assert.equal(missing.similarity, 100); assert.equal(missing.coverage, 15); assert.equal(missing.missing.length, 3);
  const described = { ...query, description: "עם חניה" };
  assert.equal(scoreTransaction(t, described, null).coverage, 83);
  assert.equal(scoreTransaction(t, described, 0).similarity, 83);
});

function mockMcp() {
  const calls = [];
  return { calls, connect: async () => calls.push("connect"), deals: async args => { calls.push(args); return [row]; }, close: async () => calls.push("close") };
}
function mockProvider(transform = x => x) {
  const calls = [];
  const provider = async p => {
    calls.push(p); assert.equal(p.model, options.model); assert.equal(p.search, false);
    if (calls.length === 1) return JSON.stringify({});
    const { candidates } = JSON.parse(p.input);
    return JSON.stringify({ assessments: transform(candidates.map(t => ({ id: t.id, descriptionScore: null, reason: "אותו בניין, שטח וחדרים תואמים", amount: 1, address: "invented" }))) });
  };
  return { calls, provider };
}

test("full pipeline always calls MCP and preserves facts despite model attempts to change them", async () => {
  const mcp = mockMcp(), ai = mockProvider();
  const result = await findNearbyTransactions(input, options, { mcp, provider: ai.provider, now });
  assert.equal(mcp.calls[0], "connect"); assert.equal(mcp.calls.at(-1), "close");
  assert.deepEqual(mcp.calls.filter(x => typeof x === "object").map(x => x.deal_type), [1, 2]);
  assert.equal(result.transactions.length, 1); assert.equal(result.transactions[0].amount, row.deal_amount);
  assert.equal(result.transactions[0].address, "דיזנגוף 50 תל אביב"); assert.equal(result.source, "Nadlan MCP / GovMap"); assert.equal(ai.calls.length, 2);
});

test("MCP configuration, outage, tool failure and empty results cannot fall back to invented data", async () => {
  let paidCalls = 0;
  await assert.rejects(findNearbyTransactions(input, { ...options, endpoint: "" }, { provider: async () => { paidCalls++; return "{}"; } }));
  const mcp = mockMcp(); mcp.connect = async () => { throw new Error("offline"); };
  await assert.rejects(findNearbyTransactions(input, options, { mcp, provider: async () => { paidCalls++; return "{}"; }, now }));
  assert.equal(paidCalls, 0); assert.equal(mcp.calls.at(-1), "close");
  const broken = mockMcp(); broken.deals = async () => { throw new Error("MCP failed"); };
  const ai = mockProvider();
  await assert.rejects(findNearbyTransactions(input, options, { mcp: broken, provider: ai.provider, now }));
  assert.equal(ai.calls.length, 1);
  const empty = mockMcp(); empty.deals = async () => [];
  const noRows = mockProvider(); const result = await findNearbyTransactions(input, options, { mcp: empty, provider: noRows.provider, now });
  assert.deepEqual(result.transactions, []); assert.equal(noRows.calls.length, 1);
});

test("unknown, duplicate, missing IDs and invalid scores in AI output are rejected", async () => {
  for (const transform of [a => [{ ...a[0], id: "invented" }], () => [], a => [a[0], a[0]], a => [{ ...a[0], descriptionScore: 101 }]]) {
    await assert.rejects(findNearbyTransactions(input, options, { mcp: mockMcp(), provider: mockProvider(transform).provider, now }));
  }
});

function transport({ sse = false, payload = { deals: [row] }, toolError = false, structured = false } = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    assert.equal(url, options.endpoint); assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, "Bearer secret");
    if (init.method === "DELETE") { calls.push("DELETE"); return new Response(null, { status: 204 }); }
    const req = JSON.parse(init.body); calls.push(req.method);
    if (req.method !== "initialize") assert.equal(init.headers["Mcp-Session-Id"], "session-123");
    if (req.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result = req.method === "initialize" ? { protocolVersion: "2025-03-26" }
      : req.method === "tools/list" ? { tools: [{ name: "find_recent_deals_for_address" }] }
      : { isError: toolError, ...(structured ? { structuredContent: { result: typeof payload === "string" ? payload : JSON.stringify(payload) } } : { content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload) }] }) };
    const msg = JSON.stringify({ jsonrpc: "2.0", id: req.id, result });
    return new Response(sse ? `: ping\r\n\r\nevent: message\r\ndata: ${msg}\r\n\r\n` : msg,
      { headers: { "content-type": sse ? "text/event-stream" : "application/json", "Mcp-Session-Id": "session-123" } });
  };
  return { calls, fetcher };
}

for (const config of [{}, { sse: true }, { structured: true }]) test(`MCP initializes, discovers and invokes required tool (${JSON.stringify(config)})`, async () => {
  const t = transport(config), client = new NadlanMcp(options.endpoint, "secret", t.fetcher);
  await client.connect(); assert.deepEqual(await client.deals({ address: input.address }), [row]); await client.close();
  assert.deepEqual(t.calls, ["initialize", "notifications/initialized", "tools/list", "tools/call", "DELETE"]);
});

test("MCP text errors and malformed metadata are failures; upstream empty text is legitimate", async () => {
  for (const payload of ["Error analyzing address: private data", { polygons: [] }, "invalid JSON"]) {
    const t = transport({ payload }), client = new NadlanMcp(options.endpoint, "secret", t.fetcher);
    await client.connect(); await assert.rejects(client.deals({}), e => !e.message.includes("private data"));
  }
  const t = transport({ payload: "No second hand (used) deals found for address 'test'" }), client = new NadlanMcp(options.endpoint, "secret", t.fetcher);
  await client.connect(); assert.deepEqual(await client.deals({}), []);
  assert.throws(() => new NadlanMcp("http://untrusted.example/mcp"));
});

test("GovMap access refusal is distinguished from MCP connection failure without leaking source text", async () => {
  for (const structured of [false, true]) {
    const t = transport({ structured, payload: "Error finding deals: 403 Client Error: Forbidden for url: https://www.govmap.gov.il/api/search-service/autocomplete?private-data" });
    const client = new NadlanMcp(options.endpoint, "secret", t.fetcher);
    await client.connect();
    await assert.rejects(client.deals({}), e => e.status === 502 && e.message.includes("GovMap") && e.message.includes("403") && !e.message.includes("private-data"));
  }
});
