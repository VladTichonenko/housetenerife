'use strict';

/**
 * Группы районов: синонимы в переписке и в текстах объявлений.
 * Узкие группы — жёсткий фильтр подборки; широкие (south/north) — только усиление score.
 */
/** Регионы, где подборка без конкретной зоны/района даёт плохие результаты */
const REGIONS_REQUIRING_MICRO = ['tenerife', 'dubai', 'marbella', 'ibiza', 'malaga', 'barcelona'];

const AREA_OPTIONS_BY_MACRO = {
  tenerife: {
    ru: 'Costa Adeje / El Duque, Los Cristianos, Las Américas, Golf del Sur, El Médano, Puerto de la Cruz, Palm-Mar, Las Galletas, юг/север/запад',
    en: 'Costa Adeje / El Duque, Los Cristianos, Las Américas, Golf del Sur, El Médano, Puerto de la Cruz, Palm-Mar, Las Galletas, south/north/west',
    es: 'Costa Adeje / El Duque, Los Cristianos, Las Américas, Golf del Sur, El Médano, Puerto de la Cruz, Palm-Mar, Las Galletas, sur/norte/oeste',
    de: 'Costa Adeje / El Duque, Los Cristianos, Las Américas, Golf del Sur, El Médano, Puerto de la Cruz, Palm-Mar, Las Galletas, Süden/Norden/Westen',
    fr: 'Costa Adeje / El Duque, Los Cristianos, Las Américas, Golf del Sur, El Médano, Puerto de la Cruz, Palm-Mar, Las Galletas, sud/nord/ouest',
  },
  dubai: {
    ru: 'Dubai Marina, Palm Jumeirah, Business Bay, Dubai Hills, JLT, Downtown',
    en: 'Dubai Marina, Palm Jumeirah, Business Bay, Dubai Hills, JLT, Downtown',
    es: 'Dubai Marina, Palm Jumeirah, Business Bay, Dubai Hills, JLT, Downtown',
    de: 'Dubai Marina, Palm Jumeirah, Business Bay, Dubai Hills, JLT, Downtown',
    fr: 'Dubai Marina, Palm Jumeirah, Business Bay, Dubai Hills, JLT, Downtown',
  },
  marbella: {
    ru: 'Puerto Banús, Golden Mile, Nueva Andalucía, Estepona, Benahavís',
    en: 'Puerto Banús, Golden Mile, Nueva Andalucía, Estepona, Benahavís',
    es: 'Puerto Banús, Golden Mile, Nueva Andalucía, Estepona, Benahavís',
    de: 'Puerto Banús, Golden Mile, Nueva Andalucía, Estepona, Benahavís',
    fr: 'Puerto Banús, Golden Mile, Nueva Andalucía, Estepona, Benahavís',
  },
  ibiza: {
    ru: 'Sant Antoni (San Antonio), Santa Eulalia, Es Cubells, Cala Jondal, Ibiza Town / Jesús',
    en: 'Sant Antoni (San Antonio), Santa Eulalia, Es Cubells, Cala Jondal, Ibiza Town / Jesús',
    es: 'Sant Antoni (San Antonio), Santa Eulalia, Es Cubells, Cala Jondal, Ibiza ciudad / Jesús',
    de: 'Sant Antoni (San Antonio), Santa Eulalia, Es Cubells, Cala Jondal, Ibiza Town / Jesús',
    fr: 'Sant Antoni (San Antonio), Santa Eulalia, Es Cubells, Cala Jondal, Ibiza Town / Jesús',
  },
  malaga: {
    ru: 'Малага центр, Torremolinos, Fuengirola, Axarquía',
    en: 'Málaga city, Torremolinos, Fuengirola, Axarquía',
    es: 'Málaga ciudad, Torremolinos, Fuengirola, Axarquía',
    de: 'Málaga city, Torremolinos, Fuengirola, Axarquía',
    fr: 'Málaga city, Torremolinos, Fuengirola, Axarquía',
  },
  barcelona: {
    ru: 'Барселона центр / Eixample, Sitges, Maresme',
    en: 'Barcelona / Eixample, Sitges, Maresme coast',
    es: 'Barcelona / Eixample, Sitges, Maresme',
    de: 'Barcelona / Eixample, Sitges, Maresme coast',
    fr: 'Barcelona / Eixample, Sitges, Maresme coast',
  },
};

