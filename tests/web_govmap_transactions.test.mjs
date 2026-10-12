import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectGovMapTransactions } from '../web/src/lib/govmap-transactions.ts';
import { transactionPoint, transactionRows } from '../supabase/functions/appraisal/govmap-transactions.ts';
import { prepareDirectTransactionSearch, compareDirectTransactions } from '../supabase/functions/appraisal/nearby-transactions.ts';

const now = new Date('2026-09-27T10:00:00Z');
const query = { address: 'דיזנגוף 50 תל אביב', area: 100, rooms: 4, radiusMeters: 500, startDate: '2025-01-01', endDate: '2026-09-27' };
const sale = { dealAmount: 3000000, dealDate: '2026-09-01', assetArea: 100, assetRoomNum: 4, streetName: 'דיזנגוף', houseNumber: 50, settlementNameHeb: 'תל אביב', shape: 'POINT(180000 660000)' };
const options = { provider: 'gemini', model: 'chosen-model', key: 'test-key' };
const evidence = rows => ({ source: 'GovMap browser', address: query.address, point: { x: 180000, y: 660000 }, retrievedAt: now.toISOString(), rows, warnings: [] });
const collector = { address: query.address, point: { x: 180000, y: 660000, approximate: false }, radius: 500, token: 'domain-token', api: { getLayerFilterFields: async () => [] }, pause: async () => {} };
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

test('collector separates polygon discovery from sales and never leaks the SDK token to internal endpoints', async () => {
  const calls = [];
  const result = await collectGovMapTransactions({ ...collector, fetcher: async (url, init) => {
    calls.push({ url, init });
    return json(calls.length === 1 ? [{ polygon_id: 'a/b' }, { polygon_id: 'a/b' }] : { data: [sale, sale], totalCount: 200 });
  } });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith('/deals/180000,660000/500'));
  assert.ok(calls[1].url.endsWith('/street-deals/a%2Fb?limit=100'));
  assert.ok(!JSON.stringify(calls).includes('domain-token'));
  assert.ok(!calls[1].url.includes('dealType'));
  assert.equal(result.rows.length, 1);
  assert.ok(result.warnings.some(w => w.includes('עמוד חלקי')));
});

test('token-aware SDK sales avoid the internal endpoint fallback', async () => {
  const result = await collectGovMapTransactions({ ...collector, api: {
    getLayerFilterFields: async (_, token) => { assert.equal(token, 'domain-token'); return { data: [{ name: 'dealAmount' }, { name: 'dealDate' }] }; },
    getLayerFeaturesByLocation: async (_, token) => { assert.equal(token, 'domain-token'); return { data: { layers: { nadlan: [sale] } } }; },
  }, fetcher: async () => { throw new Error('unexpected fallback'); } });
  assert.deepEqual(result.rows, [sale]);
});

test('access failures identify the blocked stage and SDK outcome without leaking request secrets', async () => {
  const api = { getLayerFilterFields: async () => { throw Object.assign(new Error('url?apiToken=PRIVATE'), { response: { status: 403 } }); } };
  await assert.rejects(collectGovMapTransactions({ ...collector, api, fetcher: async () => new Response('', { status: 403 }) }), error => {
    assert.match(error.message, /איתור הפוליגונים/);
    assert.match(error.message, /SDK.*403/);
    assert.match(error.message, /reCAPTCHA/);
    assert.ok(!error.message.includes('PRIVATE'));
    return true;
  });
  let calls = 0;
  await assert.rejects(collectGovMapTransactions({ ...collector, fetcher: async () => ++calls === 1 ? json([{ polygon_id: 1 }]) : new Response('', { status: 403 }) }), /אחזור רשומות המכר/);
  assert.equal(calls, 2);
});

