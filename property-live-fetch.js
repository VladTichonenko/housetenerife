'use strict';

/**
 * On-demand загрузка карточки объекта с housetenerife.eu,
 * когда ссылки клиента нет в локальном properties.json.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { findItemByUrl, findItemByPropertyId, invalidateUrlIndex } = require('./property-share');
const { reload } = require('./property-catalog');

const BASE = 'https://housetenerife.eu';
const USER_AGENT = 'HouseTenerifeBot/1.0 (property live fetch; contact agency)';
const FETCH_TIMEOUT_MS = Math.min(
  20000,
  Math.max(4000, parseInt(process.env.PROPERTY_LIVE_FETCH_TIMEOUT_MS, 10) || 12000)
);

function resolveCatalogPath() {
  if (process.env.PROPERTIES_PATH) return process.env.PROPERTIES_PATH;
  return path.join(__dirname, 'data', 'properties.json');
}

function propertyUrlFromText(text) {
  const s = String(text || '');
  const urls = [];
  const propRe =
    /https?:\/\/(?:www\.)?housetenerife\.eu(?:\/(?:ru|es|en|de|fr|pl|nl))?\/property\/[^\s<>\])"'{}]+/gi;
  let m;
  while ((m = propRe.exec(s))) {
    urls.push(m[0].replace(/[.,;:!?)]+$/, ''));
  }
  return [...new Set(urls)];
}

function extractPropertyIdFromHtml(html) {
  const s = String(html || '');
  const hz = s.match(/\bHZ\d{2,6}\b/i);
  if (hz) return hz[0].toUpperCase();
  const dataId = s.match(/data-property-id=["']?(\d{2,8})/i);
  if (dataId) return `HZ${dataId[1]}`;
  const postId = s.match(/<body[^>]*class="[^"]*\bpostid-(\d{2,8})\b/i);
  if (postId) return `HZ${postId[1]}`;
  return null;
}

function extractAlternatePropertyUrls(html) {
  const out = {};
  const re =
    /https?:\/\/(?:www\.)?housetenerife\.eu\/(?:([a-z]{2})\/)?property\/[a-z0-9-]+\/?/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const lang = m[1] ? m[1].toLowerCase() : 'en';
    out[lang] = m[0].replace(/\/+$/, '') + '/';
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
    description: description || '',
  };
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return String(res.data || '');
}

function pathLang(url) {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/^\/(ru|es|en|de|fr|pl|nl)\//i);
    return m ? m[1].toLowerCase() : 'en';
  } catch {
    return 'en';
  }
}

function upsertCatalogItem(item) {
  if (!item?.id && !item?.url) return null;
  const filePath = resolveCatalogPath();
  let data = { items: [], syncedAt: null, count: 0 };
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    data = { items: [], syncedAt: null, count: 0 };
  }
  if (!Array.isArray(data.items)) data.items = [];

  const key = String(item.id || '').toUpperCase();
  const idx = data.items.findIndex((x) => {
    if (key && String(x.id || '').toUpperCase() === key) return true;
    const urls = [x.url, ...(x.urls ? Object.values(x.urls) : [])].filter(Boolean);
    const itemUrls = [item.url, ...(item.urls ? Object.values(item.urls) : [])].filter(Boolean);
    return urls.some((u) => itemUrls.some((iu) => String(u).includes(String(iu).split('/').pop())));
  });

  if (idx >= 0) {
    const prev = data.items[idx];
    data.items[idx] = {
      ...prev,
      ...item,
      urls: { ...(prev.urls || {}), ...(item.urls || {}) },
      titles: { ...(prev.titles || {}), ...(item.titles || {}) },
      descriptions: { ...(prev.descriptions || {}), ...(item.descriptions || {}) },
      overviews: { ...(prev.overviews || {}), ...(item.overviews || {}) },
      id: item.id || prev.id,
      price: item.price || prev.price,
    };
  } else {
    data.items.push(item);
  }

  data.count = data.items.length;
  data.syncedAt = new Date().toISOString();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  try {
    invalidateUrlIndex();
  } catch {
    /* ignore */
  }
  reload();
  return idx >= 0 ? data.items[idx] : item;
}

async function fetchPropertyFromUrl(url) {
  const cleaned = String(url || '').replace(/[.,;:!?)]+$/, '');
  if (!/housetenerife\.eu/i.test(cleaned)) return null;

  const existing = findItemByUrl(cleaned);
  if (existing) return existing;

  console.log(`🔗 Live-fetch объекта: ${cleaned}`);
  const html = await fetchHtml(cleaned);
  const parsed = parseProperty(html, cleaned);
  const id =
    extractPropertyIdFromHtml(html) ||
    extractPropertyIdFromHtml(parsed.description) ||
    (() => {
      const m = cleaned.match(/-(\d{2,6})\/?$/);
      return m ? `HZ${m[1]}` : null;
    })();

  if (id) {
    const byId = findItemByPropertyId(id);
    if (byId) return byId;
  }

  const lang = pathLang(cleaned);
  const alternates = extractAlternatePropertyUrls(html);
  const item = {
    id: id || `HZ${Date.now().toString().slice(-6)}`,
    url: alternates.ru || cleaned,
    title: parsed.title,
    price: parsed.price,
    overview: parsed.overview,
    description: parsed.description,
    urls: { [lang]: cleaned, ...alternates },
    titles: { [lang]: parsed.title },
    descriptions: { [lang]: parsed.description },
    overviews: { [lang]: parsed.overview },
    liveFetchedAt: new Date().toISOString(),
  };

  return upsertCatalogItem(item);
}

/**
 * Резолвит ссылки из текста клиента: каталог → при miss live-fetch.
 * @param {string} text
 * @returns {Promise<object[]>}
 */
async function resolvePropertyItemsFromText(text) {
  const { extractPropertyItemsFromText } = require('./property-interest');
  let items = extractPropertyItemsFromText(text);
  if (items.length) return items;

  const urls = propertyUrlFromText(text);
  if (!urls.length) return [];

  const found = [];
  const seen = new Set();
  for (const url of urls.slice(0, 2)) {
    try {
      const item = await fetchPropertyFromUrl(url);
      if (!item) continue;
      const key = String(item.id || item.url).toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(item);
    } catch (e) {
      console.warn(`⚠️ Live-fetch не удался (${url}):`, e.message);
    }
  }
  return found;
}

module.exports = {
  fetchPropertyFromUrl,
  resolvePropertyItemsFromText,
  propertyUrlFromText,
};