const SPECIFIC_AREA_GROUPS = [
  {
    id: 'costa_adeje',
    macro: 'tenerife',
    keywords: [
      'costa adeje',
      'adeje',
      'fanabe',
      'fánabe',
      'torviscas',
      'callao salvaje',
      'playa paraiso',
      'playa paraíso',
      'caldera del rey',
      'roque del conde',
      'abama',
      'абона',
      'адехе',
      'коста адехе',
      'коста-адехе',
      'файабе',
      'фанабе',
      'торвискас',
      'кальяо сальвахе',
      'плайя параисо',
      'el duque',
      'эль дуке',
      'эль-дуке',
      'puerto colon',
      'puerto colón',
      'пуэрто колон',
      'los menores',
      'лос менорес',
      'la caldera',
      'barranco del ingles',
      'barranco del inglés',
    ],
  },
  {
    id: 'los_cristianos',
    macro: 'tenerife',
    keywords: [
      'los cristianos',
      'лос кристиан',
      'лос-кристиан',
      'san miguel de abona',
      'сан мигель де абона',
      'guargacho',
      'гуаргачо',
      'arona',
      'арона',
      'chayofa',
      'чайофа',
      'amarilla golf',
      'amarilla',
      'амарилья',
      'las galletas',
      'лас гальетас',
      'el fraile',
      'el frayle',
      'эль фрайле',
      'cabo blanco',
      'capo blanco',
      'кабо бланко',
      'island village',
    ],
  },
  {
    id: 'las_americas',
    macro: 'tenerife',
    keywords: [
      'las americas',
      'las américas',
      'americas',
      'américas',
      'лас америк',
      'лас-америк',
      'лас америкас',
      'лас-америкас',
      'америкас',
      'playa de las americas',
      'playa de las américas',
      'плайя де лас америкас',
      'san eugenio',
      'сан эухенио',
      'aloha garden',
      'алоха',
    ],
  },
  {
    id: 'golf_del_sur',
    macro: 'tenerife',
    keywords: [
      'golf del sur',
      'гольф дель сур',
      'гольф-дель-сур',
      // Разговорные формы (часто так пишут клиенты)
      'гольфреда',
      'гольфред',
      'гольф реда',
      'golfreda',
      'golf reda',
      'golf-reda',
      'amarilla golf',
      'amarilla',
      'амарилья',
      'амарилла',
      'the palms',
      'san isidro',
      'сан исидро',
      'san miguel de abona',
      'сан мигель де абона',
      'сан-мигель-де-абона',
      'granadilla',
      'гранадилья',
    ],
  },
  {
    id: 'el_medano',
    macro: 'tenerife',
    keywords: ['el medano', 'el médano', 'medano', 'медано', 'эль медано', 'эль-медано'],
  },
  {
    id: 'puerto_de_la_cruz',
    macro: 'tenerife',
    keywords: [
      'puerto de la cruz',
      'пуэрто де ла крус',
      'пуэрто-де-ла-крус',
      'пуэрто де ла круз',
    ],
  },
  {
    id: 'santa_cruz',
    macro: 'tenerife',
    keywords: [
      'santa cruz de tenerife',
      'santa cruz',
      'санта крус',
      'санта-крус',
      'la laguna',
      'ла лагуна',
      'ла-лагуна',
      'la orotava',
      'orotava',
      'ла оротава',
      'ла-оротава',
      'candelaria',
      'канделария',
    ],
  },
  {
    id: 'palm_mar',
    macro: 'tenerife',
    keywords: [
      'palm-mar',
      'palm mar',
      'pal-mar',
      'la caleta',
      'пальм мар',
      'пальм-мар',
      'ла калета',
      'ла-калета',
    ],
  },
  {
    id: 'los_gigantes',
    macro: 'tenerife',
    keywords: [
      'los gigantes',
      'лос гигантес',
      'лос-гигантес',
      'playa de la arena',
      'playa la arena',
      'плайя ла арена',
      'alcala',
      'alcalá',
      'алькала',
      'santiago del teide',
      'сантьяго дель тейде',
    ],
  },
  {
    id: 'dubai_marina',
    macro: 'dubai',
    keywords: [
      'dubai marina',
      'marina dubai',
      'дубай марина',
      'дубай-марина',
      'марина дубай',
    ],
  },
  {
    id: 'palm_jumeirah',
    macro: 'dubai',
    keywords: [
      'palm jumeirah',
      'пальм джумейра',
      'пальм-джумейра',
      'palm jebel',
    ],
  },
  {
    id: 'dubai_business_bay',
    macro: 'dubai',
    keywords: [
      'business bay',
      'бизнес бэй',
      'бизнес-бэй',
      'бизнес бей',
      'sheikh zayed road',
      'downtown dubai',
      'downtown',
      'даунтаун',
      'dubai hills',
      'дубай хиллс',
      'hills estate',
    ],
  },
  {
    id: 'dubai_jlt',
    macro: 'dubai',
    keywords: ['jlt', 'jumeirah lakes', 'jumeirah lake towers', 'джумейра лейкс', 'джлт', 'джейелти'],
  },
  {
    id: 'marbella_puerto_banus',
    macro: 'marbella',
    keywords: [
      'puerto banus',
      'puerto banús',
      'пуэрто банус',
      'пуэрто-банус',
    ],
  },
  {
    id: 'marbella_golden_mile',
    macro: 'marbella',
    keywords: [
      'golden mile',
      'голден майл',
      'milla de oro',
      'милья де оро',
      'guadalmina',
      'гвадалмина',
      'nueva andalucia',
      'nueva andalucía',
      'нуэва андалусия',
      'нуэва-андалусия',
    ],
  },
  {
    id: 'marbella_estepona',
    macro: 'marbella',
    keywords: [
      'estepona',
      'эстепона',
      'sotogrande',
      'сотогранде',
      'mijas',
      'михас',
      'benahavis',
      'benahavís',
      'бенавис',
      'la zagaleta',
      'ла сагалета',
    ],
  },
  {
    id: 'ibiza_santa_eulalia',
    macro: 'ibiza',
    keywords: [
      'santa eulalia',
      'santa eulària',
      'santa eularia',
      'санта еулалия',
      'санта эулалия',
      'санта-еулалия',
      'санта-эулалия',
      'santa gertrudis',
      'санта гертрудис',
    ],
  },
  {
    id: 'ibiza_sant_antoni',
    macro: 'ibiza',
    keywords: [
      'sant antoni',
      'sant antoni de portmany',
      'san antonio',
      'san antonio de portmany',
      'san antoni',
      'сан антонио',
      'сан-антонио',
      'сан антони',
      'сан-антони',
      'сант антони',
      'сант-антони',
      'сан антонио де портмани',
      'сан-антонио де портмани',
      'сант антони де портмани',
      'портмани',
      'portmany',
      'port de sant antoni',
    ],
  },
  {
    id: 'ibiza_town',
    macro: 'ibiza',
    keywords: [
      'ibiza town',
      'eivissa',
      'ibiza ciudad',
      'ciudad de ibiza',
      'город ибица',
      'город ибицы',
      'ибица таун',
      'ибиса таун',
      'эйвисса',
      'jesus',
      'jesús',
      'хесус',
      'san rafael',
      'сан рафаэль',
      'san agustin',
      'san agustín',
    ],
  },
  {
    id: 'ibiza_es_cubells',
    macro: 'ibiza',
    keywords: [
      'es cubells',
      'эс кубельс',
      'эс-кубельс',
      'es cavallet',
      'эс кавальет',
      'cala jondal',
      'кала хондаль',
      'cala conta',
      'кала конта',
      'cap martinet',
      'кап мартинет',
      'sant josep',
      'sant josep de sa talaia',
      'сан хосе',
      'can furnet',
      'кан фурнет',
      'sa caleta',
      'са калета',
      'vista alegre',
    ],
  },
  {
    id: 'malaga_city',
    macro: 'malaga',
    keywords: [
      'málaga centro',
      'malaga centro',
      'центр малаги',
      'малага центр',
      'malaga city',
      'малага город',
    ],
  },
  {
    id: 'malaga_coast',
    macro: 'malaga',
    keywords: [
      'torremolinos',
      'торремолинос',
      'fuengirola',
      'фуэнхирола',
      'rincón de la victoria',
      'rincon de la victoria',
      'axarquia',
      'axarquía',
      'ашаркия',
    ],
  },
  {
    id: 'barcelona_city',
    macro: 'barcelona',
    keywords: [
      'eixample',
      'эйшампле',
      'эшампле',
      'vila de gracia',
      'vila de gràcia',
      'barrio de gracia',
      'barrio de gràcia',
      'грасия',
      'грасиа',
      'barceloneta',
      'барселонета',
      'sagrada familia',
      'саграда фамилия',
    ],
  },
  {
    id: 'barcelona_coast',
    macro: 'barcelona',
    keywords: [
      'sitges',
      'ситжес',
      'ситгес',
      'garraf',
      'гарраф',
      'maresme',
      'маресме',
      'castelldefels',
      'кастельдефельс',
    ],
  },
];

