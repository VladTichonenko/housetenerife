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

/** Кириллические каноны → латиница для не-русских диалогов */
const CYR_PLACE_TO_LATIN = {
  Марбелья: 'Marbella',
  Ибица: 'Ibiza',
  Дубай: 'Dubai',
  Тенерифе: 'Tenerife',
};

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

/** CJK / хангыль — слабые модели иногда вставляют иероглифы в RU/EN/ES ответ. */
const UNEXPECTED_SCRIPT_RE =
  /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af\u0600-\u06ff]/gu;

function hasUnexpectedScripts(text) {
  return UNEXPECTED_SCRIPT_RE.test(String(text || ''));
}

/**
 * Убирает иероглифы/хангыль/арабицу из ответа европейского диалога.
 * «которые明显 не подходят» → «которые не подходят».
 */
function stripUnexpectedScripts(text) {
  if (!text || !hasUnexpectedScripts(text)) return text;
  return String(text)
    .replace(UNEXPECTED_SCRIPT_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\./g, '.')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
function fixPlaceNameSpellings(text, lang = 'ru') {
  if (!text) return text;
  let s = String(text);
  const code = normalizeSalesLang(lang);
  for (const [from, to] of PLACE_NAME_FIXES) {
    let repl = to;
    if (code !== 'ru' && CYR_PLACE_TO_LATIN[to]) {
      repl = CYR_PLACE_TO_LATIN[to];
    } else if (code !== 'ru' && /[а-яё]/i.test(to)) {
      continue;
    }
    const re = new RegExp(`${WB}${from}${WE}`, 'giu');
    s = s.replace(re, (match) => {
      if (/^\p{Lu}/u.test(match) && repl.length) {
        return repl.charAt(0).toUpperCase() + repl.slice(1);
      }
      return repl;
    });
  }
  return s;
}

function fixPhoneticTransliterations(text, lang) {
  let s = fixPlaceNameSpellings(text, lang);
  if (!s || normalizeSalesLang(lang) !== 'ru') return s;
  for (const [re, repl] of RU_PHONETIC_FIXES) {
    s = s.replace(re, repl);
  }
  return s;
}

function hasPhoneticGarbage(text) {
  return PHONETIC_GARBAGE_RE.test(stripUrlsAndBrands(text));
}

const EN_MARKER_RE =
  /\b(hi!?|hello|hey|i'?m\b|i am\b|got it|looking for|what budget|cash available|mortgage|shortlist|which option|great!|here are|investment size|for you to live|are you looking)\b/i;
const ES_MARKER_RE =
  /\b(ya\s+s[eé]|buscas|presupuesto|cu[aá]nto|efectivo|hipoteca|contado|encaja|villas?\s+en|perfecto)\b/i;
const RU_MARKER_RE =
  /отлично|понял|бюджет|ипотек|апартамент|вилл|подборк|здравствуйте|размер инвестиций/i;
const NL_MARKER_RE =
  /\b(ik|je|u|wij|een|het|van|voor|naar|appartement|woning|vastgoed|investering|goedemorgen|hallo|budget|zoek|zoeken|wonen)\b/i;
const DE_MARKER_RE =
  /\b(ich|wir|sie|und|für|fur|bitte|danke|wohnung|immobilie|suche|budget|hallo)\b/i;
const FR_MARKER_RE =
  /\b(je|nous|vous|bonjour|merci|appartement|budget|chercher|investir|habiter)\b/i;
const PL_MARKER_RE =
  /\b(szukam|mieszkanie|bud[zż]et|inwestycja|cze[sś][cć]|prosz[eę]|apartament|nieruchomo)\b/i;

/**
 * Ответ явно не на языке диалога (кириллица vs латиница), с иероглифами или фонетическим мусором.
 */
function replyMismatchesLanguage(text, lang) {
  const raw = String(lang || '').toLowerCase().slice(0, 2);
  const salesLang = raw === 'uk' ? 'uk' : raw === 'it' || raw === 'pt' || raw === 'tr' ? raw : normalizeSalesLang(lang);
  const body = stripUrlsAndBrands(text);
  if (!body.trim()) return false;

  // Китайские/японские/корейские символы в европейском диалоге — всегда ошибка модели
  if (hasUnexpectedScripts(body)) return true;

  const cyr = (body.match(/[а-яё]/gi) || []).length;
  const lat = (body.match(/[a-zàáâãäåæçèéêëìíîïñòóôõöùúûüýÿœßąćęłńóśźż]/gi) || []).length;
  const letters = cyr + lat;
  if (letters < 12) return false;

  if (salesLang === 'uk') {
    if (lat > 40 && cyr / Math.max(letters, 1) < 0.25) return true;
    if (EN_MARKER_RE.test(body) && cyr < 20) return true;
    return false;
  }

  if (salesLang === 'it' || salesLang === 'pt' || salesLang === 'tr') {
    if (cyr >= 8 && cyr / Math.max(letters, 1) >= 0.12) return true;
    if (RU_MARKER_RE.test(body)) return true;
    const native =
      salesLang === 'it'
        ? /\b(ciao|buongiorno|cerco|appartamento|investire|vivere|grazie)\b/i
        : salesLang === 'pt'
          ? /\b(ol[aá]|procuro|apartamento|investir|viver|obrigado)\b/i
          : /\b(merhaba|arıyorum|daire|yatırım|teşekkür)\b/i;
    if (EN_MARKER_RE.test(body) && !native.test(body)) return true;
    return false;
  }

  if (salesLang === 'ru') {
    if (hasPhoneticGarbage(body)) return true;
    // Ответ почти целиком на латинице при русском диалоге
    if (lat > 40 && cyr / Math.max(letters, 1) < 0.25) return true;
    // Заметная смесь: много латиницы рядом с кириллицей + английские маркеры
    if (cyr >= 20 && lat >= 35 && EN_MARKER_RE.test(body)) return true;
    return false;
  }

  // Любой не-русский диалог: кириллица в ответе = смесь / неверный язык
  if (cyr >= 8 && cyr / Math.max(letters, 1) >= 0.12) return true;
  if (cyr >= 15) return true;
  if (RU_MARKER_RE.test(body)) return true;

  if (salesLang === 'en') {
    if (ES_MARKER_RE.test(body) || /¿/.test(body)) return true;
    return false;
  }

  if (salesLang === 'es') {
    if (EN_MARKER_RE.test(body)) return true;
    return false;
  }

  if (salesLang === 'nl') {
    if (EN_MARKER_RE.test(body) || ES_MARKER_RE.test(body) || /¿/.test(body)) return true;
    // Чистый английский без нидерландских маркеров
    if (
      !NL_MARKER_RE.test(body) &&
      /\b(the|you|your|looking|investment|apartment|budget|live in|or are)\b/i.test(body)
    ) {
      return true;
    }
    return false;
  }

  if (salesLang === 'de') {
    if (EN_MARKER_RE.test(body) || ES_MARKER_RE.test(body) || /¿/.test(body)) return true;
    if (
      !DE_MARKER_RE.test(body) &&
      !/[äöüß]/i.test(body) &&
      /\b(the|you|your|looking|investment|apartment|budget)\b/i.test(body)
    ) {
      return true;
    }
    return false;
  }

  if (salesLang === 'fr') {
    if (EN_MARKER_RE.test(body) || ES_MARKER_RE.test(body) || /¿/.test(body)) return true;
    if (
      !FR_MARKER_RE.test(body) &&
      /\b(the|you|your|looking|investment|apartment|budget)\b/i.test(body)
    ) {
      return true;
    }
    return false;
  }

  if (salesLang === 'pl') {
    if (EN_MARKER_RE.test(body) || ES_MARKER_RE.test(body) || /¿/.test(body)) return true;
    if (
      !PL_MARKER_RE.test(body) &&
      !/[ąćęłńśźż]/i.test(body) &&
      /\b(the|you|your|looking|investment|apartment|budget)\b/i.test(body)
    ) {
      return true;
    }
    return false;
  }

  return false;
}

function languageRewriteInstruction(lang) {
  const raw = String(lang || '').toLowerCase().slice(0, 2);
  if (raw === 'uk') {
    return (
      'Перепиши останню відповідь СТРОГО українською. ' +
      'Без російської канцелярії, без англійських фраз і без китайських/японських ієрогліфів. ' +
      'Назви районів латиницею точно як у каталозі: Los Cristianos, Costa Adeje, Sant Antoni. Стиль WhatsApp.'
    );
  }
  if (raw === 'it') {
    return (
      'Riscrivi l’ultima risposta STRETTAMENTE in italiano naturale. ' +
      'Niente russo, inglese o caratteri cinesi/giapponesi. Toponimi in latino come in catalogo ' +
      '(Los Cristianos, Costa Adeje, Sant Antoni). Stile WhatsApp, tono umano.'
    );
  }
  if (raw === 'pt') {
    return (
      'Reescreve a última resposta ESTRITAMENTE em português natural. ' +
      'Sem russo, inglês nem caracteres chineses/japoneses. Topónimos em latim como no catálogo ' +
      '(Los Cristianos, Costa Adeje, Sant Antoni). Estilo WhatsApp, tom humano.'
    );
  }
  if (raw === 'tr') {
    return (
      'Son yanıtı YALNIZCA doğal Türkçe yeniden yaz. ' +
      'Rusça, İngilizce veya Çin/Japon karakterleri karıştırma. Yer adları katalogdaki gibi Latin harfleriyle ' +
      '(Los Cristianos, Costa Adeje, Sant Antoni). WhatsApp stili, insani ton.'
    );
  }
  const code = normalizeSalesLang(lang);
  if (code === 'ru') {
    return (
      'Перепиши последний ответ СТРОГО на нормальном русском языке. ' +
      'Запрещена транслитерация английских слов кириллицей (не «Арор», а «Ошибка»; не «баджет», а «бюджет»; не «проперти», а «объект»). ' +
      'Запрещены китайские, японские и корейские иероглифы и любые другие алфавиты — только русский + латиница в названиях районов/URL. ' +
      'Названия районов и городов пиши латиницей ТОЧНО как в каталоге: Los Cristianos, Costa Adeje, Las Américas, Golf del Sur, Sant Antoni — без «Лос Кристианос», «Коста Адеже» и т.п. ' +
      'Без смеси языков. Кратко, WhatsApp-стиль, как живой риелтор.'
    );
  }
  if (code === 'es') {
    return (
      'Reescribe la última respuesta ESTRICTAMENTE en español natural. ' +
      'Sin mezclar ruso, inglés ni caracteres chinos/japoneses/coreanos. Estilo WhatsApp, tono humano.'
    );
  }
  if (code === 'de') {
    return (
      'Schreibe die letzte Antwort STRENG auf natürlichem Deutsch um. ' +
      'Kein Russisch, Englisch oder chinesische/japanische Schriftzeichen. Ortsnamen lateinisch genau wie im Katalog ' +
      '(Los Cristianos, Costa Adeje, Sant Antoni). WhatsApp-Stil, menschlicher Ton.'
    );
  }
  if (code === 'fr') {
    return (
      'Réécris la dernière réponse STRICTEMENT en français naturel. ' +
      'Sans mélanger russe, anglais ni caractères chinois/japonais. Toponymes en latin exacts comme au catalogue ' +
      '(Los Cristianos, Costa Adeje, Sant Antoni). Style WhatsApp, ton humain.'
    );
  }
  if (code === 'pl') {
    return (
      'Przepisz ostatnią odpowiedź ŚCIŚLE na naturalny polski. ' +
      'Bez mieszania rosyjskiego, angielskiego ani znaków chińskich/japońskich. Toponimy łacińsko dokładnie jak w katalogu ' +
      '(Los Cristianos, Costa Adeje, Sant Antoni). Styl WhatsApp, ludzki ton.'
    );
  }
  if (code === 'nl') {
    return (
      'Herschrijf het laatste antwoord STRENG in natuurlijk Nederlands. ' +
      'Begin met iets als «Hallo!» / «Goedemorgen!» — NOOIT «Hi!» of «Hello!» of Engelse zinnen. ' +
      'Geen Russisch, Engels of Chinese/Japanse tekens. Plaatsnamen Latijns precies zoals in de catalogus ' +
      '(Los Cristianos, Costa Adeje, Sant Antoni). WhatsApp-stijl, menselijke toon. ' +
      'Voorbeeldtoon: «Hallo! Ik ben Maxim van House Tenerife. Zoeken jullie om te wonen of om te investeren?»'
    );
  }
  return (
    'Rewrite the last reply STRICTLY in natural English. ' +
    'No Russian/Spanish mixed in, no Chinese/Japanese/Korean characters, no awkward machine translation. WhatsApp style, human tone.'
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
  hasUnexpectedScripts,
  stripUnexpectedScripts,
  replyMismatchesLanguage,
  languageRewriteInstruction,
  detectUserMessageLang,
  stripUrlsAndBrands,
};
