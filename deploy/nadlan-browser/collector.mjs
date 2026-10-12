import { normalizeAddress, resolveAddressInPage } from './address-resolver.mjs';

export function collectionRequest(input) {
  const maxPages = input?.maxPages ?? 5;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20) throw new Error('maxPages must be between 1 and 20.');
  if (!input?.sourceUrl) {
    if (typeof input?.address !== 'string' || !normalizeAddress(input.address) || input.address.length > 500) throw new Error('An address or share URL is required.');
    return { address: input.address.trim(), maxPages };
  }
  if (typeof input?.sourceUrl !== 'string' || input.sourceUrl.length > 2000) throw new Error('Invalid source URL.');
  const url = new URL(input.sourceUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'www.nadlan.gov.il' || url.port || url.username || url.password || url.pathname !== '/' ||
    url.searchParams.get('view') !== 'address' || !/^\d{1,15}$/.test(url.searchParams.get('id') ?? '') || url.searchParams.get('page') !== 'deals') throw new Error('Automatic collection requires a Nadlan address share link.');
  const sourceUrl = `https://www.nadlan.gov.il/?view=address&id=${url.searchParams.get('id')}&page=deals`;
  return { sourceUrl, maxPages };
}

// Read only rendered table data. Never inspect session storage, tokens, or application internals.
// Also usable with the in-app browser's read-only evaluate API for live verification.
export function readNeighborhoodPage() {
  const visible = e => !!e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
  const pageText = document.body.innerText;
  const challenged = /access denied|403 forbidden|verify you are human|unusual traffic|אינך רובוט/i.test(pageText) ||
    [...document.querySelectorAll('iframe[src*="/bframe"]')].some(visible) || new URL(location.href).searchParams.get('view') === 'login';
  if (challenged) return { blocked: true };
  const scope = document.querySelector('#streets')?.parentElement;
  const heading = scope?.querySelector('h2')?.textContent?.trim();
  const container = scope?.querySelector('.tableContainer');
  if (!heading?.startsWith('עסקאות נוספות בשכונה') || !container) return { pending: true };
  const tidy = s => (s ?? '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  const rows = [...container.querySelectorAll('tbody tr.mainTable__row')].map(tr => {
    const fields = Object.fromEntries([...tr.querySelectorAll('td[data-head]')].map(td => [td.getAttribute('data-head'), tidy(td.textContent)]));
    return [fields['כתובת'], fields['שטח במ"ר'], fields['תאריך עסקה'], fields['מחיר העסקה'], fields['תת-חלקה'], fields['סוג נכס'], fields['חדרים'], fields['קומה']].map(v => v ?? '');
  });
  const count = /נמצאו\s+([\d,]+)\s+עסקאות/.exec(container.querySelector('.tableSummary')?.textContent ?? '');
  const page = /^(\d+)\s*\/\s*(\d+)$/.exec(container.querySelector('.paginate')?.textContent?.trim() ?? '');
  const next = container.querySelector('button.nextBtn');
  return { rows, totalRows: count ? Number(count[1].replace(/,/g, '')) : null,
    page: page ? Number(page[1]) : null, totalPages: page ? Number(page[2]) : null,
    hasNext: visible(next) && !next.disabled, heading,
    sourceAddress: [...document.querySelectorAll('h1')].map(e => tidy(e.textContent)).find(t => t.startsWith('עסקאות בכתובת'))?.replace(/^עסקאות בכתובת\s*/, '') ?? '' };
}

const HEADERS = ['כתובת', 'שטח במ״ר', 'תאריך העסקה', 'מחיר העסקה', 'גוש/חלקה/תת-חלקה', 'סוג נכס', 'חדרים', 'קומה'];
export function toTsv(rows) {
  const quote = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [HEADERS, ...rows].map(r => r.map(quote).join('\t')).join('\n');
}

