/**
 * Обход страниц каталога housetenerife.eu/ru/ и сохранение объявлений в data/properties.json
 * Уважает robots Crawl-delay — пауза между запросами (по умолчанию 2 с).
 */
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE = 'https://housetenerife.eu';
const USER_AGENT = 'HouseTenerifeBot/1.0 (property catalog sync; contact agency)';
const DELAY_MS = parseInt(process.env.SYNC_DELAY_MS, 10) || 2000;
const MAX_INDEX_PAGES = parseInt(process.env.SYNC_MAX_INDEX_PAGES, 10) || 600;
const MAX_PROPERTIES = parseInt(process.env.SYNC_MAX_PROPERTIES, 10) || 2200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeUrl(href) {
  if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.includes('api.whatsapp')) {
    return null;
  }
  let u = href.split('#')[0].trim();
  if (u.startsWith('//')) u = 'https:' + u;
  if (u.startsWith('/')) u = BASE + u;
  if (!u.startsWith('http')) return null;
  if (!u.startsWith(BASE)) return null;
  u = u.replace(/\/+$/, '');
  if (u.endsWith('/feed')) return null;
  return u;
}

function pathOnly(full) {
  try {
    return new URL(full).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return '/';
  }
}

function isListingIndexUrl(full) {
  const p = pathOnly(full);
  if (p === '/ru') return true;
  if (/^\/ru\/city\/[^/]+(\/page\/\d+)?$/.test(p)) return true;
  if (/^\/ru\/property-type\/[^/]+(\/page\/\d+)?$/.test(p)) return true;
  if (/^\/ru\/state\/[^/]+(\/page\/\d+)?$/.test(p)) return true;
  if (/^\/ru\/label\/[^/]+(\/page\/\d+)?$/.test(p)) return true;
  return false;
}

function isPropertyUrl(full) {
  return /^\/ru\/property\/[^/]+$/.test(pathOnly(full));
}

function normalizePropertyUrl(full) {
  const p = pathOnly(full);
  if (!/^\/ru\/property\/[^/]+$/.test(p)) return null;
  return `${BASE}${p}/`;
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    timeout: 90000,
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400
  });
  return res.data;
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

function parseProperty(html, url) {
  const $ = cheerio.load(html);
  const title = $('h1').first().text().trim();
  const price = $('.property-title-price-wrap .price').first().text().trim();
  const overview = $('.property-overview-data li')
    .map((i, el) => $(el).text().trim().replace(/\s+/g, ' '))
    .get()
    .join(' | ');
  let description = $('.block-content-wrap.property-description-wrap').text().trim();
  if (description.length < 60) {
    description = $('.property-detail-wrap .block-content-wrap, .property-view .block-content-wrap')
      .first()
      .text()
      .trim();
  }
  if (description.length > 4000) description = `${description.slice(0, 4000)}…`;
  return {
    url,
    title: title || url,
    price: price || '',
    overview: overview || '',
    description: description || ''
  };
}

async function main() {
  const seenIndex = new Set();
  const queued = new Set();
  const queue = [`${BASE}/ru/`];

  const propertyUrls = new Set();

  while (queue.length && seenIndex.size < MAX_INDEX_PAGES) {
    const url = queue.shift();
    if (seenIndex.has(url)) continue;
    seenIndex.add(url);
    process.stdout.write(`\rIndex ${seenIndex.size}/${MAX_INDEX_PAGES} ${url.slice(0, 72)}…   `);
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.warn('\nSkip index', url, e.message);
      continue;
    }
    await sleep(DELAY_MS);

    for (const u of extractUrls(html)) {
      const prop = normalizePropertyUrl(u);
      if (prop) propertyUrls.add(prop);
      if (isListingIndexUrl(u) && !seenIndex.has(u) && !queued.has(u)) {
        queued.add(u);
        queue.push(u);
      }
    }
  }

  console.log(`\nНайдено уникальных объявлений: ${propertyUrls.size}`);

  const items = [];
  const list = [...propertyUrls].slice(0, MAX_PROPERTIES);
  let i = 0;
  for (const pu of list) {
    i++;
    process.stdout.write(`\rОбъект ${i}/${list.length}…`);
    try {
      const html = await fetchHtml(pu);
      items.push(parseProperty(html, pu));
    } catch (e) {
      console.warn('\nОшибка', pu, e.message);
    }
    await sleep(DELAY_MS);
  }

  const outDir = path.join(__dirname, '..', 'data');
  const outPath = path.join(outDir, 'properties.json');
  fs.mkdirSync(outDir, { recursive: true });
  const out = {
    syncedAt: new Date().toISOString(),
    source: BASE,
    count: items.length,
    items
  };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\nГотово: ${items.length} объектов → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
