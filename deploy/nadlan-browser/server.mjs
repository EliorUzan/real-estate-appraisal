import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { collectionRequest, collectWithBrowser } from './collector.mjs';

export function createCollectorServer({ token, collect }) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('NADLAN_BROWSER_TOKEN must contain at least 32 characters.');
  const hash = value => createHash('sha256').update(value).digest();
  const expected = hash(`Bearer ${token}`); let busy = false;
  return createServer(async (req, res) => {
    const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    if (req.method === 'GET' && req.url === '/health') return reply(200, { status: 'ok', service: 'nadlan-browser' });
    if (!timingSafeEqual(expected, hash(req.headers.authorization ?? ''))) return reply(401, { error: 'Unauthorized' });
    if (req.method !== 'POST' || req.url !== '/collect') return reply(404, { error: 'Not found' });
    if (busy) return reply(429, { error: 'Collector busy. Try again later.' });
    busy = true;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 4096) return reply(413, { error: 'Request too large' }); chunks.push(chunk); }
      let request;
      try { request = collectionRequest(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { return reply(400, { error: 'Invalid Nadlan address URL or page limit' }); }
      const result = await collect(request);
      return reply(200, result);
    } catch (error) {
      const code = ['NADLAN_ADDRESS_NOT_UNIQUE', 'NADLAN_SHARE_TIMEOUT', 'NADLAN_SHARE_INVALID', 'NADLAN_ACCESS_CHALLENGE', 'NADLAN_PAGE_TIMEOUT', 'NADLAN_LAYOUT_CHANGED', 'NADLAN_DATE_ORDER_CHANGED', 'NADLAN_RESULTS_CHANGED'].includes(error.message) ? error.message : 'NADLAN_COLLECTION_FAILED';
      return reply(502, { error: code }); // No raw page content, addresses or credentials in errors/logs.
    } finally { busy = false; }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import('playwright');
  const server = createCollectorServer({ token: process.env.NADLAN_BROWSER_TOKEN, collect: input => collectWithBrowser(input, chromium) });
  server.requestTimeout = 135_000; server.headersTimeout = 10_000;
  server.listen(Number(process.env.PORT ?? 8000), '0.0.0.0');
}
