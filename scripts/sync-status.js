/**
 * Быстрое обновление статуса «Продано / Зарезервировано» в data/properties.json
 * (1 GET на объект, без полного sync-db: описания и фото не трогаем).
 *
 *   npm run sync-status                 # весь каталог
 *   npm run sync-status -- --dry        # только отчёт, файл не пишем
 *   npm run sync-status -- --limit=50   # первые 50 (проверка)
 *   npm run sync-status -- --stale-hours=24   # пропуск свежепроверенных
 *   SYNC_DELAY_MS=300 npm run sync-status
 *
 * После деплоя на Railway: выполнить `npm run sync-status` (или `npm run sync-db`).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const {
  extractStatusFromHtml,
  statusFieldsFromExtract,
  mergeStatusFields,
} = require('../property-status');

const USER_AGENT = 'HouseTenerifeBot/1.0 (catalog status check; contact agency)';
const DELAY_MS = parseInt(process.env.SYNC_DELAY_MS, 10) || 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveCatalogPath() {
  if (process.env.PROPERTIES_PATH) return process.env.PROPERTIES_PATH;
  return path.join(__dirname, '..', 'data', 'properties.json');
}

/** URL'ы для проверки: ru → en → es (достаточно худшего статуса из доступных). */
function statusUrlsForItem(item) {
  const urls = item?.urls || {};
  const list = [urls.ru, urls.en, urls.es, item?.url].filter(Boolean);
  return [...new Set(list)].slice(0, 2);
}

async function defaultFetchHtml(url) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return String(res.data || '');
}

/**
 * Обновляет поля статуса у items (мутирует). Возвращает отчёт.
 * @param {object[]} items
 * @param {{ fetchHtmlFn?: Function, delayMs?: number, limit?: number, staleHours?: number, onProgress?: Function }} [opts]
 */
async function refreshStatuses(items, opts = {}) {
  const fetchHtmlFn = opts.fetchHtmlFn || defaultFetchHtml;
  const delayMs = opts.delayMs ?? DELAY_MS;
  const limit = opts.limit || Infinity;
  const staleMs = (opts.staleHours || 0) * 3600 * 1000;
  const report = { checked: 0, skipped: 0, errors: 0, changed: 0, sold: [], reserved: [], unavailable: [] };

  for (const item of items) {
    if (report.checked >= limit) break;
    const checkedAt = Date.parse(item.statusCheckedAt || '') || 0;
    if (staleMs && checkedAt && Date.now() - checkedAt < staleMs) {
      report.skipped++;
      continue;
    }
    const sets = [];
    for (const url of statusUrlsForItem(item)) {
      try {
        const html = await fetchHtmlFn(url);
        sets.push(statusFieldsFromExtract(extractStatusFromHtml(html)));
      } catch (e) {
        report.errors++;
      }
      if (delayMs) await sleep(delayMs);
    }
    report.checked++;
    if (!sets.length) continue; // ничего не получили — флаги не трогаем
    const merged = mergeStatusFields(...sets);
    const before = item.availability || 'available';
    Object.assign(item, merged);
    if (before !== merged.availability) report.changed++;
    const row = `${item.id || '—'} ${item.url}`;
    if (merged.availability === 'sold') report.sold.push(row);
    else if (merged.availability === 'reserved') report.reserved.push(row);
    else if (merged.availability === 'unavailable') report.unavailable.push(row);
    if (opts.onProgress) opts.onProgress(report, item);
  }
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const staleArg = args.find((a) => a.startsWith('--stale-hours='));
  const file = resolveCatalogPath();
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = raw.items || [];
  console.log(`Каталог: ${items.length} объектов (${file})${dry ? ' [dry-run]' : ''}`);

  const report = await refreshStatuses(items, {
    limit: limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined,
    staleHours: staleArg ? parseFloat(staleArg.split('=')[1]) : 0,
    onProgress: (r) => {
      if (r.checked % 25 === 0) {
        process.stdout.write(`\r${r.checked} проверено, sold ${r.sold.length}, reserved ${r.reserved.length}…`);
      }
    },
  });

  console.log(
    `\nГотово: проверено ${report.checked}, пропущено ${report.skipped}, ошибок запросов ${report.errors}, изменений ${report.changed}`
  );
  console.log(`Продано: ${report.sold.length}, зарезервировано: ${report.reserved.length}, снято: ${report.unavailable.length}`);
  if (!dry) {
    raw.statusSyncedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(raw, null, 2), 'utf8');
    console.log(`💾 ${file}`);
    console.log('Если бот уже запущен — он подхватит файл по mtime; иначе перезапустите сервис.');
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { refreshStatuses, statusUrlsForItem };
