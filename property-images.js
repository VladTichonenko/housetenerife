'use strict';

/**
 * Фото объектов каталога: og:image, кэш в properties.json, детект просьбы «пришли фото».
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { findItemByUrl, findItemByPropertyId } = require('./property-share');
const { getLocalizedItem, normalizeLang, reload } = require('./property-catalog');
const { getShareUrl } = require('./property-share');

const FETCH_TIMEOUT_MS = Math.min(
  20000,
  Math.max(4000, parseInt(process.env.PROPERTY_IMAGE_FETCH_TIMEOUT_MS, 10) || 10000)
);
const MAX_PHOTOS_PER_REPLY = Math.min(
  5,
  Math.max(1, parseInt(process.env.PROPERTY_PHOTOS_MAX, 10) || 3)
);
const USER_AGENT = 'HouseTenerifeBot/1.0 (property image fetch)';

function resolveCatalogPath() {
  if (process.env.PROPERTIES_PATH) return process.env.PROPERTIES_PATH;
  return path.join(__dirname, 'data', 'properties.json');
}

function wantsPropertyPhotos(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return false;
  return /(?:фото|фотк|снимк|картинк|изображен|gallery|галере)|(?:show|send|give|want|need|see).{0,24}(?:photo|photos|pics?|pictures?|images?)|(?:photo|photos|pics?|pictures?|images?).{0,20}(?:please|of|the)|(?:foto|fotos|im[aá]genes?).{0,20}(?:por\s+favor|del|de)|(?:muestra|env[ií]a|manda|quiero|dame).{0,24}(?:foto|fotos|im[aá]gen)|(?:zeig|schicken|sende|schick).{0,24}(?:foto|bilder|bild)|(?:montre|envoie|voir).{0,24}(?:photo|photos|images?)|(?:poka[zż]|prze[sś]lij|zdj[eę]c)|(?:stuur|laat\s+zien|foto'?s?)/i.test(
    t
  );
}

function extractOgImageFromHtml(html) {
  const $ = cheerio.load(String(html || ''));
  const candidates = [
    $('meta[property="og:image"]').attr('content'),
    $('meta[property="og:image:secure_url"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    $('meta[name="twitter:image:src"]').attr('content'),
    $('.property-banner img, .property-featured-image img, .property-slider img, .lightbox-content img')
      .first()
      .attr('src'),
    $('img[src*="uploads"]').first().attr('src'),
  ].filter(Boolean);
  for (const raw of candidates) {
    const u = absolutizeImageUrl(raw);
    if (u) return u;
  }
  return null;
}

function absolutizeImageUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return null;
  if (u.startsWith('//')) u = `https:${u}`;
  if (u.startsWith('/')) u = `https://housetenerife.eu${u}`;
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    const parsed = new URL(u);
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function fetchOgImageFromPage(pageUrl) {
  if (!pageUrl || !/housetenerife\.eu/i.test(pageUrl)) return null;
  try {
    const res = await axios.get(pageUrl, {
      timeout: FETCH_TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    return extractOgImageFromHtml(res.data);
  } catch (e) {
    console.warn('🖼️ fetchOgImage:', e.message);
    return null;
  }
}

function persistOgImage(itemId, ogImage) {
  if (!itemId || !ogImage) return;
  const filePath = resolveCatalogPath();
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(data.items)) return;
    const idx = data.items.findIndex(
      (x) => String(x.id || '').toUpperCase() === String(itemId).toUpperCase()
    );
    if (idx < 0) return;
    data.items[idx].ogImage = ogImage;
    if (!Array.isArray(data.items[idx].images)) data.items[idx].images = [];
    if (!data.items[idx].images.includes(ogImage)) {
      data.items[idx].images = [ogImage, ...data.items[idx].images].slice(0, 8);
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    try {
      reload();
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.warn('🖼️ persistOgImage:', e.message);
  }
}

/**
 * @param {object} item
 * @returns {Promise<string|null>}
 */
async function resolvePropertyImageUrl(item) {
  if (!item) return null;
  if (item.ogImage) return absolutizeImageUrl(item.ogImage);
  if (Array.isArray(item.images) && item.images[0]) {
    return absolutizeImageUrl(item.images[0]);
  }
  const pageUrl =
    item.url ||
    item.urls?.ru ||
    item.urls?.es ||
    item.urls?.en ||
    Object.values(item.urls || {}).find(Boolean);
  if (!pageUrl) return null;
  const og = await fetchOgImageFromPage(pageUrl);
  if (og && item.id) persistOgImage(item.id, og);
  return og;
}

function extractPropertyItemsFromReplyText(text) {
  const s = String(text || '');
  const items = [];
  const seen = new Set();

  const propRe =
    /https?:\/\/(?:www\.)?housetenerife\.eu(?:\/(?:ru|es|en|de|fr|pl|nl))?\/property\/[^\s<>\])"'{}]+/gi;
  let m;
  while ((m = propRe.exec(s))) {
    const item = findItemByUrl(m[0].replace(/[.,;:!?)]+$/, ''));
    if (!item) continue;
    const key = String(item.id || m[0]).toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  const hzRe = /\b(HZ\d{2,6})\b/gi;
  while ((m = hzRe.exec(s))) {
    const item = findItemByPropertyId(m[1]);
    if (!item) continue;
    const key = String(item.id).toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  return items;
}

function buildPhotoCaption(item, lang = 'ru') {
  const l = normalizeLang(lang);
  const loc = getLocalizedItem(item, l);
  const share = getShareUrl(item, l) || loc.url || item.url || '';
  const title = loc.title || item.title || item.id || 'Object';
  const price = loc.price || item.price || '';
  const lines = [`*${title}*`, price, share].filter(Boolean);
  return lines.join('\n');
}

/**
 * Подготовить до N фото для отправки после ответа со ссылками / по просьбе.
 * @param {string} replyText
 * @param {string} [lang]
 * @param {{ force?: boolean, historyText?: string }} [opts]
 * @returns {Promise<Array<{ id: string, imageUrl: string, caption: string }>>}
 */
async function preparePropertyPhotosForSend(replyText, lang = 'ru', opts = {}) {
  let items = extractPropertyItemsFromReplyText(replyText);
  if (!items.length && opts.historyText) {
    items = extractPropertyItemsFromReplyText(opts.historyText);
  }
  if (!items.length && opts.force) {
    // последний шанс — заинтересованные объекты в runtime подтянет вызывающий код
    return [];
  }

  const out = [];
  for (const item of items.slice(0, MAX_PHOTOS_PER_REPLY)) {
    try {
      const imageUrl = await resolvePropertyImageUrl(item);
      if (!imageUrl) {
        console.warn(`🖼️ Нет фото для ${item.id}`);
        continue;
      }
      out.push({
        id: item.id,
        imageUrl,
        caption: buildPhotoCaption(item, lang),
      });
    } catch (e) {
      console.warn(`🖼️ photo ${item.id}:`, e.message);
    }
  }
  return out;
}

function extractOgImageFromHtmlExport(html) {
  return extractOgImageFromHtml(html);
}

module.exports = {
  wantsPropertyPhotos,
  resolvePropertyImageUrl,
  preparePropertyPhotosForSend,
  extractPropertyItemsFromReplyText,
  extractOgImageFromHtml: extractOgImageFromHtmlExport,
  fetchOgImageFromPage,
  persistOgImage,
  buildPhotoCaption,
  MAX_PHOTOS_PER_REPLY,
};
