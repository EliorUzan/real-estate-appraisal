import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectionRequest, collectPages, toTsv } from '../deploy/nadlan-browser/collector.mjs';
import { createCollectorServer } from '../deploy/nadlan-browser/server.mjs';
import { parseTransactionImport } from '../supabase/functions/appraisal/transaction-import.ts';

const url = 'https://www.nadlan.gov.il/?view=address&id=72888186&page=deals';
const sale = ['כתובת בדיקה', '80', '01/07/2026', '2,000,000 ₪', '1-2-3', 'דירה', '4', 'ראשונה'];
const page = (n, patch = {}) => ({ page: n, rows: [[...sale.slice(0, 2), n === 1 ? '01/07/2026' : '01/06/2026', ...sale.slice(3)]], totalRows: 3, totalPages: 3, heading: 'עסקאות נוספות בשכונה בדיקה לפי רחובות', sourceAddress: 'נכס בדיקה', hasNext: true, ...patch });
function adapter(sequence) { let clock = 0, index = 0, clicks = 0;
  return { adapter: { read: async () => sequence[Math.min(index++, sequence.length - 1)], pause: async ms => { clock += ms; }, next: async () => { clicks++; } }, now: () => Date.parse('2026-09-28') + clock, clicks: () => clicks }; }

test('collector rejects unrelated URLs and limits', () => {
  assert.deepEqual(collectionRequest({ sourceUrl: url }), { sourceUrl: url, maxPages: 5 });
  for (const patch of [{ sourceUrl: 'https://127.0.0.1/' }, { sourceUrl: url.replace('view=address', 'view=settlement') }, { maxPages: 21 }, { maxPages: 1.5 }, { sourceUrl: url.replace('https:', 'http:') }, { sourceUrl: url.replace('https://', 'https://user:pass@') }]) assert.throws(() => collectionRequest({ sourceUrl: url, ...patch }));
});
test('pagination waits for row changes, captures second page, stops at limit and reports partial coverage', async () => {
  const state = adapter([page(1), page(1), page(2)]);
  const result = await collectPages(state.adapter, collectionRequest({ sourceUrl: url, maxPages: 2 }), { now: state.now });
  assert.equal(state.clicks(), 1); assert.equal(result.pagesCollected, 2); assert.equal(result.collectedRows, 2); assert.equal(result.complete, false);
  assert.equal(parseTransactionImport(result.table).rows.length, 2); assert.equal(result.neighborhood, 'בדיקה');
});
test('last page finishes without an extra click, empty source is explicit, exact duplicates deduplicate', async () => {
  const state = adapter([page(1, { hasNext: false, totalRows: 1, totalPages: 1, rows: [sale, sale] })]);
  const result = await collectPages(state.adapter, collectionRequest({ sourceUrl: url }), { now: state.now });
  assert.equal(result.complete, true); assert.equal(result.collectedRows, 1); assert.equal(state.clicks(), 0);
  const empty = adapter([page(1, { rows: [], totalRows: 0, totalPages: 1, hasNext: false })]);
  assert.equal((await collectPages(empty.adapter, collectionRequest({ sourceUrl: url }), { now: empty.now })).collectedRows, 0);
});
test('access challenge aborts even after a successful page; stale pages become explicit partial result', async () => {
  const blocked = adapter([page(1), { blocked: true }]);
  await assert.rejects(collectPages(blocked.adapter, collectionRequest({ sourceUrl: url }), { now: blocked.now }), /NADLAN_ACCESS_CHALLENGE/);
  const stale = adapter([page(1)]);
  const result = await collectPages(stale.adapter, collectionRequest({ sourceUrl: url }), { now: stale.now });
  assert.equal(result.stopReason, 'timeout'); assert.equal(result.complete, false); assert.equal(result.pagesCollected, 1);
});
test('changed results, malformed dates or ascending date order cannot be labeled latest transactions', async () => {
  for (const second of [page(2, { sourceAddress: 'wrong source' }), page(2, { rows: [[...sale.slice(0, 2), '01/08/2026', ...sale.slice(3)]] }), page(2, { rows: [[...sale.slice(0, 2), '30/02/2026', ...sale.slice(3)]] })]) {
    const state = adapter([page(1), second]); await assert.rejects(collectPages(state.adapter, collectionRequest({ sourceUrl: url }), { now: state.now }));
  }
  assert.equal(parseTransactionImport(toTsv([[...sale.slice(0, 1).map(() => 'הרא"ה 1'), ...sale.slice(1)]])).rows[0].address, 'הרא"ה 1');
});

test('HTTP collector requires bearer auth and serializes browser jobs', async t => {
  const token = 'secret-'.repeat(6); let finish;
  const server = createCollectorServer({ token, collect: async () => await new Promise(resolve => { finish = resolve; }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/collect', { method: 'POST' })).status, 401);
  const request = { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ sourceUrl: url }) };
  const first = fetch(base + '/collect', request);
  while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal((await fetch(base + '/collect', request)).status, 429);
  finish({ table: 'test' }); assert.equal((await first).status, 200);
  assert.equal((await fetch(base + '/collect', { ...request, body: 'x'.repeat(4097) })).status, 413);
  assert.equal((await fetch(base + '/collect', { ...request, body: '{}' })).status, 400);
});
