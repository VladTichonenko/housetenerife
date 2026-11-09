'use strict';

/**
 * Статус объявления (продано / зарезервировано / не продаётся).
 *
 * Houzez на housetenerife.eu показывает статус бейджем
 *   <a href=".../ru/status/prodano/" class="label-status label status-color-1817">Продано</a>
 * (таксономия `status`: for-sale, sold / prodano / vendido / verkauft …).
 * Бейджи есть и у карточек «Similar Listings» внизу страницы — их игнорируем,
 * иначе объект «наследует» статус соседей.
 *
 * Поля, которые пишет sync / live-fetch в data/properties.json:
 *   availability: 'available' | 'sold' | 'reserved' | 'unavailable'
 *   sold: boolean          — true для sold/reserved/unavailable (не рекомендовать)
 *   statusLabels: string[] — тексты бейджей
 *   statusSlugs: string[]  — slug таксономии status (prodano, sold, …)
 *   statusCheckedAt: ISO
 */

const cheerio = require('cheerio');

const L = '[\\p{L}\\p{N}]';
const WB = `(?<!${L})`;
const WE = `(?!${L})`;

const SOLD_WORDS = [
  'продано',
  'продан[аоы]?',
  'sold(?:[\\s-]*out)?',
  'vendid[oa]s?',
  'vendu[es]?',
  'verkauft',
  'sprzedan[aey]?',
  'prodáno',
  'prodano',
  'prodán[ao]?',
  'verkocht',
  'venduto',
  'vendut[aei]',
  'satıldı',
  'продан[оаи]',
  'проданий',
].join('|');

const RESERVED_WORDS = [
  'зарезервирован\\p{L}*',
  'в\\s+резерве',
  'reserved',
  'reservad[oa]s?',
  'réservé[es]?',
  'reserviert',
  'zarezerwowan\\p{L}*',
  'rezerwacj\\p{L}*',
  'gereserveerd',
  'rezervov\\p{L}*',
  'under\\s+offer',
  'sale\\s+agreed',
  'sold\\s+stc',
].join('|');

const UNAVAILABLE_WORDS = [
  'not\\s+for\\s+sale',
  'no\\s+(?:est[aá]\\s+)?disponible',
  'nicht\\s+verf[uü]gbar',
  'indisponible',
  'niedost[eę]pn\\p{L}*',
  'недоступн\\p{L}*',
  'не\\s+продаётся',
  'не\\s+продается',
  'снят\\p{L}*\\s+с\\s+продаж\\p{L}*',
  'withdrawn',
  'off[\\s-]?market',
].join('|');

const SOLD_TEXT_RE = new RegExp(`${WB}(?:${SOLD_WORDS})${WE}`, 'iu');
const RESERVED_TEXT_RE = new RegExp(`${WB}(?:${RESERVED_WORDS})${WE}`, 'iu');
const UNAVAILABLE_TEXT_RE = new RegExp(`${WB}(?:${UNAVAILABLE_WORDS})${WE}`, 'iu');

