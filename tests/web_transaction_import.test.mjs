import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTransactionImport, nadlanSourceUrl } from '../supabase/functions/appraisal/transaction-import.ts';
import { analyzeImportedTransactions } from '../supabase/functions/appraisal/imported-transactions.ts';
import { collectNadlanTransactions, signCollection, verifyCollection } from '../supabase/functions/appraisal/nadlan-browser.ts';

const url = 'https://www.nadlan.gov.il/?view=address&id=72888186&page=deals';
const now = new Date('2026-09-28T12:00:00Z');
const table = 'כתובת\tשטח במ״ר\tתאריך העסקה\tמחיר העסקה\tחדרים\tקומה\tגוש/חלקה/תת-חלקה\nרחוב בדיקה 1\t80\t01/07/2026\t2,000,000 ₪\t4\tראשונה\t1-2-3\nרחוב בדיקה 2\t110\t01/06/2026\t3,000,000 ₪\t5\tשנייה\t1-2-4';
const input = { sourceUrl: url, table, query: { address: 'נכס בדיקה', area: 80, rooms: 4, description: 'קומה ראשונה עם חניה', limit: 10 } };
const options = { provider: 'gemini', model: 'configured-model', key: 'private' };
const token = 'test-secret-'.repeat(4);
const meta = { sourceUrl: url, sourceAddress: 'כתובת בדיקה', neighborhood: 'שכונת בדיקה', retrievedAt: now.toISOString(), pagesCollected: 1, totalRows: 20, collectedRows: 2, complete: false, warnings: ['רשימה חלקית'] };

test('share URL canonicalization rejects arbitrary hosts, protocols, credentials, IDs and paths', () => {
  assert.equal(nadlanSourceUrl(url + '&tracking=ignored#share'), url);
  for (const invalid of [url.replace('https:', 'http:'), url.replace('www.nadlan.gov.il', 'www.nadlan.gov.il.evil.test'), url.replace('https://', 'https://secret@'), url.replace('72888186', '../etc'), url.replace('/?', '/other?'), url.replace('page=deals', 'page=rent'), 'javascript:alert(1)']) assert.throws(() => nadlanSourceUrl(invalid));
});

test('Hebrew TSV preserves facts, strips bidi, sorts dates, deduplicates exact rows only', () => {
  const { rows, warnings } = parseTransactionImport(table + '\n' + table.split('\n')[1] + '\n' + table.split('\n')[1].replace('1-2-3', '1-2-5'));
  assert.equal(rows.length, 3); assert.equal(warnings.length, 1);
  assert.equal(rows[0].date, '2026-07-01'); assert.equal(rows[0].amount, 2000000);
  assert.equal(rows[0].floor, 'ראשונה'); assert.equal(rows[0].parcel, '1-2-3');
  assert.equal(parseTransactionImport(table.replace('ראשונה', '\u200eראשונה\u200f')).rows[0].floor, 'ראשונה');
  assert.equal(parseTransactionImport(table + '\n' + table.split('\n')[0]).rows.length, 2);
});

test('quoted CSV handles commas, escaped quotes, multiline fields and missing values', () => {
  const csv = '\uFEFFaddress,date,price,area,rooms,floor,parcel\r\n"הרא""ה 1, רמת גן",2026-07-01,"2,000,000",80,,0,1-2-3\r\n"רחוב\nשני",2026-06-01,1000000,לא ידוע,3,,1-2-4';
  const { rows } = parseTransactionImport(csv);
  assert.equal(rows[0].address, 'הרא"ה 1, רמת גן'); assert.equal(rows[0].floor, '0'); assert.equal(rows[0].rooms, null);
  assert.equal(rows[1].address, 'רחוב\nשני'); assert.equal(rows[1].area, null);
  const noAddress = parseTransactionImport('parcel;date;price\n1-2-3;2026-07-01;2000000');
  assert.equal(noAddress.rows[0].address, null);
});

test('malformed tables and ambiguous money fail rather than silently changing evidence', () => {
  for (const value of ['', 'address,date\na,2026-01-01', table.replace('01/07/2026', '30/02/2026'), table.replace('2,000,000 ₪', '2,00,000'), table.replace('2,000,000 ₪', '-2'), 'address,date,price\na,2026-01-01,2,000,000', 'address,date,price\n"unclosed,2026-01-01,200', table + '\textra', 'date,price,amount,address\n2026-01-01,2,2,a', 'x'.repeat(1_000_001)]) assert.throws(() => parseTransactionImport(value));
  assert.throws(() => parseTransactionImport('address,date,price\n' + 'a,2026-01-01,200\n'.repeat(501)));
});