test('403, CORS, non-JSON, metadata-only rows and approximate locations fail explicitly', async () => {
  let calls = 0;
  await assert.rejects(collectGovMapTransactions({ ...collector, fetcher: async () => { calls++; return new Response('', { status: 403 }); } }), /403/);
  assert.equal(calls, 1);
  await assert.rejects(collectGovMapTransactions({ ...collector, fetcher: async () => { throw new TypeError('Failed to fetch'); } }), /CORS/);
  await assert.rejects(collectGovMapTransactions({ ...collector, fetcher: async () => new Response('<html>blocked</html>') }), /JSON/);
  assert.throws(() => transactionRows({ data: [{ polygon_id: 1, dealscount: 10 }] }));
  assert.throws(() => transactionRows({ status: 2, data: [] }));
  await assert.rejects(collectGovMapTransactions({ ...collector, point: { ...collector.point, approximate: true } }));
});

test('geometry parser accepts 2D ITM only and rejects malformed or other-coordinate shapes', () => {
  assert.deepEqual(transactionPoint(sale.shape), { x: 180000, y: 660000 });
  assert.deepEqual(transactionPoint('POLYGON((180000 660000,180020 660000,180020 660020,180000 660000))'), { x: 180010, y: 660010 });
  for (const shape of ['POINT(34.8 32.1)', 'POINT(3800000 3800000)', 'POLYGON((180000 660000 1,180020 660000 1,180020 660020 1,180000 660000 1))', 'POLYGON((180000 660000,180020 660000,180020 660020,180000 660000)) junk']) assert.equal(transactionPoint(shape), null);
});

test('direct comparison uses each sale geometry, hard filters and immutable source facts', async () => {
  let calls = 0;
  const result = await compareDirectTransactions(query, evidence([
    sale, { ...sale, shape: 'POINT(181000 660000)', distance_meters: 0, deal_source: 'same_building' },
    { ...sale, shape: null }, { ...sale, dealAmount: 0 }, { ...sale, dealDate: '2024-01-01' },
  ]), options, { now, provider: async request => {
    calls++; assert.equal(request.model, options.model); assert.equal(request.search, false);
    const { candidates } = JSON.parse(request.input);
    assert.equal(candidates.length, 1);
    return JSON.stringify({ assessments: candidates.map(c => ({ id: c.id, descriptionScore: null, reason: 'שטח וחדרים תואמים', amount: 1, address: 'invented' })) });
  } });
  assert.equal(calls, 1); assert.equal(result.transactions[0].amount, 3000000);
  assert.equal(result.transactions[0].pricePerSqm, 30000); assert.equal(result.transactions[0].distanceMeters, 0);
  assert.ok(result.source.includes('GovMap')); assert.ok(!result.source.includes('MCP'));
  assert.ok(result.warnings.some(w => w.includes('EPSG:2039')));
});

test('empty results, unknown sale type, stale evidence and metadata never trigger comparison AI', async () => {
  const deps = { now, provider: async () => { throw new Error('AI must not run'); } };
  for (const rows of [[], [{ ...sale, shape: null }]]) {
    assert.equal((await compareDirectTransactions(query, evidence(rows), options, deps)).transactions.length, 0);
  }
  assert.equal((await compareDirectTransactions({ ...query, dealType: 'new' }, evidence([sale]), options, deps)).transactions.length, 0);
  await assert.rejects(compareDirectTransactions(query, { ...evidence([sale]), retrievedAt: '2020-01-01' }, options, deps));
  await assert.rejects(compareDirectTransactions(query, evidence([{ polygon_id: 1 }]), options, deps));
  await assert.rejects(compareDirectTransactions(query, { ...evidence([sale]), address: 'other' }, options, deps));
});

test('structured search needs no planning AI; free text uses the selected model and explicit fields win', async () => {
  const prepared = await prepareDirectTransactionSearch(query, options, { now, provider: async () => { throw new Error('unnecessary AI'); } });
  assert.equal(prepared.address, query.address);
  const planned = await prepareDirectTransactionSearch({ ...query, description: 'דירה עם מרפסת' }, options, { now, provider: async request => {
    assert.equal(request.model, options.model); return JSON.stringify({ rooms: 6, area: 200 });
  } });
  assert.equal(planned.rooms, 4); assert.equal(planned.area, 100);
});
