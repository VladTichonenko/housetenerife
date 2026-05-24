'use strict';

function looksLikeLink(text) {
  return /(?:https?:\/\/|www\.)/i.test(text);
}

/** @type {Map<string, object>} */
const pending = new Map();

const PENDING_TTL_MS = 30 * 60 * 1000;

function setPendingHandoff(chatId, data) {
  pending.set(chatId, {
    ...data,
    startedAt: Date.now(),
  });
}

function getPendingHandoff(chatId) {
  const item = pending.get(chatId);
  if (!item) return null;
  if (Date.now() - item.startedAt > PENDING_TTL_MS) {
    pending.delete(chatId);
    return null;
  }
  return item;
}

function clearPendingHandoff(chatId) {
  pending.delete(chatId);
}

function extractClientName(text) {
  if (!text || typeof text !== 'string') return null;
  if (looksLikeLink(text)) return null;
  const trimmed = text.trim();
  if (/^\[фото\]/i.test(trimmed)) return null;

  let name = trimmed.replace(/\s+/g, ' ');
  name = name.replace(
    /^(меня зовут|зовут меня|my name is|i am|i'm|me llamo|soy|ich heiße|je m'appelle|mi chiamo)\s+/i,
    ''
  );
  name = name.replace(/^[-–—•*]+|[-–—•*]+$/g, '').trim();
  if (name.length < 2 || name.length > 80) return null;
  if (/^[\d\s+()@-]+$/.test(name)) return null;
  return name;
}

module.exports = {
  setPendingHandoff,
  getPendingHandoff,
  clearPendingHandoff,
  extractClientName,
};
