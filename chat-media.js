'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function resolveMediaRoot() {
  if (process.env.CHAT_MEDIA_PATH) return process.env.CHAT_MEDIA_PATH;
  const sessionPath = process.env.SESSION_PATH;
  if (sessionPath && path.isAbsolute(sessionPath)) {
    return path.join(path.dirname(sessionPath), 'chat-media');
  }
  if (fs.existsSync('/data')) return path.join('/data', 'chat-media');
  return path.join(__dirname, 'data', 'chat-media');
}

const MEDIA_ROOT = resolveMediaRoot();

function ensureMediaRoot() {
  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
  return MEDIA_ROOT;
}

function extFromMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return '.png';
  if (m.includes('webp')) return '.webp';
  if (m.includes('gif')) return '.gif';
  return '.jpg';
}

/**
 * Сохранить медиа WhatsApp на диск.
 * @returns {{ absPath: string, relPath: string, mime: string }|null}
 */
function saveChatMedia(waMessageId, media) {
  if (!media?.data) return null;
  ensureMediaRoot();
  const safeId = String(waMessageId || '')
    .replace(/[^\w.@-]+/g, '_')
    .slice(0, 180);
  const hash = crypto
    .createHash('sha1')
    .update(String(waMessageId || media.data.slice(0, 64)))
    .digest('hex')
    .slice(0, 10);
  const mime = String(media.mimetype || 'image/jpeg').split(';')[0];
  const fileName = `${safeId || 'media'}_${hash}${extFromMime(mime)}`;
  const absPath = path.join(MEDIA_ROOT, fileName);
  fs.writeFileSync(absPath, Buffer.from(String(media.data).replace(/\s+/g, ''), 'base64'));
  return { absPath, relPath: fileName, mime };
}

function resolveMediaAbsPath(relOrName) {
  const name = path.basename(String(relOrName || ''));
  if (!name || name.includes('..')) return null;
  const abs = path.join(MEDIA_ROOT, name);
  if (!fs.existsSync(abs)) return null;
  return abs;
}

function extractUrls(text) {
  const raw = String(text || '');
  const re = /https?:\/\/[^\s<>"')\]]+/gi;
  const found = raw.match(re) || [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?)]+$/g, '')))].slice(0, 5);
}

/**
 * Короткий текстовый снимок страницы по URL (для контекста ИИ).
 */
async function fetchLinkContext(url) {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) return null;
  // Не ходим на тяжёлые бинарники
  if (/\.(jpg|jpeg|png|gif|webp|mp4|pdf|zip)(\?|$)/i.test(target)) {
    return { url: target, title: '', text: 'Бинарный/медиа URL без HTML-страницы.' };
  }
  try {
    const axios = require('axios');
    const cheerio = require('cheerio');
    const res = await axios.get(target, {
      timeout: 12000,
      maxRedirects: 5,
      responseType: 'text',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; HouseTenerifeBot/1.0; +https://housetenerife.eu)',
        Accept: 'text/html,application/xhtml+xml',
      },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const html = String(res.data || '');
    if (!html || html.length < 40) return null;
    const $ = cheerio.load(html);
    $('script, style, noscript, svg, iframe').remove();
    const title = String($('title').first().text() || $('meta[property="og:title"]').attr('content') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    const desc = String(
      $('meta[name="description"]').attr('content') ||
        $('meta[property="og:description"]').attr('content') ||
        ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400);
    const body = String($('body').text() || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2200);
    const text = [desc, body].filter(Boolean).join('\n').slice(0, 2500);
    if (!title && !text) return null;
    return { url: target, title, text };
  } catch (e) {
    console.warn(`🔗 link fetch ${target}:`, e.message);
    return null;
  }
}

module.exports = {
  MEDIA_ROOT,
  ensureMediaRoot,
  saveChatMedia,
  resolveMediaAbsPath,
  extractUrls,
  fetchLinkContext,
};