/** Bounded state machine: wait for changed page number AND rows before accepting a page. */
export async function collectPages(adapter, request, { now = () => Date.now(), budgetMs = 65_000 } = {}) {
  const started = now(), collected = [], warnings = [], fingerprints = new Set();
  let lastPage = 0, previousFingerprint = '', lastDate = '9999', metadata, stopReason = 'limit';
  async function waitPage(expected) {
    const until = Math.min(started + budgetMs, now() + (expected === 1 ? 35_000 : 12_000));
    while (now() < until) {
      const snap = await adapter.read();
      if (snap.blocked) throw new Error('NADLAN_ACCESS_CHALLENGE');
      if (!snap.pending && snap.page === expected && (snap.rows.length || snap.totalRows === 0) && JSON.stringify(snap.rows) !== previousFingerprint) return snap;
      await adapter.pause(300);
    }
    throw new Error('NADLAN_PAGE_TIMEOUT');
  }
  while (lastPage < request.maxPages && now() - started < budgetMs) {
    let snap;
    try { snap = await waitPage(lastPage + 1); }
    catch (error) {
      if (!lastPage || error.message === 'NADLAN_ACCESS_CHALLENGE') throw error;
      stopReason = 'timeout'; warnings.push('האיסוף נעצר לפני טעינת העמוד הבא. מוצגות רק עסקאות מעמודים שנקראו במלואם.'); break;
    }
    if (!snap.sourceAddress || !Number.isInteger(snap.totalRows) || !Number.isInteger(snap.totalPages)) throw new Error('NADLAN_LAYOUT_CHANGED');
    if (metadata && (metadata.heading !== snap.heading || metadata.sourceAddress !== snap.sourceAddress || metadata.totalRows !== snap.totalRows)) throw new Error('NADLAN_RESULTS_CHANGED');
    metadata = snap;
    if (snap.rows.length > 100) throw new Error('NADLAN_LAYOUT_CHANGED');
    // Fail closed on changed columns/date order: never present an arbitrary page as the latest sales.
    if (snap.rows.length) {
      for (const row of snap.rows) {
        const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(row[2]);
        const date = match ? `${match[3]}-${match[2]}-${match[1]}` : '';
        if (!date || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('NADLAN_LAYOUT_CHANGED');
        if (date > lastDate) throw new Error('NADLAN_DATE_ORDER_CHANGED');
        lastDate = date;
      }
    }
    for (const row of snap.rows) {
      const id = JSON.stringify(row);
      if (!fingerprints.has(id)) { fingerprints.add(id); collected.push(row); }
    }
    lastPage = snap.page; previousFingerprint = JSON.stringify(snap.rows);
    if (!snap.hasNext) { stopReason = 'end'; break; }
    if (collected.length >= 500) { stopReason = 'limit'; break; }
    if (lastPage < request.maxPages) {
      await adapter.pause(750);
      try { await adapter.next(); } catch { stopReason = 'pagination'; warnings.push('המעבר לעמוד הבא נכשל; האיסוף חלקי.'); break; }
    }
  }
  if (!metadata) throw new Error('NADLAN_PAGE_TIMEOUT');
  const complete = stopReason === 'end';
  if (!complete) warnings.push(`נאספו ${lastPage} עמודים בלבד מתוך ${metadata.totalPages}; זו רשימה חלקית של העסקאות האחרונות.`);
  return { sourceUrl: request.sourceUrl, table: toTsv(collected.slice(0, 500)), sourceAddress: metadata.sourceAddress,
    neighborhood: metadata.heading.replace(/^עסקאות נוספות בשכונה\s*/, '').replace(/\s*לפי רחובות$/, ''),
    retrievedAt: new Date(now()).toISOString(), pagesCollected: lastPage, totalRows: metadata.totalRows,
    collectedRows: Math.min(collected.length, 500), complete, stopReason, warnings };
}

export async function collectWithBrowser(input, chromium) {
  const request = collectionRequest(input);
  chromium ??= (await import('playwright')).chromium;
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  let timer;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'he-IL', acceptDownloads: false });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    let receiveShare;
    // Capture and abort the share navigation: no WhatsApp page or message is sent.
    await context.route('**/*', route => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.isNavigationRequest() && ['api.whatsapp.com', 'wa.me'].includes(url.hostname)) {
        receiveShare?.(req.url()); return route.abort();
      }
      if (req.isNavigationRequest() && req.frame().parentFrame() === null &&
        (url.origin !== 'https://www.nadlan.gov.il' || url.pathname !== '/' || ![null, 'address'].includes(url.searchParams.get('view')))) return route.abort();
      return route.continue();
    });
    timer = setTimeout(() => { void browser.close().catch(() => {}); }, 125_000);
    if (!request.sourceUrl) {
      await page.goto('https://www.nadlan.gov.il/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      request.sourceUrl = await resolveAddressInPage(page, request.address, async click => {
        let shareTimer;
        const shared = new Promise((resolve, reject) => {
          receiveShare = resolve;
          shareTimer = setTimeout(() => reject(new Error('NADLAN_SHARE_TIMEOUT')), 10_000);
        });
        try { const [url] = await Promise.all([shared, click()]); return url; }
        finally { clearTimeout(shareTimer); receiveShare = undefined; }
      });
    }
    await page.goto(request.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const result = await collectPages({
      read: () => page.evaluate(readNeighborhoodPage),
      next: () => page.locator('#streets').locator('..').locator('.tableContainer button.nextBtn').click(),
      pause: ms => new Promise(resolve => setTimeout(resolve, ms)),
    }, request);
    if (request.address && normalizeAddress(result.sourceAddress) !== normalizeAddress(request.address)) throw new Error('NADLAN_ADDRESS_NOT_UNIQUE');
    return result;
  } finally { clearTimeout(timer); await browser.close(); }
}