/** /status/sold/, /ru/status/prodano/, /status/for-sold/, /es/status/vendido/ … */
const STATUS_PATH_RE = /\/status\/([a-z0-9%_-]+)\/?(?:[?#].*)?$/i;
const SOLD_SLUG_RE =
  /^(?:for-)?(?:sold|sold-out|prodano|prodan[a-z]*|prodano-\d+|vendid[a-z]*|vendu[a-z]*|verkauft|verkocht|venduto|sprzedan[a-z]*|prodáno)(?:-\d+)?$/i;
const RESERVED_SLUG_RE =
  /^(?:for-)?(?:reserved|reservad[a-z]*|reserve[a-z]*|reserviert|zarezerwowan[a-z]*|gereserveerd|zarezervirovan[a-z]*|rezerv[a-z]*|under-offer|sale-agreed)(?:-\d+)?$/i;
const UNAVAILABLE_SLUG_RE =
  /^(?:not-for-sale|unavailable|withdrawn|off-market|no-disponible|nicht-verfuegbar|indisponible|niedostepn[a-z]*)(?:-\d+)?$/i;

/** Блоки страницы, где бейджи принадлежат ДРУГИМ объектам или навигации. */
const FOREIGN_BLOCKS = [
  '#similar-listings-wrap',
  '.similar-property-wrap',
  '.item-listing-wrap',
  '.listing-view',
  '.houzez-listing-view',
  '.widget',
  'header',
  'nav',
  'footer',
  'aside',
  '.main-nav',
  '.mobile-nav',
  '.footer-wrap',
].join(',');

const SEVERITY = { available: 0, unavailable: 1, reserved: 2, sold: 3 };

/**
 * Runtime-пометки (live-check увидел «Продано» раньше, чем прошёл sync-db).
 * Живут до рестарта процесса; постоянный флаг ставит scripts/sync-status.js / sync-db.
 */
const runtimeBlocked = new Map();

function itemKeys(item) {
  const keys = [];
  if (item?.id) keys.push(`id:${String(item.id).toUpperCase()}`);
  const urls = [item?.url, ...Object.values(item?.urls || {})].filter(Boolean);
  for (const u of urls) {
    const m = String(u).match(/\/property\/([^/?#]+)/i);
    if (m) keys.push(`slug:${m[1].toLowerCase()}`);
  }
  return keys;
}

function urlKey(url) {
  const m = String(url || '').match(/\/property\/([^/?#]+)/i);
  return m ? `slug:${m[1].toLowerCase()}` : '';
}

function markRuntimeAvailability(itemOrUrl, availability) {
  const keys =
    typeof itemOrUrl === 'string' ? [urlKey(itemOrUrl)].filter(Boolean) : itemKeys(itemOrUrl);
  for (const k of keys) {
    if (!availability || availability === 'available') runtimeBlocked.delete(k);
    else runtimeBlocked.set(k, availability);
  }
}

function clearRuntimeAvailability() {
  runtimeBlocked.clear();
}

function classifyStatusText(text) {
  const s = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || s.length > 80) return null;
  if (SOLD_TEXT_RE.test(s)) return 'sold';
  if (RESERVED_TEXT_RE.test(s)) return 'reserved';
  if (UNAVAILABLE_TEXT_RE.test(s)) return 'unavailable';
  return null;
}

function statusSlugFromHref(href) {
  const raw = String(href || '').trim();
  if (!raw) return '';
  let p = raw;
  try {
    p = new URL(raw, 'https://housetenerife.eu').pathname;
  } catch {
    /* keep raw */
  }
  const m = p.match(STATUS_PATH_RE);
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]).toLowerCase();
  } catch {
    return m[1].toLowerCase();
  }
}

function classifyStatusSlug(slug) {
  const s = String(slug || '').toLowerCase();
  if (!s) return null;
  if (SOLD_SLUG_RE.test(s)) return 'sold';
  if (RESERVED_SLUG_RE.test(s)) return 'reserved';
  if (UNAVAILABLE_SLUG_RE.test(s)) return 'unavailable';
  return null;
}

function worse(a, b) {
  return (SEVERITY[b] || 0) > (SEVERITY[a] || 0) ? b : a;
}

/**
 * Статус ГЛАВНОГО объекта страницы по HTML.
 * @param {string} html
 * @returns {{ availability: string, sold: boolean, labels: string[], slugs: string[] }}
 */
function extractStatusFromHtml(html) {
  const out = { availability: 'available', sold: false, labels: [], slugs: [] };
  const src = String(html || '');
  if (!src) return out;

  let $;
  try {
    $ = cheerio.load(src);
  } catch {
    return out;
  }
  $(FOREIGN_BLOCKS).remove();

  const seenLabel = new Set();
  const seenSlug = new Set();
  const consider = (label, href) => {
    const text = String(label || '')
      .replace(/\s+/g, ' ')
      .trim();
    const slug = statusSlugFromHref(href);
    if (text && !seenLabel.has(text.toLowerCase())) {
      seenLabel.add(text.toLowerCase());
      out.labels.push(text);
    }
    if (slug && !seenSlug.has(slug)) {
      seenSlug.add(slug);
      out.slugs.push(slug);
    }
    const byText = classifyStatusText(text);
    const bySlug = classifyStatusSlug(slug);
    if (byText) out.availability = worse(out.availability, byText);
    if (bySlug) out.availability = worse(out.availability, bySlug);
  };

  $('a.label-status, .label-status, .property-labels-wrap a, a[href*="/status/"]').each((_, el) => {
    const $el = $(el);
    const href = $el.is('a') ? $el.attr('href') : $el.find('a').first().attr('href');
    consider($el.text(), href);
  });

  out.sold = out.availability !== 'available';
  return out;
}

/** Ручное исключение без sync: CATALOG_EXCLUDE_IDS=HZ1276,HZ800 */
function manualExcludedIds() {
  return new Set(
    String(process.env.CATALOG_EXCLUDE_IDS || '')
      .split(/[\s,;]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  );
}

const TITLE_SOLD_PREFIX_RE =
  /^\s*[[(]?\s*(?:sold|продано|продан[оа]?|vendido|verkauft|vendu|sprzedan[ey]|prodáno)\s*[\])]?\s*[-–—:!|]/iu;

/**
 * @param {object} item запись каталога
 * @returns {'available'|'sold'|'reserved'|'unavailable'}
 */
function getAvailability(item) {
  if (!item || typeof item !== 'object') return 'available';

  const ids = manualExcludedIds();
  if (ids.size && ids.has(String(item.id || '').toUpperCase())) return 'unavailable';

  if (runtimeBlocked.size) {
    for (const k of itemKeys(item)) {
      const v = runtimeBlocked.get(k);
      if (v) return v;
    }
  }

  const explicit = String(item.availability || '').toLowerCase();
  if (explicit && explicit !== 'available' && SEVERITY[explicit] != null) return explicit;
  if (item.sold === true) return 'sold';
  if (item.unavailable === true) return 'unavailable';

  let best = 'available';
  for (const label of Array.isArray(item.statusLabels) ? item.statusLabels : []) {
    const c = classifyStatusText(label);
    if (c) best = worse(best, c);
  }
  for (const slug of Array.isArray(item.statusSlugs) ? item.statusSlugs : []) {
    const c = classifyStatusSlug(slug);
    if (c) best = worse(best, c);
  }
  if (best !== 'available') return best;

  const titles = [item.title, ...Object.values(item.titles || {})];
  for (const t of titles) {
    if (t && TITLE_SOLD_PREFIX_RE.test(String(t))) return 'sold';
  }
  return 'available';
}

/** Можно ли рекомендовать объект клиенту. */
function isListingAvailable(item) {
  return getAvailability(item) === 'available';
}

/** Поля статуса для записи в каталог из extractStatusFromHtml. */
function statusFieldsFromExtract(status, now = new Date()) {
  const s = status || {};
  const availability = s.availability || 'available';
  return {
    availability,
    sold: availability !== 'available',
    statusLabels: Array.isArray(s.labels) ? s.labels : [],
    statusSlugs: Array.isArray(s.slugs) ? s.slugs : [],
    statusCheckedAt: now.toISOString(),
  };
}

/** Худший статус из нескольких языковых страниц одного объекта. */
function mergeStatusFields(...fieldSets) {
  const sets = fieldSets.filter(Boolean);
  if (!sets.length) return statusFieldsFromExtract({});
  let availability = 'available';
  const labels = [];
  const slugs = [];
  let checked = null;
  for (const f of sets) {
    availability = worse(availability, f.availability || 'available');
    for (const l of f.statusLabels || []) if (!labels.includes(l)) labels.push(l);
    for (const sl of f.statusSlugs || []) if (!slugs.includes(sl)) slugs.push(sl);
    if (f.statusCheckedAt && (!checked || f.statusCheckedAt > checked)) checked = f.statusCheckedAt;
  }
  return {
    availability,
    sold: availability !== 'available',
    statusLabels: labels,
    statusSlugs: slugs,
    statusCheckedAt: checked || new Date().toISOString(),
  };
}

module.exports = {
  classifyStatusText,
  classifyStatusSlug,
  statusSlugFromHref,
  extractStatusFromHtml,
  getAvailability,
  isListingAvailable,
  statusFieldsFromExtract,
  mergeStatusFields,
  manualExcludedIds,
  markRuntimeAvailability,
  clearRuntimeAvailability,
};
