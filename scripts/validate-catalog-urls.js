/**
 * Проверка всех URL каталога на живом housetenerife.eu (не 404).
 *
 *   npm run validate-urls
 *   VALIDATE_CONCURRENCY=16 npm run validate-urls
 *
 * Exit code 1 — если есть HTTP >= 400 (после ретраев).
 */
require('dotenv').config();
const axios = require('axios');
const { load, getLocalizedItem } = require('../property-catalog');
const { getShareUrl } = require('../property-share');

const CONCURRENCY = Math.min(
  32,
  Math.max(1, parseInt(process.env.VALIDATE_CONCURRENCY, 10) || 12)
);
const TIMEOUT = parseInt(process.env.VALIDATE_TIMEOUT_MS, 10) || 20000;
const RETRIES = parseInt(process.env.VALIDATE_RETRIES, 10) || 2;
const UA =
  process.env.VALIDATE_UA ||
  'HouseTenerifeLinkCheck/1.0 (+npm run validate-urls)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function collectJobs(items) {
  const jobs = [];
  const seen = new Set();

  function add(url, meta) {
    const u = String(url || '').trim();
    if (!u.startsWith('http') || seen.has(u)) return;
    // Прокси бота /p/HZ… — не страница сайта
    if (/\/p\/HZ/i.test(u)) return;
    seen.add(u);
    jobs.push({ url: u, ...meta });
  }

  for (const item of items) {
    const id = item.id || item.urls?.ru || item.url || '?';
    for (const lang of ['ru', 'es', 'en']) {
      const loc = getLocalizedItem(item, lang);
      if (loc.url) add(loc.url, { id, lang, source: 'localized' });
      const share = getShareUrl(item, lang);
      if (share && share.includes('housetenerife.eu')) {
        add(share, { id, lang, source: 'share' });
      }
    }
    for (const [lang, u] of Object.entries(item.urls || {})) {
      add(u, { id, lang, source: 'raw' });
    }
    if (item.url) add(item.url, { id, lang: 'ru', source: 'legacy' });
  }
  return jobs;
}

async function checkUrl(url) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES + 1; attempt++) {
    try {
      let res = await axios.head(url, {
        timeout: TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: { 'User-Agent': UA, Accept: 'text/html' }
      });
      let status = res.status;
      if (status === 403 || status === 405 || status === 501) {
        res = await axios.get(url, {
          timeout: TIMEOUT,
          maxRedirects: 5,
          validateStatus: () => true,
          headers: { 'User-Agent': UA, Accept: 'text/html' },
          maxContentLength: 80000,
          maxBodyLength: 80000
        });
        status = res.status;
      }
      if (status >= 500 && attempt <= RETRIES) {
        await sleep(800 * attempt);
        continue;
      }
      return { status };
    } catch (e) {
      lastErr = e;
      if (attempt <= RETRIES) {
        await sleep(800 * attempt);
        continue;
      }
    }
  }
  return { error: lastErr?.code || lastErr?.message || 'error' };
}

async function runPool(list, limit, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < list.length) {
        const idx = i++;
        if (idx % 40 === 0) {
          process.stderr.write(`\rChecked ${idx}/${list.length}…`);
        }
        await fn(list[idx], idx);
      }
    })
  );
  process.stderr.write(`\rChecked ${list.length}/${list.length}   \n`);
}

async function main() {
  const data = load();
  const items = data.items || [];
  const jobs = collectJobs(items);

  console.log(`Catalog: ${items.length} items (synced ${data.syncedAt || 'n/a'})`);
  console.log(`Unique URLs: ${jobs.length}; concurrency=${CONCURRENCY}`);

  const ok = [];
  const fail = [];
  const errors = [];

  const t0 = Date.now();
  await runPool(jobs, CONCURRENCY, async (job) => {
    const result = await checkUrl(job.url);
    if (result.error) errors.push({ ...job, error: result.error });
    else if (result.status >= 200 && result.status < 400) ok.push({ ...job, status: result.status });
    else fail.push({ ...job, status: result.status });
  });

  // Один проход ретрая сетевых ошибок с браузерным UA
  const stillErrors = [];
  for (const job of errors) {
    const result = await checkUrl(job.url);
    if (result.error) stillErrors.push({ ...job, error: result.error });
    else if (result.status >= 200 && result.status < 400) ok.push({ ...job, status: result.status });
    else fail.push({ ...job, status: result.status });
  }

  const seconds = Math.round((Date.now() - t0) / 1000);
  console.log('\n=== SUMMARY ===');
  console.log({
    ok: ok.length,
    fail: fail.length,
    networkErrors: stillErrors.length,
    seconds
  });

  if (fail.length) {
    console.log('\n=== HTTP FAILURES ===');
    for (const f of fail) {
      console.log(`[${f.status}] ${f.id} ${f.lang} ${f.url}`);
    }
  }
  if (stillErrors.length) {
    console.log('\n=== NETWORK ERRORS (после ретраев) ===');
    for (const f of stillErrors) {
      console.log(`[${f.error}] ${f.id} ${f.url}`);
    }
  }

  // Языковые пробелы (не 404, но ES-клиент может получить RU/EN)
  let missingEs = 0;
  let missingEn = 0;
  for (const item of items) {
    if (!item.urls?.es) missingEs++;
    if (!item.urls?.en) missingEn++;
  }
  console.log('\n=== LANG COVERAGE ===');
  console.log({
    withEs: items.length - missingEs,
    missingEs,
    withEn: items.length - missingEn,
    missingEn,
    note: 'Нет ES URL → бот отдаст EN/RU fallback (страница живая, другой язык)'
  });

  if (fail.length) {
    process.exitCode = 1;
    console.error('\nЕсть битые URL в каталоге — обновите sync-db или почините записи.');
  } else if (stillErrors.length) {
    console.warn('\nСетевые сбои при проверке; HTTP 404 не подтверждены. Перезапустите validate-urls.');
  } else {
    console.log('\nВсе проверенные URL каталога отвечают OK.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
