const fs = require('fs');
const path = require('path');
const { LOCATION_KEYWORDS } = require('./dialog-context');

function resolveCatalogPath() {
  if (process.env.PROPERTIES_PATH) return process.env.PROPERTIES_PATH;
  return path.join(__dirname, 'data', 'properties.json');
}

const DATA = resolveCatalogPath();
const SUPPORTED_LANGS = ['ru', 'en', 'es'];

let cache = null;
let cacheMtimeMs = 0;

function load() {
  try {
    const st = fs.statSync(DATA);
    if (cache && st.mtimeMs === cacheMtimeMs) return cache;
    cacheMtimeMs = st.mtimeMs;
    const raw = fs.readFileSync(DATA, 'utf8');
    cache = JSON.parse(raw);
  } catch {
    cache = { items: [], syncedAt: null, count: 0 };
    cacheMtimeMs = 0;
  }
  if (!cache.items) cache.items = [];
  cache.items = cache.items.map(normalizeItem);
  return cache;
}

/** Сброс кэша после npm run sync-db при долгоживущем процессе */
function reload() {
  cache = null;
  cacheMtimeMs = 0;
  try {
    require('./property-share').invalidateUrlIndex();
  } catch {
    /* property-share optional at load */
  }
  return load();
}

function extractPropertyId(item) {
  const blob = [item.description, item.overview, item.title].join(' ');
  const m = blob.match(/\bHZ\d+\b/i);
  return m ? m[0].toUpperCase() : null;
}

/** Приводит старые записи (только RU) к мультиязычной структуре */
function normalizeItem(item) {
  if (item.titles && item.descriptions) {
    if (!item.id) item.id = extractPropertyId(item);
    return item;
  }
  const ruUrl = item.url || '';
  return {
    ...item,
    id: extractPropertyId(item),
    urls: item.urls || { ru: ruUrl },
    titles: item.titles || { ru: item.title || '' },
    descriptions: item.descriptions || { ru: item.description || '' },
    overviews: item.overviews || { ru: item.overview || '' }
  };
}

function normalizeLang(lang) {
  const l = String(lang || 'ru').toLowerCase().slice(0, 2);
  return SUPPORTED_LANGS.includes(l) ? l : 'ru';
}

const FALLBACK_CHAIN = {
  ru: ['ru'],
  es: ['es', 'ru'],
  en: ['en', 'es', 'ru']
};

function pickLocalized(map, langChain) {
  if (!map || typeof map !== 'object') return '';
  for (const code of langChain) {
    if (map[code]) return map[code];
  }
  return Object.values(map).find(Boolean) || '';
}

function getLocalizedItem(item, lang) {
  const l = normalizeLang(lang);
  const chain = FALLBACK_CHAIN[l] || ['ru'];
  const url = pickLocalized(item.urls, chain) || item.url || '';
  return {
    ...item,
    url,
    title: pickLocalized(item.titles, chain) || item.title || '',
    description: pickLocalized(item.descriptions, chain) || item.description || '',
    overview: pickLocalized(item.overviews, chain) || item.overview || ''
  };
}

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-zà-ÿа-яё0-9€]+/gi, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function itemSearchBlob(item) {
  const parts = [
    item.title,
    item.description,
    item.overview,
    item.price,
    item.url,
    item.id
  ];
  for (const lang of SUPPORTED_LANGS) {
    parts.push(item.titles?.[lang], item.descriptions?.[lang], item.overviews?.[lang], item.urls?.[lang]);
  }
  return parts.filter(Boolean).join(' ');
}

function parseItemPriceEur(item) {
  const raw = String(item.price || item.overview || '').replace(/\s/g, '');
  const m = raw.match(/(\d{2,3})[.,]?(\d{3})|(\d{5,7})/);
  if (!m) return null;
  if (m[3]) return parseInt(m[3], 10);
  return parseInt(m[1] + m[2], 10);
}

function scoreLocation(item, contextText) {
  const blob = itemSearchBlob(item).toLowerCase();
  const lower = String(contextText || '').toLowerCase();
  let sc = 0;
  for (const k of LOCATION_KEYWORDS) {
    const key = k.toLowerCase();
    if (lower.includes(key) && blob.includes(key)) sc += 18;
  }
  return sc;
}

