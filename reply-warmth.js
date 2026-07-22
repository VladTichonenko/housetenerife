'use strict';

const { normalizeSalesLang } = require('./sales-localization');

const WARM_MARKER_RE =
  /(?:[\u{1F300}-\u{1F9FF}\u2600-\u27BF])|:\)|;\)|:-\)|\(-:|🙂|😊|👋|👍/u;

const SKIP_STAGES =
  /^(SHOW_LISTINGS|OFFER_MANAGER_CALL|NEED_FUNDS_NOW|NEED_MORTGAGE|FINANCE_|PROPERTY_CLOSING)/;

const WARM_STAGES = new Set([
  'FIRST_CONTACT',
  'NEED_PURPOSE',
  'NEED_PROPERTY_TYPE',
  'NEED_REGION',
  'NEED_BUDGET',
  'NEED_LOCATION',
  'REFINE',
]);

/** Всегда тёплый тон на первом контакте; на остальных — примерно каждое второе сообщение */
const ALWAYS_WARM_STAGES = new Set(['FIRST_CONTACT']);

const OPENER_PATTERNS = {
  ru: /^(Привет|Здравствуйте|Отлично|Понял|Поняла|Хорошо|Прекрасно|Замечательно|Супер|Окей|Ок)([!,.]?\s+)/i,
  en: /^(Hi|Hello|Hey|Great|Got it|Perfect|Sounds good|Nice|Lovely|Okay|Ok)([!,.]?\s+)/i,
  es: /^(Hola|Perfecto|Genial|Vale|Claro|Entendido|De acuerdo|Estupendo|Ok)([!,.]?\s+)/i,
  de: /^(Hallo|Guten Tag|Perfekt|Verstanden|Alles klar|Super|Okay|Ok|Prima)([!,.]?\s+)/i,
  fr: /^(Bonjour|Salut|Parfait|Compris|D.accord|Super|Okay|Ok|Génial)([!,.]?\s+)/i,
};

function hasWarmMarker(text) {
  return WARM_MARKER_RE.test(String(text || ''));
}

function shouldSkipWarmth(stage) {
  return SKIP_STAGES.test(String(stage || ''));
}

function pickMarker(salesLang, text) {
  const useParens = (String(text || '').length + salesLang.length) % 3 !== 0;
  if (useParens) return ' :)';
  return ' 🙂';
}

function shouldInjectWarmth(stage, text) {
  if (ALWAYS_WARM_STAGES.has(stage)) return true;
  // ~45–55%: не в каждом сообщении, но достаточно часто для «живого» консультанта
  const hash = (String(text || '').length * 17 + String(stage || '').length * 7) % 100;
  return hash < 50;
}

function insertAfterOpener(text, salesLang) {
  const lang = normalizeSalesLang(salesLang);
  const pattern = OPENER_PATTERNS[lang] || OPENER_PATTERNS.en;
  const match = text.match(pattern);
  if (!match) return null;
  const marker = pickMarker(lang, text);
  const idx = match[0].length;
  return `${text.slice(0, idx).trimEnd()}${marker} ${text.slice(idx).trimStart()}`;
}

function appendMarker(text, salesLang) {
  const trimmed = text.trimEnd();
  const marker = pickMarker(normalizeSalesLang(salesLang), text);
  if (trimmed.endsWith('?') || trimmed.endsWith('!')) {
    return `${trimmed}${marker}`;
  }
  return `${trimmed}${marker}`;
}

/**
 * Добавляет один уместный смайлик / :) если модель не добавила.
 * Не в каждом сообщении — чтобы звучать как консультант, не как бот со смайлами.
 * @param {string} text
 * @param {string} salesLang
 * @param {string} stage
 */
function maybeAddWarmSmiley(text, salesLang, stage) {
  const body = String(text || '').trim();
  if (!body || hasWarmMarker(body)) return text;
  if (shouldSkipWarmth(stage)) return text;
  if (!WARM_STAGES.has(stage)) return text;
  if (!shouldInjectWarmth(stage, body)) return text;

  const withOpener = insertAfterOpener(body, salesLang);
  if (withOpener) return withOpener;

  return appendMarker(body, salesLang);
}

function getWarmTonePromptBlock(salesLang) {
  const lang = normalizeSalesLang(salesLang);
  if (lang === 'es') {
    return `**TONO CÁLIDO (WhatsApp):** En etapas de conversación (saludo, objetivo, tipo, región, zona, presupuesto) incluye de vez en cuando *un* emoji suave 🙂 o :) — no en cada mensaje, sí en saludo y en ~cada segunda respuesta cálida. Ejemplo: «Perfecto :) ¿qué tipo de inmueble…?» o «Hola, soy Maksim 🙂». Si el cliente envía un emoji — duplícalo. No en fichas con enlaces, hipoteca ni documentos.`;
  }
  if (lang === 'en') {
    return `**WARM TONE (WhatsApp):** On conversation stages (greeting, goal, type, region, area, budget) occasionally include *one* subtle 🙂 or :) — not every message, yes on greetings and roughly every other warm reply. Example: «Got it :) What property type…?» or «Hi, I'm Maxim 🙂». If the client sends an emoji — mirror it. Not in listing blocks, mortgage or documents.`;
  }
  if (lang === 'de') {
    return `**WARMER TON (WhatsApp):** In Gesprächsphasen (Begrüßung, Ziel, Typ, Region, Zone, Budget) gelegentlich *ein* dezentes 🙂 oder :) — nicht in jeder Nachricht, ja bei Begrüßung und etwa jeder zweiten warmen Antwort. Beispiel: «Perfekt :) Welcher Objekttyp…?» oder «Hallo, ich bin Maxim 🙂». Wenn der Kunde ein Emoji schickt — dasselbe spiegeln. Nicht bei Objektlisten, Hypothek oder Dokumenten.`;
  }
  if (lang === 'fr') {
    return `**TON CHALEUREUX (WhatsApp):** Aux étapes de conversation (accueil, objectif, type, région, zone, budget) inclure parfois *un* emoji doux 🙂 ou :) — pas à chaque message, oui à l’accueil et environ une réponse chaleureuse sur deux. Exemple: « Parfait :) Quel type de bien… ? » ou « Bonjour, je suis Maxim 🙂 ». Si le client envoie un emoji — le dupliquer. Pas sur les fiches, l’hypothèque ni les documents.`;
  }
  return `**ТЁПЛЫЙ ТОН (WhatsApp):** На этапах диалога (приветствие, цель, тип, регион, район, бюджет) иногда добавляй *один* мягкий смайлик 🙂 или скобочки :) — не в каждом сообщении, обязательно в приветствии и примерно в каждом втором тёплом ответе. Если клиент прислал смайлик — *обязательно дублируй его же* в ответе. Пример: «Отлично :) Какой тип объекта…?» или «Привет, я Максим 🙂». Не в подборке со ссылками, не на ипотеке/документах.`;
}

module.exports = {
  maybeAddWarmSmiley,
  getWarmTonePromptBlock,
  hasWarmMarker,
};