const BROAD_AREA_HINTS = [
  {
    id: 'south',
    macro: 'tenerife',
    userTriggers: ['south', 'юг', 'sur', 'zona sur', 'south coast', 'south tenerife', 'юг тенериф', 'sur de tenerife', 'sur de la isla'],
    itemKeywords: [
      'sur',
      'south',
      'zona sur',
      'south coast',
      'south tenerife',
      'sur de',
      'adeje',
      'arona',
      'los cristianos',
      'las americas',
      'costa adeje',
      'golf del sur',
      'el medano',
      'callao salvaje',
      'playa paraiso',
    ],
  },
  {
    id: 'north',
    macro: 'tenerife',
    userTriggers: ['north', 'север', 'norte', 'north tenerife', 'север тенериф'],
    itemKeywords: ['north', 'norte', 'север', 'puerto de la cruz', 'santa cruz', 'la laguna', 'los gigantes'],
  },
  {
    id: 'west',
    macro: 'tenerife',
    userTriggers: ['west', 'запад', 'oeste', 'west coast'],
    itemKeywords: ['west', 'oeste', 'запад', 'guia de isora', 'los gigantes', 'palm-mar', 'adeje'],
  },
];

const GENERIC_LOCATION_TERMS = new Set(['tenerife', 'тенериф', 'canary', 'canarias', 'канар']);

