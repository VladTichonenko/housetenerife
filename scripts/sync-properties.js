/**
 * Обход каталога housetenerife.eu и сохранение объявлений в data/properties.json
 * Источники URL: все property-sitemap* из sitemap_index (+ опционально обход индексов).
 * Доп. языки карточки: SYNC_EXTRA_LANGS=es
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
const SKIP_INDEX_CRAWL =
  process.env.SYNC_SKIP_INDEX_CRAWL === '1' || process.env.SYNC_SKIP_INDEX_CRAWL === 'true';
const MAX_PROPERTIES = parseInt(process.env.SYNC_MAX_PROPERTIES, 10) || 5000;
const FETCH_RETRIES = parseInt(process.env.SYNC_RETRIES, 10) || 3;
const EXTRA_LANGS = (process.env.SYNC_EXTRA_LANGS || 'es')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s && s !== 'ru');

/** Fallback, если sitemap_index недоступен */
const SITEMAP_URLS_FALLBACK = [
  `${BASE}/property-sitemap.xml`,
  `${BASE}/property-sitemap2.xml`,
  `${BASE}/property-sitemap3.xml`,
  `${BASE}/property-sitemap4.xml`
];

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
  try {
    const host = new URL(u).hostname.replace(/^www\./, '');
    if (host !== 'housetenerife.eu') return null;
  } catch {
    return null;
  }
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
  try {
    const host = new URL(full).hostname.replace(/^www\./, '');
    if (host !== 'housetenerife.eu') return false;
  } catch {
    return false;
  }
  const p = pathOnly(full);
  if (p === '/ru' || p === '/') return true;
  return /^\/(?:ru\/)?(city|state|property-type|label|area)\/[^/]+(\/page\/\d+)?$/i.test(p);
}

function normalizePropertyUrl(full) {
  const p = pathOnly(full);
  // Любой языковой префикс WPML (ru/es/en/fr/de/pl/cs/…) или без префикса
  if (!/^\/(?:[a-z]{2}\/)?property\/[^/]+$/i.test(p)) return null;
  if (/^\/(?:[a-z]{2}\/)?property$/i.test(p)) return null;
  return `${BASE}${p}/`;
}

function propertySlugFromUrl(full) {
  const p = pathOnly(full);
  const m = p.match(/\/property\/([^/]+)$/i);
  return m ? m[1].toLowerCase() : null;
}

function canonicalPropertyUrl(full) {
  const url = normalizePropertyUrl(full);
  return url || null;
}

/** Один slug — один URL; приоритет русской версии */
function registerProperty(map, full) {
  const url = canonicalPropertyUrl(full);
  if (!url) return;
  const slug = propertySlugFromUrl(url);
  if (!slug) return;
  const prev = map.get(slug);
  if (!prev || urlFetchPriority(url) < urlFetchPriority(prev)) {
    map.set(slug, url);
  }
}

