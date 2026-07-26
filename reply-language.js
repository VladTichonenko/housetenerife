'use strict';

/**
 * Постобработка языка ответа: анти-транслит EN→кириллица, эвристика «ответ не на том языке»,
 * канонические названия районов/городов (модели часто искажают написание).
 */

const { normalizeSalesLang } = require('./sales-localization');
const { detectLanguageFromText } = require('./language-detector');

/** Границы слова с учётом кириллицы (JS \\b на кириллице не работает). */
const WB = '(?<![\\p{L}\\p{N}])';
const WE = '(?![\\p{L}\\p{N}])';

/**
 * Искажённое написание → канон из каталога (латиница, как в microAreaLabel).
 * Длинные фразы первыми. Работает для RU/EN/ES ответов.
 */
const PLACE_NAME_FIXES = [
  // Tenerife
  ['коста адеже', 'Costa Adeje'],
  ['коста адэхе', 'Costa Adeje'],
  ['коста адехе', 'Costa Adeje'],
  ['коста-адехе', 'Costa Adeje'],
  ['коста адедж', 'Costa Adeje'],
  ['costa adeije', 'Costa Adeje'],
  ['costa adejeh', 'Costa Adeje'],
  ['эль дуке', 'El Duque'],
  ['el duqe', 'El Duque'],
  ['лос кристианос', 'Los Cristianos'],
  ['лос кристьянос', 'Los Cristianos'],
  ['лос кристианес', 'Los Cristianos'],
  ['лос-кристианос', 'Los Cristianos'],
  ['los christianos', 'Los Cristianos'],
  ['los cristianós', 'Los Cristianos'],
  ['лас америкас', 'Las Américas'],
  ['лас-америкас', 'Las Américas'],
  ['плайя де лас америкас', 'Playa de las Américas'],
  ['playa de las americas', 'Playa de las Américas'],
  ['las americas', 'Las Américas'],
  ['гольф дель сур', 'Golf del Sur'],
  ['гольф-дель-сур', 'Golf del Sur'],
  ['гольфред[аыу]?', 'Golf del Sur'],
  ['golfreda', 'Golf del Sur'],
  ['golf reda', 'Golf del Sur'],
  ['амарилья гольф', 'Amarilla Golf'],
  ['амарилла гольф', 'Amarilla Golf'],
  ['эль медано', 'El Médano'],
  ['эль-медано', 'El Médano'],
  ['el medano', 'El Médano'],
  ['пуэрто де ла крус', 'Puerto de la Cruz'],
  ['пуэрто де ла круз', 'Puerto de la Cruz'],
  ['пуэрто-де-ла-крус', 'Puerto de la Cruz'],
  ['puerto de la crus', 'Puerto de la Cruz'],
  ['пальм[- ]?мар', 'Palm-Mar'],
  ['palm mar', 'Palm-Mar'],
  ['лос гигантес', 'Los Gigantes'],
  ['плайя де ла арена', 'Playa de la Arena'],
  ['лас гальетас', 'Las Galletas'],
  ['санта крус', 'Santa Cruz'],
  ['ла лагуна', 'La Laguna'],
  // Ibiza / Marbella / etc.
  ['сант антони', 'Sant Antoni'],
  ['сан[- ]?антонио', 'San Antonio'],
  ['sant antonio', 'Sant Antoni'],
  ['санта еулалия', 'Santa Eulalia'],
  ['санта эулалия', 'Santa Eulalia'],
  ['santa eularia', 'Santa Eulalia'],
  ['эс кубельс', 'Es Cubells'],
  ['пуэрто банус', 'Puerto Banús'],
  ['пуэрто-банус', 'Puerto Banús'],
  ['puerto banus', 'Puerto Banús'],
  ['новая андалусия', 'Nueva Andalucía'],
  ['nueva andalucia', 'Nueva Andalucía'],
  ['эстепона', 'Estepona'],
  ['марбелла', 'Марбелья'],
  ['ибиза', 'Ибица'],
  ['eivissa', 'Ibiza'],
  ['дубаи', 'Дубай'],
  ['dubaii', 'Dubai'],
  ['тенерифф?е', 'Тенерифе'],
  ['teneriffa', 'Tenerife'],
];

