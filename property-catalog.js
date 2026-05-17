const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data', 'properties.json');

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
  return cache;
}

/** Сброс кэша после npm run sync-db при долгоживущем процессе */
function reload() {
  cache = null;
  cacheMtimeMs = 0;
  return load();
}

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9€]+/gi, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function scoreItem(item, tokens) {
  const blob = [item.title, item.description, item.overview, item.price, item.url].join(' ');
  const hay = tokenize(blob);
  let sc = 0;
  for (const t of tokens) {
    if (blob.toLowerCase().includes(t)) sc += 3;
    for (const h of hay) {
      if (h === t) sc += 2;
      else if (h.includes(t) || t.includes(h)) sc += 1;
    }
  }
  return sc;
}

/**
 * Подбор объектов из локального JSON для контекста модели.
 * @param {string} query
 * @param {number} limit
 */
function searchForContext(query, limit = 8) {
  const data = load();
  if (!data.items.length) {
    return {
      found: false,
      text:
        'Локальный каталог пуст. Администратору: в папке проекта выполните npm run sync-db (и перезапустите бота). Пока отвечай по общим знаниям и направляй на https://housetenerife.eu/ru/'
    };
  }
  const tokens = tokenize(query);
  if (!tokens.length) {
    return { found: false, text: '' };
  }
  const ranked = data.items
    .map((item) => ({ item, s: scoreItem(item, tokens) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
  if (!ranked.length) {
    return {
      found: false,
      text:
        'По этому запросу в синхронизированном каталоге совпадений нет. Предложи уточнить бюджет, район (Лас Америкас, Лос Кристианос и т.д.) или тип жилья; дай ссылку на поиск: https://housetenerife.eu/ru/'
    };
  }
  const lines = ranked.map((r, i) => {
    const desc = (r.item.description || '').replace(/\s+/g, ' ').trim();
    const short = desc.length > 240 ? `${desc.slice(0, 240)}…` : desc;
    return `${i + 1}. ${r.item.title} — ${r.item.price || 'цена уточняется'}\n   ${r.item.url}\n   ${short}`;
  });
  return {
    found: true,
    text: lines.join('\n\n'),
    syncedAt: data.syncedAt || null,
    totalInDb: data.items.length
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
function listProperties({ q = '', page = 1, limit = 24 } = {}) {
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
      filtered = items.filter((item) => {
        const blob = [item.title, item.description, item.overview, item.price, item.url]
          .join(' ')
          .toLowerCase();
        return blob.includes(query);
      });
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

  return {
    items: slice.map((item) => ({
      url: item.url,
      title: item.title || 'Без названия',
      price: item.price || null,
      overview: item.overview || null,
      propertyType: extractPropertyType(item.overview),
      description: cleanDescription(item.description)
    })),
    total,
    page: currentPage,
    limit: safeLimit,
    totalPages,
    syncedAt: data.syncedAt || null,
    source: data.source || null,
    countInDb: data.count ?? items.length
  };
}

module.exports = { load, reload, searchForContext, listProperties };
