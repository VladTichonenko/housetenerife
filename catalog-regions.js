/**
 * Регионы и города каталога House Tenerife (housetenerife.eu).
 * @see https://housetenerife.eu/
 */

const MACRO_REGIONS = {
  tenerife: {
    id: 'tenerife',
    labels: { ru: 'Тенерифе / Канары', en: 'Tenerife / Canary Islands', es: 'Tenerife / Canarias' },
    keywords: [
      'tenerife',
      'тенериф',
      'канар',
      'canary',
      'canarias',
      'adeje',
      'адехе',
      'arona',
      'арона',
      'los cristianos',
      'лос кристиан',
      'las americas',
      'las américas',
      'лас америк',
      'costa adeje',
      'playa de las americas',
      'puerto de la cruz',
      'puerto colon',
      'golf del sur',
      'el medano',
      'medano',
      'santa cruz',
      'la laguna',
      'callao salvaje',
      'playa paraíso',
      'playa paraiso',
      'fanabe',
      'фанабе',
      'torviscas',
      'guia de isora',
      'guía de isora',
      'palm-mar',
      'la caleta',
      'los gigantes',
      'guargacho',
      'san eugenio',
      'san miguel',
      'caldera del rey',
      'roque del conde',
      'abama'
    ]
  },
  dubai: {
    id: 'dubai',
    labels: { ru: 'Дубай', en: 'Dubai', es: 'Dubái' },
    keywords: [
      'dubai',
      'dubaj',
      'дубай',
      'jumeirah',
      'jlt',
      'sheikh zayed',
      'marriott residences',
      'imtiaz',
      'uae',
      'оаэ',
      'emirates',
      'эмират',
      'dubai marina',
      'business bay',
      'palm jumeirah'
    ]
  },
  ibiza: {
    id: 'ibiza',
    labels: { ru: 'Ибица', en: 'Ibiza', es: 'Ibiza' },
    keywords: [
      'ibiza',
      'ибиц',
      'eivissa',
      'santa eulalia',
      'santa eulària',
      'sant antoni',
      'sant josep',
      'cala jondal',
      'cala conta',
      'es cubells',
      'es cavallet',
      'cap martinet',
      'can furnet'
    ]
  },
  marbella: {
    id: 'marbella',
    labels: { ru: 'Марбелья / Costa del Sol', en: 'Marbella / Costa del Sol', es: 'Marbella / Costa del Sol' },
    keywords: [
      'marbella',
      'марбел',
      'benahavis',
      'benahavís',
      'puerto banus',
      'puerto banús',
      'golden mile',
      'costa del sol',
      'коста дель соль',
      'guadalmina',
      'nueva andalucia',
      'la zagaleta',
      'sotogrande',
      'estepona',
      'mijas',
      'el campanario'
    ]
  },
  malaga: {
    id: 'malaga',
    labels: { ru: 'Малага', en: 'Málaga / Malaga', es: 'Málaga' },
    keywords: [
      'malaga',
      'málaga',
      'малаг',
      'costa del sol',
      'torremolinos',
      'fuengirola',
      'rincón de la victoria',
      'axarquia'
    ]
  },
  barcelona: {
    id: 'barcelona',
    labels: { ru: 'Барселона', en: 'Barcelona', es: 'Barcelona' },
    keywords: [
      'barcelona',
      'барселон',
      'catalonia',
      'каталон',
      'cataluña',
      'eixample',
      'sitges',
      'garraf',
      'maresme'
    ]
  }
};

const REGION_OPTIONS_PROMPT = {
  ru: 'Тенерифе, Дубай, Ибица, Марбелья, Малага, Барселона',
  en: 'Tenerife, Dubai, Ibiza, Marbella, Malaga, Barcelona',
  es: 'Tenerife, Dubái, Ibiza, Marbella, Málaga, Barcelona'
};

function itemSearchBlob(item) {
  const parts = [
    item?.title,
    item?.description,
    item?.overview,
    item?.url,
    item?.id
  ];
  for (const lang of ['ru', 'es', 'en']) {
    parts.push(item?.titles?.[lang], item?.descriptions?.[lang], item?.overviews?.[lang], item?.urls?.[lang]);
  }
  return parts.filter(Boolean).join(' ');
}

/**
 * @param {object} item
 * @returns {string[]}
 */
function getItemMacroRegions(item) {
  const blob = itemSearchBlob(item).toLowerCase();
  const found = [];
  for (const [id, def] of Object.entries(MACRO_REGIONS)) {
    if (def.keywords.some((k) => blob.includes(k.toLowerCase()))) found.push(id);
  }
  if (!found.length) return ['tenerife'];
  return found;
}