const response = candidates => ({ selected: [{ id: candidates.at(-1).id, reason: 'השטח והקומה דורשים השוואה נוספת', descriptionScore: null, amount: 1, address: 'invented' }], keyPoints: [{ text: 'יש לבדוק נתוני חניה, שאינם בטבלה.', transactionIds: [candidates[0].id] }] });
test('AI chooses a subset; source facts survive model attempts to rewrite them', async () => {
  let calls = 0;
  const result = await analyzeImportedTransactions(input, options, { now, provider: async p => {
    calls++; assert.equal(p.model, options.model); assert.equal(p.key, options.key); assert.equal(p.search, false);
    const payload = JSON.parse(p.input); assert.equal(payload.subject.radiusMeters, undefined); assert.equal(payload.subject.dealType, undefined);
    return JSON.stringify(response(payload.candidates));
  } });
  assert.equal(calls, 1); assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].amount, 3000000); assert.equal(result.transactions[0].pricePerSqm, 27272.73);
  assert.equal(result.transactions[0].distanceMeters, null); assert.equal(result.transactions[0].parcel, '1-2-4');
  assert.equal(result.source, 'ייבוא משתמש / Nadlan'); assert.equal(result.query.scope, 'imported');
  assert.equal(result.keyPoints[0].transactionIds[0], 'import-1');
});

test('missing or invented IDs, duplicate selections and invalid model shapes are rejected', async () => {
  for (const change of [r => ({ ...r, selected: [{ ...r.selected[0], id: 'unknown' }] }), r => ({ ...r, selected: [r.selected[0], r.selected[0]] }), r => ({ ...r, selected: [{ ...r.selected[0], descriptionScore: 101 }] }), r => ({ ...r, keyPoints: [] }), r => ({ ...r, keyPoints: [{ text: 'unsafe', transactionIds: ['unknown'] }] }), r => ({ ...r, keyPoints: [{ text: 'unsafe', transactionIds: [] }] }), () => ({})]) {
    await assert.rejects(analyzeImportedTransactions(input, options, { now, provider: async p => JSON.stringify(change(response(JSON.parse(p.input).candidates))) }), e => e.status === 502);
  }
});

test('no rows in the date window means no paid AI call; unsupported radius/type rejected', async () => {
  const provider = async () => { throw new Error('Must not call AI'); };
  const result = await analyzeImportedTransactions({ ...input, query: { ...input.query, startDate: '2026-09-01' } }, options, { now, provider });
  assert.equal(result.transactions.length, 0); assert.equal(result.analyzedCount, 0); assert.equal(result.candidateCount, 0);
  for (const patch of [{ radiusMeters: 500 }, { dealType: 'new' }, { address: '' }]) await assert.rejects(analyzeImportedTransactions({ ...input, query: { ...input.query, ...patch } }, options, { now, provider }));
});

test('AI order is preserved even when numeric scores differ; explicit selection limit enforced', async () => {
  const provider = async p => { const candidates = JSON.parse(p.input).candidates;
    return JSON.stringify({ ...response(candidates), selected: candidates.reverse().map(c => ({ id: c.id, reason: 'הסבר', descriptionScore: null })) }); };
  const result = await analyzeImportedTransactions(input, options, { now, provider });
  assert.equal(result.transactions[0].id, 'import-2'); assert.equal(result.transactions[1].id, 'import-1');
  await assert.rejects(analyzeImportedTransactions({ ...input, query: { ...input.query, limit: 1 } }, options, { now, provider }));
});

test('collector proof binds exact data, URL, owner and expiry; forged provenance fails', async () => {
  const proof = await signCollection(meta, table, 'owner', token, now);
  assert.deepEqual(await verifyCollection(proof, table, url, 'owner', token, now), meta);
  for (const [t, u, o, secret, time] of [[table + '\n', url, 'owner', token, now], [table, url.replace('72888186', '123'), 'owner', token, now], [table, url, 'other', token, now], [table, url, 'owner', token + 'x', now], [table, url, 'owner', token, new Date(now.getTime() + 31 * 60_000)]]) await assert.rejects(verifyCollection(proof, t, u, o, secret, time));
  await assert.rejects(verifyCollection(proof.slice(0, -2) + '00', table, url, 'owner', token, now));
});

test('authenticated collector transport is bounded, canonicalized and signs returned table', async () => {
  const collected = await collectNadlanTransactions({ sourceUrl: url, maxPages: 2 }, 'owner', { endpoint: 'https://collector.example/collect', token }, async (endpoint, init) => {
    assert.equal(endpoint, 'https://collector.example/collect'); assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.deepEqual(JSON.parse(init.body), { sourceUrl: url, maxPages: 2 });
    return Response.json({ ...meta, table });
  }, now);
  const verified = await verifyCollection(collected.proof, table, url, 'owner', token, now);
  const result = await analyzeImportedTransactions(input, options, { now, collection: verified, provider: async p => JSON.stringify(response(JSON.parse(p.input).candidates)) });
  assert.equal(result.source, 'Nadlan / איסוף בדפדפן'); assert.equal(result.query.scope, 'neighborhood'); assert.equal(result.collection.pagesCollected, 1);
});

test('collector outages, oversized responses, stale or malformed data never produce a signed success', async () => {
  for (const fetcher of [async () => { throw new Error('private upstream details'); }, async () => new Response('private details', { status: 403 }), async () => Response.json({ ...meta, table, collectedRows: 7 }), async () => Response.json({ ...meta, table, retrievedAt: '2020-01-01' }), async () => new Response('x'.repeat(1_100_000))]) {
    await assert.rejects(collectNadlanTransactions({ sourceUrl: url }, 'owner', { endpoint: 'https://collector.example/collect', token }, fetcher, now), e => e.status === 502 && !e.message.includes('private'));
  }
});
