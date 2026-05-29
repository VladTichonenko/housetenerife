/**
 * Обход каталога housetenerife.eu/ru/ и сохранение объявлений в data/properties.json
 * Доп. языки (es по умолчанию): SYNC_EXTRA_LANGS=es или SYNC_EXTRA_LANGS=es,de
 */
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE = 'https://housetenerife.eu';
const { SYNC_SEED_INDEX_URLS } = require('../catalog-regions');
const USER_AGENT = 'HouseTenerifeBot/1.0 (property catalog sync; contact agency)';
const DELAY_MS = parseInt(process.env.SYNC_DELAY_MS, 10) || 2000;
const MAX_INDEX_PAGES = parseInt(process.env.SYNC_MAX_INDEX_PAGES, 10) || 600;
const MAX_PROPERTIES = parseInt(process.env.SYNC_MAX_PROPERTIES, 10) || 2200;
const EXTRA_LANGS = (process.env.SYNC_EXTRA_LANGS || 'es')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s && s !== 'ru');

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

function extractPropertyIdFromHtml(html) {
  const m = String(html).match(/\bHZ\d+\b/i);
  return m ? m[0].toUpperCase() : null;
}

/** WPML / переключатель языков на странице объекта */
function extractAlternatePropertyUrls(html) {
  const out = {};
  const re = /housetenerife\.eu\/([a-z]{2})\/property\/[^"'#\s]+/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const lang = m[1].toLowerCase();
    const url = normalizeUrl(m[0].replace(/^https?:\/\//, 'https://'));
    if (url) out[lang] = url.endsWith('/') ? url : `${url}/`;
  }
  return out;
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

function buildMultilingualItem(ruParsed, ruHtml, extraByLang) {
  const id = extractPropertyIdFromHtml(ruHtml) || extractPropertyIdFromHtml(ruParsed.description);
  const urls = { ru: ruParsed.url };
  const titles = { ru: ruParsed.title };
  const descriptions = { ru: ruParsed.description };
  const overviews = { ru: ruParsed.overview };

  for (const [lang, data] of Object.entries(extraByLang)) {
    if (data.url) urls[lang] = data.url;
    if (data.title) titles[lang] = data.title;
    if (data.description) descriptions[lang] = data.description;
    if (data.overview) overviews[lang] = data.overview;
  }

  return {
    id,
    url: ruParsed.url,
    title: ruParsed.title,
    price: ruParsed.price,
    overview: ruParsed.overview,
    description: ruParsed.description,
    urls,
    titles,
    descriptions,
    overviews
  };
}

async function fetchExtraLanguages(ruHtml, ruUrl, langs) {
  const alternates = extractAlternatePropertyUrls(ruHtml);
  const extra = {};
  for (const lang of langs) {
    const altUrl = alternates[lang];
    if (!altUrl) {
      console.warn(`\n  Нет ${lang} URL для ${ruUrl}`);
      continue;
    }
    try {
      const html = await fetchHtml(altUrl);
      const parsed = parseProperty(html, altUrl);
      extra[lang] = parsed;
    } catch (e) {
      console.warn(`\n  Ошибка ${lang}`, altUrl, e.message);
    }
    await sleep(DELAY_MS);
  }
  return extra;
}

async function main() {
  const seenIndex = new Set();
  const queued = new Set();
  const queue = [...new Set([`${BASE}/ru/`, ...SYNC_SEED_INDEX_URLS])];

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
  if (EXTRA_LANGS.length) {
    console.log(`Доп. языки: ${EXTRA_LANGS.join(', ')}`);
  }

  const items = [];
  const list = [...propertyUrls].slice(0, MAX_PROPERTIES);
  let i = 0;
  for (const pu of list) {
    i++;
    process.stdout.write(`\rОбъект ${i}/${list.length}…`);
    try {
      const html = await fetchHtml(pu);
      const ruParsed = parseProperty(html, pu);
      let extraByLang = {};
      if (EXTRA_LANGS.length) {
        extraByLang = await fetchExtraLanguages(html, pu, EXTRA_LANGS);
      }
      items.push(buildMultilingualItem(ruParsed, html, extraByLang));
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
    langs: ['ru', ...EXTRA_LANGS],
    items
  };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\nГотово: ${items.length} объектов → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