function scoreItem(item, tokens, options = {}) {
  const blob = itemSearchBlob(item);
  const hay = tokenize(blob);
  let sc = scoreLocation(item, options.contextText);

  for (const t of tokens) {
    if (t.length < 2) continue;
    if (blob.toLowerCase().includes(t)) sc += 3;
    for (const h of hay) {
      if (h === t) sc += 2;
      else if (h.includes(t) || t.includes(h)) sc += 1;
    }
  }

  const price = parseItemPriceEur(item);
  const { minPrice, maxPrice } = options;
  if (price != null && (minPrice != null || maxPrice != null)) {
    if (minPrice != null && maxPrice != null) {
      if (price >= minPrice && price <= maxPrice) sc += 12;
      else if (price >= minPrice * 0.85 && price <= maxPrice * 1.15) sc += 5;
      else sc -= 4;
    } else if (maxPrice != null) {
      if (price <= maxPrice) sc += 10;
      else if (price <= maxPrice * 1.2) sc += 3;
      else sc -= 3;
    } else if (minPrice != null) {
      if (price >= minPrice) sc += 8;
      else if (price >= minPrice * 0.8) sc += 2;
    }
  }

  return sc;
}

const EMPTY_CATALOG_MSG = {
  ru: 'Локальный каталог пуст. Администратору: npm run sync-db. Пока направляй на https://housetenerife.eu/ru/',
  en: 'Local catalog is empty. Admin: run npm run sync-db. For now direct clients to https://housetenerife.eu/es/',
  es: 'Catálogo local vacío. Admin: ejecute npm run sync-db. Mientras tanto: https://housetenerife.eu/es/'
};

const NO_MATCH_MSG = {
  ru: 'По этому запросу совпадений нет. Уточни бюджет и район; каталог: https://housetenerife.eu/ru/',
  en: 'No matches for this query. Ask for budget and area; catalog: https://housetenerife.eu/es/',
  es: 'Sin coincidencias. Pida presupuesto y zona; catálogo: https://housetenerife.eu/es/'
};

const PRICE_FALLBACK = {
  ru: 'цена уточняется',
  en: 'price on request',
  es: 'precio a consultar'
};

/**
 * Подбор объектов из локального JSON для контекста модели.
 * @param {string} query
 * @param {number} limit
 * @param {{ minPrice?: number, maxPrice?: number, lang?: string }} options
 */
function searchForContext(query, limit = 8, options = {}) {
  if (typeof limit === 'object' && limit !== null) {
    options = limit;
    limit = options.limit ?? 8;
  }
  limit = Math.min(20, Math.max(1, parseInt(limit, 10) || 8));

  const lang = normalizeLang(options.lang);
  const data = load();
  const totalInDb = data.items.length;
  if (!totalInDb) {
    return { found: false, text: EMPTY_CATALOG_MSG[lang] || EMPTY_CATALOG_MSG.ru, totalInDb: 0 };
  }
  const tokens = tokenize(query);
  const scoreOpts = {
    minPrice: options.minPrice ?? null,
    maxPrice: options.maxPrice ?? null,
    contextText: options.contextText || query || ''
  };

  let ranked = data.items.map((item) => ({ item, s: scoreItem(item, tokens, scoreOpts) }));

  if (!tokens.length && (scoreOpts.minPrice || scoreOpts.maxPrice)) {
    ranked = ranked.filter((x) => x.s > 0);
  } else if (tokens.length) {
    const withScore = ranked.filter((x) => x.s > 0);
    if (withScore.length) ranked = withScore;
    else if (scoreOpts.minPrice || scoreOpts.maxPrice) {
      ranked = ranked.filter((x) => {
        const p = parseItemPriceEur(x.item);
        if (p == null) return false;
        const { minPrice, maxPrice } = scoreOpts;
        if (minPrice != null && maxPrice != null) return p >= minPrice * 0.8 && p <= maxPrice * 1.2;
        if (maxPrice != null) return p <= maxPrice * 1.25;
        if (minPrice != null) return p >= minPrice * 0.75;
        return true;
      });
    }
  } else {
    ranked = data.items
      .map((item) => ({ item, s: parseItemPriceEur(item) || 0 }))
      .sort((a, b) => a.s - b.s)
      .slice(0, limit * 4);
  }

  ranked = ranked.sort((a, b) => b.s - a.s).slice(0, limit);

  if (!ranked.length) {
    ranked = data.items
      .slice(0, Math.max(limit, 1) * 2)
      .map((item) => ({ item, s: 1 }))
      .slice(0, Math.max(limit, 1));
  }

  if (!ranked.length) {
    return { found: false, text: NO_MATCH_MSG[lang] || NO_MATCH_MSG.ru, totalInDb };
  }
  let lines;
  const { getShareUrl } = require('./property-share');
  try {
    lines = ranked.map((r, i) => {
      const loc = getLocalizedItem(r.item, lang);
      const desc = (loc.description || '').replace(/\s+/g, ' ').trim();
      const short = desc.length > 240 ? `${desc.slice(0, 240)}…` : desc;
      const priceLabel = loc.price || PRICE_FALLBACK[lang] || PRICE_FALLBACK.ru;
      const shareUrl = getShareUrl(r.item, lang);
      return `${i + 1}. ${loc.title} — ${priceLabel}\n   ${shareUrl}\n   ${short}`;
    });
  } catch (e) {
    console.warn('⚠️ searchForContext format:', e.message);
    return { found: false, text: NO_MATCH_MSG[lang] || NO_MATCH_MSG.ru, totalInDb };
  }
  const header =
    lang === 'en'
      ? `[Catalog: ${totalInDb} listings on site; below are the ${lines.length} best matches for the query — do not invent other URLs.]`
      : lang === 'es'
        ? `[Catálogo: ${totalInDb} anuncios; abajo ${lines.length} mejores coincidencias — no inventes otros enlaces.]`
        : `[Каталог: на сайте ${totalInDb} объектов; ниже ${lines.length} лучших по запросу — другие ссылки не выдумывай.]`;

  return {
    found: true,
    text: `${header}\n\n${lines.join('\n\n')}`,
    syncedAt: data.syncedAt || null,
    totalInDb
  };
}

