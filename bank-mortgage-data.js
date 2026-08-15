'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const { getPuppeteerLaunchOptions } = require('./puppeteer-env');

const DATA_PATH =
  process.env.BANK_MORTGAGE_RATES_PATH ||
  path.join(__dirname, 'data', 'bank-mortgage-rates.json');

const KNOWLEDGE_PATH =
  process.env.KNOWLEDGE_PATH || path.join(__dirname, 'consultant-knowledge.json');

const USER_AGENT =
  process.env.MORTGAGE_SYNC_USER_AGENT ||
  'Mozilla/5.0 (compatible; HouseTenerifeBot/1.0; +https://housetenerife.eu)';

const STALE_MS = parseInt(process.env.MORTGAGE_SYNC_STALE_MS, 10) || 7 * 24 * 60 * 60 * 1000;
const HTTP_TIMEOUT = parseInt(process.env.MORTGAGE_SYNC_TIMEOUT_MS, 10) || 35000;

const BDE_SERIES = {
  euribor_1w: 'D_1NBAF468',
  euribor_1m: 'D_1NBAF469',
  euribor_3m: 'D_1NBAF470',
  euribor_6m: 'D_1NBAF471',
  euribor_12m: 'D_1NBAF472',
  irs_5y: 'D_1NBAF474',
  avg_mortgage_over_3y: 'D_1NBAF475',
};

const PARTNER_BANK_IDS = ['santander', 'caixabank', 'bbva'];

const BANK_PAGES = [
  {
    id: 'santander',
    name: 'Banco Santander',
    fetch: 'http',
    pages: [
      {
        product_type: 'fixed',
        label: 'Hipoteca fija',
        url: 'https://www.bancosantander.es/particulares/hipotecas/hipoteca-fija',
      },
      {
        product_type: 'variable',
        label: 'Hipoteca variable',
        url: 'https://www.bancosantander.es/particulares/hipotecas/hipoteca-variable',
      },
      {
        product_type: 'mixed',
        label: 'Hipoteca mixta',
        url: 'https://www.bancosantander.es/particulares/hipotecas/hipoteca-mixta',
      },
    ],
  },
  {
    id: 'caixabank',
    name: 'CaixaBank',
    fetch: 'http',
    pages: [
      {
        product_type: 'overview',
        label: 'Hipotecas CaixaBank',
        url: 'https://www.caixabank.es/particular/hipotecas.html',
      },
    ],
  },
  {
    id: 'bbva',
    name: 'BBVA',
    fetch: 'puppeteer',
    pages: [
      {
        product_type: 'variable',
        label: 'Hipoteca variable',
        url: 'https://www.bbva.es/personas/productos/hipotecas/hipoteca-variable.html',
      },
      {
        product_type: 'fixed',
        label: 'Hipoteca fija',
        url: 'https://www.bbva.es/personas/productos/hipotecas/hipoteca-fija.html',
      },
    ],
  },
];

let memoryCache = null;
let syncInFlight = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePct(raw) {
  if (raw == null) return null;
  const n = parseFloat(String(raw).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function defaultData() {
  return {
    fetched_at: null,
    official: {
      source: 'Banco de España',
      as_of_month: null,
      updated_at: null,
      values: {},
      primary_source_url:
        'https://clientebancario.bde.es/pcb/es/menu-horizontal/podemosayudarte/tiposinteres/guia_textual/tiposinteresreferenciaotrostiposfrecuentes/tabla_tipos_referencia_oficiales_mercado_hipotecario.html',
    },
    banks: [],
    partner_banks: PARTNER_BANK_IDS,
    sync_log: [],
  };
}

function loadFromDisk() {
  try {
    if (!fs.existsSync(DATA_PATH)) return defaultData();
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    return { ...defaultData(), ...raw };
  } catch (e) {
    console.warn('⚠️ bank-mortgage-rates.json:', e.message);
    return defaultData();
  }
}

function saveToDisk(data) {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
  memoryCache = data;
}

function getMortgageData() {
  if (!memoryCache) memoryCache = loadFromDisk();
  return memoryCache;
}

function isStale(data = getMortgageData()) {
  if (!data?.fetched_at) return true;
  const age = Date.now() - new Date(data.fetched_at).getTime();
  return !Number.isFinite(age) || age > STALE_MS;
}

async function httpGet(url, opts = {}) {
  return axios.get(url, {
    timeout: HTTP_TIMEOUT,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      Accept: 'text/html,application/json',
      ...opts.headers,
    },
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
    ...opts,
  });
}

async function fetchPageTextHttp(url) {
  const { data: html } = await httpGet(url);
  return cheerio.load(html)('body').text();
}

async function createPuppeteerSession() {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch(getPuppeteerLaunchOptions());
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9' });
  return { browser, page };
}

async function fetchPageTextPuppeteer(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(2000);
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, a, bbva-button-default, span')];
    const hit = els.find((el) =>
      /aceptar todas|aceptar todo|accept all|aceptar/i.test(el.textContent || '')
    );
    if (hit) hit.click();
  });
  await sleep(4000);
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
}

