'use strict';

/** @type {Map<string, Promise<unknown>>} */
const chains = new Map();

/**
 * Задачи одного чата — по порядку; разные чаты — параллельно.
 * @param {string} chatId
 * @param {() => Promise<unknown>} fn
 */
function enqueueForChat(chatId, fn) {
  const key = String(chatId || 'unknown');
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(key, next);
  next.finally(() => {
    if (chains.get(key) === next) chains.delete(key);
  });
  return next;
}

module.exports = { enqueueForChat };
