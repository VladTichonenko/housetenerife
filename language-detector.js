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
    'budget', 'price', 'euro', 'eur', 'euros', 'thousand', 'million', 'around', 'up', 'to',
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
    'budget', 'preis', 'euro', 'euros', 'tausend', 'million', 'millionen',
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

/** Убирает URL — иначе /es/property/… и slug на испанском ломают детект. */
function stripUrls(text) {
  return String(text || '')
    .replace(/https?:\/\/[^\s<>\])"'{}]+/gi, ' ')
    .replace(/\b(?:www\.)?housetenerife\.eu\/[^\s<>\])"'{}]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Названия объектов из каталога / скобки: «Parking à vendre», «en venta» —
 * не сигнал языка клиента (иначе ES→FR из‑за à vendre).
 */
function stripCatalogTitleNoise(text) {
  return String(text || '')
    .replace(/\[[^\]]{0,120}\]/g, ' ')
    .replace(/\([^)]{0,120}\)/g, ' ')
    .replace(
      /\b(?:parking|garage|plaza|local|negocio|bar|villa|apartamento?|piso|maison|wohnung)\s+(?:à\s+vendre|a\s+vendre|en\s+vente|en\s+venta|zu\s+verkaufen|for\s+sale|te\s+koop)\b/gi,
      ' '
    )
    .replace(/\b(?:à|a)\s+vendre\b/gi, ' ')
    .replace(/\ben\s+venta\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Текст для детекта языка: без URL и без «шума» каталога. */
function prepareDetectBody(text) {
  return stripCatalogTitleNoise(stripUrls(text));
}

function isUrlOnlyMessage(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (!/https?:\/\/|housetenerife\.eu/i.test(trimmed)) return false;
  const rest = prepareDetectBody(trimmed).replace(/[^\p{L}\p{N}]+/gu, '');
  return rest.length < 3;
}

function detectByScript(text) {
  if (/[а-яёіїєґ]/i.test(text)) {
    // Украинские буквы в слове (жіття, шукаю) — не только целые слова «і/ї»
    if (/[іїєґІЇЄҐ]/.test(text) || /\b(це|як|де|чому|привіт|дякую|шукаю|хочу|бюджет)\b/i.test(text)) {
      return 'uk';
    }
    return 'ru';
  }
  // Турецкий ДО немецкого: ü/ö/ç есть и в DE/FR/PT (bütçe, Yatırım)
  if (/[ışğİŞĞ]/.test(text)) return 'tr';
  if (
    /[üçöÜÇÖ]/.test(text) &&
    /\b(merhaba|i[cç]in|istiyorum|daire|yat[iı]r[iı]m|b[uü]t[cç]e|almak|ar[iı]yorum)\b/i.test(text)
  ) {
    return 'tr';
  }
  // Немецкий ДО испанского: ü в für/würde раньше ошибочно давал ES
  if (/[äöüßÄÖÜ]/.test(text)) return 'de';
  // Испанский ¿¡ñ ДО польского
  if (/[ñÑ]/.test(text) || /[¿¡]/.test(text)) return 'es';
  // Польские буквы без ó (ó общая с испанским)
  if (/[ąćęłńśźżĄĆĘŁŃŚŹŻ]/.test(text)) return 'pl';
  if (
    /[óÓ]/.test(text) &&
    /\b(jest|się|moz|moż|że|zeby|żeby|proszę|prosze|dziękuję|dziekuje|mieszkanie|szukam|chcę|chce|budżet|budzet)\b/i.test(
      text
    )
  ) {
    return 'pl';
  }
  // Португальский ã õ — уникальны; Olá/procuro ДО голого á→ES
  if (/[ãõÃÕ]/.test(text)) return 'pt';
  if (
    /\b(ol[aá]|procuro|quero|obrigado|bom\s+dia|or[cç]amento|para\s+viver)\b/i.test(text) &&
    /\b(um|uma|em|para|comprar|apartamento|villa)\b/i.test(text)
  ) {
    return 'pt';
  }
  // Испанские ударные (не голое á из PT Olá без ES-контекста)
  if (
    /[íúÍÚ]/.test(text) ||
    (/[áÁ]/.test(text) &&
      /\b(está|están|días|más|información|aquí|así|qué|quién|cómo|dónde|también|mañana|días)\b/i.test(text))
  ) {
    return 'es';
  }
  if (
    /[óÓ]/.test(text) &&
    /\b(inversi[oó]n|informaci[oó]n|opci[oó]n|tambi[eé]n|m[aá]s|c[oó]mo|d[oó]nde)\b/i.test(text)
  ) {
    return 'es';
  }
  if (
    /\b\w+[éÉ]\b/.test(text) &&
    /\b(yo|me|te|mi|tu|ya|esto|este|propuesta|pas[eé]|habl[eé]|dij[eé]|estoy|alquilar|alquilarlo|dijistes|hablastes)\b/i.test(
      text
    )
  ) {
    return 'es';
  }
  // Португальский ç с PT-контекстом (ç также FR/TR)
  if (/[çÇ]/.test(text) && /\b(ol[aá]|procuro|quero|obrigado|or[cç]amento)\b/i.test(text)) {
    return 'pt';
  }
  // Французский: уникальные буквы (не голое é; ï часто в NL: geïnteresseerd)
  if (/[œæŒÆ]/.test(text) || /[àâêëôùûÀÂÊËÔÙÛ]/.test(text)) return 'fr';
  if (/[çÇ]/.test(text) && /\b(je|nous|fran[cç]ais|gar[cç]on|ça)\b/i.test(text)) return 'fr';
  if (
    /[îÎ]/.test(text) &&
    /\b(je|nous|vous|bonjour|merci|appartement|na[iï]ve)\b/i.test(text)
  ) {
    return 'fr';
  }
  if (
    /[ïÏ]/.test(text) &&
    /\b(je|nous|vous|bonjour|merci|appartement)\b/i.test(text) &&
    !/\b(ik|wij|bedankt|ge[iï]nteresseerd|zoek|woning)\b/i.test(text)
  ) {
    return 'fr';
  }
  if (
    /[èÈ]/.test(text) &&
    /\b(je|nous|vous|bonjour|merci|appartement|cherche|voudrais|pour|avec|une|des)\b/i.test(text)
  ) {
    return 'fr';
  }
  // Нидерландский (без диакритики)
  if (
    /\b(wij|willen|kopen|wonen|bedankt|ge[iï]nteresseerd|goedemorgen|alsjeblieft)\b/i.test(text) &&
    /\b(ik|een|het|om\s+te|villa|appartement|budget|object|dit)\b/i.test(text)
  ) {
    return 'nl';
  }
  // Итальянский
  if (
    /\b(buongiorno|ciao|cerco|vorrei|appartamento|grazie|per\s+favore|investimento)\b/i.test(text) &&
    /\b(un|una|per|sono|voglio|comprare)\b/i.test(text)
  ) {
    return 'it';
  }
  return null;
}

function scoreStopWords(words) {
  const scores = { ru: 0, en: 0, es: 0, de: 0, fr: 0, pl: 0, nl: 0, uk: 0, pt: 0, it: 0, tr: 0 };
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

/** Топонимы / районы — не сигнал языка (Puerto de la Cruz ≠ español). */
const PLACE_NAME_NEUTRAL_RE =
  /\b(?:puerto\s+de\s+la\s+cruz|costa\s+adeje|los\s+cristianos|las\s+am[eé]ricas|golf\s+del\s+sur|el\s+m[eé]dano|palm[-\s]?mar|los\s+gigantes|santa\s+cruz|la\s+laguna|la\s+orotava|callao\s+salvaje|playa\s+para[ií]so|el\s+duque|puerto\s+ban[uú]s|nueva\s+andaluc[ií]a|sant\s+antoni|santa\s+eulalia|es\s+cubells|dubai\s+marina|palm\s+jumeirah|business\s+bay|tenerife|marbella|barcelona|m[aá]laga|ibiza|dubai|adeje|arona|fanabe|torviscas)\b/gi;

function stripPlaceNames(text) {
  return String(text || '')
    .replace(PLACE_NAME_NEUTRAL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Сообщение почти целиком — название места (с артиклями de/la/el). */
function isMostlyPlaceName(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || trimmed.length > 80) return false;
  PLACE_NAME_NEUTRAL_RE.lastIndex = 0;
  const hasPlace = PLACE_NAME_NEUTRAL_RE.test(trimmed);
  PLACE_NAME_NEUTRAL_RE.lastIndex = 0;
  if (!hasPlace) return false;
  const withoutPlaces = stripPlaceNames(trimmed);
  const restWords = tokenize(withoutPlaces).filter(
    (w) => !/^(de|del|la|las|el|los|the|and|y|in|en|a|al|di)$/i.test(w)
  );
  return restWords.length === 0;
}

function applySpanishMarkers(text, words, scores) {
  const signalText = stripPlaceNames(stripCatalogTitleNoise(text));
  if (!signalText || isMostlyPlaceName(text)) return;
  // Не считаем топонимы (Tenerife/Dubai…) — они есть во всех языках и ломают детекцию EN↔ES
  if (
    /\b(quiero|quieres|busco|buscas|necesito|quisiera|gustaria|gustaría|apartamento|piso|invertir|inversión|inversion|presupuesto|hola|gracias|españa|espana|vivir|trabajar|alquilar|alquilarlo|vender|comprar|bar|parking|propuesta|pas[eé]|habl[eé]|dij[eé]|dijistes|hablastes|estoy|interesado|interesada|buenos|d[ií]as|podemos|hablar|aqu[ií])\b/i.test(
      signalText
    )
  ) {
    scores.es += 3;
  }
  // Артикли el/la/de только вместе с другими ES-сигналами — иначе «Puerto de la Cruz» → es
  if (
    /\b(estoy|estamos|tenemos|tengo|encaja|encajan|quisiera|busco|buscas|quiero|quieres|para\s+vivir|para\s+invertir|para\s+trabajar|te\s+(?:pas[eé]|habl[eé]|dij[eé]))\b/i.test(
      signalText
    ) &&
    /\b(el|la|los|las|un|una|del|al|para|por|con|yo|mi|me|te)\b/i.test(signalText)
  ) {
    scores.es += 1.5;
  }
  if (/\b\w+(ción|cion|sión|sion|mente)\b/i.test(signalText)) {
    scores.es += 2;
  }
  // Прошедшее на -é / -ó типично для ES (pasé, hablé) — не путать с FR
  if (
    /\b\w+[éó]\b/.test(signalText) &&
    /\b(yo|me|te|mi|tu|ya|esto|este|propuesta|parking)\b/i.test(signalText)
  ) {
    scores.es += 2.5;
  }
  if (/[¿¡]/.test(signalText)) scores.es += 3;
}

function applyEnglishMarkers(text, words, scores) {
  const signalText = stripPlaceNames(text);
  if (!signalText || isMostlyPlaceName(text)) return;
  if (/\b(i|i'm|i've|we're|looking|want|need|investment|apartment|property|budget|please|thanks|hello)\b/i.test(signalText)) {
    scores.en += 2;
  }
  if (/\b(the|and|with|for|from|about|help)\b/i.test(signalText)) {
    scores.en += 1;
  }
}

function applyGermanMarkers(text, scores) {
  const signalText = stripPlaceNames(text);
  if (!signalText || isMostlyPlaceName(text)) return;
  if (
    /\b(ich|wir|suche|suchen|möchte|mochte|brauche|kaufen|wohnung|immobilie|bitte|danke|hallo|guten|gerne|eventuell|würden?|wuerde|schöne|schone|grüße|grusse)\b/i.test(
      signalText
    )
  ) {
    scores.de += 3;
  }
  if (/\b(der|die|das|und|mit|für|fur|nach|bei|zum|zur|auch|wenn|oder|nicht)\b/i.test(signalText)) {
    scores.de += 1.5;
  }
  if (/[äöüßÄÖÜ]/.test(signalText)) scores.de += 3;
}

function applyFrenchMarkers(text, scores) {
  const signalText = stripPlaceNames(stripCatalogTitleNoise(text));
  if (!signalText || isMostlyPlaceName(text)) return;
  // Не бустить FR из «à vendre» в названии объекта — вырезается в stripCatalogTitleNoise
  if (
    /\b(je|nous|cherche|cherchons|voudrais|appartement|maison|bonjour|merci|acheter|investir|s'?il\s+vous\s+pla[iî]t|pouvez|suis\s+int[eé]ress[eé]|int[eé]ress[eé])\b/i.test(
      signalText
    )
  ) {
    scores.fr += 3;
  }
  if (/\b(pour|avec|dans|une|des|suis|avons|aimerais|ce\s+bien|appeler)\b/i.test(signalText)) {
    scores.fr += 1.5;
  }
  if (/[çœæ]/i.test(signalText)) scores.fr += 3;
}

function applyRussianMarkers(text, scores) {
  if (/[а-яё]/i.test(text)) scores.ru += 4;
  if (/[іїєґ]/i.test(text)) {
    scores.uk = (scores.uk || 0) + 5;
    scores.ru = Math.max(0, (scores.ru || 0) - 2);
  }
}

function applyPolishMarkers(text, scores) {
  if (/[ąćęłńóśźż]/i.test(text)) scores.pl += 4;
  if (
    /\b(chcę|chce|szukam|szukamy|mieszkanie|apartament|bud[zż]et|inwestycja|nieruchomo[sś][cć]|prosz[eę]|dzi[eę]kuj[eę]|cze[sś][cć]|prosze|dziekuje|czesc|budzet)\b/i.test(
      text
    )
  ) {
    scores.pl += 3;
  }
}

function applyDutchMarkers(text, scores) {
  if (
    /\b(ik|wij|zoek|zoeken|appartement|woning|vastgoed|budget|investering|bedankt|graag|goedemorgen|willen|kopen|wonen|ge[iï]nteresseerd|object)\b/i.test(
      text
    )
  ) {
    scores.nl += 3;
  }
  if (/\b(het|een|van|voor|naar|met|wil|om\s+te|dit)\b/i.test(text)) {
    scores.nl += 1.5;
  }
  // ï в geïnteresseerd — NL, не FR
  if (/ge[iï]nteresseerd/i.test(text) || /\b(bedankt|alsjeblieft|goedemiddag)\b/i.test(text)) {
    scores.nl += 3;
    if (scores.fr) scores.fr = Math.max(0, scores.fr - 2);
  }
}

function applyPortugueseMarkers(text, scores) {
  if (/[ãõÃÕ]/.test(text)) scores.pt = (scores.pt || 0) + 4;
  if (
    /\b(ol[aá]|procuro|quero|comprar|apartamento|or[cç]amento|obrigado|bom\s+dia|para\s+viver|investir)\b/i.test(
      text
    )
  ) {
    scores.pt = (scores.pt || 0) + 3;
  }
}

function applyItalianMarkers(text, scores) {
  if (
    /\b(buongiorno|ciao|cerco|vorrei|appartamento|grazie|investimento|comprare|per\s+viverci)\b/i.test(
      text
    )
  ) {
    scores.it = (scores.it || 0) + 3;
  }
}

function applyTurkishMarkers(text, scores) {
  if (/[ışğüçöİŞĞÜÇÖ]/.test(text)) scores.tr = (scores.tr || 0) + 5;
  if (/\b(merhaba|arıyorum|istiyorum|daire|yatırım|bütçe|için)\b/i.test(text)) {
    scores.tr = (scores.tr || 0) + 3;
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
 * Сумма/бюджет без языкового контекста — «2 million euros», «350k», «800000 €».
 * Не должны переключать sticky-язык EN→ES из‑за слова «euros».
 */
function isBudgetAmountReply(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || trimmed.length > 80) return false;
  const lower = trimmed.toLowerCase().replace(/\s+/g, ' ');

  // Явно испанская/французская/немецкая фраза про бюджет — язык есть, не neutral
  if (
    /\b(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|millones?\s+de|presupuesto|hasta|aproximadamente|ser[ií]a)\b/i.test(
      lower
    )
  ) {
    return false;
  }
  if (/\b(je|cherche|voudrais|millions?\s+d['e])\b/i.test(lower)) return false;
  if (/\b(ich|suche|möchte|mochte|millionen)\b/i.test(lower)) return false;

  const hasDigit = /\d/.test(lower);
  const hasEnBudgetWord =
    /\b(million|millions|thousand|thousands|budget|approx|around|up\s*to|max|k|mln|mio)\b/i.test(
      lower
    );
  const hasCurrency = /\b(euros?|eur|€|\$|usd|gbp)\b/i.test(lower) || /€/.test(trimmed);

  if (hasDigit && (hasCurrency || hasEnBudgetWord)) return true;
  if (hasEnBudgetWord && hasCurrency) return true;

  // «two million euros» без цифр
  if (
    /^(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:million|millions|thousand|k)\s*(?:euros?|eur|€)?$/i.test(
      lower
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Короткие реплики вроде ok / yes / да — слишком слабый сигнал, чтобы менять язык диалога.
 */
function isAmbiguousShortReply(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return true;
  if (isUrlOnlyMessage(trimmed)) return true;
  if (isMostlyPlaceName(trimmed)) return true;
  if (isBudgetAmountReply(trimmed)) return true;
  const words = tokenize(stripUrls(trimmed));
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
  if (isMostlyPlaceName(trimmed)) return false;
  if (isBudgetAmountReply(trimmed)) return false;

  const body = prepareDetectBody(trimmed) || trimmed;
  // После вырезания «à vendre» почти ничего не осталось — не переключаем sticky
  if (tokenize(body).length < 2 && /à\s+vendre|en\s+venta|housetenerife/i.test(trimmed)) {
    return false;
  }

  const scriptLang = detectByScript(body);
  if (scriptLang && scriptLang === detectedLang) return true;
  if (/[а-яёіїєґ]/i.test(body) && (detectedLang === 'ru' || detectedLang === 'uk')) {
    return true;
  }
  if (/[ąćęłńóśźż]/i.test(body) && detectedLang === 'pl') {
    return true;
  }
  if (/[äöüß]/i.test(body) && detectedLang === 'de') return true;
  // FR: не голое é/ï (ES pasé, NL geïnteresseerd)
  if (/[çœæàâêëôùû]/i.test(body) && detectedLang === 'fr') return true;
  if (
    detectedLang === 'fr' &&
    /\b(je|nous|bonjour|merci|appartement|cherche|suis)\b/i.test(body) &&
    !/\b(yo|me\s+pas[eé]|habl[eé]|propuesta|estoy|interesado)\b/i.test(body)
  ) {
    return true;
  }
  // Длинное сообщение без маркеров detectedLang — не strong для «чужого» языка
  if (detectedLang === 'fr') {
    const looksEs =
      /\b(yo|me|te|mi|propuesta|pas[eé]|habl[eé]|estoy|interesado|alquilar)\b/i.test(body) ||
      (/\b\w+[éó]\b/.test(body) && /\b(yo|ya|te|me)\b/i.test(body));
    const looksFr = /\b(je|nous|bonjour|merci|appartement|cherche|suis)\b/i.test(body);
    if (looksEs && !looksFr) return false;
  }
  if (
    detectedLang === 'es' &&
    (/\b(yo|me|te|pas[eé]|habl[eé]|propuesta|estoy|interesado)\b/i.test(body) ||
      /[ñ¿¡áíú]/i.test(body) ||
      (/\b\w+[éó]\b/.test(body) && /\b(yo|ya|te|me|esto)\b/i.test(body)))
  ) {
    return true;
  }

  const words = tokenize(stripPlaceNames(body));
  if (words.length >= 4 && stripPlaceNames(body).length >= 16) return true;
  if (words.length >= 3 && stripPlaceNames(body).length >= 12) return true;
  return false;
}

function detectLanguageFromText(text) {
  if (!text || typeof text !== 'string') {
    return 'ru';
  }

  const trimmed = text.trim();
  if (!trimmed) return 'ru';

  // Ссылки на объекты не задают язык (path /es/… ≠ клиент пишет по-испански)
  if (isUrlOnlyMessage(trimmed)) {
    return 'en';
  }

  const detectBody = prepareDetectBody(trimmed) || trimmed;
  const words = tokenize(detectBody);

  if (words.length === 1) {
    const short = SHORT_REPLY[words[0]] || SHORT_REPLY[detectBody.toLowerCase()];
    if (short) return short;
  }

  const scriptLang = detectByScript(detectBody);
  // detectByScript уже фильтрует ложные срабатывания (é ES vs FR, ï NL vs FR…)
  if (scriptLang) {
    return scriptLang;
  }

  // Топонимы / суммы бюджета — не голосуют стоп-словами
  if (isMostlyPlaceName(detectBody) || isBudgetAmountReply(detectBody)) {
    return 'en';
  }

  const signalText = stripPlaceNames(detectBody) || detectBody;
  const signalWords = tokenize(signalText);
  const scores = scoreStopWords(signalWords.length ? signalWords : words);
  // Обнуляем вклад сверхчастых артиклей без глаголов — иначе ES побеждает на топонимах
  if (signalWords.length <= 4) {
    const onlyArticles = signalWords.every((w) =>
      /^(de|del|la|las|el|los|un|una|the|a|an|and|y|in|en|of)$/i.test(w)
    );
    if (onlyArticles) {
      scores.es = 0;
      scores.en = 0;
    }
  }
  applySpanishMarkers(detectBody, signalWords, scores);
  applyEnglishMarkers(detectBody, signalWords, scores);
  applyGermanMarkers(detectBody, scores);
  applyFrenchMarkers(detectBody, scores);
  applyRussianMarkers(detectBody, scores);
  applyPolishMarkers(detectBody, scores);
  applyDutchMarkers(detectBody, scores);
  applyPortugueseMarkers(detectBody, scores);
  applyItalianMarkers(detectBody, scores);
  applyTurkishMarkers(detectBody, scores);

  // Если после вырезания каталога остался явный ES — не даём FR победить из slug
  if ((scores.es || 0) >= 3 && (scores.fr || 0) > 0 && (scores.es || 0) >= (scores.fr || 0)) {
    scores.fr = Math.min(scores.fr, scores.es - 1);
  }
  // NL vs FR: geïnteresseerd
  if ((scores.nl || 0) >= 3 && (scores.fr || 0) > 0) {
    scores.fr = Math.min(scores.fr, Math.max(0, scores.nl - 1));
  }
  // FR vs ES: je/merci
  if ((scores.fr || 0) >= 3 && (scores.es || 0) > 0 && /\b(je|nous|merci|bonjour|suis)\b/i.test(detectBody)) {
    scores.es = Math.min(scores.es, Math.max(0, scores.fr - 1));
  }

  const heuristicLang = pickTopScore(scores);
  const francLang = signalText.length >= 8 ? detectByFranc(signalText) : null;

  if (heuristicLang && francLang) {
    if (heuristicLang === francLang) return heuristicLang;
    const topHeuristicScore = scores[heuristicLang] || 0;
    // Heuristic надёжнее franc на коротких Romance/Slavic текстах (ES↔PL/FR путаница)
    if (topHeuristicScore >= 3) return heuristicLang;
    if ((scores[francLang] || 0) >= 2) return francLang;
    return heuristicLang;
  }

  if (heuristicLang) return heuristicLang;
  if (francLang && (scores[francLang] || 0) >= 1) return francLang;
  if (francLang && signalText.length >= 40) return francLang;
  if (scriptLang) return scriptLang;

  if (words.length && /^[a-z0-9\s.,!?€$%+\-/]+$/i.test(stripAccents(detectBody))) {
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
  isMostlyPlaceName,
  isBudgetAmountReply,
  isUrlOnlyMessage,
  stripUrls,
  stripCatalogTitleNoise,
  prepareDetectBody,
  SUPPORTED_DETECT,
};
