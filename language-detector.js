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
  nld: 'nl',
  tur: 'tr',
};

const SUPPORTED_DETECT = ['ru', 'en', 'es', 'de', 'uk', 'pt', 'fr', 'it', 'pl', 'nl', 'tr'];

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
  hallo: 'de',
  bonjour: 'fr',
  salut: 'fr',
  merci: 'fr',
  danke: 'de',
  привет: 'ru',
  здравствуйте: 'ru',
  gracias: 'es',
  thanks: 'en',
  cześć: 'pl',
  czesc: 'pl',
  tak: 'pl',
  nie: 'pl',
  dziękuję: 'pl',
  dziekuje: 'pl',
  proszę: 'pl',
  prosze: 'pl',
  bedankt: 'nl',
  graag: 'nl',
  goedemorgen: 'nl',
  goedemiddag: 'nl',
  goedenavond: 'nl',
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
  fr: new Set([
    'je', 'nous', 'vous', 'me', 'mon', 'ma', 'mes', 'notre', 'nos', 'votre', 'vos',
    'le', 'la', 'les', 'un', 'une', 'des', 'et', 'ou', 'mais', 'dans', 'de', 'du', 'au', 'aux', 'a', 'à', 'avec', 'pour', 'par', 'sans', 'sur', 'entre', 'comme', 'où', 'quand', 'pourquoi', 'combien',
    'bonjour', 'salut', 'bonsoir', 'merci', 's\'il', 'svp', 'oui', 'non', 'ok', 'd\'accord',
    'veux', 'vouloir', 'voudrais', 'cherche', 'cherchons', 'besoin', 'intéresse', 'aide',
    'acheter', 'achat', 'investir', 'investissement', 'location', 'vivre', 'déménagement', 'demenagement',
    'appartement', 'maison', 'villa', 'propriété', 'propriete', 'bien', 'immobilier',
    'budget', 'prix', 'euro', 'euros', 'mille', 'millions',
    'tenerife', 'espagne', 'dubai', 'dubaï', 'marbella', 'barcelona', 'barcelone', 'ibiza', 'canaries',
    'suis', 'avons', 'ai', 'serait', 'aimerais',
  ]),
  pl: new Set([
    'ja', 'my', 'wy', 'ty', 'mi', 'nas', 'was', 'mnie', 'ciebie', 'pan', 'pani',
    'i', 'w', 'na', 'z', 'do', 'od', 'dla', 'po', 'przy', 'bez', 'lub', 'ale', 'że', 'jak', 'gdzie', 'kiedy', 'dlaczego', 'ile',
    'cześć', 'czesc', 'dzień', 'dobry', 'dziekuje', 'dziękuję', 'proszę', 'prosze', 'tak', 'nie', 'ok',
    'chcę', 'chce', 'chcemy', 'szukam', 'szukamy', 'potrzebuję', 'potrzebuje', 'interesuje',
    'kupić', 'kupic', 'inwestycja', 'inwestować', 'inwestowac', 'wynajem', 'mieszkać', 'mieszkac', 'przeprowadzka',
    'mieszkanie', 'apartament', 'dom', 'willa', 'nieruchomość', 'nieruchomosc', 'obiekt', 'działka', 'dzialka',
    'budżet', 'budzet', 'cena', 'euro', 'tysięcy', 'tysiecy', 'milion',
    'teneryfa', 'tenerife', 'hiszpania', 'dubaj', 'marbella', 'barcelona', 'ibiza',
  ]),
  nl: new Set([
    'ik', 'wij', 'we', 'jij', 'je', 'u', 'mij', 'ons', 'mijn', 'jouw', 'uw',
    'de', 'het', 'een', 'en', 'of', 'maar', 'in', 'op', 'aan', 'met', 'van', 'voor', 'naar', 'bij', 'uit', 'over', 'als', 'wat', 'waar', 'wanneer', 'waarom', 'hoeveel',
    'hallo', 'goedemorgen', 'goedemiddag', 'goedenavond', 'bedankt', 'alsjeblieft', 'graag', 'ja', 'nee', 'ok', 'oke',
    'wil', 'willen', 'zoek', 'zoeken', 'nodig', 'interessant', 'hulp',
    'kopen', 'koop', 'investering', 'investeren', 'huur', 'wonen', 'verhuizen',
    'appartement', 'huis', 'villa', 'woning', 'vastgoed', 'object', 'grond',
    'budget', 'prijs', 'euro', 'duizend', 'miljoen',
    'tenerife', 'spanje', 'dubai', 'marbella', 'barcelona', 'ibiza', 'canarische',
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
  if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(text)) return 'pl';
  if (/[ñáéíóúüÑÁÉÍÓÚÜ]/i.test(text)) return 'es';
  if (/[äöüßÄÖÜ]/i.test(text)) return 'de';
  if (/[àâçéèêëîïôùûüœæ]/i.test(text)) return 'fr';
  return null;
}