function latestFromBdeSeries(seriesPayload) {
  const rows = seriesPayload?.ListaDatos || seriesPayload?.listaDatos || [];
  if (!Array.isArray(rows) || !rows.length) return null;
  const sorted = [...rows].sort((a, b) => String(b.Fecha || b.fecha).localeCompare(String(a.Fecha || a.fecha)));
  const top = sorted[0];
  const value = parsePct(top?.Valor ?? top?.valor ?? top?.Dato ?? top?.dato);
  const date = top?.Fecha || top?.fecha || null;
  return value != null ? { value, date } : null;
}

async function fetchBdeOfficialRates() {
  const seriesList = Object.values(BDE_SERIES).join(',');
  const url = `https://app.bde.es/bierest/resources/srdatosapp/listaSeries?idioma=en&series=${seriesList}&rango=6M`;
  const { data } = await httpGet(url, { headers: { Accept: 'application/json' } });
  const items = Array.isArray(data) ? data : data?.ListaSeries || data?.listaSeries || [];
  const byCode = new Map();
  for (const item of items) {
    const code = item?.Codigo || item?.codigo || item?.Series?.Codigo;
    if (code) byCode.set(code, item);
  }

  const values = {};
  let latestDate = null;
  const mapKey = {
    [BDE_SERIES.euribor_1w]: 'euribor_1w_pct',
    [BDE_SERIES.euribor_1m]: 'euribor_1m_pct',
    [BDE_SERIES.euribor_3m]: 'euribor_3m_pct',
    [BDE_SERIES.euribor_6m]: 'euribor_6m_pct',
    [BDE_SERIES.euribor_12m]: 'euribor_12m_pct',
    [BDE_SERIES.irs_5y]: 'irs_5y_pct',
    [BDE_SERIES.avg_mortgage_over_3y]: 'avg_mortgage_loans_over_3y_spain_entities_pct',
  };

  for (const [code, key] of Object.entries(mapKey)) {
    const entry = byCode.get(code);
    const latest = latestFromBdeSeries(entry);
    if (latest?.value != null) {
      values[key] = latest.value;
      if (latest.date && (!latestDate || String(latest.date) > String(latestDate))) {
        latestDate = latest.date;
      }
    }
  }

  if (!Object.keys(values).length) {
    throw new Error('BdE API: пустой ответ по сериям Euríbor');
  }

  return {
    source: 'Banco de España (BIEST API)',
    updated_at: latestDate,
    as_of_month: latestDate ? String(latestDate).slice(0, 7) : null,
    values,
    primary_source_url:
      'https://clientebancario.bde.es/pcb/es/menu-horizontal/podemosayudarte/tiposinteres/guia_textual/tiposinteresreferenciaotrostiposfrecuentes/tabla_tipos_referencia_oficiales_mercado_hipotecario.html',
  };
}