/**
 * Нормализация для матчинга: регистр, лат. диакритика, дефисы/тире → пробел.
 * Кириллическую «й» сохраняем (NFD иначе превращает «дубай» → «дубаи»).
 */
function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/й/g, '\uE000')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\uE000/g, 'й')
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D_/·•]+/g, ' ')
    .replace(/[^a-z0-9а-яёñç\s]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textIncludesPhrase(text, phrase) {
  const t = normalizeText(text);
  const p = normalizeText(phrase);
  if (!p || p.length < 2) return false;
  if (p.includes(' ')) return t.includes(p);
  // Unicode letter/number boundaries (латиница + кириллица)
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, 'iu');
  return re.test(t);
}

function editDistance(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const prev = new Array(t.length + 1);
  const cur = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;
  for (let i = 1; i <= s.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= t.length; j++) prev[j] = cur[j];
  }
  return prev[t.length];
}

function maxEditsForLength(len) {
  if (len < 5) return 0;
  if (len <= 7) return 1;
  if (len <= 12) return 2;
  return 3;
}

function fuzzyEqual(a, b) {
  const na = normalizeText(a).replace(/\s+/g, '');
  const nb = normalizeText(b).replace(/\s+/g, '');
  if (!na || !nb) return false;
  if (na === nb) return true;
  const maxLen = Math.max(na.length, nb.length);
  const minLen = Math.min(na.length, nb.length);
  const allowed = maxEditsForLength(maxLen);
  if (!allowed) return false;
  if (maxLen - minLen > allowed) return false;
  return editDistance(na, nb) <= allowed;
}

/** Ищет needle в haystack с допуском опечаток (скользящее окно). */
function fuzzyContainsCollapsed(haystack, needle) {
  const h = normalizeText(haystack).replace(/\s+/g, '');
  const n = normalizeText(needle).replace(/\s+/g, '');
  if (!n || n.length < 5) return false;
  if (h.includes(n)) return true;
  const allowed = maxEditsForLength(n.length);
  if (!allowed) return false;
  for (let len = n.length - allowed; len <= n.length + allowed; len++) {
    if (len < 4 || len > h.length) continue;
    for (let i = 0; i <= h.length - len; i++) {
      if (editDistance(h.slice(i, i + len), n) <= allowed) return true;
    }
  }
  return false;
}