function scoreStopWords(words) {
  const scores = { ru: 0, en: 0, es: 0, de: 0, fr: 0, pl: 0, nl: 0 };
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
  // Не считаем топонимы (Tenerife/Dubai…) — они есть во всех языках и ломают детекцию EN↔ES
  if (/\b(quiero|busco|necesito|quisiera|gustaria|gustaría|apartamento|piso|invertir|inversión|inversion|presupuesto|hola|gracias|españa|espana)\b/i.test(text)) {
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
  if (/\b(i|i'm|i've|we're|looking|want|need|investment|apartment|property|budget|please|thanks|hello)\b/i.test(text)) {
    scores.en += 2;
  }
  if (/\b(the|and|with|for|from|about|help)\b/i.test(text)) {
    scores.en += 1;
  }
}

function applyRussianMarkers(text, scores) {
  if (/[а-яё]/i.test(text)) scores.ru += 4;
}

function applyPolishMarkers(text, scores) {
  if (/[ąćęłńóśźż]/i.test(text)) scores.pl += 4;
  if (/\b(chcę|szukam|mieszkanie|apartament|budżet|inwestycja|nieruchomość|proszę|dziękuję|cześć)\b/i.test(text)) {
    scores.pl += 3;
  }
}

function applyDutchMarkers(text, scores) {
  if (/\b(ik|wij|zoek|zoeken|appartement|woning|vastgoed|budget|investering|bedankt|graag|goedemorgen)\b/i.test(text)) {
    scores.nl += 3;
  }
  if (/\b(het|een|van|voor|naar|met|wil|kopen|wonen)\b/i.test(text)) {
    scores.nl += 1.5;
  }
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
/**
 * Короткие реплики вроде ok / yes / да — слишком слабый сигнал, чтобы менять язык диалога.
 */
function isAmbiguousShortReply(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return true;
  const words = tokenize(trimmed);
  if (words.length === 0) return true;
  if (words.length === 1) {
    const w = words[0];
    if (SHORT_REPLY[w] || SHORT_REPLY[trimmed.toLowerCase()]) return true;
    // Одно служебное EN-слово не должно переключать sticky-язык диалога
    if (/^(error|sorry|please|thanks|thank|hello|budget|ok|okay|yes|no|hi|hey)$/i.test(w)) {
      return true;
    }
  }
  // Цифры, бюджет «300k», эмодзи — без смены языка
  if (words.length <= 3 && words.every((w) => /^\d+[kкм]?$/i.test(w) || /^[€$]$/.test(w))) {
    return true;
  }
  return trimmed.length < 3;
}

/**
 * Достаточно ли сигнала, чтобы переключить sticky-язык диалога.
 */
function isStrongLanguageSignal(text, detectedLang) {
  const trimmed = String(text || '').trim();
  if (!trimmed || !detectedLang) return false;
  if (isAmbiguousShortReply(trimmed)) return false;

  const scriptLang = detectByScript(trimmed);
  if (scriptLang && scriptLang === detectedLang) return true;
  if (/[а-яёіїєґ]/i.test(trimmed) && (detectedLang === 'ru' || detectedLang === 'uk')) {
    return true;
  }
  if (/[ąćęłńóśźż]/i.test(trimmed) && detectedLang === 'pl') {
    return true;
  }

  const words = tokenize(trimmed);
  if (words.length >= 4 && trimmed.length >= 16) return true;
  if (words.length >= 3 && trimmed.length >= 12) return true;
  return false;
}

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
  applyPolishMarkers(trimmed, scores);
  applyDutchMarkers(trimmed, scores);

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
    nl: 'Нидерландский',
    tr: 'Турецкий',
    uk: 'Украинский',
  };
  return names[langCode] || langCode;
}

module.exports = {
  detectLanguageFromText,
  getLanguageName,
  isAmbiguousShortReply,
  isStrongLanguageSignal,
  SUPPORTED_DETECT,
};
