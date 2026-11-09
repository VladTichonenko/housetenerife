'use strict';

/**
 * Постобработка ответа бота перед отправкой клиенту:
 *  - sanitizeWebReply: вырезает внутренние токены/блоки промпта, которые модель могла «эхнуть»
 *    ([Website page property …], [Full catalog …], [описание фото], STATUS: SOLD …);
 *  - dropListingBlocks: убирает карточки с указанными URL (проданные).
 */

const PROPERTY_URL_RE =
  /https?:\/\/(?:www\.)?housetenerife\.eu(?:\/(?:ru|es|en|de|fr|pl|nl))?\/property\/[^\s<>\])"'}]+/gi;

function extractPropertyUrls(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text || '').matchAll(PROPERTY_URL_RE)) {
    const u = m[0].replace(/[.,;:!?)]+$/, '');
    const key = u.toLowerCase().replace(/\/+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

function urlKey(u) {
  return String(u || '')
    .toLowerCase()
    .replace(/[.,;:!?)]+$/, '')
    .replace(/\/+$/, '');
}

/**
 * Удаляет «карточки» (абзацы / пункты списка), содержащие любой из urls.
 * @param {string} text
 * @param {string[]} urls
 */
function dropListingBlocks(text, urls) {
  const drop = new Set((urls || []).map(urlKey));
  if (!drop.size) return String(text || '');
  const blocks = String(text || '').split(/\n{2,}/);
  const out = [];
  const hasDropped = (s) => extractPropertyUrls(s).some((u) => drop.has(urlKey(u)));
  for (const block of blocks) {
    if (!hasDropped(block)) {
      out.push(block);
      continue;
    }
    // В одном абзаце несколько пунктов — режем по маркерам списка
    const lines = block.split('\n');
    const parts = [];
    let cur = [];
    for (const line of lines) {
      if (/^\s*(?:[•\-*]|\d+[.)])\s+/.test(line) && cur.length) {
        parts.push(cur);
        cur = [];
      }
      cur.push(line);
    }
    if (cur.length) parts.push(cur);
    if (parts.length <= 1) continue; // весь абзац — одна проданная карточка
    for (const p of parts) {
      const joined = p.join('\n');
      if (!hasDropped(joined)) out.push(joined);
    }
  }
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

const INTERNAL_BLOCK_RES = [
  // Контекст страницы (многострочный блок из bindWebchatPageProperty)
  /\[Website page property[^\]]*\][\s\S]*?(?:Treat it as the selected listing unless they clearly ask for other options\.?|(?=\n{2,})|$)/gi,
  /I['’]m looking at this property:[^\n]*/gi,
  // Заголовок каталога из searchForContext
  /\[(?:Full catalog|Полный каталог|Cat[aá]logo completo|Vollst[aä]ndiger Katalog|Catalogue complet|Pe[lł]ny katalog|Volledige catalogus)[^\]]*\]/gi,
  /\((?:внутренний фильтр|internal filter|filtro interno|interner Filter|filtre interne|filtr wewn[eę]trzny|interne filter)[^)]*\)/gi,
  // Служебные пометки промпта
  /^[ \t]*STATUS:\s*(?:SOLD|RESERVED|UNAVAILABLE)\b.*$/gim,
  /\[(?:описание фото|содержимое ссылки|photo description|link content|foto)\]/gi,
  /\*\*(?:ФОТО[^*]*|PHOTO[^*]*|FOTO[^*]*|CATCH-UP[^*]*|ДОГОН[^*]*)\*\*:?/gi,
];

const EMPTY_FALLBACK = {
  ru: 'Здравствуйте! Подскажите, какую недвижимость на Тенерифе вы ищете?',
  en: 'Hello! What kind of property in Tenerife are you looking for?',
  es: '¡Hola! ¿Qué tipo de inmueble busca en Tenerife?',
  de: 'Hallo! Welche Immobilie auf Teneriffa suchen Sie?',
  fr: 'Bonjour ! Quel type de bien recherchez-vous à Tenerife ?',
  pl: 'Dzień dobry! Jakiej nieruchomości szukacie na Teneryfie?',
  nl: 'Hallo! Wat voor woning zoekt u op Tenerife?',
};

function hasInternalTokens(text) {
  const s = String(text || '');
  return INTERNAL_BLOCK_RES.some((re) => {
    re.lastIndex = 0;
    const hit = re.test(s);
    re.lastIndex = 0;
    return hit;
  });
}

/**
 * @param {string} text
 * @param {string} [lang]
 */
function sanitizeWebReply(text, lang = 'en') {
  let out = String(text || '');
  if (!out) return out;
  for (const re of INTERNAL_BLOCK_RES) {
    re.lastIndex = 0;
    out = out.replace(re, '');
  }
  out = out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!out) {
    const l = String(lang || 'en').toLowerCase().slice(0, 2);
    return EMPTY_FALLBACK[l] || EMPTY_FALLBACK.en;
  }
  return out;
}

module.exports = {
  PROPERTY_URL_RE,
  extractPropertyUrls,
  dropListingBlocks,
  sanitizeWebReply,
  hasInternalTokens,
};
