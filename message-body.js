'use strict';

const RETRY_DELAYS_MS = [500, 1200, 2500];

const TEXT_LIKE_TYPES = new Set([
  'chat',
  'text',
  'ciphertext',
  'e2e_notification',
  'buttons_response',
  'list_response',
  'template_button_reply',
  'poll_creation',
  'interactive',
  'hsm',
]);

const NON_TEXT_SKIP_TYPES = new Set([
  'image',
  'video',
  'audio',
  'ptt',
  'document',
  'sticker',
  'location',
  'contact_card',
  'contact_card_multi',
  'vcard',
  'reaction',
  'revoked',
  'call_log',
  'order',
  'product',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Извлекает читаемый текст из объекта Message (body, caption, ответы на кнопки/списки).
 */
function extractMessageText(msg) {
  if (!msg) return '';

  const body = typeof msg.body === 'string' ? msg.body.trim() : '';
  if (body) return body;

  const data = msg._data || msg.rawData;
  if (data) {
    const fromData = (data.body || data.caption || data.pollName || data.eventName || '').trim();
    if (fromData) return fromData;
    const selected = data.selectedButtonId || data.selectedRowId;
    if (selected) return String(selected).trim();
  }

  if (msg.selectedButtonId) return String(msg.selectedButtonId).trim();
  if (msg.selectedRowId) return String(msg.selectedRowId).trim();
  if (msg.pollName) return String(msg.pollName).trim();

  return '';
}

function isLikelyDecrypting(msg) {
  const type = msg?.type;
  if (!type || type === 'ciphertext' || type === 'e2e_notification') return true;
  if (TEXT_LIKE_TYPES.has(type) && !extractMessageText(msg)) return true;
  return false;
}

function isPermanentNonText(msg) {
  const type = msg?.type;
  if (!type) return false;
  if (type === 'ciphertext') return false;
  if (NON_TEXT_SKIP_TYPES.has(type)) return true;
  const data = msg._data || {};
  if (data.isViewOnce || data.viewMode === 'ONCE') return true;
  return false;
}

/**
 * Пытается получить текст: reload с паузами (race при fetchMessages / ciphertext).
 * @returns {{ text: string, msg: object }}
 */
async function resolveMessageText(msg) {
  let current = msg;
  let text = extractMessageText(current);
  if (text) return { text, msg: current };

  if (!isLikelyDecrypting(current) && isPermanentNonText(current)) {
    return { text: '', msg: current };
  }

  for (const delayMs of RETRY_DELAYS_MS) {
    await sleep(delayMs);
    try {
      const reloaded = await current.reload();
      if (reloaded) current = reloaded;
    } catch (err) {
      console.warn('⚠️ [resolveMessageText] reload:', err.message);
    }
    text = extractMessageText(current);
    if (text) {
      console.log('✅ [resolveMessageText] Текст получен после reload');
      return { text, msg: current };
    }
    if (current.type && current.type !== 'ciphertext' && !TEXT_LIKE_TYPES.has(current.type)) {
      break;
    }
  }

  return { text: '', msg: current };
}

const MAX_EMPTY_BODY_RETRIES = 6;
const emptyBodyRetryCount = new Map();

function trackEmptyBodyRetry(msgId) {
  const n = (emptyBodyRetryCount.get(msgId) || 0) + 1;
  emptyBodyRetryCount.set(msgId, n);
  return n;
}

function clearEmptyBodyRetry(msgId) {
  emptyBodyRetryCount.delete(msgId);
}

function exceededEmptyBodyRetries(msgId) {
  return (emptyBodyRetryCount.get(msgId) || 0) >= MAX_EMPTY_BODY_RETRIES;
}

module.exports = {
  extractMessageText,
  resolveMessageText,
  isLikelyDecrypting,
  isPermanentNonText,
  trackEmptyBodyRetry,
  clearEmptyBodyRetry,
  exceededEmptyBodyRetries,
  sleep,
};
