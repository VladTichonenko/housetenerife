'use strict';

const { franc } = require('franc-min');

/** ISO 639-3 → коды бота */
const ISO3_TO_CODE = {
  rus: 'ru',
  ukr: 'uk',
  bel: 'ru',
  eng: 'en',
  spa: 'es',
  por: 'pt',
  deu: 'de',
  fra: 'fr',
  ita: 'it',
  pol: 'pl',
  tur: 'tr',
};

const SUPPORTED_DETECT = ['ru', 'en', 'es', 'de', 'uk', 'pt', 'fr', 'it', 'pl', 'tr'];

/** Короткие реплики — целые слова */
const SHORT_REPLY = {
  si: 'es',
  sí: 'es',
  ok: 'en',
  okay: 'en',
  yes: 'en',
  da: 'ru',
  нет: 'ru',
  да: 'ru',
  ja: 'de',
  nein: 'de',
  hola: 'es',
  hello: 'en',
  hi: 'en',
  hey: 'en',
  привет: 'ru',
  здравствуйте: 'ru',
  gracias: 'es',
  thanks: 'en',
  merci: 'fr',
  danke: 'de',
};

const STOP_WORDS = {
  ru: new Set([
    'я', 'мы', 'вы', 'ты', 'мне', 'нам', 'меня', 'нас', 'вас',
    'и', 'в', 'на', 'с', 'по', 'для', 'от', 'до', 'из', 'к', 'у', 'о', 'об', 'при', 'без', 'или', 'но', 'а', 'же', 'ли', 'бы', 'что', 'как', 'где', 'когда', 'почему', 'зачем', 'сколько',
    'хочу', 'хотим', 'хотел', 'хотела', 'ищу', 'ищем', 'нужно', 'нужен', 'нужна', 'можно', 'интересует', 'интересует',
    'привет', 'здравствуйте', 'добрый', 'день', 'вечер', 'спасибо', 'пожалуйста', 'подскажите', 'расскажите',
    'да', 'нет', 'ок', 'хорошо', 'понятно', 'ладно',
    'квартира', 'квартиру', 'апартаменты', 'апартамент', 'дом', 'вилла', 'виллу', 'недвижимость', 'объект', 'объекты', 'жилье', 'жильё',
    'инвестиция', 'инвестицию', 'инвестировать', 'аренда', 'доход', 'бюджет', 'евро', 'тысяч', 'млн',
    'тенерифе', 'тенериф', 'испания', 'дубай', 'марбелья', 'барселона', 'майорка', 'ибица',
    'покупка', 'купить', 'куплю', 'смотрю', 'рассматриваю', 'переезд', 'жизнь', 'семья', 'семьей',
  ]),
  en: new Set([
    'i', 'we', 'you', 'me', 'my', 'our', 'your', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'by', 'about', 'into', 'through', 'during', 'before', 'after',
    'what', 'how', 'where', 'when', 'why', 'which', 'who', 'whom',
    'want', 'wanted', 'need', 'needed', 'looking', 'look', 'interested', 'interest', 'help', 'please', 'thanks', 'thank', 'hello', 'hi', 'hey', 'yes', 'no', 'ok', 'okay', 'sure',
    'buy', 'buying', 'purchase', 'invest', 'investment', 'investing', 'rent', 'rental', 'live', 'living', 'relocate', 'relocation',
    'apartment', 'flat', 'house', 'villa', 'property', 'properties', 'real', 'estate', 'home', 'homes', 'listing', 'listings',
    'budget', 'price', 'euro', 'eur', 'thousand', 'million', 'around', 'up', 'to',
    'tenerife', 'spain', 'dubai', 'marbella', 'barcelona', 'ibiza', 'canary', 'canaries',
  ]),
  es: new Set([
    'yo', 'nosotros', 'usted', 'ustedes', 'me', 'mi', 'mis', 'nos', 'les', 'su', 'sus',
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'pero', 'en', 'de', 'del', 'al', 'a', 'con', 'por', 'para', 'sin', 'sobre', 'entre', 'hasta', 'desde', 'que', 'como', 'donde', 'cuando', 'porque', 'cuanto', 'cuánto',
    'hola', 'buenos', 'dias', 'días', 'tardes', 'noches', 'gracias', 'favor', 'porfavor', 'por favor', 'si', 'sí', 'no', 'vale', 'claro', 'bueno',
    'quiero', 'queremos', 'quisiera', 'busco', 'buscamos', 'necesito', 'necesitamos', 'puedo', 'puede', 'interesa', 'interesado', 'interesada', 'ayuda', 'ayudar',
    'comprar', 'compro', 'compra', 'invertir', 'inversion', 'inversión', 'invertir', 'alquiler', 'vivir', 'viviendo', 'mudanza', 'mudarme',
    'apartamento', 'piso', 'casa', 'villa', 'propiedad', 'propiedades', 'inmueble', 'inmuebles', 'vivienda', 'hogar',
    'presupuesto', 'precio', 'euro', 'euros', 'mil', 'millones',
    'tenerife', 'españa', 'espana', 'dubai', 'marbella', 'barcelona', 'ibiza', 'canarias', 'canary',
    'estoy', 'estamos', 'tengo', 'tenemos', 'seria', 'sería', 'gustaria', 'gustaría',
  ]),
  de: new Set([
    'ich', 'wir', 'sie', 'mir', 'mich', 'uns', 'mein', 'meine', 'unser', 'ihr',
    'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einem', 'einen',
    'und', 'oder', 'aber', 'in', 'im', 'an', 'auf', 'mit', 'von', 'zu', 'für', 'fur', 'nach', 'bei', 'aus', 'über', 'uber', 'wie', 'was', 'wo', 'wann', 'warum', 'welche', 'welcher',
    'hallo', 'guten', 'tag', 'morgen', 'abend', 'danke', 'bitte', 'ja', 'nein',
    'will', 'möchte', 'mochte', 'suche', 'suchen', 'brauche', 'brauchen', 'kaufen', 'kauf', 'investition', 'investieren', 'miete', 'wohnen', 'umziehen',
    'wohnung', 'apartment', 'haus', 'villa', 'immobilie', 'immobilien', 'eigentum',
    'budget', 'preis', 'euro', 'tausend',
    'teneriffa', 'spanien', 'dubai', 'marbella', 'barcelona', 'ibiza', 'kanaren',
  ]),
};