/** Типичный мусор слабых моделей: Error→Арор, Budget→Баджет и т.п. */
const RU_PHONETIC_FIXES = [
  [new RegExp(`${WB}Арор${WE}`, 'gu'), 'Ошибка'],
  [new RegExp(`${WB}арор${WE}`, 'gu'), 'ошибка'],
  [new RegExp(`${WB}Эрор${WE}`, 'gu'), 'Ошибка'],
  [new RegExp(`${WB}эрор${WE}`, 'gu'), 'ошибка'],
  [new RegExp(`${WB}[Ээ]ррор${WE}`, 'giu'), 'ошибка'],
  [new RegExp(`${WB}[Ее]рор${WE}`, 'giu'), 'ошибка'],
  [new RegExp(`${WB}Баджет([ауеом]?)${WE}`, 'gu'), 'Бюджет$1'],
  [new RegExp(`${WB}баджет([ауеом]?)${WE}`, 'gu'), 'бюджет$1'],
  [new RegExp(`${WB}[Пп]ропертиз?${WE}`, 'giu'), 'объект'],
  [new RegExp(`${WB}[Лл]истинг(и|ов|а|е)?${WE}`, 'giu'), 'объявление'],
  [new RegExp(`${WB}[Ии]нвестмент(ы|ов|а|у|ом|е)?${WE}`, 'giu'), 'инвестиция'],
  [new RegExp(`${WB}[Хх]еллоу${WE}`, 'giu'), 'Привет'],
  [new RegExp(`${WB}[Хх]ай${WE}`, 'gu'), 'Привет'],
  [new RegExp(`${WB}[Сс]орри${WE}`, 'giu'), 'извините'],
  [new RegExp(`${WB}[Пп]лиз[аa]?${WE}`, 'giu'), 'пожалуйста'],
  [new RegExp(`${WB}[Лл]укинг${WE}`, 'giu'), 'ищу'],
  [new RegExp(`${WB}[Аа]партмент(ы|ов|а|е)?${WE}`, 'giu'), 'апартаменты'],
  [new RegExp(`${WB}[Мм]иттинг(а|у|е|ом)?${WE}`, 'giu'), 'встреча'],
  [new RegExp(`${WB}[Кк]олл${WE}`, 'gu'), 'звонок'],
];

const PHONETIC_GARBAGE_RE = new RegExp(
  `${WB}(арор|эрор|еррор|баджет|проперти|листинг|инвестмент|хеллоу|хай|сорри|плиз|лукинг|апартмент|митинг)${WE}`,
  'iu'
);

function stripUrlsAndBrands(text) {
  return String(text || '')
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/housetenerife\.eu[^\s]*/gi, ' ')
    .replace(/\bHZ\d+\b/gi, ' ')
    .replace(/€[\d\s.,]+/g, ' ')
    .replace(/\b(?:WhatsApp|House Tenerife|Maxim|Maksim|NIE|LTV|EUR|USD)\b/gi, ' ');
}

/**
 * Чинит искажённые названия районов/городов в ответе бота.
 * (Модель часто «считает» район верно, но пишет с орфографией от себя.)
 */
function fixPlaceNameSpellings(text) {
  if (!text) return text;
  let s = String(text);
  for (const [from, to] of PLACE_NAME_FIXES) {
    const re = new RegExp(`${WB}${from}${WE}`, 'giu');
    s = s.replace(re, (match) => {
      // Сохраняем регистр первой буквы, если оригинал с заглавной
      if (/^\p{Lu}/u.test(match) && to.length) {
        return to.charAt(0).toUpperCase() + to.slice(1);
      }
      return to;
    });
  }
  return s;
}

function fixPhoneticTransliterations(text, lang) {
  let s = fixPlaceNameSpellings(text);
  if (!s || normalizeSalesLang(lang) !== 'ru') return s;
  for (const [re, repl] of RU_PHONETIC_FIXES) {
    s = s.replace(re, repl);
  }
  return s;
}

function hasPhoneticGarbage(text) {
  return PHONETIC_GARBAGE_RE.test(stripUrlsAndBrands(text));
}

/**
 * Ответ явно не на языке диалога (кириллица vs латиница) или с фонетическим мусором.
 */
