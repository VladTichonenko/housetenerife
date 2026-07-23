/**
 * Догрузка объектов, которых нет в data/properties.json, но есть в sitemap (EN/RU/ES).
 * Быстрее полного sync-db: трогает только отсутствующие URL.
 *
 *   npm run sync-missing
 *   SYNC_DELAY_MS=800 npm run sync-missing
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://housetenerife.eu';
const DELAY_MS = parseInt(process.env.SYNC_DELAY_MS, 10) || 800;
const USER_AGENT = 'HouseTenerifeBot/1.0 (property catalog gap-fill)';
const outPath = path.join(__dirname, '..', 'data', 'properties.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pathOnly(full) {
  try {
    return new URL(full).pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return '';
  }
}

function langFrom(url) {
  const p = pathOnly(url);
  const m = p.match(/^\/([a-z]{2})\/property\//i);
  if (m) return m[1].toLowerCase();
  if (/^\/property\//i.test(p)) return 'en';
  return 'xx';
}

function slugFrom(url) {
  const m = pathOnly(url).match(/\/property\/([^/]+)$/i);
  return m ? m[1].toLowerCase() : null;
}

function canonical(full) {
  const p = pathOnly(full);
  if (!/^\/(?:[a-z]{2}\/)?property\/[^/]+$/i.test(p)) return null;
  return `${BASE}${p}/`;
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xml,*/*' },
    timeout: 90000,
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400
  });
  return res.data;
}

function extractId(html) {
  const hz = String(html).match(/\bHZ\d{2,6}\b/i);
  if (hz) return hz[0].toUpperCase();
  const dataId = String(html).match(/data-property-id=["']?(\d{2,8})/i);
  if (dataId) return `HZ${dataId[1]}`;
  const postId = String(html).match(/<body[^>]*class="[^"]*\bpostid-(\d{2,8})\b/i);
  if (postId) return `HZ${postId[1]}`;
  return null;
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

function extractAlternates(html) {
  const out = {};
  const re =
    /https?:\/\/(?:www\.)?housetenerife\.eu\/(?:([a-z]{2})\/)?property\/[a-z0-9-]+\/?/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const lang = m[1] ? m[1].toLowerCase() : 'en';
    const url = canonical(m[0]);
    if (url) out[lang] = url;
  }
  return out;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const items = raw.items || [];
  const knownSlugs = new Set();
  const byId = new Map();
  for (const it of items) {
    const key = it.id || slugFrom(it.url) || it.url;
    byId.set(key, it);
    for (const u of [it.url, ...Object.values(it.urls || {})]) {
      const s = slugFrom(u || '');
      if (s) knownSlugs.add(s);
    }
  }

  console.log(`Текущий каталог: ${items.length} объектов, ${knownSlugs.size} известных slug`);

  const idx = await fetchHtml(`${BASE}/sitemap_index.xml`);
  const sitemaps = [...String(idx).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
    .map((m) => m[1].trim())
    .filter((u) => /property-sitemap/i.test(u));

  const missingUrls = [];
  const seenMissing = new Set();
  for (const sm of sitemaps) {
    const xml = await fetchHtml(sm);
    for (const loc of [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) =>
      m[1].trim()
    )) {
      const u = canonical(loc);
      if (!u) continue;
      const lang = langFrom(u);
      if (!['ru', 'es', 'en'].includes(lang)) continue;
      const slug = slugFrom(u);
      if (!slug || knownSlugs.has(slug) || seenMissing.has(slug)) continue;
      seenMissing.add(slug);
      missingUrls.push(u);
    }
    await sleep(200);
  }

  const order = { ru: 0, es: 1, en: 2 };
  missingUrls.sort((a, b) => (order[langFrom(a)] ?? 9) - (order[langFrom(b)] ?? 9));

  console.log(`В sitemap нет в каталоге: ${missingUrls.length} URL`);
  console.log(
    'ℹ️  Sitemap считает языковые страницы отдельно; уникальных объектов обычно ~600–700.'
  );
  if (!missingUrls.length) {
    console.log('Догружать нечего.');
    return;
  }

  let added = 0;
  let merged = 0;
  let errors = 0;
  const processed = new Set();

  for (const pu of missingUrls) {
    const slug = slugFrom(pu);
    if (!slug || processed.has(slug) || knownSlugs.has(slug)) continue;
    process.stdout.write(`\rДогрузка ${added + merged + 1}/${missingUrls.length} (ошибок ${errors})…`);
    try {
      const html = await fetchHtml(pu);
      const alternates = extractAlternates(html);
      const parsed = parseProperty(html, pu);
      const id = extractId(html);
      const urls = { ru: alternates.ru || null, es: alternates.es || null, en: alternates.en || null };
      const lang = langFrom(pu);
      urls[lang] = pu;
      const item = {
        id,
        url: urls.ru || urls.es || urls.en || pu,
        title: parsed.title,
        price: parsed.price,
        overview: parsed.overview,
        description: parsed.description,
        urls,
        titles: { [lang]: parsed.title },
        descriptions: { [lang]: parsed.description },
        overviews: { [lang]: parsed.overview }
      };
      for (const s of Object.values(urls).map(slugFrom).filter(Boolean)) {
        processed.add(s);
        knownSlugs.add(s);
      }
      processed.add(slug);
      knownSlugs.add(slug);

      const key = id || slug;
      if (byId.has(key)) {
        const prev = byId.get(key);
        byId.set(key, {
          ...prev,
          urls: { ...(prev.urls || {}), ...urls },
          titles: { ...(prev.titles || {}), ...item.titles },
          descriptions: { ...(prev.descriptions || {}), ...item.descriptions },
          overviews: { ...(prev.overviews || {}), ...item.overviews },
          id: prev.id || id,
          price: prev.price || item.price
        });
        merged++;
      } else {
        byId.set(key, item);
        added++;
      }
    } catch (e) {
      errors++;
      console.warn(`\nОшибка ${pu}: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }

  const finalItems = [...byId.values()];
  const out = {
    syncedAt: new Date().toISOString(),
    source: BASE,
    count: finalItems.length,
    langs: raw.langs || ['ru', 'es'],
    items: finalItems
  };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(
    `\nГотово: было ${items.length} → стало ${finalItems.length} (добавлено ${added}, слито ${merged}, ошибок ${errors})`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
