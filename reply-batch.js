'use strict';

function readNonNegativeEnv(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Пауза после последнего сообщения (trailing debounce). */
const REPLY_WAIT_MS = Math.max(0, readNonNegativeEnv('BOT_REPLY_WAIT_MS', 2500));
/**
 * Максимум от первого сообщения в пачке — чтобы при «дописывании» не ждать вечно.
 * По умолчанию max(REPLY_WAIT, 6000).
 */
const REPLY_BATCH_WAIT_MS = Math.max(
  REPLY_WAIT_MS,
  readNonNegativeEnv('BOT_REPLY_BATCH_WAIT_MS', 6000)
);

/**
 * Окно сбора (trailing):
 * - каждое новое сообщение сбрасывает короткий таймер REPLY_WAIT_MS;
 * - но не дольше REPLY_BATCH_WAIT_MS от первого в пачке → один ответ.
 *
 * @type {Map<string, { messages: object[], messageIds: Set<string>, firstAt: number, timer: ReturnType<typeof setTimeout>|null, source: string, flushing: boolean }>}
 */
const batches = new Map();

/** msgId → chatId — чтобы message/message_create/polling не дублировали пачку */
const queuedMessageIds = new Map();

function messageKey(msg) {
  if (!msg) return '';
  if (typeof msg.id === 'string') return msg.id;
  if (msg.id && msg.id._serialized) return String(msg.id._serialized);
  if (msg.id && msg.id.id) return String(msg.id.id);
  return '';
}

function isMessageQueuedInBatch(msgOrId) {
  const id = typeof msgOrId === 'string' ? msgOrId : messageKey(msgOrId);
  return Boolean(id && queuedMessageIds.has(id));
}

function clearBatchIds(batch) {
  if (!batch) return;
  for (const id of batch.messageIds) {
    queuedMessageIds.delete(id);
  }
}

/**
 * Откладывает обработку: ждём REPLY_WAIT_MS после последнего сообщения,
 * но не больше REPLY_BATCH_WAIT_MS от первого. Несколько сообщений → один flush.
 *
 * @param {string} chatId
 * @param {object} msg
 * @param {string} source
 * @param {(chatId: string, messages: object[], source: string) => void|Promise<void>} onFlush
 * @param {(fn: () => void|Promise<void>, delayMs: number) => ReturnType<typeof setTimeout>} [scheduleTimeout]
 * @returns {'added'|'duplicate'|'empty'|'flushing'}
 */
function scheduleReplyBatch(chatId, msg, source, onFlush, scheduleTimeout = setTimeout) {
  const key = String(chatId || 'unknown');
  const msgId = messageKey(msg);
  if (!msgId) {
    console.warn('⚠️ reply-batch: сообщение без id, пропускаю дебаунс');
    return 'empty';
  }

  if (queuedMessageIds.has(msgId)) {
    console.log(`⏭️ Пачка: уже в очереди ${msgId.substring(0, 24)}...`);
    return 'duplicate';
  }

  let batch = batches.get(key);

  // Flush уже идёт — не теряем новое сообщение: новая пачка после текущей.
  if (batch?.flushing) {
    batch = null;
  }

  if (!batch) {
    batch = {
      messages: [],
      messageIds: new Set(),
      firstAt: Date.now(),
      timer: null,
      source,
      flushing: false,
    };
    batches.set(key, batch);
  }

  batch.messages.push(msg);
  batch.messageIds.add(msgId);
  queuedMessageIds.set(msgId, key);
  batch.source = source;

  const now = Date.now();
  const sinceFirst = now - batch.firstAt;
  const maxRemaining = Math.max(0, REPLY_BATCH_WAIT_MS - sinceFirst);
  // Trailing: всегда ждём REPLY_WAIT_MS от последнего, но не выходим за max окно.
  const remaining = Math.min(REPLY_WAIT_MS, maxRemaining);

  if (batch.timer) clearTimeout(batch.timer);
  batch.timer = scheduleTimeout(async () => {
    const current = batches.get(key);
    if (!current || current !== batch || current.flushing) return;
    current.flushing = true;
    current.timer = null;
    // Не удаляем queuedMessageIds до конца flush — иначе polling/message_create
    // подхватит те же id вторым заходом, пока AI ещё думает.
    const messages = current.messages.slice();
    const batchSource = current.source;
    try {
      await onFlush(key, messages, batchSource);
    } catch (err) {
      console.error('❌ reply-batch flush:', err.message);
    } finally {
      clearBatchIds(current);
      if (batches.get(key) === current) {
        batches.delete(key);
      }
    }
  }, remaining);

  const multi = batch.messages.length > 1;
  const sec = (remaining / 1000).toFixed(remaining % 1000 ? 1 : 0);
  console.log(
    `⏳ Ожидание ответа ${key}: ${batch.messages.length} сообщ., через ${sec} с` +
      (multi
        ? ` (пачка, max ${REPLY_BATCH_WAIT_MS / 1000} с от первого)`
        : ` (пауза ${REPLY_WAIT_MS / 1000} с после последнего)`)
  );

  return 'added';
}

function cancelReplyBatch(chatId) {
  const key = String(chatId || 'unknown');
  const batch = batches.get(key);
  if (!batch) return;
  if (batch.timer) clearTimeout(batch.timer);
  clearBatchIds(batch);
  batches.delete(key);
}

function hasPendingReplyBatch(chatId) {
  return batches.has(String(chatId || 'unknown'));
}

module.exports = {
  scheduleReplyBatch,
  cancelReplyBatch,
  hasPendingReplyBatch,
  isMessageQueuedInBatch,
  REPLY_WAIT_MS,
  REPLY_BATCH_WAIT_MS,
};