function replyMismatchesLanguage(text, lang) {
  const salesLang = normalizeSalesLang(lang);
  const body = stripUrlsAndBrands(text);
  if (!body.trim()) return false;

  const cyr = (body.match(/[а-яё]/gi) || []).length;
  const lat = (body.match(/[a-z]/gi) || []).length;
  const letters = cyr + lat;
  if (letters < 12) return false;

  if (salesLang === 'ru') {
    if (hasPhoneticGarbage(body)) return true;
    // Ответ почти целиком на латинице при русском диалоге
    if (lat > 40 && cyr / Math.max(letters, 1) < 0.25) return true;
    return false;
  }

  if (salesLang === 'en') {
    if (cyr > 25 && lat / Math.max(letters, 1) < 0.35) return true;
    // Испанский в английском диалоге (Ya sé, presupuesto, hipoteca, ¿…)
    if (
      /\b(ya\s+s[eé]|buscas|presupuesto|cu[aá]nto|efectivo|hipoteca|contado|encaja|villas?\s+en)\b/i.test(
        body
      ) ||
      /¿/.test(body)
    ) {
      return true;
    }
    return false;
  }

  if (salesLang === 'es') {
    if (cyr > 20) return true;
    // Английский в испанском диалоге
    if (
      /\b(got it|looking for|what budget|cash available|mortgage|shortlist|which option)\b/i.test(
        body
      )
    ) {
      return true;
    }
    return false;
  }

  if (salesLang === 'de' || salesLang === 'fr' || salesLang === 'pl' || salesLang === 'nl') {
    if (cyr > 20) return true;
    return false;
  }

  return false;
}

function languageRewriteInstruction(lang) {
  const code = normalizeSalesLang(lang);
  if (code === 'ru') {
    return (
      'Перепиши последний ответ СТРОГО на нормальном русском языке. ' +
      'Запрещена транслитерация английских слов кириллицей (не «Арор», а «Ошибка»; не «баджет», а «бюджет»; не «проперти», а «объект»). ' +
      'Названия районов и городов пиши латиницей ТОЧНО как в каталоге: Los Cristianos, Costa Adeje, Las Américas, Golf del Sur, Sant Antoni — без «Лос Кристианос», «Коста Адеже» и т.п. ' +
      'Без смеси языков. Кратко, WhatsApp-стиль, как живой риелтор.'
    );
  }
  if (code === 'es') {
    return (
      'Reescribe la última respuesta ESTRICTAMENTE en español natural. ' +
      'Sin mezclar ruso ni inglés, sin transliteraciones. Estilo WhatsApp, tono humano.'
    );
  }
  if (code === 'de') {
    return (
      'Schreibe die letzte Antwort STRENG auf natürlichem Deutsch um. ' +
      'Kein Russisch oder Englisch mischen. Ortsnamen lateinisch genau wie im Katalog ' +
      '(Los Cristianos, Costa Adeje, Sant Antoni). WhatsApp-Stil, menschlicher Ton.'
    );
  }
  if (code === 'fr') {
    return (
      'Réécris la dernière réponse STRICTEMENT en français naturel. ' +
      'Sans mélanger russe ou anglais. Toponymes en latin exacts comme au catalogue ' +
      '(Los Cristianos, Costa Adeje, Sant Antoni). Style WhatsApp, ton humain.'
    );
  }
  if (code === 'pl') {
    return (
      'Przepisz ostatnią odpowiedź ŚCIŚLE na naturalny polski. ' +
      'Bez mieszania rosyjskiego ani angielskiego. Toponimy łacińsko dokładnie jak w katalogu ' +
      '(Los Cristianos, Costa Adeje, Sant Antoni). Styl WhatsApp, ludzki ton.'
    );
  }
  if (code === 'nl') {
    return (
      'Herschrijf het laatste antwoord STRENG in natuurlijk Nederlands. ' +
      'Geen Russisch of Engels erdoorheen. Plaatsnamen Latijns precies zoals in de catalogus ' +
      '(Los Cristianos, Costa Adeje, Sant Antoni). WhatsApp-stijl, menselijke toon.'
    );
  }
  return (
    'Rewrite the last reply STRICTLY in natural English. ' +
    'No Russian/Spanish mixed in, no awkward machine translation. WhatsApp style, human tone.'
  );
}

/**
 * Быстрая проверка: похоже ли сообщение пользователя на смену языка.
 * (обёртка для тестов / отладки)
 */
function detectUserMessageLang(text) {
  return detectLanguageFromText(text);
}

module.exports = {
  fixPhoneticTransliterations,
  fixPlaceNameSpellings,
  hasPhoneticGarbage,
  replyMismatchesLanguage,
  languageRewriteInstruction,
  detectUserMessageLang,
  stripUrlsAndBrands,
};
