/**
 * Добавляет ES (и др.) к уже существующему data/properties.json без полного обхода каталога.
 * SYNC_EXTRA_LANGS=es node scripts/enrich-properties-i18n.js
 */
require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { normalizeItem } = require('../property-catalog');

const BASE = 'https://housetenerife.eu';
const USER_AGENT = 'HouseTenerifeBot/1.0 (property i18n enrich)';
const DELAY_MS = parseInt(process.env.SYNC_DELAY_MS, 10) || 2000;
const LANGS = (process.env.SYNC_EXTRA_LANGS || 'es')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s && s !== 'ru');
const DATA = path.join(__dirname, '..', 'data', 'properties.json');
const RETRIES = parseInt(process.env.SYNC_RETRIES, 10) || 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isTransientNetError(err) {
  const code = err.code || err.cause?.code;
  const msg = String(err.message || '');
  return (
    ['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code) ||
    /timeout|network/i.test(msg)
  );
}

function extractAlternatePropertyUrls(html) {
  const out = {};
  const re = /housetenerife\.eu\/([a-z]{2})\/property\/[^"'#\s]+/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const lang = m[1].toLowerCase();
    let url = m[0];
    if (!url.startsWith('http')) url = `https://${url}`;
    out[lang] = url.endsWith('/') ? url : `${url}/`;
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
  const ogImage =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    '';
  return { url, title, price, overview, description, ogImage };
}

async function fetchHtml(url) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        timeout: 90000,
        validateStatus: (s) => s >= 200 && s < 400
      });
      return res.data;
    } catch (err) {
      lastErr = err;
      if (!isTransientNetError(err) || attempt === RETRIES) throw err;
      await sleep(DELAY_MS * attempt);
    }
  }
  throw lastErr;
}

function missingLangs(item) {
  return LANGS.filter((lang) => {
    const d = item.descriptions?.[lang];
    return !d || d.length < 40;
  });
}

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  data.items = (data.items || []).map(normalizeItem);
  let done = 0;
  let skipped = 0;

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    const need = missingLangs(item);
    if (!need.length) {
      skipped++;
      continue;
    }
    const ruUrl = item.urls?.ru || item.url;
    process.stdout.write(`\r${i + 1}/${data.items.length} ${ruUrl.slice(-48)}…`);
    try {
      const html = await fetchHtml(ruUrl);
      const ruParsed = parseProperty(html, ruUrl);
      if (ruParsed.ogImage && !item.ogImage) item.ogImage = ruParsed.ogImage;
      const alts = extractAlternatePropertyUrls(html);
      for (const lang of need) {
        const altUrl = alts[lang];
        if (!altUrl) continue;
        const altHtml = await fetchHtml(altUrl);
        const parsed = parseProperty(altHtml, altUrl);
        item.urls = item.urls || {};
        item.titles = item.titles || {};
        item.descriptions = item.descriptions || {};
        item.overviews = item.overviews || {};
        item.urls[lang] = parsed.url;
        item.titles[lang] = parsed.title;
        item.descriptions[lang] = parsed.description;
        item.overviews[lang] = parsed.overview;
        if (parsed.ogImage && !item.ogImage) item.ogImage = parsed.ogImage;
        await sleep(DELAY_MS);
      }
      done++;
      if (done % 5 === 0) {
        fs.writeFileSync(DATA, JSON.stringify(data, null, 2), 'utf8');
      }
    } catch (e) {
      console.warn(`\nНе удалось скачать (ES не добавлен): ${ruUrl} — ${e.message}`);
    }
    await sleep(DELAY_MS);
  }

  fs.writeFileSync(DATA, JSON.stringify(data, null, 2), 'utf8');
  console.log(`\nГотово. Обновлено: ${done}, уже были все языки: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
