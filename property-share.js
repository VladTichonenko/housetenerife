/**
 * Локализованные ссылки для WhatsApp: превью под URL берётся с целевой страницы (OG-теги).
 * Для EN — прокси /p/HZ123?lang=en с английскими og:title/description из каталога.
 */
function catalog() {
  return require('./property-catalog');
}

// RU/ES: /ru/property/… /es/property/… — EN: /property/… (без /en/, такого пути на сайте нет)
const PROPERTY_URL_RE =
  /https?:\/\/(?:www\.)?housetenerife\.eu(?:\/(?:ru|es|en|de|fr|pl|nl))?\/property\/[^\s<>\])"'}]+/gi;

/** Любая ссылка на housetenerife.eu (в т.ч. выдуманные /objekt/123). */
const ANY_HT_URL_RE =
  /https?:\/\/(?:www\.)?housetenerife\.eu\/[^\s<>\])"'{}]+/gi;

let urlIndex = null;
let slugIndex = null;

function getPublicBase() {
  const explicit = process.env.PUBLIC_BASE_URL || process.env.BOT_PUBLIC_URL;
  if (explicit) return String(explicit).replace(/\/$/, '');
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railway) return `https://${railway.replace(/^https?:\/\//, '')}`;
  return null;
}

function propertySlugFromPath(pathname) {
  const m = String(pathname || '').match(/\/property\/([^/]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function normalizePropertyPath(url) {
  try {
    let pathname = new URL(url).pathname.replace(/\/+$/, '').toLowerCase();
    // На housetenerife.eu английская версия — /property/…, не /en/property/…
    if (pathname.startsWith('/en/property/')) {
      pathname = pathname.replace(/^\/en\/property\//, '/property/');
    }
    return pathname;
  } catch {
    return '';
  }
}

function rebuildUrlIndex() {
  urlIndex = new Map();
  slugIndex = new Map();
  const data = catalog().load();
  for (const item of data.items) {
    const candidates = new Set([item.url, ...(item.urls ? Object.values(item.urls) : [])].filter(Boolean));
    for (const u of candidates) {
      const key = normalizePropertyPath(u);
      if (key) urlIndex.set(key, item);
      const slug = propertySlugFromPath(key);
      if (slug) slugIndex.set(slug, item);
    }
    if (item.id) urlIndex.set(String(item.id).toUpperCase(), item);
  }
}

function ensureIndex() {
  if (!urlIndex) rebuildUrlIndex();
}

function findItemByUrl(url) {
  ensureIndex();
  const key = normalizePropertyPath(url);
  if (key && urlIndex.has(key)) return urlIndex.get(key);
  const slug = propertySlugFromPath(key);
  return slug ? slugIndex.get(slug) || null : null;
}

/** Убирает несуществующий префикс /en/ (404 на сайте). */
function stripInvalidEnPrefix(url) {
  return String(url || '').replace(
    /^(https?:\/\/(?:www\.)?housetenerife\.eu)\/en(\/property\/)/i,
    '$1$2'
  );
}

function findItemByPropertyId(id) {
  ensureIndex();
  return urlIndex.get(String(id || '').toUpperCase()) || null;
}

function repairKnownUrlSpacing(text) {
  return String(text || '')
    .replace(/https?:\s*\/\/\s*/gi, (match) =>
      match.toLowerCase().startsWith('https') ? 'https://' : 'http://'
    )
    .replace(/www\s*\.\s*/gi, 'www.')
    .replace(/housetenerife\s*\.\s*eu/gi, 'housetenerife.eu')
    .replace(/(housetenerife\.eu)\s*\/\s*/gi, '$1/')
    // Только доклейка кусков slug у /property/…, не «objekt/123 closest»
    .replace(
      /(https?:\/\/(?:www\.)?housetenerife\.eu(?:\/(?:ru|es|en|de|fr|pl|nl))?\/property\/[a-z0-9-]*)\s+([a-z0-9-]+\/?)/gi,
      '$1$2'
    );
}

function hasEnglishCatalogCopy(item) {
  const t = item.titles?.en;
  const d = item.descriptions?.en;
  return Boolean(t && t.length > 2 && d && d.length > 40);
}

/**
 * URL для отправки клиенту (WhatsApp preview = OG целевой страницы).
 */
function getShareUrl(item, lang) {
  if (!item) return '';
  const { getLocalizedItem, normalizeLang } = catalog();
  const l = normalizeLang(lang);
  const base = getPublicBase();

  if (l === 'en' && base && item.id && hasEnglishCatalogCopy(item)) {
    return `${base}/p/${encodeURIComponent(item.id)}?lang=en`;
  }

  return getLocalizedItem(item, l).url || item.url || '';
}

/**
 * Обрезает хвост, который модель приклеила к URL (…/slugWhichonefeels).
 */
function splitGluedUrlTail(rawUrl) {
  const url = String(rawUrl || '').replace(/[.,;:!?)]+$/g, '');

  // …/objekt/11223Whichone → …/objekt/11223 + Whichone
  const gluedDigits = url.match(
    /^(https?:\/\/(?:www\.)?housetenerife\.eu\/(?:(?:ru|es|en|de|fr|pl|nl)\/)?[a-z]+\/\d{2,})([A-Za-zА-Яа-яЁё].*)$/i
  );
  if (gluedDigits) {
    return { url: gluedDigits[1], tail: gluedDigits[2] };
  }

  // …/property/some-slug + ExtraWord (только если хвост с заглавной — иначе ломает villa-391)
  const prop = url.match(
    /^(https?:\/\/(?:www\.)?housetenerife\.eu(?:\/(?:ru|es|en|de|fr|pl|nl))?\/property\/[a-z0-9-]+\/?)([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё].*)$/
  );
  if (prop) {
    return { url: prop[1], tail: prop[2] };
  }

  return { url, tail: '' };
}

function formatUrlTail(tail) {
  if (!tail) return '';
  let t = String(tail).trim();
  t = t
    .replace(/^Whichonefeels\b/i, 'Which one feels')
    .replace(/^Whichone\b/i, 'Which one')
    .replace(/^Какойвариант\b/i, 'Какой вариант');
  return /^[A-ZА-ЯЁ]/.test(t) ? `\n${t}` : ` ${t}`;
}

function isCatalogPropertyUrl(url) {
  ensureIndex();
  const item = findItemByUrl(url);
  if (item) return true;
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, '');
    if (!/\/property\//i.test(pathname)) return false;
    // /en/property/… на сайте нет — но slug может быть валидным
    const normalized = pathname.replace(/^\/en\/property\//i, '/property/');
    return Boolean(findItemByUrl(`https://housetenerife.eu${normalized}/`));
  } catch {
    return false;
  }
}

function hasValidCatalogPropertyLinks(text) {
  if (!text) return false;
  ensureIndex();
  const re = new RegExp(PROPERTY_URL_RE.source, 'gi');
  const matches = String(text).match(re) || [];
  return matches.some((u) => isCatalogPropertyUrl(splitGluedUrlTail(u).url));
}

function hasInventedHtLinks(text) {
  if (!text) return false;
  ensureIndex();
  const re = new RegExp(ANY_HT_URL_RE.source, 'gi');
  const matches = String(text).match(re) || [];
  if (!matches.length) return false;
  return matches.some((raw) => {
    const { url } = splitGluedUrlTail(raw);
    if (/\/objekt\b|\/object\b|\/listing\b|\/id\/\d+/i.test(url)) return true;
    if (/\/property\//i.test(url)) return !isCatalogPropertyUrl(url);
    try {
      const path = new URL(url).pathname.replace(/\/+$/, '') || '/';
      if (path === '/' || path === '/ru' || path === '/es' || path === '/en') return false;
      return !/\/property\//i.test(path);
    } catch {
      return true;
    }
  });
}

/**
 * В подборке объектов оставляет только реальные карточки каталога House Tenerife
 * и внутренние proxy-ссылки /p/HZ… для локализованного preview.
 */
function stripNonCatalogUrls(text) {
  if (!text || typeof text !== 'string') return text;
  const publicBase = getPublicBase();
  let publicOrigin = '';
  try {
    publicOrigin = publicBase ? new URL(publicBase).origin : '';
  } catch {
    publicOrigin = '';
  }

  const isAllowed = (raw) => {
    const cleaned = String(raw || '').replace(/[.,;:!?)]+$/g, '');
    if (isCatalogPropertyUrl(cleaned)) return true;
    try {
      const parsed = new URL(cleaned);
      return (
        Boolean(publicOrigin) &&
        parsed.origin === publicOrigin &&
        /^\/p\/HZ[\w-]+/i.test(parsed.pathname)
      );
    } catch {
      return false;
    }
  };

  const markdownUrlRe = /\[([^\]]+)\]\((https?:\/\/[^\s<>)]+)\)/gi;
  let out = String(text).replace(markdownUrlRe, (match, label, url) =>
    isAllowed(url) ? match : String(label || '').trim()
  );
  const anyUrlRe = /https?:\/\/[^\s<>\])"'{}]+/gi;
  out = out.replace(anyUrlRe, (raw) => (isAllowed(raw) ? raw : ''));
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeShareUrlKey(url) {
  try {
    const u = new URL(stripInvalidEnPrefix(url));
    return `${u.origin}${u.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return String(url || '')
      .trim()
      .toLowerCase()
      .replace(/\/+$/, '');
  }
}

function extractPropertyUrlsFromText(text) {
  const re = new RegExp(PROPERTY_URL_RE.source, 'gi');
  return String(text || '').match(re) || [];
}

/** URL объектов, которые уже показывали в этом чате (чтобы не липнуть к одной ссылке). */
function collectRecentPropertyUrls(history, limit = 12) {
  const out = [];
  const seen = new Set();
  const msgs = [...(history || [])].reverse();
  for (const m of msgs) {
    if (m.sender !== 'assistant') continue;
    for (const raw of extractPropertyUrlsFromText(m.text)) {
      const key = normalizeShareUrlKey(splitGluedUrlTail(raw).url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(stripInvalidEnPrefix(splitGluedUrlTail(raw).url));
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Подменяет выдуманные / битые ссылки на реальные из каталога (preferredUrls).
 * Также локализует валидные /property/… ссылки.
 * @param {object} [options]
 * @param {string[]} [options.wantedTypes] — если задано, чужой тип (апартаменты при запросе вилл) заменяется
 * @param {string[]} [options.avoidUrls] — недавно показанные URL (подставлять в последнюю очередь)
 */
function repairPropertyUrlsInText(text, lang, preferredUrls = [], options = {}) {
  if (!text || typeof text !== 'string') return text;
  ensureIndex();

  const wantedTypes = Array.isArray(options.wantedTypes) ? options.wantedTypes : [];
  const avoidKeys = new Set(
    (options.avoidUrls || []).map((u) => normalizeShareUrlKey(u)).filter(Boolean)
  );
  const { itemMatchesPropertyTypes } = require('./property-types');

  const pool = [];
  const poolSeen = new Set();
  const pushPool = (u) => {
    const cleaned = stripInvalidEnPrefix(String(u || '').trim());
    if (!cleaned) return;
    const key = normalizeShareUrlKey(cleaned);
    if (poolSeen.has(key)) return;
    poolSeen.add(key);
    pool.push(cleaned);
  };
  // Сначала свежие из каталога, потом уже показанные (если больше нечего)
  const preferred = [...(preferredUrls || [])];
  const fresh = [];
  const reused = [];
  for (const u of preferred) {
    const key = normalizeShareUrlKey(u);
    if (avoidKeys.has(key)) reused.push(u);
    else fresh.push(u);
  }
  for (const u of fresh) pushPool(u);
  for (const u of reused) pushPool(u);

  let poolIdx = 0;
  const usedKeys = new Set();
  const nextPreferred = () => {
    while (poolIdx < pool.length) {
      const pref = pool[poolIdx++];
      const key = normalizeShareUrlKey(pref);
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      return pref;
    }
    return null;
  };

  let out = repairKnownUrlSpacing(text);
  out = out.replace(new RegExp(ANY_HT_URL_RE.source, 'gi'), (raw) => {
    const { url: sliced, tail } = splitGluedUrlTail(raw);
    const item = findItemByUrl(sliced);
    const suffix = formatUrlTail(tail);

    if (item) {
      let share = getShareUrl(item, lang);
      const key = normalizeShareUrlKey(share);
      const typeOk =
        !wantedTypes.length || itemMatchesPropertyTypes(item, wantedTypes);
      const recentlyShown = avoidKeys.has(key);
      // Повтор / чужой тип / уже показывали в чате → следующая из каталога
      if (!typeOk || usedKeys.has(key) || recentlyShown) {
        const pref = nextPreferred();
        if (pref) return `${pref}${suffix}`;
        if (!typeOk || usedKeys.has(key)) return suffix.trimStart();
        // recentlyShown but no alternatives — keep once
        if (usedKeys.has(key)) return suffix.trimStart();
      }
      usedKeys.add(key);
      return `${share}${suffix}`;
    }

    const pref = nextPreferred();
    if (pref) return `${pref}${suffix}`;
    return suffix.trimStart();
  });

  // Схлопнуть подряд идущие одинаковые ссылки (копипаст / двойная вставка)
  out = collapseAdjacentDuplicateUrls(out);

  return out.replace(/[ \t]{2,}/g, ' ').replace(/ \n/g, '\n').trim();
}

/** Убирает подряд дублирующиеся housetenerife URL (часто при копировании). */
function collapseAdjacentDuplicateUrls(text) {
  if (!text) return text;
  const re = new RegExp(ANY_HT_URL_RE.source, 'gi');
  let lastKey = null;
  const cleaned = String(text).replace(re, (raw) => {
    const key = normalizeShareUrlKey(splitGluedUrlTail(raw).url);
    if (key && key === lastKey) return '';
    lastKey = key;
    return raw;
  });
  return cleaned
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ');
}

/** Есть ли в тексте повторяющиеся /property/… ссылки */
function hasDuplicatePropertyUrls(text) {
  const re = new RegExp(PROPERTY_URL_RE.source, 'gi');
  const matches = String(text || '').match(re) || [];
  if (matches.length < 2) return false;
  const keys = matches.map((u) => normalizeShareUrlKey(splitGluedUrlTail(u).url));
  return new Set(keys).size < keys.length;
}

/** Есть ли ссылки на объекты другого типа, чем запросил клиент */
function hasMismatchedPropertyTypeUrls(text, wantedTypes) {
  if (!wantedTypes?.length || !text) return false;
  const { itemMatchesPropertyTypes } = require('./property-types');
  const re = new RegExp(PROPERTY_URL_RE.source, 'gi');
  const matches = String(text).match(re) || [];
  for (const raw of matches) {
    const item = findItemByUrl(splitGluedUrlTail(raw).url);
    if (item && !itemMatchesPropertyTypes(item, wantedTypes)) return true;
  }
  return false;
}

/**
 * Заменяет все ссылки housetenerife.eu/property/... на язык пользователя.
 */
function localizeUrlsInText(text, lang) {
  if (!text || typeof text !== 'string') return text;
  ensureIndex();
  return repairKnownUrlSpacing(text).replace(new RegExp(PROPERTY_URL_RE.source, 'gi'), (match) => {
    const { url, tail } = splitGluedUrlTail(match);
    const item = findItemByUrl(url);
    const suffix = formatUrlTail(tail);
    if (item) return `${getShareUrl(item, lang)}${suffix}`;
    // Не оставляем битые /property/… slug'и
    return suffix.trimStart();
  });
}

function invalidateUrlIndex() {
  urlIndex = null;
  slugIndex = null;
}

module.exports = {
  getPublicBase,
  getShareUrl,
  localizeUrlsInText,
  repairPropertyUrlsInText,
  stripNonCatalogUrls,
  hasValidCatalogPropertyLinks,
  hasInventedHtLinks,
  hasDuplicatePropertyUrls,
  hasMismatchedPropertyTypeUrls,
  collectRecentPropertyUrls,
  findItemByUrl,
  findItemByPropertyId,
  rebuildUrlIndex,
  invalidateUrlIndex,
  hasEnglishCatalogCopy
};
