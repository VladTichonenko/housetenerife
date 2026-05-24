/**
 * ОПЦИОНАЛЬНЫЙ офлайн-скрипт (не нужен для работы WhatsApp-бота).
 * Заполняет titles.en / descriptions.en в data/properties.json через отдельный ключ API.
 * На сайте нет /en/ — для англоязычных клиентов бот и так берёт ES/RU из каталога.
 *
 *   TRANSLATE_AI_API_KEY=... node scripts/translate-properties-en.js
 * Не использует AI_API_KEY бота.
 */
require('dotenv').config();
const dns = require('dns');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { normalizeItem } = require('../property-catalog');

// На Windows часто падает DNS по IPv6 — сначала IPv4
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const DATA = path.join(__dirname, '..', 'data', 'properties.json');
const AI_API_URL =
  process.env.AI_API_URL || 'https://api.intelligence.io.solutions/api/v1/chat/completions';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-ai/DeepSeek-V3.2';
const AI_API_KEY = process.env.TRANSLATE_AI_API_KEY;
const BATCH = parseInt(process.env.TRANSLATE_BATCH, 10) || 3;
const DELAY_MS = parseInt(process.env.TRANSLATE_DELAY_MS, 10) || 12000;
const RETRIES = parseInt(process.env.TRANSLATE_RETRIES, 10) || 8;
const STOP_AFTER_FAILS = parseInt(process.env.TRANSLATE_STOP_AFTER_FAILS, 10) || 20;
const RATE_LIMIT_BASE_MS = parseInt(process.env.TRANSLATE_RATE_LIMIT_MS, 10) || 45000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpStatus(err) {
  return err.response?.status;
}

function isRateLimited(err) {
  const s = httpStatus(err);
  return s === 429 || s === 503;
}

function isTransientNetError(err) {
  const code = err.code || err.cause?.code;
  const msg = String(err.message || '');
  return (
    ['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH'].includes(
      code
    ) || /timeout|network|ENOTFOUND/i.test(msg)
  );
}

function isRetryableError(err) {
  return isTransientNetError(err) || isRateLimited(err);
}

/** Пауза перед повтором (429 — дольше, с Retry-After если есть). */
function retryWaitMs(err, attempt) {
  if (isRateLimited(err)) {
    const hdr = err.response?.headers?.['retry-after'];
    const sec = hdr ? parseInt(String(hdr), 10) : NaN;
    if (Number.isFinite(sec) && sec > 0) return sec * 1000;
    return Math.min(180000, RATE_LIMIT_BASE_MS * attempt);
  }
  return DELAY_MS * attempt;
}

async function checkApiHost() {
  const host = new URL(AI_API_URL).hostname;
  try {
    const res = await dns.promises.lookup(host, { family: 4 });
    console.log(`DNS OK: ${host} → ${res.address}`);
    return true;
  } catch (e) {
    console.error(`\n❌ DNS не находит хост API: ${host}`);
    console.error(`   Ошибка: ${e.message}`);
    console.error(`   URL из .env: ${AI_API_URL}`);
    console.error('\n   Это сетевая проблема (роутер, VPN, провайдер), не ключ API.');
    console.error('   Попробуйте: другой Wi‑Fi, отключить VPN, перезагрузить роутер,');
    console.error('   сменить DNS на 8.8.8.8 / 1.1.1.1, затем снова запустить скрипт\n');
    return false;
  }
}

function needsEnglish(item) {
  const t = item.titles?.en;
  const d = item.descriptions?.en;
  return !t || !d || t.length < 3 || d.length < 20;
}

function sourceForItem(item) {
  const title = item.titles?.es || item.titles?.ru || item.title || '';
  const description = item.descriptions?.es || item.descriptions?.ru || item.description || '';
  const overview = item.overviews?.es || item.overviews?.ru || item.overview || '';
  const fromLang = item.descriptions?.es ? 'es' : 'ru';
  return {
    id: item.id,
    title,
    description: description.slice(0, 1400),
    overview: overview.slice(0, 400),
    fromLang
  };
}