function getPrimaryMacroRegion(item) {
  const all = getItemMacroRegions(item);
  const nonTenerife = all.filter((id) => id !== 'tenerife');
  if (nonTenerife.length === 1) return nonTenerife[0];
  if (all.length === 1) return all[0];
  const overview = itemSearchBlob(item).slice(0, 800).toLowerCase();
  for (const id of ['dubai', 'ibiza', 'barcelona', 'malaga', 'marbella', 'tenerife']) {
    const def = MACRO_REGIONS[id];
    if (def.keywords.some((k) => overview.includes(k.toLowerCase()))) return id;
  }
  return nonTenerife[0] || all[0];
}

/**
 * @param {string} text
 * @returns {{ regions: string[], hasRegion: boolean, label: string }}
 */
function keywordMatchesText(keyword, text) {
  const k = keyword.toLowerCase();
  if (text.includes(k)) return true;
  if (k === 'дубай' && /дуба[йею]/.test(text)) return true;
  if (k === 'ibiza' && /ибиц/.test(text)) return true;
  if (k === 'marbella' && /марбел/.test(text)) return true;
  if (k === 'malaga' && /малаг/.test(text)) return true;
  if (k === 'barcelona' && /барселон/.test(text)) return true;
  if (k === 'tenerife' && /тенериф/.test(text)) return true;
  return false;
}

function detectRegionPreference(text, lang = 'ru') {
  const lower = String(text || '').toLowerCase();
  const regions = new Set();

  for (const [id, def] of Object.entries(MACRO_REGIONS)) {
    if (def.keywords.some((k) => keywordMatchesText(k, lower))) regions.add(id);
  }

  if (/испани|spain|канар/i.test(lower) && !regions.size) regions.add('tenerife');
  if (/оаэ|эмират|uae/i.test(lower)) regions.add('dubai');

  const list = [...regions];
  const label = list.length === 0 ? '' : formatRegionLabel(list, lang);

  return { regions: list, hasRegion: list.length > 0, label };
}

function itemMatchesRegions(item, wantedRegions) {
  if (!wantedRegions?.length) return true;
  const itemRegions = getItemMacroRegions(item);
  if (wantedRegions.length === 1) {
    const want = wantedRegions[0];
    if (!itemRegions.includes(want)) return false;
    return getPrimaryMacroRegion(item) === want;
  }
  return wantedRegions.some((r) => itemRegions.includes(r));
}

function scoreRegionFit(item, wantedRegions) {
  if (!wantedRegions?.length) return 0;
  const primary = getPrimaryMacroRegion(item);
  const itemRegions = getItemMacroRegions(item);
  if (wantedRegions.includes(primary)) return 24;
  if (wantedRegions.some((r) => itemRegions.includes(r))) return 10;
  return -35;
}

function formatRegionLabel(regions, lang = 'ru') {
  const chain = MACRO_REGIONS.tenerife.labels[lang] ? lang : 'ru';
  return regions.map((id) => MACRO_REGIONS[id]?.labels?.[chain] || id).join(', ');
}

/** Стартовые URL для sync-properties.js — полный обход регионов сайта */
const SYNC_SEED_INDEX_URLS = [
  'https://housetenerife.eu/',
  'https://housetenerife.eu/ru/',
  'https://housetenerife.eu/ru/state/tenerife-ru/',
  'https://housetenerife.eu/state/tenerife/',
  'https://housetenerife.eu/ru/state/marbella/',
  'https://housetenerife.eu/state/marbella/',
  'https://housetenerife.eu/ru/state/ibiza/',
  'https://housetenerife.eu/ru/state/ibitsa/',
  'https://housetenerife.eu/state/ibiza/',
  'https://housetenerife.eu/ru/state/malaga/',
  'https://housetenerife.eu/state/malaga/',
  'https://housetenerife.eu/ru/state/barcelona/',
  'https://housetenerife.eu/state/barcelona/',
  'https://housetenerife.eu/ru/city/dubai/',
  'https://housetenerife.eu/ru/city/dubaj/',
  'https://housetenerife.eu/ru/city/costa-adeje/',
  'https://housetenerife.eu/ru/city/los-cristianos/',
  'https://housetenerife.eu/ru/city/las-amerikas/',
  'https://housetenerife.eu/ru/property-type/apartments/',
  'https://housetenerife.eu/ru/property-type/villas/',
  'https://housetenerife.eu/ru/property-type/houses/',
  'https://housetenerife.eu/ru/property-type/land/',
  'https://housetenerife.eu/ru/property-type/commercial-properties/',
  'https://housetenerife.eu/ru/property-type/business-for-sale/',
  'https://housetenerife.eu/ru/property-type/investment-and-development/',
  'https://housetenerife.eu/ru/property-type/appartments-in-dubai/',
  'https://housetenerife.eu/property-type/apartments/',
  'https://housetenerife.eu/ru/label/featured/'
];

module.exports = {
  MACRO_REGIONS,
  REGION_OPTIONS_PROMPT,
  SYNC_SEED_INDEX_URLS,
  getItemMacroRegions,
  getPrimaryMacroRegion,
  detectRegionPreference,
  itemMatchesRegions,
  scoreRegionFit,
  formatRegionLabel
};
