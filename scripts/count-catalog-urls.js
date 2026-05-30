/** Быстрая проверка числа URL объявлений при обходе индексов. */
const axios = require('axios');
const { SYNC_SEED_INDEX_URLS } = require('../catalog-regions');

const BASE = 'https://housetenerife.eu';
const MAX = parseInt(process.env.SYNC_MAX_INDEX_PAGES, 10) || 200;

// minimal copy of sync index crawl
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function pathOnly(full) {
  try {
    return new URL(full).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return '/';
  }
}
function normalizeUrl(href) {
  if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.includes('whatsapp')) {
    return null;
  }
  let u = href.split('#')[0].trim();
  if (u.startsWith('/')) u = BASE + u;
  if (!u.startsWith('http') || !u.includes('housetenerife.eu')) return null;
  return u.replace(/\/+$/, '');
}
function isListingIndexUrl(full) {
  const p = pathOnly(full);
  if (p === '/ru' || p === '/') return true;
  return /^\/(?:ru\/)?(city|state|property-type|label|area)\/[^/]+(\/page\/\d+)?$/i.test(p);
}
function normalizePropertyUrl(full) {
  const p = pathOnly(full);
  if (/^\/(?:ru\/|es\/|en\/)?property\/[^/]+$/i.test(p)) return `${BASE}${p}/`;
  return null;
}
function registerProperty(map, full) {
  const url = normalizePropertyUrl(full);
  if (!url) return;
  const m = pathOnly(url).match(/\/property\/([^/]+)$/i);
  if (!m) return;
  const slug = m[1].toLowerCase();
  const prev = map.get(slug);
  if (!prev || (url.includes('/ru/') && !prev.includes('/ru/'))) map.set(slug, url);
}
function extractUrls(html) {
  const urls = new Set();
  const re = /href=["']([^"'#]+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const n = normalizeUrl(m[1]);
    if (n) urls.add(n);
  }
  return urls;
}

(async () => {
  const seen = new Set();
  const queued = new Set();
  const queue = [...new Set([`${BASE}/`, `${BASE}/ru/`, ...SYNC_SEED_INDEX_URLS])];
  const map = new Map();
  while (queue.length && seen.size < MAX) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const r = await axios.get(url, {
      headers: { 'User-Agent': 'HouseTenerifeBot/1.0' },
      validateStatus: () => true
    });
    if (r.status >= 400) continue;
    for (const u of extractUrls(r.data)) {
      if (!u.startsWith('http')) continue;
      registerProperty(map, u);
      if (isListingIndexUrl(u) && !seen.has(u) && !queued.has(u)) {
        queued.add(u);
        queue.push(u);
      }
    }
    await sleep(300);
  }
  const barcelona = [...map.values()].filter((u) => /barcelona|obama-1320/i.test(u));
  console.log('index pages:', seen.size, 'unique properties:', map.size);
  console.log('barcelona sample:', barcelona);
})();