async function translateBatch(batch) {
  const payload = {
    model: AI_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You translate real-estate listing fields to English. Return ONLY valid JSON array, no markdown. Each element: {"id":"HZ123","title":"...","description":"...","overview":"..."}. Keep prices, numbers, HZ ids. Natural marketing English.'
      },
      {
        role: 'user',
        content: JSON.stringify(
          batch.map((b) => ({
            id: b.id,
            from: b.fromLang,
            title: b.title,
            description: b.description,
            overview: b.overview
          }))
        )
      }
    ],
    temperature: 0.2
  };

  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await axios.post(AI_API_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AI_API_KEY}`
        },
        timeout: 120000
      });
      let text = res.data.choices?.[0]?.message?.content || '[]';
      text = text.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('Expected JSON array');
      return parsed;
    } catch (err) {
      lastErr = err;
      if (!isRetryableError(err) || attempt === RETRIES) throw err;
      const wait = retryWaitMs(err, attempt);
      const why = isRateLimited(err) ? 'лимит API (429)' : 'сеть';
      process.stdout.write(`\n  ${why}, повтор ${attempt}/${RETRIES} через ${Math.round(wait / 1000)}с… `);
      await sleep(wait);
    }
  }
  throw lastErr;
}

function applyTranslations(data, translated) {
  for (const row of translated) {
    const item = data.items.find((x) => x.id === row.id);
    if (!item) continue;
    item.titles = item.titles || {};
    item.descriptions = item.descriptions || {};
    item.overviews = item.overviews || {};
    if (row.title) item.titles.en = row.title;
    if (row.description) item.descriptions.en = row.description;
    if (row.overview) item.overviews.en = row.overview;
    if (!item.urls?.en) {
      item.urls = item.urls || {};
      item.urls.en = item.urls.es || item.urls.ru || item.url;
    }
  }
}

async function main() {
  if (!AI_API_KEY?.trim()) {
    console.error(
      'Задайте TRANSLATE_AI_API_KEY (отдельный ключ, не AI_API_KEY бота).\n' +
        'Скрипт не обязателен: бот для EN использует тексты ES/RU из каталога.'
    );
    process.exit(1);
  }

  console.log(`API: ${AI_API_URL}`);
  if (!(await checkApiHost())) {
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  data.items = (data.items || []).map(normalizeItem);
  const pending = data.items.filter(needsEnglish).map(sourceForItem);
  const totalBatches = Math.ceil(pending.length / BATCH) || 0;
  console.log(
    `К переводу на EN: ${pending.length} из ${data.items.length} (${totalBatches} пакетов, по ${BATCH} объ., пауза ${DELAY_MS / 1000}с)`
  );
  console.log('При 429 скрипт ждёт и повторяет — не прерывайте сразу.\n');

  let consecutiveFails = 0;
  let okBatches = 0;

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const batchNum = Math.floor(i / BATCH) + 1;
    process.stdout.write(`\rПакет ${batchNum}/${totalBatches}…`);

    try {
      const translated = await translateBatch(batch);
      applyTranslations(data, translated);
      fs.writeFileSync(DATA, JSON.stringify(data, null, 2), 'utf8');
      okBatches++;
      consecutiveFails = 0;
    } catch (e) {
      consecutiveFails++;
      const status = httpStatus(e);
      const code = e.code || e.cause?.code || '';
      console.warn(
        `\nОшибка пакета ${batchNum}${status ? ` HTTP ${status}` : ''} (${code || '—'}): ${e.message}`
      );
      if (status === 429) {
        console.warn(`  Подождите 1–2 мин и запустите снова — или оставьте скрипт (внутри пакета уже были повторы).`);
        await sleep(RATE_LIMIT_BASE_MS);
      }
      if (consecutiveFails >= STOP_AFTER_FAILS) {
        console.error(
          `\nОстановка: ${STOP_AFTER_FAILS} пакетов подряд без успеха.`
        );
        if (status === 429) {
          console.error('Лимит API (429). Запустите позже с TRANSLATE_BATCH=2 TRANSLATE_DELAY_MS=20000');
        }
        console.error('Уже переведено пакетов:', okBatches, '— повторный запуск продолжит с оставшихся.');
        process.exit(1);
      }
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nГотово. Успешных пакетов: ${okBatches}/${totalBatches}. Перезапустите бота.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
