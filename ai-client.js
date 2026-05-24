'use strict';

const axios = require('axios');

const AI_API_URL =
  process.env.AI_API_URL || 'https://api.intelligence.io.solutions/api/v1/chat/completions';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-ai/DeepSeek-V3.2';
const AI_API_KEY = process.env.AI_API_KEY;

const MAX_ATTEMPTS = Math.min(15, Math.max(1, parseInt(process.env.AI_MAX_RETRIES, 10) || 8));
const RETRY_BASE_MS = Math.max(400, parseInt(process.env.AI_RETRY_BASE_MS, 10) || 1800);
const MIN_INTERVAL_MS = Math.max(0, parseInt(process.env.AI_MIN_INTERVAL_MS, 10) || 400);
const MAX_CONCURRENT = Math.min(12, Math.max(1, parseInt(process.env.AI_CONCURRENCY, 10) || 6));

let lastRequestAt = 0;
let inFlight = 0;
/** @type {Array<() => void>} */
const waiters = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function isRetryable(err) {
  const status = err.response?.status;
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
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

async function postWithRetries(payload, options = {}) {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const timeout = options.timeout ?? 90000;
  const label = options.label || 'chat';

  if (!AI_API_KEY || !String(AI_API_KEY).trim()) {
    const err = new Error('AI_API_KEY is not set');
    err.code = 'AI_KEY_MISSING';
    throw err;
  }

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await waitMinInterval();
    try {
      const response = await axios.post(AI_API_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AI_API_KEY}`
        },
        timeout
      });
      lastRequestAt = Date.now();
      if (response.status >= 200 && response.status < 300) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
      lastError.response = response;
    } catch (err) {
      lastError = err;
      lastRequestAt = Date.now();
      if (attempt >= maxAttempts || !isRetryable(err)) {
        throw err;
      }
      const retryAfter = retryAfterMs(err);
      const backoff = Math.min(60000, RETRY_BASE_MS * 2 ** (attempt - 1));
      const waitMs = (retryAfter ?? backoff) + Math.floor(Math.random() * 300);
      console.warn(
        `ai-client [${label}]: ${attempt}/${maxAttempts}, пауза ${waitMs}ms (${err.response?.status || err.code || err.message})`
      );
      await sleep(waitMs);
    }
  }
  throw lastError;
}

/**
 * Параллельные запросы (до AI_CONCURRENCY), с повторами при 429/5xx.
 */
async function chatCompletions(payload, options = {}) {
  await acquireSlot();
  try {
    return await postWithRetries(payload, options);
  } finally {
    releaseSlot();
  }
}

module.exports = {
  chatCompletions,
  AI_API_URL,
  AI_API_KEY,
  AI_MODEL
};
