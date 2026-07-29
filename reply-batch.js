'use strict';

function readNonNegativeEnv(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const REPLY_WAIT_MS = Math.max(
  0,
  readNonNegativeEnv('BOT_REPLY_WAIT_MS', 3000)
);
const REPLY_BATCH_WAIT_MS = Math.max(
  REPLY_WAIT_MS,
  readNonNegativeEnv('BOT_REPLY_BATCH_WAIT_MS', 6000)
);

/**
 * Окно сбора: 1 сообщение → ждём REPLY_WAIT_MS;
 * если за это время пришло ещё — один ответ через REPLY_BATCH_WAIT_MS от первого.
 *
 * @type {Map<string, { messages: object[], messageIds: Set<string>, firstAt: number, timer: ReturnType<typeof setTimeout>|null, source: string }>}
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
  const id =
    typeof msgOrId === 'string' ? msgOrId : messageKey(msgOrId);
  return Boolean(id && queuedMessageIds.has(id));
}

/**
 * Откладывает обработку сообщений чата: короткая пауза на одиночное,
 * чуть большее окно при пачке.
 * Несколько сообщений за окно → один flush → один ответ бота.
 *
 * @param {string} chatId
 * @param {object} msg
 * @param {string} source
 * @param {(chatId: string, messages: object[], source: string) => void|Promise<void>} onFlush
 * @param {(fn: () => void|Promise<void>, delayMs: number) => ReturnType<typeof setTimeout>} [scheduleTimeout]
 * @returns {'added'|'duplicate'|'empty'}
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

  if (!batch) {
    batch = {
      messages: [],
      messageIds: new Set(),
      firstAt: Date.now(),
      timer: null,
      source,
    };
    batches.set(key, batch);
  }

  batch.messages.push(msg);
  batch.messageIds.add(msgId);
  queuedMessageIds.set(msgId, key);
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
    for (const id of current.messageIds) {
      queuedMessageIds.delete(id);
    }
    try {
      await onFlush(key, messages, batchSource);
    } catch (err) {
      console.error('❌ reply-batch flush:', err.message);
    }
  }, remaining);

  console.log(
    `⏳ Ожидание ответа ${key}: ${batch.messages.length} сообщ., через ${Math.round(remaining / 1000)} с (${multi ? `пачка → один ответ, окно ${REPLY_BATCH_WAIT_MS / 1000} с` : `${REPLY_WAIT_MS / 1000} с`})`
  );

  return 'added';
}

function cancelReplyBatch(chatId) {
  const key = String(chatId || 'unknown');
  const batch = batches.get(key);
  if (!batch) return;
  if (batch.timer) clearTimeout(batch.timer);
  for (const id of batch.messageIds) {
    queuedMessageIds.delete(id);
  }
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