/**
 * Точное совпадение ИЛИ опечатка (1–2 символа).
 * Короткие ключи (&lt;5) — только exact, чтобы не ловить ложные срабатывания.
 * Многословные фразы — только по словам (не по всему тексту), иначе «Тенерифе» ≈ «юг тенериф».
 */
function textMatchesLocationPhrase(text, phrase) {
  if (textIncludesPhrase(text, phrase)) return true;
  const t = normalizeText(text);
  const p = normalizeText(phrase);
  if (!p || p.length < 5) return false;

  const pWords = p.split(/\s+/).filter(Boolean);
  const tWords = t.split(/\s+/).filter(Boolean);
  const pCollapsed = pWords.join('');

  if (pWords.length >= 2) {
    // Слово-за-слово / n-gram с допуском опечаток
    for (let i = 0; i <= tWords.length - pWords.length; i++) {
      const slice = tWords.slice(i, i + pWords.length);
      if (fuzzyEqual(slice.join(' '), p)) return true;
      let ok = true;
      for (let w = 0; w < pWords.length; w++) {
        const tw = slice[w];
        const pw = pWords[w];
        if (tw === pw) continue;
        if (pw.length >= 5 && fuzzyEqual(tw, pw)) continue;
        ok = false;
        break;
      }
      if (ok) return true;
    }
    // Слитно написанный район: «санатонио» ≈ «сан антонио»
    for (const tw of tWords) {
      if (tw.length >= 6 && fuzzyEqual(tw, pCollapsed)) return true;
    }
    return false;
  }

  // Одно слово: токены или окно в тексте (адеже / санатонио как один токен уже выше)
  for (const tw of tWords) {
    if (tw.length >= 4 && fuzzyEqual(tw, p)) return true;
  }
  return fuzzyContainsCollapsed(t, p);
}

/**
 * @param {string} text
 * @returns {{ groupIds: string[], broadIds: string[], keywords: string[], label: string, hasSpecific: boolean, fuzzyMatched: boolean }}
 */
function detectMicroAreas(text, lang = 'ru') {
  const lower = normalizeText(text);
  const groupIds = [];
  const keywords = new Set();
  const broadIds = [];
  let fuzzyMatched = false;

  for (const g of SPECIFIC_AREA_GROUPS) {
    let hit = false;
    let fuzzy = false;
    for (const k of g.keywords) {
      if (textIncludesPhrase(lower, k)) {
        hit = true;
        break;
      }
      if (textMatchesLocationPhrase(lower, k)) {
        hit = true;
        fuzzy = true;
      }
    }
    if (hit) {
      groupIds.push(g.id);
      if (fuzzy) fuzzyMatched = true;
      g.keywords.forEach((k) => keywords.add(k.toLowerCase()));
    }
  }

  for (const b of BROAD_AREA_HINTS) {
    if (b.userTriggers.some((k) => textMatchesLocationPhrase(lower, k))) {
      broadIds.push(b.id);
      b.userTriggers.forEach((k) => keywords.add(k.toLowerCase()));
      b.itemKeywords.forEach((k) => keywords.add(k.toLowerCase()));
    }
  }

  const hasSpecific = groupIds.length > 0;
  const label = formatMicroAreaLabel(groupIds, broadIds, lang);

  return {
    groupIds,
    broadIds,
    keywords: [...keywords],
    label,
    hasSpecific,
    fuzzyMatched,
  };
}

