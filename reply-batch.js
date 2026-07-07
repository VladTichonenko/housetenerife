'use strict';

const REPLY_WAIT_MS = Math.max(
  0,
  parseInt(process.env.BOT_REPLY_WAIT_MS, 10) || 20000
);
const REPLY_BATCH_WAIT_MS = Math.max(
  REPLY_WAIT_MS,
  parseInt(process.env.BOT_REPLY_BATCH_WAIT_MS, 10) || 30000
);

/** @type {Map<string, { messages: object[], firstAt: number, timer: ReturnType<typeof setTimeout>|null, source: string }>} */
const batches = new Map();

/**
 * Откладывает обработку сообщений чата: 20 с на одиночное, 30 с суммарно при пачке.
 * @param {string} chatId
 * @param {object} msg
 * @param {string} source
 * @param {(chatId: string, messages: object[], source: string) => void|Promise<void>} onFlush
 * @param {(fn: () => void|Promise<void>, delayMs: number) => ReturnType<typeof setTimeout>} [scheduleTimeout]
 */
function scheduleReplyBatch(chatId, msg, source, onFlush, scheduleTimeout = setTimeout) {
  const key = String(chatId || 'unknown');
  let batch = batches.get(key);

  if (!batch) {
    batch = { messages: [], firstAt: Date.now(), timer: null, source };
    batches.set(key, batch);
  }

  batch.messages.push(msg);
  batch.source = source;

  const multi = batch.messages.length > 1;
  const targetMs = multi ? REPLY_BATCH_WAIT_MS : REPLY_WAIT_MS;
  const elapsed = Date.now() - batch.firstAt;
  const remaining = Math.max(0, targetMs - elapsed);

  if (batch.timer) clearTimeout(batch.timer);
  batch.timer = scheduleTimeout(async () => {
    const current = batches.get(key);
    if (!current || current !== batch) return;
    batches.delete(key);
    const messages = current.messages.slice();
    const batchSource = current.source;
    try {
      await onFlush(key, messages, batchSource);
    } catch (err) {
      console.error('❌ reply-batch flush:', err.message);
    }
  }, remaining);

  console.log(
    `⏳ Ожидание ответа ${key}: ${batch.messages.length} сообщ., через ${Math.round(remaining / 1000)} с (${multi ? `пачка, всего ${REPLY_BATCH_WAIT_MS / 1000} с` : `${REPLY_WAIT_MS / 1000} с`})`
  );
}

function cancelReplyBatch(chatId) {
  const key = String(chatId || 'unknown');
  const batch = batches.get(key);
  if (batch?.timer) clearTimeout(batch.timer);
  batches.delete(key);
}

function hasPendingReplyBatch(chatId) {
  return batches.has(String(chatId || 'unknown'));
}

module.exports = {
  scheduleReplyBatch,
  cancelReplyBatch,
  hasPendingReplyBatch,
  REPLY_WAIT_MS,
  REPLY_BATCH_WAIT_MS,
};