function cleanDescription(s) {
  let d = String(s || '').replace(/\s+/g, ' ').trim();
  const cut = d.search(/\bDetails\b|\t{3,}/i);
  if (cut > 80) d = d.slice(0, cut).trim();
  if (d.length > 320) d = `${d.slice(0, 320)}…`;
  return d;
}

function extractPropertyType(overview) {
  const m = String(overview || '').match(/Property type\s*\|\s*([^|]+)/i);
  return m ? m[1].trim() : '';
}

/**
 * Список объектов для админ-панели (поиск + пагинация).
 */
function listProperties({ q = '', page = 1, limit = 24, lang = 'ru' } = {}) {
  const data = load();
  const items = data.items || [];
  const query = String(q || '').trim().toLowerCase();
  let filtered = items;

  if (query) {
    const tokens = tokenize(query);
    filtered = items
      .map((item) => ({ item, s: scoreItem(item, tokens) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.item);
    if (!filtered.length) {
      filtered = items.filter((item) => itemSearchBlob(item).toLowerCase().includes(query));
    }
  } else {
    filtered = [...items].sort((a, b) =>
      String(a.title || '').localeCompare(String(b.title || ''), 'ru')
    );
  }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 24, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const currentPage = Math.min(safePage, totalPages);
  const start = (currentPage - 1) * safeLimit;
  const slice = filtered.slice(start, start + safeLimit);
  const l = normalizeLang(lang);

  return {
    items: slice.map((item) => {
      const loc = getLocalizedItem(item, l);
      return {
        url: loc.url,
        title: loc.title || 'Без названия',
        price: loc.price || null,
        overview: loc.overview || null,
        propertyType: extractPropertyType(loc.overview),
        description: cleanDescription(loc.description)
      };
    }),
    total,
    page: currentPage,
    limit: safeLimit,
    totalPages,
    syncedAt: data.syncedAt || null,
    source: data.source || null,
    countInDb: data.count ?? items.length
  };
}

function getCatalogSiteUrl(lang) {
  const l = normalizeLang(lang);
  if (l === 'es') return 'https://housetenerife.eu/es/';
  if (l === 'en') return 'https://housetenerife.eu/es/';
  return 'https://housetenerife.eu/ru/';
}

module.exports = {
  load,
  reload,
  searchForContext,
  listProperties,
  getLocalizedItem,
  normalizeItem,
  normalizeLang,
  getCatalogSiteUrl,
  cleanDescription,
  SUPPORTED_LANGS
};