function formatMicroAreaLabel(groupIds, broadIds, lang = 'ru') {
  const names = {
    costa_adeje: { ru: 'Costa Adeje', en: 'Costa Adeje', es: 'Costa Adeje' },
    los_cristianos: { ru: 'Los Cristianos', en: 'Los Cristianos', es: 'Los Cristianos' },
    las_americas: { ru: 'Las Américas', en: 'Las Américas', es: 'Las Américas' },
    golf_del_sur: { ru: 'Golf del Sur', en: 'Golf del Sur', es: 'Golf del Sur' },
    el_medano: { ru: 'El Médano', en: 'El Médano', es: 'El Médano' },
    puerto_de_la_cruz: { ru: 'Puerto de la Cruz', en: 'Puerto de la Cruz', es: 'Puerto de la Cruz' },
    santa_cruz: { ru: 'Santa Cruz / La Laguna / Orotava', en: 'Santa Cruz / La Laguna / Orotava', es: 'Santa Cruz / La Laguna / Orotava' },
    palm_mar: { ru: 'Palm-Mar', en: 'Palm-Mar', es: 'Palm-Mar' },
    los_gigantes: { ru: 'Los Gigantes / Playa de la Arena', en: 'Los Gigantes / Playa de la Arena', es: 'Los Gigantes / Playa de la Arena' },
    dubai_marina: { ru: 'Dubai Marina', en: 'Dubai Marina', es: 'Dubai Marina' },
    palm_jumeirah: { ru: 'Palm Jumeirah', en: 'Palm Jumeirah', es: 'Palm Jumeirah' },
    dubai_business_bay: { ru: 'Business Bay / Dubai Hills', en: 'Business Bay / Dubai Hills', es: 'Business Bay / Dubai Hills' },
    dubai_jlt: { ru: 'JLT', en: 'JLT', es: 'JLT' },
    marbella_puerto_banus: { ru: 'Puerto Banús', en: 'Puerto Banús', es: 'Puerto Banús' },
    marbella_golden_mile: { ru: 'Golden Mile / Nueva Andalucía', en: 'Golden Mile / Nueva Andalucía', es: 'Golden Mile / Nueva Andalucía' },
    marbella_estepona: { ru: 'Estepona / Sotogrande', en: 'Estepona / Sotogrande', es: 'Estepona / Sotogrande' },
    ibiza_santa_eulalia: { ru: 'Santa Eulalia', en: 'Santa Eulalia', es: 'Santa Eulalia' },
    ibiza_sant_antoni: { ru: 'Sant Antoni / San Antonio', en: 'Sant Antoni / San Antonio', es: 'Sant Antoni / San Antonio' },
    ibiza_town: { ru: 'Ibiza Town', en: 'Ibiza Town', es: 'Ibiza ciudad' },
    ibiza_es_cubells: { ru: 'Es Cubells / Cala', en: 'Es Cubells / Cala', es: 'Es Cubells / Cala' },
    malaga_city: { ru: 'Málaga', en: 'Málaga', es: 'Málaga' },
    malaga_coast: { ru: 'Torremolinos / Fuengirola', en: 'Torremolinos / Fuengirola', es: 'Torremolinos / Fuengirola' },
    barcelona_city: { ru: 'Barcelona / Eixample', en: 'Barcelona / Eixample', es: 'Barcelona / Eixample' },
    barcelona_coast: { ru: 'Sitges / Maresme', en: 'Sitges / Maresme', es: 'Sitges / Maresme' },
    south: { ru: 'юг Тенерифе', en: 'south Tenerife', es: 'sur de Tenerife', de: 'Süden Teneriffa', fr: 'sud de Tenerife' },
    north: { ru: 'север Тенерифе', en: 'north Tenerife', es: 'norte de Tenerife', de: 'Norden Teneriffa', fr: 'nord de Tenerife' },
    west: { ru: 'запад Тенерифе', en: 'west Tenerife', es: 'oeste de Tenerife', de: 'Westen Teneriffa', fr: 'ouest de Tenerife' },
  };
  const l = ['ru', 'en', 'es', 'de', 'fr'].includes(lang) ? lang : 'en';
  const parts = [...groupIds, ...broadIds].map((id) => names[id]?.[l] || names[id]?.en || id);
  return parts.join(', ');
}

function getGroupById(id) {
  return SPECIFIC_AREA_GROUPS.find((g) => g.id === id);
}

function getGroupMacro(g) {
  return g?.macro || 'tenerife';
}