async function fetchEuriborFallback() {
  const url = 'https://www.euribor-rates.eu/en/current-euribor-rates/';
  const { data: html } = await httpGet(url);
  const $ = cheerio.load(html);
  const values = {};
  $('table tr').each((_i, row) => {
    const cells = $(row)
      .find('td, th')
      .map((_j, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
      .get();
    const label = cells[0] || '';
    const current = parsePct(cells[1]);
    if (!current) return;
    if (/12\s*month/i.test(label)) values.euribor_12m_pct = current;
    else if (/6\s*month/i.test(label)) values.euribor_6m_pct = current;
    else if (/3\s*month/i.test(label)) values.euribor_3m_pct = current;
    else if (/1\s*month/i.test(label)) values.euribor_1m_pct = current;
    else if (/1\s*week/i.test(label)) values.euribor_1w_pct = current;
  });

  if (!values.euribor_12m_pct) {
    throw new Error('Euribor fallback: не удалось распарсить таблицу');
  }

  return {
    source: 'euribor-rates.eu (fallback; сверяйте с Banco de España)',
    updated_at: new Date().toISOString().slice(0, 10),
    as_of_month: new Date().toISOString().slice(0, 7),
    values,
    primary_source_url: url,
  };
}

function parseSpanishPctMatches(text, limit = 12) {
  const out = [];
  const re = /(\d+[,.]\d+)\s*%/g;
  let m;
  while ((m = re.exec(text)) && out.length < limit) {
    out.push(parsePct(m[1]));
  }
  return out.filter((v) => v != null && v > 0.05 && v < 20);
}

function parseSantanderProducts(text, productType, sourceUrl) {
  const products = [];
  const body = String(text || '').replace(/\s+/g, ' ');

  if (productType === 'variable') {
    const spreadMatches = [...body.matchAll(/Eur[ií]bor\s*\+\s*(\d+[,.]\d+)\s*%\s*TIN[^.]{0,120}/gi)];
    const taeMatches = [...body.matchAll(/TAE\s*Variable\s*(\d+[,.]\d+)\s*%/gi)];
    const seenSpreads = new Set();
    for (let i = 0; i < spreadMatches.length; i += 1) {
      const spread = parsePct(spreadMatches[i][1]);
      const tae = parsePct(taeMatches[i]?.[1]);
      if (spread == null) continue;
      const key = `${spread}|${tae ?? ''}`;
      if (seenSpreads.has(key)) continue;
      seenSpreads.add(key);
      products.push({
        type: 'variable',
        name: 'Hipoteca variable',
        euribor_spread_pct: spread,
        tae_pct: tae,
        rate_formula: `Euríbor + ${String(spread).replace('.', ',')}% TIN`,
        conditions_note:
          spread <= 1
            ? 'Tipo bonificado cumpliendo condiciones publicadas en la web del banco (domiciliación, seguros, etc.)'
            : 'Tipo sin bonificación / sin cumplir condiciones publicadas en la web',
        source_url: sourceUrl,
      });
    }
  }

  if (productType === 'fixed') {
    const taeMatches = [...body.matchAll(/TAE\s*(\d+[,.]\d+)\s*%/gi)];
    taeMatches.slice(0, 2).forEach((match, idx) => {
      const tae = parsePct(match[1]);
      if (tae == null) return;
      products.push({
        type: 'fixed',
        name: 'Hipoteca fija',
        tae_pct: tae,
        conditions_note:
          idx === 0
            ? 'TAE publicada cumpliendo condiciones del banco'
            : 'TAE publicada sin bonificación / sin condiciones',
        source_url: sourceUrl,
      });
    });
  }

  if (productType === 'mixed') {
    const tinMatches = [...body.matchAll(/TIN\s*(\d+[,.]\d+)\s*%/gi)];
    const taeMatches = [...body.matchAll(/TAE\s*Variable\s*(\d+[,.]\d+)\s*%/gi)];
    for (let i = 0; i < Math.max(tinMatches.length, taeMatches.length); i += 1) {
      const tin = parsePct(tinMatches[i]?.[1]);
      const tae = parsePct(taeMatches[i]?.[1]);
      if (tin == null && tae == null) continue;
      products.push({
        type: 'mixed',
        name: 'Hipoteca mixta',
        tin_pct: tin,
        tae_pct: tae,
        conditions_note: 'Periodo fijo inicial + variable Euríbor (condiciones en web del banco)',
        source_url: sourceUrl,
      });
    }
  }

  return products;
}

function parseCaixaProducts(text, sourceUrl) {
  const body = String(text || '').replace(/\s+/g, ' ');
  const products = [];
  const taeMatches = [...body.matchAll(/TAE\s*(\d+[,.]\d+)\s*%/gi)];
  const tinMatches = [...body.matchAll(/TIN\s*(\d+[,.]\d+)\s*%/gi)];

  taeMatches.slice(0, 4).forEach((match, idx) => {
    const tae = parsePct(match[1]);
    const tin = parsePct(tinMatches[idx]?.[1]);
    if (tae == null) return;
    products.push({
      type: idx < 2 ? 'fixed' : 'variable',
      name: idx < 2 ? 'Hipoteca fija (web CaixaBank)' : 'Hipoteca variable (web CaixaBank)',
      tin_pct: tin,
      tae_pct: tae,
      conditions_note: 'Valores publicados en caixabank.es; sujetos a condiciones y perfil del cliente',
      source_url: sourceUrl,
    });
  });

  return products;
}

function parseBbvaProducts(text, productType, sourceUrl) {
  const body = String(text || '').replace(/\s+/g, ' ');
  const products = [];

  if (/error 404|algo no ha ido bien|algo salió mal/i.test(body)) {
    return products;
  }

  const termYearsMax = /hasta un máximo de 30 años|hasta 30 años/i.test(body) ? 30 : null;
  const ltvNote = /hasta el 80%.*habitual|80%.*70%|Financiamos hasta el 80%/i.test(body)
    ? 'Hasta 80% vivienda habitual / 70% segunda vivienda (según web BBVA)'
    : null;

  if (productType === 'variable') {
    const blocks = [
      ...body.matchAll(
        /primer\s+año\s+desde\s+(\d+[,.]\d+)\s*%\s*TIN[^.]{0,180}?(?:eur[ií]bor\s*\+\s*(\d+[,.]\d+)\s*%)[^.]{0,80}?TAE\s*Variable\s*(\d+[,.]\d+)\s*%/gi
      ),
    ];
    blocks.forEach((match, idx) => {
      const tin1y = parsePct(match[1]);
      const spread = parsePct(match[2]);
      const tae = parsePct(match[3]);
      if (spread == null && tae == null) return;
      products.push({
        type: 'variable',
        name: 'Hipoteca variable BBVA',
        tin_first_year_pct: tin1y,
        euribor_spread_pct: spread,
        tae_pct: tae,
        rate_formula: spread != null ? `Euríbor + ${String(spread).replace('.', ',')}%` : null,
        term_years_max: termYearsMax,
        ltv_note: ltvNote,
        conditions_note:
          spread != null && spread <= 1
            ? 'Con nómina domiciliada y seguros BBVA (condiciones publicadas en bbva.es)'
            : 'Sin bonificación / sin cumplir condiciones publicadas en bbva.es',
        source_url: sourceUrl,
      });
    });

    if (!products.length) {
      const spreadMatches = [...body.matchAll(/eur[ií]bor\s*\+\s*(\d+[,.]\d+)\s*%/gi)];
      const taeMatches = [...body.matchAll(/TAE\s*Variable\s*:?\s*(\d+[,.]\d+)\s*%/gi)];
      spreadMatches.slice(0, 2).forEach((match, idx) => {
        const spread = parsePct(match[1]);
        const tae = parsePct(taeMatches[idx]?.[1]);
        if (spread == null) return;
        products.push({
          type: 'variable',
          name: 'Hipoteca variable BBVA',
          euribor_spread_pct: spread,
          tae_pct: tae,
          rate_formula: `Euríbor + ${String(spread).replace('.', ',')}%`,
          term_years_max: termYearsMax,
          ltv_note: ltvNote,
          conditions_note: 'Publicado en bbva.es',
          source_url: sourceUrl,
        });
      });
    }
  }

  if (productType === 'fixed') {
    const fixedBlocks = [
      ...body.matchAll(
        /(?:Desde|desde)\s+(\d+[,.]\d+)\s*%\s*TIN(?:\s+para\s+(\d+)\s+años)?[^.]{0,40}?(\d+[,.]\d+)\s*%\s*TAE/gi
      ),
    ];
    fixedBlocks.slice(0, 3).forEach((match, idx) => {
      const tin = parsePct(match[1]);
      const termYears = match[2] ? parseInt(match[2], 10) : null;
      const tae = parsePct(match[3]);
      if (tin == null && tae == null) return;
      products.push({
        type: 'fixed',
        name: 'Hipoteca fija BBVA',
        tin_pct: tin,
        tae_pct: tae,
        term_years: termYears,
        term_years_max: termYearsMax,
        ltv_note: ltvNote,
        conditions_note:
          idx === 0
            ? 'Tipo publicado en bbva.es (puede incluir bonificación inicial)'
            : 'Con nómina y seguros BBVA (condiciones en bbva.es)',
        source_url: sourceUrl,
      });
    });
  }

  return products;
}

function dedupeBankProducts(products) {
  const filtered = products.filter((p) => !p.error || p.tae_pct || p.euribor_spread_pct || p.tin_pct);
  return filtered.filter((p, _idx, arr) => {
    if (p.tae_pct != null || p.euribor_spread_pct == null) return true;
    return !arr.some(
      (other) =>
        other !== p &&
        other.type === p.type &&
        other.euribor_spread_pct === p.euribor_spread_pct &&
        other.tae_pct != null
    );
  });
}

function parseBankPageProducts(bankId, text, productType, sourceUrl) {
  if (bankId === 'caixabank') return parseCaixaProducts(text, sourceUrl);
  if (bankId === 'santander') return parseSantanderProducts(text, productType, sourceUrl);
  if (bankId === 'bbva') return parseBbvaProducts(text, productType, sourceUrl);
  return [];
}

async function fetchBankOffers() {
  const banks = [];
  let puppeteerSession = null;

  try {
    const needsPuppeteer = BANK_PAGES.some((bank) => bank.fetch === 'puppeteer');
    if (needsPuppeteer) {
      puppeteerSession = await createPuppeteerSession();
    }

    for (const bank of BANK_PAGES) {
      const bankEntry = {
        id: bank.id,
        name: bank.name,
        fetched_at: new Date().toISOString(),
        source_urls: bank.pages.map((p) => p.url),
        products: [],
        disclaimer:
          'Información publicada en la web del banco; no es oferta vinculante ni garantía de aprobación para no residentes.',
      };

      for (const page of bank.pages) {
        try {
          let text = '';
          if (bank.fetch === 'puppeteer') {
            text = await fetchPageTextPuppeteer(puppeteerSession.page, page.url);
          } else {
            text = await fetchPageTextHttp(page.url);
          }

          const products = parseBankPageProducts(bank.id, text, page.product_type, page.url);
          bankEntry.products.push(
            ...products.map((p) => ({
              ...p,
              label: page.label,
            }))
          );
          await sleep(400);
        } catch (e) {
          console.warn(`⚠️ ${bank.name} ${page.label}: ${e.message}`);
          bankEntry.sync_errors = bankEntry.sync_errors || [];
          bankEntry.sync_errors.push({ page: page.label, url: page.url, error: e.message });
        }
      }

      bankEntry.products = dedupeBankProducts(bankEntry.products);
      if (bankEntry.products.length) banks.push(bankEntry);
    }
  } finally {
    if (puppeteerSession?.browser) {
      await puppeteerSession.browser.close().catch(() => {});
    }
  }

  return banks;
}

function patchKnowledgeOfficialRates(official) {
  if (!official?.values || !fs.existsSync(KNOWLEDGE_PATH)) return;
  try {
    const kb = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8'));
    const prev = kb.mortgage_rates_official || {};
    kb.mortgage_rates_official = {
      ...prev,
      updated_at: official.updated_at || new Date().toISOString().slice(0, 10),
      as_of_month: official.as_of_month || prev.as_of_month,
      primary_source: {
        name: 'Banco de España — Tabla de tipos de referencia oficiales del mercado hipotecario',
        url: official.primary_source_url || prev.primary_source?.url,
      },
      values: {
        ...(prev.values || {}),
        ...official.values,
      },
      live_sync_source: official.source,
      live_sync_at: new Date().toISOString(),
    };
    fs.writeFileSync(KNOWLEDGE_PATH, JSON.stringify(kb, null, 2), 'utf8');
  } catch (e) {
    console.warn('⚠️ Не удалось обновить consultant-knowledge.json:', e.message);
  }
}

async function syncMortgageData({ force = false } = {}) {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const prev = loadFromDisk();
    if (!force && !isStale(prev)) {
      memoryCache = prev;
      return { ok: true, skipped: true, data: prev };
    }

    const log = [];
    let official = null;

    try {
      official = await fetchBdeOfficialRates();
      log.push({ step: 'bde_api', ok: true, source: official.source });
    } catch (bdeErr) {
      log.push({ step: 'bde_api', ok: false, error: bdeErr.message });
      try {
        official = await fetchEuriborFallback();
        log.push({ step: 'euribor_fallback', ok: true, source: official.source });
      } catch (fallbackErr) {
        log.push({ step: 'euribor_fallback', ok: false, error: fallbackErr.message });
        official = prev.official?.values
          ? prev.official
          : {
              source: 'consultant-knowledge (static fallback)',
              values: {},
              updated_at: null,
              as_of_month: null,
              primary_source_url:
                'https://clientebancario.bde.es/pcb/es/menu-horizontal/podemosayudarte/tiposinteres/guia_textual/tiposinteresreferenciaotrostiposfrecuentes/tabla_tipos_referencia_oficiales_mercado_hipotecario.html',
            };
      }
    }

    let banks = [];
    try {
      banks = await fetchBankOffers();
      log.push({ step: 'bank_pages', ok: true, count: banks.length });
    } catch (bankErr) {
      log.push({ step: 'bank_pages', ok: false, error: bankErr.message });
      banks = prev.banks || [];
    }

    const next = {
      fetched_at: new Date().toISOString(),
      official,
      banks,
      sync_log: log,
    };

    saveToDisk(next);
    if (official?.values && Object.keys(official.values).length) {
      patchKnowledgeOfficialRates(official);
    }

    console.log(
      `✅ Ипотечные ставки обновлены: Euríbor 12m=${official?.values?.euribor_12m_pct ?? 'n/a'}%, банков=${banks.length}`
    );
    return { ok: true, skipped: false, data: next };
  })();

  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

function ensureFreshMortgageData() {
  if (!isStale()) return Promise.resolve(getMortgageData());
  return syncMortgageData().catch((e) => {
    console.warn('⚠️ Фоновое обновление ипотечных ставок:', e.message);
    return getMortgageData();
  });
}

function formatOfficialRatesBlock(data, lang = 'ru') {
  const v = data?.official?.values || {};
  const asOf = data?.official?.as_of_month || data?.official?.updated_at || data?.fetched_at;
  const lines = [];

  if (lang === 'en') {
    lines.push('**OFFICIAL REFERENCE RATES (Spain, Banco de España / Euríbor):**');
    if (v.euribor_12m_pct != null) lines.push(`- Euríbor 12m: ${v.euribor_12m_pct}%`);
    if (v.euribor_6m_pct != null) lines.push(`- Euríbor 6m: ${v.euribor_6m_pct}%`);
    if (v.euribor_3m_pct != null) lines.push(`- Euríbor 3m: ${v.euribor_3m_pct}%`);
    if (v.avg_mortgage_loans_over_3y_spain_entities_pct != null) {
      lines.push(
        `- Avg new mortgage rate (>3y, Spanish entities, BdE): ${v.avg_mortgage_loans_over_3y_spain_entities_pct}%`
      );
    }
    if (v.irs_5y_pct != null) lines.push(`- IRS 5y (BdE reference): ${v.irs_5y_pct}%`);
    lines.push(`- As of: ${asOf || 'see BdE'}`);
    lines.push('- Client rate ≈ Euríbor + bank margin; final offer is bank-only after dossier review.');
    return lines.join('\n');
  }

  if (lang === 'es') {
    lines.push('**TIPOS OFICIALES DE REFERENCIA (España, Banco de España / Euríbor):**');
    if (v.euribor_12m_pct != null) lines.push(`- Euríbor 12 meses: ${v.euribor_12m_pct}%`);
    if (v.euribor_6m_pct != null) lines.push(`- Euríbor 6 meses: ${v.euribor_6m_pct}%`);
    if (v.euribor_3m_pct != null) lines.push(`- Euríbor 3 meses: ${v.euribor_3m_pct}%`);
    if (v.avg_mortgage_loans_over_3y_spain_entities_pct != null) {
      lines.push(
        `- Tipo medio hipotecas >3 años (entidades españolas, BdE): ${v.avg_mortgage_loans_over_3y_spain_entities_pct}%`
      );
    }
    if (v.irs_5y_pct != null) lines.push(`- IRS 5 años (referencia BdE): ${v.irs_5y_pct}%`);
    lines.push(`- Fecha/orientación: ${asOf || 'consultar BdE'}`);
    lines.push('- Tipo final ≈ Euríbor + margen del banco; la oferta vinculante la da el banco tras estudiar el expediente.');
    return lines.join('\n');
  }

  lines.push('**ОФИЦИАЛЬНЫЕ СПРАВОЧНЫЕ СТАВКИ (Испания, Banco de España / Euríbor):**');
  if (v.euribor_12m_pct != null) lines.push(`- Euríbor 12 мес.: ${v.euribor_12m_pct}%`);
  if (v.euribor_6m_pct != null) lines.push(`- Euríbor 6 мес.: ${v.euribor_6m_pct}%`);
  if (v.euribor_3m_pct != null) lines.push(`- Euríbor 3 мес.: ${v.euribor_3m_pct}%`);
  if (v.avg_mortgage_loans_over_3y_spain_entities_pct != null) {
    lines.push(
      `- Средний тип по новым ипотекам >3 лет (исп. банки, BdE): ${v.avg_mortgage_loans_over_3y_spain_entities_pct}%`
    );
  }
  if (v.irs_5y_pct != null) lines.push(`- IRS 5 лет (справочник BdE): ${v.irs_5y_pct}%`);
  lines.push(`- Актуальность: ${asOf || 'см. BdE'}`);
  lines.push(
    '- Ставка клиента ≈ Euríbor + маржа банка; финальная оферта — только у банка после анализа досье.'
  );
  return lines.join('\n');
}

function formatBankOffersBlock(data, lang = 'ru') {
  const banks = data?.banks || [];
  if (!banks.length) return '';

  const header =
    lang === 'en'
      ? '**BANK MORTGAGE ORIENTATIONS (internal — use numbers; do NOT name these banks to the client):**'
      : lang === 'es'
        ? '**ORIENTACIONES HIPOTECARIAS (interno — usa las cifras; NO nombres estos bancos al cliente):**'
        : '**ОРИЕНТИРЫ ПО ИПОТЕКЕ ОТ БАНКОВ (внутренний блок — цифры бери отсюда; клиенту эти банки НЕ называй):**';

  const lines = [header];
  for (const bank of banks) {
    lines.push(`\n*[источник для тебя] ${bank.name}* (обновлено ${bank.fetched_at?.slice(0, 10) || '—'}):`);
    for (const product of bank.products.slice(0, 4)) {
      const bits = [];
      if (product.type) bits.push(product.type);
      if (product.rate_formula) bits.push(product.rate_formula);
      if (product.tin_pct != null) bits.push(`TIN ${product.tin_pct}%`);
      if (product.tae_pct != null) bits.push(`TAE ${product.tae_pct}%`);
      if (product.euribor_spread_pct != null) bits.push(`Euríbor + ${product.euribor_spread_pct}%`);
      if (product.tin_first_year_pct != null) bits.push(`1er año TIN ${product.tin_first_year_pct}%`);
      if (product.term_years) bits.push(`${product.term_years} años`);
      if (product.term_years_max) bits.push(`plazo hasta ${product.term_years_max} años`);
      if (product.ltv_note) bits.push(product.ltv_note);
      if (product.conditions_note) bits.push(product.conditions_note);
      lines.push(`- ${bits.join(' · ')}`);
    }
    lines.push(`  Источник: ${bank.source_urls?.[0] || 'web del banco'}`);
  }

  const footer =
    lang === 'en'
      ? 'Client wording: “major banks / market orientations” only — never Santander, CaixaBank, BBVA by name. House Tenerife helps match a bank — no approval guarantee.'
      : lang === 'es'
        ? 'Al cliente: solo “grandes bancos / orientaciones de mercado” — nunca nombres Santander, CaixaBank, BBVA. House Tenerife ayuda con el banco — sin garantía de aprobación.'
        : 'Клиенту: только «крупные банки / рыночные ориентиры» — никогда не называй Santander, CaixaBank, BBVA. House Tenerife помогает с подбором банка — без гарантии одобрения.';
  lines.push(`\n${footer}`);
  return lines.join('\n');
}

function formatMortgageLiveBlock(lang = 'ru') {
  const data = getMortgageData();
  if (!data?.fetched_at && !(data?.official?.values && Object.keys(data.official.values).length)) {
    return '';
  }

  const parts = [
    formatOfficialRatesBlock(data, lang),
    formatBankOffersBlock(data, lang),
    `\nДанные синхронизированы: ${data.fetched_at || '—'} (${data.official?.source || 'BdE'}).`,
  ].filter(Boolean);

  return parts.join('\n\n');
}

function getMortgageOpeningInstruction(lang = 'ru', opts = {}) {
  const isEarlyTopic = Boolean(opts.isEarlyTopic);
  if (!isEarlyTopic && !opts.force) return '';

  const live = formatMortgageLiveBlock(lang);
  if (!live) return '';

  if (lang === 'en') {
    return `**MORTGAGE CONVERSATION OPENING (mandatory when the client starts asking about mortgage/credit):**
1) Introduce yourself as House Tenerife — we help with the full path: NIE, Spanish account, documents, bank matching, pre-approval, valuation, notary (€3,000 support package).
2) Give the *current mortgage snapshot* from the LIVE BANK DATA block below (official Euríbor/BdE + large-bank market orientations). Quote numbers from the block — do not invent.
3) In the client reply NEVER name Santander, CaixaBank, BBVA or other banks — say “major banks” / “market orientations” only.
4) Always add: these are public/reference rates, not a guaranteed offer; final terms are bank-only.
5) Then answer their question or ask ONE next clarifying question (budget, NIE, income proof, resident/non-resident).

${live}`;
  }

  if (lang === 'es') {
    return `**APERTURA TEMA HIPOTECA (obligatorio cuando el cliente empieza a preguntar por hipoteca/crédito):**
1) Preséntate como House Tenerife — ayudamos con todo: NIE, cuenta en España, documentos, banco, preaprobación, tasación, notario (paquete €3.000).
2) Da de inmediato la *situación actual* usando el bloque LIVE BANK DATA (Euríbor/BdE oficial + orientaciones de mercado de grandes bancos). Cita cifras del bloque — no inventes.
3) En la respuesta al cliente NUNCA nombres Santander, CaixaBank, BBVA u otros bancos — di “grandes bancos” / “orientaciones de mercado”.
4) Aclara: son tipos publicados/orientativos, no oferta garantizada; el banco fija las condiciones finales.
5) Luego responde o haz UNA pregunta (presupuesto, NIE, ingresos, residente/no residente).

${live}`;
  }

  return `**СТАРТ РАЗГОВОРА ОБ ИПОТЕКЕ (обязательно, когда клиент начинает тему ипотеки/кредита):**
1) Представь House Tenerife — мы помогаем со всем: NIE, испанский счёт, документы, подбор банка, предодобрение, оценка (tasación), нотариус (пакет сопровождения €3 000).
2) Сразу дай *текущую ситуацию по ипотекам* из блока LIVE BANK DATA ниже — официальный Euríbor/BdE + рыночные ориентиры крупных банков. Цифры — только из блока, не выдумывай.
3) В ответе клиенту ЗАПРЕЩЕНО называть Santander, CaixaBank, BBVA и другие банки по имени — говори «крупные банки», «рыночные ориентиры», «типичная ставка».
4) Обязательная оговорка: это публичные ориентиры и официальные индексы, не гарантия одобрения; финальные условия — только у банка.
5) Затем ответь на вопрос или задай ОДИН уточняющий вопрос (бюджет, NIE, справка о доходах, резидент/нерезидент).

${live}`;
}

module.exports = {
  DATA_PATH,
  getMortgageData,
  isStale,
  syncMortgageData,
  ensureFreshMortgageData,
  formatMortgageLiveBlock,
  getMortgageOpeningInstruction,
  fetchBdeOfficialRates,
  fetchEuriborFallback,
  fetchBankOffers,
};
