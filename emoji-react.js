'use strict';

/**
 * Реакция на смайлики клиента: извлечение, «только эмодзи», дублирование в ответе.
 */

/** Unicode emoji + вариации + ZWJ-последовательности (упрощённо). */
const EMOJI_TOKEN_RE =
  /(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)|(?:[\u0030-\u0039\u0023\u002A]\uFE0F?\u20E3)/gu;

const TEXT_SMILEY_RE = /(?:^|[\s])(:\)|;\)|:-\)|:D|=\)|:\(|:-\()(?=[\s]|$)/;

function extractEmojis(text) {
  const s = String(text || '');
  const found = s.match(EMOJI_TOKEN_RE) || [];
  // уникальные, порядок сохранения
  const seen = new Set();
  const out = [];
  for (const e of found) {
    if (!seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

function extractTextSmiley(text) {
  const m = String(text || '').match(TEXT_SMILEY_RE);
  return m ? m[0].trim() : '';
}

/**
 * Главный смайлик клиента для дублирования (первый эмодзи или :) ).
 */
function pickUserEmoji(text) {
  const emojis = extractEmojis(text);
  if (emojis.length) return emojis[0];
  return extractTextSmiley(text) || '';
}

/**
 * Сообщение состоит только из смайликов / :) и пунктуации/пробелов.
 */
function isEmojiOnlyMessage(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (!pickUserEmoji(s)) return false;
  const without = s
    .replace(EMOJI_TOKEN_RE, ' ')
    .replace(/(?:^|[\s])(:\)|;\)|:-\)|:D|=\)|:\(|:-\()(?=[\s]|$)/g, ' ')
    .replace(/[\s.,!?…~«»"'_\-–—]+/g, '')
    .trim();
  return without.length === 0;
}

function replyHasEmoji(text, emoji) {
  const body = String(text || '');
  if (!emoji) return extractEmojis(body).length > 0 || TEXT_SMILEY_RE.test(` ${body} `);
  if (emoji.startsWith(':') || emoji.startsWith(';') || emoji.startsWith('=')) {
    return body.includes(emoji);
  }
  return body.includes(emoji);
}

/**
 * Если клиент прислал смайлик — дублируем его в ответе бота (в начале).
 * Не трогаем длинные подборки со ссылками (кроме случая emoji-only запроса).
 */
function mirrorUserEmojiInReply(reply, userText, options = {}) {
  const body = String(reply || '').trim();
  if (!body) return reply;

  const userEmoji = pickUserEmoji(userText);
  if (!userEmoji) return reply;

  if (replyHasEmoji(body, userEmoji)) return body;

  const force = Boolean(options.force) || isEmojiOnlyMessage(userText);
  const hasLink = /(?:https?:\/\/|www\.|housetenerife\.eu)/i.test(body);
  if (hasLink && !force) return body;

  // Уже есть другой тёплый маркер — всё равно добавим смайлик клиента (задача: дублировать)
  return `${userEmoji} ${body}`;
}

/**
 * Ограничивает число эмодзи в ответе (анти-спам модели), не вырезая все.
 */
function limitEmojis(text, max = 3) {
  const s = String(text || '');
  if (!s) return s;
  let count = 0;
  return s.replace(EMOJI_TOKEN_RE, (m) => {
    count += 1;
    return count <= max ? m : '';
  });
}

module.exports = {
  extractEmojis,
  pickUserEmoji,
  isEmojiOnlyMessage,
  mirrorUserEmojiInReply,
  replyHasEmoji,
  limitEmojis,
  EMOJI_TOKEN_RE,
};