function microDetectionMatchesMacro(microAreas, macroId) {
  if (!macroId) return false;
  for (const gid of microAreas.groupIds || []) {
    const g = getGroupById(gid);
    if (g && getGroupMacro(g) === macroId) return true;
  }
  for (const bid of microAreas.broadIds || []) {
    const b = BROAD_AREA_HINTS.find((x) => x.id === bid);
    if (b && (b.macro || 'tenerife') === macroId) return true;
  }
  return false;
}

/**
 * Нужно ли ещё уточнить район/зону в выбранном макрорегионе.
 * @param {string[]} macroRegions
 * @param {ReturnType<detectMicroAreas>} microAreas
 */
function needsMicroAreaSelection(macroRegions, microAreas) {
  if (!macroRegions?.length) return false;
  const requiring = macroRegions.filter((r) => REGIONS_REQUIRING_MICRO.includes(r));
  if (!requiring.length) return false;
  if (requiring.length === 1) {
    return !microDetectionMatchesMacro(microAreas, requiring[0]);
  }
  return requiring.some((r) => !microDetectionMatchesMacro(microAreas, r));
}

/**
 * @param {string[]} macroRegions
 * @param {string} lang
 */
function getAreaOptionsPrompt(macroRegions, lang = 'ru') {
  const l = ['ru', 'en', 'es', 'de', 'fr'].includes(lang) ? lang : 'en';
  const regions = (macroRegions || []).filter((r) => REGIONS_REQUIRING_MICRO.includes(r));
  if (!regions.length) return '';
  const parts = regions.map((r) => AREA_OPTIONS_BY_MACRO[r]?.[l] || r);
  return parts.join('; ');
}

/**
 * Оставляет только группы районов, относящиеся к выбранным макрорегионам.
 */
function filterMicroGroupsForMacro(groupIds, macroRegions) {
  if (!groupIds?.length || !macroRegions?.length) return groupIds || [];
  return groupIds.filter((gid) => {
    const g = getGroupById(gid);
    return g && macroRegions.includes(getGroupMacro(g));
  });
}

/**
 * Жёсткий фильтр: объект должен попасть хотя бы в одну выбранную узкую зону.
 */
function itemMatchesMicroAreas(item, groupIds, itemSearchBlobFn) {
  if (!groupIds?.length) return true;
  const blob = itemSearchBlobFn(item);
  for (const gid of groupIds) {
    const g = getGroupById(gid);
    if (!g) continue;
    // textIncludesPhrase — с границами слов (иначе «gracia» ловит «gracias»)
    if (g.keywords.some((k) => textIncludesPhrase(blob, k))) return true;
  }
  return false;
}

function scoreMicroAreaFit(item, detection, itemSearchBlobFn) {
  const blob = itemSearchBlobFn(item);
  let sc = 0;

  for (const gid of detection.groupIds || []) {
    const g = getGroupById(gid);
    if (!g) continue;
    if (g.keywords.some((k) => textIncludesPhrase(blob, k))) sc += 22;
  }

  for (const bid of detection.broadIds || []) {
    const b = BROAD_AREA_HINTS.find((x) => x.id === bid);
    if (!b) continue;
    if (b.itemKeywords.some((k) => textIncludesPhrase(blob, k))) sc += 14;
  }

  if (detection.groupIds?.length && sc === 0) sc -= 28;

  return sc;
}

/** Ключевые слова для обратной совместимости (без generic tenerife) */
const LOCATION_KEYWORDS = [
  ...SPECIFIC_AREA_GROUPS.flatMap((g) => g.keywords),
  ...BROAD_AREA_HINTS.flatMap((b) => b.userTriggers),
].filter((k) => !GENERIC_LOCATION_TERMS.has(normalizeText(k)));

module.exports = {
  SPECIFIC_AREA_GROUPS,
  BROAD_AREA_HINTS,
  REGIONS_REQUIRING_MICRO,
  AREA_OPTIONS_BY_MACRO,
  LOCATION_KEYWORDS,
  GENERIC_LOCATION_TERMS,
  normalizeText,
  detectMicroAreas,
  formatMicroAreaLabel,
  itemMatchesMicroAreas,
  scoreMicroAreaFit,
  textIncludesPhrase,
  textMatchesLocationPhrase,
  fuzzyEqual,
  needsMicroAreaSelection,
  getAreaOptionsPrompt,
  filterMicroGroupsForMacro,
  microDetectionMatchesMacro,
};
