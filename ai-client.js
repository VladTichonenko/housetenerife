'use strict';

const axios = require('axios');

const AI_API_URL =
  process.env.AI_API_URL || 'https://api.intelligence.io.solutions/api/v1/chat/completions';
const AI_MODEL =
  process.env.AI_MODEL || 'meta-llama/Llama-3.3-70B-Instruct';
const AI_API_KEY = process.env.AI_API_KEY;

const MAX_ATTEMPTS = Math.min(15, Math.max(1, parseInt(process.env.AI_MAX_RETRIES, 10) || 8));
const CHAT_MAX_ATTEMPTS = Math.min(3, Math.max(1, parseInt(process.env.AI_CHAT_MAX_RETRIES, 10) || 1));
const RETRY_BASE_MS = Math.max(400, parseInt(process.env.AI_RETRY_BASE_MS, 10) || 1800);
const MIN_INTERVAL_MS = Math.max(0, parseInt(process.env.AI_MIN_INTERVAL_MS, 10) || 400);
const MAX_CONCURRENT = Math.min(12, Math.max(1, parseInt(process.env.AI_CONCURRENCY, 10) || 6));

let lastRequestAt = 0;
let inFlight = 0;
/** @type {Array<() => void>} */
const waiters = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getProviders() {
  const list = [
    {
      name: 'primary',
      url: AI_API_URL,
      key: AI_API_KEY,
      model: process.env.AI_MODEL || AI_MODEL
    }
  ];
  const fbKey = process.env.AI_FALLBACK_API_KEY;
  if (fbKey && String(fbKey).trim()) {
    list.push({
      name: 'fallback',
      url:
        process.env.AI_FALLBACK_API_URL ||
        process.env.AI_API_URL ||
        'https://api.intelligence.io.solutions/api/v1/chat/completions',
      key: fbKey,
      model: process.env.AI_FALLBACK_MODEL || process.env.AI_MODEL || AI_MODEL
    });
  }
  return list;
}

function acquireSlot() {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      inFlight++;
      resolve();
    });
  });
}

function releaseSlot() {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) next();
}

function retryAfterMs(err) {
  const raw = err.response?.headers?.['retry-after'];
  if (!raw) return null;
  const seconds = parseInt(String(raw), 10);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const when = Date.parse(String(raw));
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return null;
}

function isRateLimited(err) {
  return err?.response?.status === 429;
}

function isRetryable(err, allow429) {
  const status = err.response?.status;
  if (status === 429) return allow429;
  if (status === 502 || status === 503 || status === 504) return true;
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
    return true;
  }
  const msg = String(err.message || '');
  return msg.includes('timeout') || msg.includes('socket hang up');
}

async function waitMinInterval() {
  if (!MIN_INTERVAL_MS) return;
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
  }
}

function buildAuthHeaders(apiKey) {
  const key = String(apiKey || '').trim();
  const style = (process.env.AI_AUTH_STYLE || '').toLowerCase();
  const useXApiKey =
    style === 'x-api-key' || (style !== 'bearer' && key.startsWith('io-v2-'));
  if (useXApiKey) {
    return { 'Content-Type': 'application/json', 'x-api-key': key };
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
}

function apiErrorDetail(err) {
  const data = err.response?.data;
  if (!data) return '';
  if (typeof data === 'string') return data.slice(0, 300);
  const msg = data.error?.message || data.message || data.detail;
  if (msg) return String(msg).slice(0, 300);
  try {
    return JSON.stringify(data).slice(0, 300);
  } catch {
    return '';
  }
}

async function postOnce(payload, provider, timeout) {
  return axios.post(provider.url, payload, {
    headers: buildAuthHeaders(provider.key),
    timeout
  });
}

/**
 * @param {object} payload
 * @param {{ provider: object, maxAttempts: number, allow429Retry: boolean, timeout: number, label: string }} opts
 */
async function postWithRetries(payload, opts) {
  const { provider, maxAttempts, allow429Retry, timeout, label } = opts;

  if (!provider.key || !String(provider.key).trim()) {
    const err = new Error('AI_API_KEY is not set');
    err.code = 'AI_KEY_MISSING';
    throw err;
  }

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await waitMinInterval();
    try {
      const response = await postOnce(payload, provider, timeout);
      lastRequestAt = Date.now();
      if (response.status >= 200 && response.status < 300) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
      lastError.response = response;
      if (response.status === 429 && !allow429Retry) {
        const limitErr = new Error('AI API rate limit (429)');
        limitErr.code = 'AI_RATE_LIMIT';
        limitErr.response = response;
        throw limitErr;
      }
    } catch (err) {
      lastError = err;
      lastRequestAt = Date.now();
      if (isRateLimited(err) && !allow429Retry) {
        const detail = apiErrorDetail(err);
        console.error(
          `ai-client [${label}/${provider.name}]: 429`,
          detail || '(нет текста ошибки в ответе)'
        );
        const limitErr = new Error('AI API rate limit (429)');
        limitErr.code = 'AI_RATE_LIMIT';
        limitErr.response = err.response;
        limitErr.apiDetail = detail;
        throw limitErr;
      }
    }

    if (attempt >= maxAttempts || !isRetryable(lastError, allow429Retry)) {
      const detail = apiErrorDetail(lastError);
      if (detail) {
        console.error(
          `ai-client [${label}/${provider.name}]: HTTP ${lastError.response?.status || '?'}`,
          detail
        );
      }
      throw lastError;
    }

    const retryAfter = retryAfterMs(lastError);
    const backoff = Math.min(30000, RETRY_BASE_MS * 2 ** (attempt - 1));
    const waitMs = (retryAfter ?? backoff) + Math.floor(Math.random() * 200);
    console.warn(
      `ai-client [${label}/${provider.name}]: повтор ${attempt}/${maxAttempts}, ${waitMs}ms (${lastError.response?.status || lastError.code || lastError.message})`
    );
    await sleep(waitMs);
  }
  throw lastError;
}

/**
 * @param {object} payload
 * @param {{ purpose?: 'chat'|'background', maxAttempts?: number, timeout?: number, label?: string }} [options]
 */
async function chatCompletions(payload, options = {}) {
  const isChat = options.purpose === 'chat';
  const maxAttempts = options.maxAttempts ?? (isChat ? CHAT_MAX_ATTEMPTS : MAX_ATTEMPTS);
  const allow429Retry = !isChat;
  const timeout = options.timeout ?? 90000;
  const label = options.label || (isChat ? 'chat' : 'api');
  const providers = getProviders();

  await acquireSlot();
  try {
    let lastError;
    for (const provider of providers) {
      try {
        const model = payload.model || provider.model;
        return await postWithRetries(
          { ...payload, model },
          { provider, maxAttempts, allow429Retry, timeout, label }
        );
      } catch (err) {
        lastError = err;
        if (err.code === 'AI_KEY_MISSING') throw err;
        const hasNext = providers.indexOf(provider) < providers.length - 1;
        if (isRateLimited(err) && hasNext) {
          console.warn(`ai-client [${label}]: 429 на ${provider.name} → сразу ${providers[providers.indexOf(provider) + 1].name}`);
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  } finally {
    releaseSlot();
  }
}

module.exports = {
  chatCompletions,
  isRateLimited,
  AI_API_URL,
  AI_API_KEY,
  AI_MODEL
};