function langFromPropertyUrl(url) {
  const p = pathOnly(url);
  const m = p.match(/^\/([a-z]{2})\/property\//i);
  if (m) return m[1].toLowerCase();
  if (/^\/property\//i.test(p)) return 'en';
  return 'xx';
}

function urlFetchPriority(url) {
  const order = { ru: 0, es: 1, en: 2, de: 3, fr: 4, pl: 5, cs: 6 };
  return order[langFromPropertyUrl(url)] ?? 9;
}

function sortPropertyUrls(urls) {
  return [...urls].sort((a, b) => {
    const pa = urlFetchPriority(a);
    const pb = urlFetchPriority(b);
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
}

async function fetchHtml(url) {
  let lastErr;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xml,*/*' },
        timeout: 90000,
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 400
      });
      return res.data;
    } catch (e) {
      lastErr = e;
      if (attempt < FETCH_RETRIES) {
        await sleep(1000 * attempt);
      }
    }
  }
  throw lastErr;
}

function extractLocUrls(xml) {
  const out = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

async function discoverPropertySitemapUrls() {
  try {
    const xml = await fetchHtml(`${BASE}/sitemap_index.xml`);
    const locs = extractLocUrls(xml).filter((u) =>
      /\/property-sitemap\d*\.xml$/i.test(u.replace(/\/+$/, ''))
    );
    if (locs.length) {
      console.log(`   sitemap_index: ${locs.length} property-sitemap`);
      return [...new Set(locs)];
    }
  } catch (e) {
    console.warn('sitemap_index skip', e.message);
  }
  return SITEMAP_URLS_FALLBACK;
}

/** В sitemap объект часто лежит отдельной строкой на каждом языке WPML.
 * Для каталога берём только основные: ru / es / en (без fr/de/pl/cs — это те же объекты). */
const SITEMAP_LANGS = new Set(['ru', 'es', 'en']);

function isMainCatalogLangUrl(url) {
  return SITEMAP_LANGS.has(langFromPropertyUrl(url));
}

async function fetchPropertyUrlsFromSitemap() {
  const urls = new Set();
  const sitemaps = await discoverPropertySitemapUrls();
  let skippedOtherLang = 0;
  for (const sm of sitemaps) {
    try {
      const xml = await fetchHtml(sm);
      let added = 0;
      for (const loc of extractLocUrls(xml)) {
        const u = canonicalPropertyUrl(loc);
        if (!u) continue;
        if (!isMainCatalogLangUrl(u)) {
          skippedOtherLang++;
          continue;
        }
        if (!urls.has(u)) added++;
        urls.add(u);
      }
      console.log(`Sitemap ${sm}: +${added} URL (уник. ru/es/en: ${urls.size})`);
    } catch (e) {
      console.warn('Sitemap skip', sm, e.message);
    }
    await sleep(300);
  }
  if (skippedOtherLang) {
    console.log(`   Пропущено URL прочих языков (fr/de/pl/…): ${skippedOtherLang} — те же объекты`);
  }
  return urls;
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
  const re =
    /https?:\/\/(?:www\.)?housetenerife\.eu\/(?:([a-z]{2})\/)?property\/[a-z0-9-]+\/?/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const lang = m[1] ? m[1].toLowerCase() : 'en';
    const url = canonicalPropertyUrl(m[0]);
    if (url) out[lang] = url;
  }
  return out;
}

function slugsFromItem(item) {
  const slugs = new Set();
  const candidates = [item.url, ...(item.urls ? Object.values(item.urls) : [])].filter(Boolean);
  for (const u of candidates) {
    const s = propertySlugFromUrl(u);
    if (s) slugs.add(s);
  }
  return slugs;
}

function mergePropertyItems(base, extra) {
  if (!extra) return base;
  const merged = { ...base };
  merged.urls = { ...(base.urls || {}), ...(extra.urls || {}) };
  merged.titles = { ...(base.titles || {}), ...(extra.titles || {}) };
  merged.descriptions = { ...(base.descriptions || {}), ...(extra.descriptions || {}) };
  merged.overviews = { ...(base.overviews || {}), ...(extra.overviews || {}) };
  if (!merged.id && extra.id) merged.id = extra.id;
  if (!merged.price && extra.price) merged.price = extra.price;
  if (merged.urls?.ru) {
    merged.url = merged.urls.ru;
    merged.title = merged.titles?.ru || merged.title;
    merged.description = merged.descriptions?.ru || merged.description;
    merged.overview = merged.overviews?.ru || merged.overview;
  }
  return merged;
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

  const primaryUrl = urls.ru || urls.es || urls.en || ruParsed.url;
  const primaryLang = urls.ru ? 'ru' : urls.es ? 'es' : 'en';

  return {
    id,
    url: primaryUrl,
    title: titles[primaryLang] || ruParsed.title,
    price: ruParsed.price,
    overview: overviews[primaryLang] || ruParsed.overview,
    description: descriptions[primaryLang] || ruParsed.description,
    urls,
    titles,
    descriptions,
    overviews
  };
}

async function fetchExtraLanguages(ruHtml, langs) {
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
    extraByLang = await fetchExtraLanguages(ruHtml, EXTRA_LANGS);
  }

  return buildMultilingualItem(ruParsed, ruHtml, extraByLang, alternates);
}

async function crawlIndexPages(propertyBySlug) {
  const seenIndex = new Set();
  const queued = new Set();
  const queue = [...new Set([`${BASE}/`, `${BASE}/ru/`, ...SYNC_SEED_INDEX_URLS])];

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
  console.log(`\nИндексы: ${seenIndex.size} стр., slug в карте: ${propertyBySlug.size}`);
}

async function main() {
  console.log('1/3 Загрузка URL из sitemap…');
  const sitemapUrls = await fetchPropertyUrlsFromSitemap();
  console.log(`   Sitemap: ${sitemapUrls.size} URL`);

  const propertyBySlug = new Map();
  for (const u of sitemapUrls) registerProperty(propertyBySlug, u);

  console.log('2/3 Обход индексов (доп. URL)…');
  if (SKIP_INDEX_CRAWL) {
    console.log('   Пропуск (SYNC_SKIP_INDEX_CRAWL) — только sitemap');
  } else {
    await crawlIndexPages(propertyBySlug);
  }

  const propertyUrls = sortPropertyUrls([...propertyBySlug.values()]);
  console.log(`\nНайдено уникальных slug: ${propertyUrls.length}`);
  if (EXTRA_LANGS.length) console.log(`Доп. языки: ${EXTRA_LANGS.join(', ')}`);

  const byId = new Map();
  const processedSlugs = new Set();
  const list = propertyUrls.slice(0, MAX_PROPERTIES);
  let fetched = 0;
  let skipped = 0;
  let errors = 0;

  const outDir = path.join(__dirname, '..', 'data');
  const outPath = path.join(outDir, 'properties.json');
  fs.mkdirSync(outDir, { recursive: true });

  function writeCatalog(partial = false) {
    const finalItems = [...byId.values()];
    const out = {
      syncedAt: new Date().toISOString(),
      source: BASE,
      count: finalItems.length,
      langs: ['ru', ...EXTRA_LANGS],
      partial: partial || undefined,
      items: finalItems
    };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    return finalItems.length;
  }

  console.log('3/3 Загрузка карточек объектов…');
  for (const pu of list) {
    const slug = propertySlugFromUrl(pu);
    if (!slug || processedSlugs.has(slug)) {
      skipped++;
      continue;
    }

    fetched++;
    process.stdout.write(
      `\rОбъект ${fetched} (в базе ${byId.size}, дублей ${skipped}, ошибок ${errors})…`
    );
    try {
      const item = await fetchPropertyItem(pu);
      for (const s of slugsFromItem(item)) processedSlugs.add(s);
      processedSlugs.add(slug);

      const key = item.id || slug;
      const prev = byId.get(key);
      byId.set(key, prev ? mergePropertyItems(prev, item) : item);

      if (fetched % 25 === 0) {
        const n = writeCatalog(true);
        console.log(`\n💾 checkpoint: ${n} объектов → ${outPath}`);
      }
    } catch (e) {
      errors++;
      console.warn('\nОшибка', pu, e.message);
      // не помечаем slug — можно добрать при следующем sync
    }
    await sleep(DELAY_MS);
  }

  const total = writeCatalog(false);
  console.log(`\nГотово: ${total} объектов (уникальных) → ${outPath}`);
  console.log(`Загружено карточек: ${fetched}, пропущено дублей URL: ${skipped}, ошибок: ${errors}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
