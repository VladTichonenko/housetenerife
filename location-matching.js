'use strict';

/**
 * Группы районов: синонимы в переписке и в текстах объявлений.
 * Узкие группы — жёсткий фильтр подборки; широкие (south/north) — только усиление score.
 */
/** Регионы, где подборка без конкретной зоны/района даёт плохие результаты */
const REGIONS_REQUIRING_MICRO = ['tenerife', 'dubai', 'marbella', 'ibiza', 'malaga', 'barcelona'];

const AREA_OPTIONS_BY_MACRO = {
  tenerife: {
    ru: 'Costa Adeje, Los Cristianos, Las Américas, Golf del Sur, Puerto de la Cruz, юг/север/запад',
    en: 'Costa Adeje, Los Cristianos, Las Américas, Golf del Sur, Puerto de la Cruz, south/north/west',
    es: 'Costa Adeje, Los Cristianos, Las Américas, Golf del Sur, Puerto de la Cruz, sur/norte/oeste',
  },
  dubai: {
    ru: 'Dubai Marina, Palm Jumeirah, Business Bay, JLT, Downtown',
    en: 'Dubai Marina, Palm Jumeirah, Business Bay, JLT, Downtown',
    es: 'Dubai Marina, Palm Jumeirah, Business Bay, JLT, Downtown',
  },
  marbella: {
    ru: 'Puerto Banús, Golden Mile, Nueva Andalucía, Estepona, Benahavís',
    en: 'Puerto Banús, Golden Mile, Nueva Andalucía, Estepona, Benahavís',
    es: 'Puerto Banús, Golden Mile, Nueva Andalucía, Estepona, Benahavís',
  },
  ibiza: {
    ru: 'Ibiza Town, Santa Eulalia, Sant Antoni, Es Cubells',
    en: 'Ibiza Town, Santa Eulalia, Sant Antoni, Es Cubells',
    es: 'Ibiza ciudad, Santa Eulalia, Sant Antoni, Es Cubells',
  },
  malaga: {
    ru: 'Малага центр, Torremolinos, Fuengirola, Axarquía',
    en: 'Málaga city, Torremolinos, Fuengirola, Axarquía',
    es: 'Málaga ciudad, Torremolinos, Fuengirola, Axarquía',
  },
  barcelona: {
    ru: 'Барселона центр / Eixample, Sitges, Maresme',
    en: 'Barcelona / Eixample, Sitges, Maresme coast',
    es: 'Barcelona / Eixample, Sitges, Maresme',
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
    ],
  },
  {
    id: 'los_cristianos',
    macro: 'tenerife',
    keywords: ['los cristianos', 'лос кристиан', 'san miguel de abona', 'guargacho', 'arona'],
  },
  {
    id: 'las_americas',
    macro: 'tenerife',
    keywords: [
      'las americas',
      'las américas',
      'лас америк',
      'playa de las americas',
      'san eugenio',
    ],
  },
  {
    id: 'golf_del_sur',
    macro: 'tenerife',
    keywords: ['golf del sur', 'гольф дель сур', 'san isidro', 'guía de isora', 'guia de isora'],
  },
  {
    id: 'el_medano',
    macro: 'tenerife',
    keywords: ['el medano', 'el médano', 'medano', 'медано'],
  },
  {
    id: 'puerto_de_la_cruz',
    macro: 'tenerife',
    keywords: ['puerto de la cruz', 'пуэрто де ла крус'],
  },
  {
    id: 'santa_cruz',
    macro: 'tenerife',
    keywords: ['santa cruz de tenerife', 'santa cruz', 'la laguna'],
  },
  {
    id: 'palm_mar',
    macro: 'tenerife',
    keywords: ['palm-mar', 'palm mar', 'la caleta', 'пальм мар'],
  },
  {
    id: 'los_gigantes',
    macro: 'tenerife',
    keywords: ['los gigantes', 'лос гигантес'],
  },
  {
    id: 'dubai_marina',
    macro: 'dubai',
    keywords: ['dubai marina', 'marina dubai', 'дубай марина'],
  },
  {
    id: 'palm_jumeirah',
    macro: 'dubai',
    keywords: ['palm jumeirah', 'пальм джумейра', 'palm jebel'],
  },
  {
    id: 'dubai_business_bay',
    macro: 'dubai',
    keywords: ['business bay', 'бизнес бэй', 'sheikh zayed road', 'downtown dubai', 'downtown'],
  },
  {
    id: 'dubai_jlt',
    macro: 'dubai',
    keywords: ['jlt', 'jumeirah lakes', 'jumeirah lake towers'],
  },
  {
    id: 'marbella_puerto_banus',
    macro: 'marbella',
    keywords: ['puerto banus', 'puerto banús', 'пуэрто банус'],
  },
  {
    id: 'marbella_golden_mile',
    macro: 'marbella',
    keywords: ['golden mile', 'guadalmina', 'nueva andalucia', 'nueva andalucía'],
  },
  {
    id: 'marbella_estepona',
    macro: 'marbella',
    keywords: ['estepona', 'sotogrande', 'mijas', 'benahavis', 'benahavís', 'la zagaleta'],
  },
  {
    id: 'ibiza_santa_eulalia',
    macro: 'ibiza',
    keywords: ['santa eulalia', 'santa eulària', 'санта еулалия', 'санта эулалия'],
  },
  {
    id: 'ibiza_sant_antoni',
    macro: 'ibiza',
    keywords: [
      'sant antoni',
      'san antonio',
      'san antoni',
      'сан антонио',
      'сан антони',
      'сант антони',
      'port de sant antoni',
    ],
  },
  {
    id: 'ibiza_town',
    macro: 'ibiza',
    keywords: ['ibiza town', 'eivissa', 'ibiza ciudad', 'город ибица'],
  },
  {
    id: 'ibiza_es_cubells',
    macro: 'ibiza',
    keywords: [
      'es cubells',
      'es cavallet',
      'cala jondal',
      'cala conta',
      'cap martinet',
      'sant josep',
      'sant josep de sa talaia',
    ],
  },
  {
    id: 'malaga_city',
    macro: 'malaga',
    keywords: ['málaga centro', 'malaga centro', 'центр малаги'],
  },
  {
    id: 'malaga_coast',
    macro: 'malaga',
    keywords: ['torremolinos', 'fuengirola', 'rincón de la victoria', 'axarquia', 'axarquía'],
  },
  {
    id: 'barcelona_city',
    macro: 'barcelona',
    keywords: ['eixample', 'gràcia', 'gracia', 'barceloneta', 'sagrada'],
  },
  {
    id: 'barcelona_coast',
    macro: 'barcelona',
    keywords: ['sitges', 'garraf', 'maresme', 'castelldefels'],
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

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function textIncludesPhrase(text, phrase) {
  const t = normalizeText(text);
  const p = normalizeText(phrase);
  if (!p || p.length < 2) return false;
  if (p.includes(' ')) return t.includes(p);
  const re = new RegExp(`(?:^|[^a-z0-9áéíóúñ])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9áéíóúñ]|$)`, 'i');
  return re.test(t);
}

/**
 * @param {string} text
 * @returns {{ groupIds: string[], broadIds: string[], keywords: string[], label: string, hasSpecific: boolean }}
 */
function detectMicroAreas(text, lang = 'ru') {
  const lower = normalizeText(text);
  const groupIds = [];
  const keywords = new Set();
  const broadIds = [];

  for (const g of SPECIFIC_AREA_GROUPS) {
    if (g.keywords.some((k) => textIncludesPhrase(lower, k))) {
      groupIds.push(g.id);
      g.keywords.forEach((k) => keywords.add(k.toLowerCase()));
    }
  }

  for (const b of BROAD_AREA_HINTS) {
    if (b.userTriggers.some((k) => textIncludesPhrase(lower, k))) {
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
    santa_cruz: { ru: 'Santa Cruz / La Laguna', en: 'Santa Cruz / La Laguna', es: 'Santa Cruz / La Laguna' },
    palm_mar: { ru: 'Palm-Mar', en: 'Palm-Mar', es: 'Palm-Mar' },
    los_gigantes: { ru: 'Los Gigantes', en: 'Los Gigantes', es: 'Los Gigantes' },
    dubai_marina: { ru: 'Dubai Marina', en: 'Dubai Marina', es: 'Dubai Marina' },
    palm_jumeirah: { ru: 'Palm Jumeirah', en: 'Palm Jumeirah', es: 'Palm Jumeirah' },
    dubai_business_bay: { ru: 'Business Bay', en: 'Business Bay', es: 'Business Bay' },
    dubai_jlt: { ru: 'JLT', en: 'JLT', es: 'JLT' },
    marbella_puerto_banus: { ru: 'Puerto Banús', en: 'Puerto Banús', es: 'Puerto Banús' },
    marbella_golden_mile: { ru: 'Golden Mile / Nueva Andalucía', en: 'Golden Mile / Nueva Andalucía', es: 'Golden Mile / Nueva Andalucía' },
    marbella_estepona: { ru: 'Estepona / Sotogrande', en: 'Estepona / Sotogrande', es: 'Estepona / Sotogrande' },
    ibiza_santa_eulalia: { ru: 'Santa Eulalia', en: 'Santa Eulalia', es: 'Santa Eulalia' },
    ibiza_sant_antoni: { ru: 'Sant Antoni / San Antonio', en: 'Sant Antoni / San Antonio', es: 'Sant Antoni / San Antonio' },
    ibiza_town: { ru: 'Ibiza Town', en: 'Ibiza Town', es: 'Ibiza ciudad' },
    ibiza_es_cubells: { ru: 'Es Cubells / Cala', en: 'Es Cubells / Cala', es: 'Es Cubells / Cala' },
    malaga_city: { ru: 'Малага центр', en: 'Málaga city', es: 'Málaga ciudad' },
    malaga_coast: { ru: 'Torremolinos / Fuengirola', en: 'Torremolinos / Fuengirola', es: 'Torremolinos / Fuengirola' },
    barcelona_city: { ru: 'Barcelona / Eixample', en: 'Barcelona / Eixample', es: 'Barcelona / Eixample' },
    barcelona_coast: { ru: 'Sitges / Maresme', en: 'Sitges / Maresme', es: 'Sitges / Maresme' },
    south: { ru: 'юг Тенерифе', en: 'south Tenerife', es: 'sur de Tenerife' },
    north: { ru: 'север Тенерифе', en: 'north Tenerife', es: 'norte de Tenerife' },
    west: { ru: 'запад Тенерифе', en: 'west Tenerife', es: 'oeste de Tenerife' },
  };
  const l = ['ru', 'en', 'es'].includes(lang) ? lang : 'en';
  const parts = [...groupIds, ...broadIds].map((id) => names[id]?.[l] || id);
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
  const l = ['ru', 'en', 'es'].includes(lang) ? lang : 'en';
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
  const blob = normalizeText(itemSearchBlobFn(item));
  for (const gid of groupIds) {
    const g = getGroupById(gid);
    if (!g) continue;
    if (g.keywords.some((k) => blob.includes(normalizeText(k)))) return true;
  }
  return false;
}

function scoreMicroAreaFit(item, detection, itemSearchBlobFn) {
  const blob = normalizeText(itemSearchBlobFn(item));
  let sc = 0;

  for (const gid of detection.groupIds || []) {
    const g = getGroupById(gid);
    if (!g) continue;
    if (g.keywords.some((k) => blob.includes(normalizeText(k)))) sc += 22;
  }

  for (const bid of detection.broadIds || []) {
    const b = BROAD_AREA_HINTS.find((x) => x.id === bid);
    if (!b) continue;
    if (b.itemKeywords.some((k) => blob.includes(normalizeText(k)))) sc += 14;
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
  detectMicroAreas,
  formatMicroAreaLabel,
  itemMatchesMicroAreas,
  scoreMicroAreaFit,
  textIncludesPhrase,
  needsMicroAreaSelection,
  getAreaOptionsPrompt,
  filterMicroGroupsForMacro,
  microDetectionMatchesMacro,
};
