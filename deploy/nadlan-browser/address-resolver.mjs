// Browser tool policy: select only an exact, unique address suggestion and obtain
// its identifier from the site's share action, never from an assumed URL change.
export const normalizeAddress = value => String(value ?? '').normalize('NFKC')
  .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
  .replace(/[,\-־"'״׳]/g, ' ').replace(/\s+/g, ' ').trim();

export function chooseAddress(address, suggestions) {
  const wanted = normalizeAddress(address);
  const matches = suggestions.filter(s => /\sכתובת$/.test(s.trim()) &&
    normalizeAddress(s.replace(/\sכתובת$/, '')) === wanted);
  if (matches.length !== 1) throw new Error('NADLAN_ADDRESS_NOT_UNIQUE');
  return matches[0];
}

export function shareSourceUrl(value) {
  const share = new URL(value);
  if (share.protocol !== 'https:' || !['api.whatsapp.com', 'wa.me'].includes(share.hostname) || share.username || share.password || share.port) throw new Error('NADLAN_SHARE_INVALID');
  const links = (share.searchParams.get('text') ?? '').match(/https:\/\/www\.nadlan\.gov\.il\/\?[^\s]+/g) ?? [];
  if (links.length !== 1) throw new Error('NADLAN_SHARE_INVALID');
  const url = new URL(links[0]);
  if (url.searchParams.get('view') !== 'address' || !/^\d{1,15}$/.test(url.searchParams.get('id') ?? '') || url.searchParams.get('page') !== 'deals') throw new Error('NADLAN_SHARE_INVALID');
  return `https://www.nadlan.gov.il/?view=address&id=${url.searchParams.get('id')}&page=deals`;
}

export async function resolveAddressInPage(page, address, captureShare) {
  await page.getByRole('textbox', { name: 'הקלד כתובת / שם רחוב / שם ישוב' }).fill(normalizeAddress(address));
  const options = page.getByRole('option');
  await options.first().waitFor({ state: 'visible', timeout: 12_000 });
  const choice = chooseAddress(address, await options.allInnerTexts());
  await page.getByRole('option', { name: choice.replace(/\s+/g, ' ').trim(), exact: true }).click();
  await page.getByRole('heading', { level: 1, name: /^עסקאות בכתובת/ }).waitFor({ state: 'visible', timeout: 20_000 });
  const sourceAddress = (await page.getByRole('heading', { level: 1 }).innerText()).replace(/^עסקאות בכתובת\s*/, '');
  if (normalizeAddress(sourceAddress) !== normalizeAddress(address)) throw new Error('NADLAN_ADDRESS_NOT_UNIQUE');
  await page.getByRole('button', { name: 'שיתוף', exact: true }).click();
  return shareSourceUrl(await captureShare(() => page.locator('button[aria-label="whatsapp"]:visible').click()));
}