const FRANC_ONLY = Object.keys(ISO3_TO_CODE);

const HEAD_WORD_BONUS = 2.5;
const HEAD_WORD_COUNT = 10;

function stripAccents(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tokenize(text) {
  return stripAccents(String(text || '').toLowerCase())
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function detectByScript(text) {
  if (/[а-яёіїєґ]/i.test(text)) {
    if (/\b(і|ї|є|ґ|це|як|де|чому|привіт|дякую)\b/i.test(text)) return 'uk';
    return 'ru';
  }
  if (/[ñáéíóúüÑÁÉÍÓÚÜ]/i.test(text)) return 'es';
  if (/[äöüßÄÖÜ]/i.test(text)) return 'de';
  if (/[àâçéèêëîïôùûüœæ]/i.test(text)) return 'fr';
  return null;
}

function scoreStopWords(words) {
  const scores = { ru: 0, en: 0, es: 0, de: 0 };
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const weight = i < HEAD_WORD_COUNT ? HEAD_WORD_BONUS : 1;
    for (const lang of Object.keys(STOP_WORDS)) {
      if (STOP_WORDS[lang].has(word)) {
        scores[lang] += weight;
      }
    }
  }
  return scores;
}

function applySpanishMarkers(text, words, scores) {
  if (/\b(quiero|busco|necesito|quisiera|gustaria|gustaría|apartamento|piso|invertir|inversión|inversion|presupuesto|tenerife|españa|espana|hola|gracias)\b/i.test(text)) {
    scores.es += 3;
  }
  if (/\b(el|la|los|las|un|una|del|al|para|por|con|estoy|tengo|encaja|encajan)\b/i.test(text)) {
    scores.es += 1.5;
  }
  if (/\b\w+(ción|cion|sión|sion|mente|dad|tad)\b/i.test(text)) {
    scores.es += 2;
  }
}

function applyEnglishMarkers(text, words, scores) {
  if (/\b(i|i'm|i've|we're|we're|looking|want|need|investment|apartment|property|budget|tenerife)\b/i.test(text)) {
    scores.en += 2;
  }
  if (/\b(the|and|with|for|from|about|please|thanks|hello|help)\b/i.test(text)) {
    scores.en += 1;
  }
}

function applyRussianMarkers(text, scores) {
  if (/[а-яё]/i.test(text)) scores.ru += 4;
}

function pickTopScore(scores) {
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topLang, topScore] = ranked[0];
  const [, secondScore] = ranked[1] || ['', 0];
  if (topScore <= 0) return null;
  if (topScore === secondScore) return null;
  return topLang;
}

function detectByFranc(text) {
  const iso3 = franc(text, { minLength: 3, only: FRANC_ONLY });
  if (!iso3 || iso3 === 'und') return null;
  return ISO3_TO_CODE[iso3] || null;
}

/**
 * Определяет язык текста: стоп-слова (с приоритетом первых слов) + franc + скрипт.
 * @param {string} text
 * @returns {string} ru | en | es | de | uk | …
 */
function detectLanguageFromText(text) {
  if (!text || typeof text !== 'string') {
    return 'ru';
  }

  const trimmed = text.trim();
  if (!trimmed) return 'ru';

  const words = tokenize(trimmed);

  if (words.length === 1) {
    const short = SHORT_REPLY[words[0]] || SHORT_REPLY[trimmed.toLowerCase()];
    if (short) return short;
  }

  const scriptLang = detectByScript(trimmed);
  if (scriptLang && /[а-яёіїєґñáéíóúüäöüßàâçéèêëîïôùûœæ]/i.test(trimmed)) {
    return scriptLang;
  }

  const scores = scoreStopWords(words);
  applySpanishMarkers(trimmed, words, scores);
  applyEnglishMarkers(trimmed, words, scores);
  applyRussianMarkers(trimmed, scores);

  const heuristicLang = pickTopScore(scores);
  const francLang = trimmed.length >= 8 ? detectByFranc(trimmed) : null;

  if (heuristicLang && francLang) {
    if (heuristicLang === francLang) return heuristicLang;
    const topHeuristicScore = scores[heuristicLang] || 0;
    if (topHeuristicScore >= 4) return heuristicLang;
    if (trimmed.length >= 16 && francLang) return francLang;
    return heuristicLang;
  }

  if (heuristicLang) return heuristicLang;
  if (francLang) return francLang;
  if (scriptLang) return scriptLang;

  if (words.length && /^[a-z0-9\s.,!?€$%+\-/]+$/i.test(stripAccents(trimmed))) {
    return 'en';
  }

  return 'ru';
}

function getLanguageName(langCode) {
  const names = {
    ru: 'Русский',
    en: 'Английский',
    es: 'Испанский',
    de: 'Немецкий',
    fr: 'Французский',
    it: 'Итальянский',
    pt: 'Португальский',
    pl: 'Польский',
    tr: 'Турецкий',
    uk: 'Украинский',
  };
  return names[langCode] || langCode;
}

module.exports = {
  detectLanguageFromText,
  getLanguageName,
  SUPPORTED_DETECT,
};
