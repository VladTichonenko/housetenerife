'use strict';

const DEFAULT_HISTORY_LIMIT = 20;

function normalizeHistoryMessage(message = {}) {
  const text = String(message.text || '').trim();
  if (!text) return null;

  const role = String(message.role || '').toLowerCase();
  if (!['user', 'assistant', 'manager'].includes(role)) return null;

  const parsedAt = Date.parse(message.at || '');
  return {
    sender: role === 'user' ? 'user' : 'assistant',
    text,
    timestamp: Number.isFinite(parsedAt) ? parsedAt : Date.now(),
  };
}

function buildRuntimeHistory(messages, limit = DEFAULT_HISTORY_LIMIT) {
  const safeLimit = Math.max(1, parseInt(limit, 10) || DEFAULT_HISTORY_LIMIT);
  return (Array.isArray(messages) ? messages : [])
    .map(normalizeHistoryMessage)
    .filter(Boolean)
    .slice(-safeLimit);
}

/**
 * Однократно восстанавливает оперативную историю чата из персистентного архива.
 * Пустая история тоже записывается в Map, чтобы не читать весь JSON повторно.
 */
function hydrateConversationHistory(historyMap, chatId, loadMessages, limit = DEFAULT_HISTORY_LIMIT) {
  if (!historyMap || !chatId || typeof loadMessages !== 'function') {
    return { hydrated: false, count: 0 };
  }

  const id = String(chatId);
  if (historyMap.has(id)) {
    return { hydrated: false, count: historyMap.get(id)?.length || 0 };
  }

  const history = buildRuntimeHistory(loadMessages(id), limit);
  historyMap.set(id, history);
  return { hydrated: true, count: history.length };
}

module.exports = {
  DEFAULT_HISTORY_LIMIT,
  normalizeHistoryMessage,
  buildRuntimeHistory,
  hydrateConversationHistory,
};
