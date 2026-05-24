/**
 * Локализованные ссылки для WhatsApp: превью под URL берётся с целевой страницы (OG-теги).
 * Для EN — прокси /p/HZ123?lang=en с английскими og:title/description из каталога.
 */
function catalog() {
  return require('./property-catalog');
}

const PROPERTY_URL_RE =
  /https?:\/\/(?:www\.)?housetenerife\.eu\/[a-z]{2}\/property\/[^\s<>\])"'}]+/gi;

let urlIndex = null;

function getPublicBase() {
  const explicit = process.env.PUBLIC_BASE_URL || process.env.BOT_PUBLIC_URL;
  if (explicit) return String(explicit).replace(/\/$/, '');
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railway) return `https://${railway.replace(/^https?:\/\//, '')}`;
  return null;
}

function normalizePropertyPath(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return '';
  }
}

function rebuildUrlIndex() {
  urlIndex = new Map();
  const data = catalog().load();
  for (const item of data.items) {
    const candidates = new Set([item.url, ...(item.urls ? Object.values(item.urls) : [])].filter(Boolean));
    for (const u of candidates) {
      const key = normalizePropertyPath(u);
      if (key) urlIndex.set(key, item);
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
  return key ? urlIndex.get(key) : null;
}

function findItemByPropertyId(id) {
  ensureIndex();
  return urlIndex.get(String(id || '').toUpperCase()) || null;
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
 * Заменяет все ссылки housetenerife.eu/property/... на язык пользователя.
 */
function localizeUrlsInText(text, lang) {
  if (!text || typeof text !== 'string') return text;
  ensureIndex();
  return text.replace(PROPERTY_URL_RE, (match) => {
    const item = findItemByUrl(match);
    return item ? getShareUrl(item, lang) : match;
  });
}

function invalidateUrlIndex() {
  urlIndex = null;
}

module.exports = {
  getPublicBase,
  getShareUrl,
  localizeUrlsInText,
  findItemByUrl,
  findItemByPropertyId,
  rebuildUrlIndex,
  invalidateUrlIndex,
  hasEnglishCatalogCopy
};
