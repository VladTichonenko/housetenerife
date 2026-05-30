/**
 * Обход каталога housetenerife.eu и сохранение объявлений в data/properties.json
 * Собирает /ru/property/ и /property/ (без языкового префикса — часть объектов, напр. Barcelona).
 * Доп. языки: SYNC_EXTRA_LANGS=es
 */
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE = 'https://housetenerife.eu';
const { SYNC_SEED_INDEX_URLS } = require('../catalog-regions');
const USER_AGENT = 'HouseTenerifeBot/1.0 (property catalog sync; contact agency)';
const DELAY_MS = parseInt(process.env.SYNC_DELAY_MS, 10) || 2000;
const MAX_INDEX_PAGES = parseInt(process.env.SYNC_MAX_INDEX_PAGES, 10) || 800;
const MAX_PROPERTIES = parseInt(process.env.SYNC_MAX_PROPERTIES, 10) || 2500;
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
  if (u.startsWith('//')) u = `https:${u}`;
  if (u.startsWith('/')) u = BASE + u;
  if (!u.startsWith('http')) return null;
  if (!u.includes('housetenerife.eu')) return null;
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
  if (p === '/ru' || p === '/') return true;
  return /^\/(?:ru\/)?(city|state|property-type|label|area)\/[^/]+(\/page\/\d+)?$/i.test(p);
}

function normalizePropertyUrl(full) {
  const p = pathOnly(full);
  if (/^\/ru\/property\/[^/]+$/i.test(p)) return `${BASE}${p}/`;
  if (/^\/(?:es|en)\/property\/[^/]+$/i.test(p)) return `${BASE}${p}/`;
  if (/^\/property\/[^/]+$/i.test(p)) return `${BASE}${p}/`;
  return null;
}

function propertySlugFromUrl(full) {
  const p = pathOnly(full);
  const m = p.match(/\/property\/([^/]+)$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Один slug — один URL; приоритет русской версии */
function registerProperty(map, full) {
  const url = normalizePropertyUrl(full);
  if (!url) return;
  const slug = propertySlugFromUrl(url);
  if (!slug) return;
  const prev = map.get(slug);
  if (!prev || (url.includes('/ru/') && !prev.includes('/ru/'))) {
    map.set(slug, url);
  }
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
  const re2 = /https?:\/\/(?:www\.)?housetenerife\.eu\/[^\s"'<>]+/gi;
  while ((m = re2.exec(html)) !== null) {
    const n = normalizeUrl(m[0]);
    if (n) urls.add(n);
  }
  return urls;
}

function extractPropertyIdFromHtml(html) {
  const m = String(html).match(/\bHZ\d+\b/i);
  return m ? m[0].toUpperCase() : null;
}

/** WPML / hreflang / ссылки на другие языки */
function extractAlternatePropertyUrls(html) {
  const out = {};
  const re = /https?:\/\/(?:www\.)?housetenerife\.eu\/(?:(ru|es|en)\/)?property\/[a-z0-9-]+\/?/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const lang = m[1] ? m[1].toLowerCase() : 'en';
    const url = normalizeUrl(m[0]);
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

function buildMultilingualItem(ruParsed, ruHtml, extraByLang, alternates = {}) {
  const id = extractPropertyIdFromHtml(ruHtml) || extractPropertyIdFromHtml(ruParsed.description);
  const ruUrl = alternates.ru || ruParsed.url;

  const urls = { ru: ruUrl, en: alternates.en || null, es: alternates.es || null };
  const titles = { ru: ruParsed.title };
  const descriptions = { ru: ruParsed.description };
  const overviews = { ru: ruParsed.overview };

  for (const [lang, data] of Object.entries(extraByLang)) {
    if (lang.startsWith('_')) continue;
    if (data.url) urls[lang] = data.url;
    if (data.title) titles[lang] = data.title;
    if (data.description) descriptions[lang] = data.description;
    if (data.overview) overviews[lang] = data.overview;
  }

  if (!urls.es && alternates.es) urls.es = alternates.es;
  if (!urls.en && alternates.en) urls.en = alternates.en;

  return {
    id,
    url: ruUrl,
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
    if (!altUrl) continue;
    try {
      const html = await fetchHtml(altUrl);
      extra[lang] = parseProperty(html, altUrl);
    } catch (e) {
      console.warn(`\n  Ошибка ${lang}`, altUrl, e.message);
    }
    await sleep(DELAY_MS);
  }
  return extra;
}

async function fetchPropertyItem(entryUrl) {
  const html = await fetchHtml(entryUrl);
  const alternates = extractAlternatePropertyUrls(html);
  let ruUrl = alternates.ru;
  if (!ruUrl && /^\/ru\/property\//i.test(pathOnly(entryUrl))) ruUrl = entryUrl;

  let ruParsed = parseProperty(html, entryUrl);
  let ruHtml = html;

  if (ruUrl && pathOnly(ruUrl) !== pathOnly(entryUrl)) {
    ruHtml = await fetchHtml(ruUrl);
    ruParsed = parseProperty(ruHtml, ruUrl);
    await sleep(DELAY_MS);
  } else if (!ruUrl) {
    ruUrl = entryUrl;
    ruParsed = parseProperty(html, entryUrl);
  }

  let extraByLang = {};
  if (EXTRA_LANGS.length) {
    extraByLang = await fetchExtraLanguages(ruHtml, ruUrl, EXTRA_LANGS);
  }

  return buildMultilingualItem(ruParsed, ruHtml, extraByLang, alternates);
}

async function main() {
  const seenIndex = new Set();
  const queued = new Set();
  const queue = [...new Set([`${BASE}/`, `${BASE}/ru/`, ...SYNC_SEED_INDEX_URLS])];
  const propertyBySlug = new Map();

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
      if (!u.startsWith('http')) continue;
      registerProperty(propertyBySlug, u);
      if (isListingIndexUrl(u) && !seenIndex.has(u) && !queued.has(u)) {
        queued.add(u);
        queue.push(u);
      }
    }
  }

  const propertyUrls = [...propertyBySlug.values()];
  console.log(`\nНайдено уникальных объявлений: ${propertyUrls.length}`);
  if (EXTRA_LANGS.length) console.log(`Доп. языки: ${EXTRA_LANGS.join(', ')}`);

  const items = [];
  const list = propertyUrls.slice(0, MAX_PROPERTIES);
  let i = 0;
  for (const pu of list) {
    i++;
    process.stdout.write(`\rОбъект ${i}/${list.length}…`);
    try {
      items.push(await fetchPropertyItem(pu));
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
