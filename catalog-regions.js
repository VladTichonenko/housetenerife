/**
 * Регионы и города каталога House Tenerife (housetenerife.eu).
 * @see https://housetenerife.eu/
 */

const MACRO_REGIONS = {
  tenerife: {
    id: 'tenerife',
    labels: { ru: 'Тенерифе / Канары', en: 'Tenerife / Canary Islands', es: 'Tenerife / Canarias', de: 'Teneriffa / Kanaren', fr: 'Tenerife / Canaries', pl: 'Teneryfa / Wyspy Kanaryjskie', nl: 'Tenerife / Canarische Eilanden' },
    keywords: [
      'tenerife',
      'teneriffa',
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
      'гольфреда',
      'golfreda',
      'amarilla golf',
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
      'abama',
      'el duque',
      'la orotava',
      'las galletas',
      'amarilla',
      'chayofa'
    ]
  },
  dubai: {
    id: 'dubai',
    labels: { ru: 'Дубай', en: 'Dubai', es: 'Dubái', de: 'Dubai', fr: 'Dubaï', pl: 'Dubaj', nl: 'Dubai' },
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
      'palm jumeirah',
      'dubai hills',
      'дубай хиллс'
    ]
  },
  ibiza: {
    id: 'ibiza',
    labels: { ru: 'Ибица', en: 'Ibiza', es: 'Ibiza', de: 'Ibiza', fr: 'Ibiza', pl: 'Ibiza', nl: 'Ibiza' },
    keywords: [
      'ibiza',
      'ибиц',
      'ибиза',
      'ивица',
      'eivissa',
      'эйвисса',
      'santa eulalia',
      'santa eulària',
      'санта еулалия',
      'санта эулалия',
      'sant antoni',
      'san antonio',
      'san antoni',
      'сан антонио',
      'сан антони',
      'сант антони',
      'portmany',
      'портмани',
      'sant josep',
      'cala jondal',
      'cala conta',
      'marina botafoch',
      'botafoch',
      'ботафоч',
      'talamanca',
      'таламанка',
      'ibiza town',
      'eivissa town',
      'es cubells',
      'es cavallet',
      'cap martinet',
      'can furnet',
      'jesus',
      'jesús',
      'хесус'
    ]
  },
  marbella: {
    id: 'marbella',
    labels: { ru: 'Марбелья / Costa del Sol', en: 'Marbella / Costa del Sol', es: 'Marbella / Costa del Sol', de: 'Marbella / Costa del Sol', fr: 'Marbella / Costa del Sol', pl: 'Marbella / Costa del Sol', nl: 'Marbella / Costa del Sol' },
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
    labels: { ru: 'Малага', en: 'Málaga / Malaga', es: 'Málaga', de: 'Málaga', fr: 'Málaga', pl: 'Málaga', nl: 'Málaga' },
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
    labels: { ru: 'Барселона', en: 'Barcelona', es: 'Barcelona', de: 'Barcelona', fr: 'Barcelone', pl: 'Barcelona', nl: 'Barcelona' },
    keywords: [
      'barcelona',
      'барселона',
      'барселоне',
      'барселоны',
      'barcelone',
      'catalonia',
      'cataluña',
      'catalunya',
      'каталония',
      'каталонии',
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
  es: 'Tenerife, Dubái, Ibiza, Marbella, Málaga, Barcelona',
  de: 'Teneriffa, Dubai, Ibiza, Marbella, Málaga, Barcelona',
  fr: 'Tenerife, Dubaï, Ibiza, Marbella, Málaga, Barcelone',
  pl: 'Teneryfa, Dubaj, Ibiza, Marbella, Málaga, Barcelona',
  nl: 'Tenerife, Dubai, Ibiza, Marbella, Málaga, Barcelona'
};

function itemSearchBlob(item) {
  const parts = [
    item?.title,
    item?.description,
    item?.overview,
    item?.url,
    item?.id
  ];
  for (const lang of ['ru', 'es', 'en', 'de', 'fr', 'pl', 'nl']) {
    parts.push(item?.titles?.[lang], item?.descriptions?.[lang], item?.overviews?.[lang], item?.urls?.[lang]);
  }
  return parts.filter(Boolean).join(' ');
}

/**
 * @param {object} item
 * @returns {string[]}
 */
function inferMacroFromUrls(item) {
  const urls = [
    item?.url,
    item?.urls?.ru,
    item?.urls?.en,
    item?.urls?.es
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!urls) return [];
  if (/\/(?:city\/)?dubai|dubaj|\/dubai\//i.test(urls)) return ['dubai'];
  if (/\/ibiza|ibitsa|\/state\/ibiza/i.test(urls)) return ['ibiza'];
  if (/\/marbella|\/state\/marbella/i.test(urls)) return ['marbella'];
  if (/\/malaga|málaga|\/state\/malaga/i.test(urls)) return ['malaga'];
  if (/\/barcelona|\/state\/barcelona/i.test(urls)) return ['barcelona'];
  if (/\/tenerife|\/state\/tenerife|costa-adeje|los-cristianos|las-amerik/i.test(urls)) {
    return ['tenerife'];
  }
  return [];
}

function getItemMacroRegions(item) {
  // URL/path — самый надёжный сигнал (не путать «каталонский стиль» с регионом Barcelona)
  const fromUrl = inferMacroFromUrls(item);
  if (fromUrl.length === 1) return fromUrl;

  const blob = itemSearchBlob(item).toLowerCase();
  const found = [];
  for (const [id, def] of Object.entries(MACRO_REGIONS)) {
    if (
      def.keywords.some((k) => {
        const kk = String(k || '').toLowerCase();
        if (!kk || !blob.includes(kk)) return false;
        // «каталонском стиле» ≠ регион Barcelona
        if (
          id === 'barcelona' &&
          /каталон|catalon/i.test(kk) &&
          !/\b(?:barcelona|барселон|catalunya|cataluña|каталони)/i.test(blob)
        ) {
          return false;
        }
        return true;
      })
    ) {
      found.push(id);
    }
  }
  if (!found.length && fromUrl.length) return fromUrl;
  return found;
}

function getPrimaryMacroRegion(item) {
  const fromUrl = inferMacroFromUrls(item);
  if (fromUrl.length === 1) return fromUrl[0];

  const all = getItemMacroRegions(item);
  const nonTenerife = all.filter((id) => id !== 'tenerife');
  if (nonTenerife.length === 1) return nonTenerife[0];
  if (all.length === 1) return all[0];
  const overview = itemSearchBlob(item).slice(0, 800).toLowerCase();
  for (const id of ['dubai', 'ibiza', 'barcelona', 'malaga', 'marbella', 'tenerife']) {
    const def = MACRO_REGIONS[id];
    if (def.keywords.some((k) => overview.includes(String(k).toLowerCase()))) return id;
  }
  if (fromUrl.length) return fromUrl[0];
  if (nonTenerife.length) return nonTenerife[0];
  if (all.length) return all[0];
  return null;
}

/**
 * @param {string} text
 * @returns {{ regions: string[], hasRegion: boolean, label: string }}
 */
function keywordMatchesText(keyword, text) {
  const { textIncludesPhrase, textMatchesLocationPhrase, normalizeText } = require('./location-matching');
  const t = normalizeText(text);
  const k = normalizeText(keyword);
  if (!k) return false;
  if (textIncludesPhrase(t, k)) return true;
  // Опечатки для топонимов длиной ≥5 (Tenerife/Adeje/Marbella…)
  if (k.length >= 5 && textMatchesLocationPhrase(t, k)) return true;
  // Короткие стемы для макрорегионов (ибиц → ибица / ибицы)
  if (k === 'дубай' && /дуба[йиеюя]/.test(t)) return true;
  if (k === 'ибиц' && /ибиц|ибиза|ивица|eivissa|эйвисс/.test(t)) return true;
  if (k === 'ibiza' && /ибиц|ибиза|ивица|eivissa|эйвисс/.test(t)) return true;
  if (k === 'marbella' && /марбел|марбея/.test(t)) return true;
  if (k === 'марбел' && /марбел|марбея|marbella/.test(t)) return true;
  if ((k === 'malaga' || k === 'málaga') && /малаг/.test(t)) return true;
  if (k === 'малаг' && /малаг|malaga/.test(t)) return true;
  if (k === 'barcelona' && /барселон|барса\b/.test(t)) return true;
  if (k === 'барселон' && /барселон|barcelona|барса\b/.test(t)) return true;
  if (k === 'tenerife' && /тенериф/.test(t)) return true;
  if (k === 'тенериф' && /тенериф|tenerife/.test(t)) return true;
  if (k === 'dubai' && /дуба[йиеюя]|dubaj/.test(t)) return true;
  if (k === 'dubaj' && /дуба[йиеюя]|dubai|dubaj/.test(t)) return true;
  return false;
}

function detectRegionPreference(text, lang = 'ru') {
  const lower = String(text || '');
  const regions = new Set();

  for (const [id, def] of Object.entries(MACRO_REGIONS)) {
    if (def.keywords.some((k) => keywordMatchesText(k, lower))) regions.add(id);
  }

  // Район без названия острова (напр. «Сан-Антонио») → макрорегион
  const { detectMicroAreas, SPECIFIC_AREA_GROUPS } = require('./location-matching');
  const micro = detectMicroAreas(lower, lang);
  for (const gid of micro.groupIds || []) {
    const g = SPECIFIC_AREA_GROUPS.find((x) => x.id === gid);
    if (g?.macro) regions.add(g.macro);
  }

  // «Испания» — это не синоним Тенерифе: в каталоге также есть Ibiza,
  // Marbella/Costa del Sol, Málaga и Barcelona.
  if (/канар|canary|canarias/i.test(lower) && !regions.size) regions.add('tenerife');
  if (/оаэ|эмират|uae/i.test(lower)) regions.add('dubai');

  const list = [...regions];
  const label = list.length === 0 ? '' : formatRegionLabel(list, lang);

  return { regions: list, hasRegion: list.length > 0, label };
}

/**
 * Активный регион диалога: берём из самой свежей реплики клиента, где регион назван.
 * «Вернёмся к Ибице» после Тенерифе → только Ibiza (старый регион не смешиваем).
 * Если в одной реплике названы два региона («сравни Тенерифе и Ибицу») — оба остаются.
 *
 * @param {Array<{sender?:string,text?:string}>} history
 * @param {string} [lang]
 * @returns {{ regions: string[], hasRegion: boolean, label: string, contextText: string }}
 */
function resolveActiveRegionPreference(history, lang = 'ru') {
  const userMsgs = (history || [])
    .filter((m) => m && m.sender === 'user' && String(m.text || '').trim())
    .map((m) => String(m.text || ''));

  if (!userMsgs.length) {
    return { regions: [], hasRegion: false, label: '', contextText: '' };
  }

  for (let i = userMsgs.length - 1; i >= 0; i--) {
    const pref = detectRegionPreference(userMsgs[i], lang);
    if (pref.hasRegion) {
      const contextText = userMsgs.slice(i).join('\n');
      return {
        regions: pref.regions,
        hasRegion: true,
        label: pref.label,
        contextText
      };
    }
  }

  const all = userMsgs.join('\n');
  const pref = detectRegionPreference(all, lang);
  return {
    regions: pref.regions,
    hasRegion: pref.hasRegion,
    label: pref.label,
    contextText: all
  };
}

function itemMatchesRegions(item, wantedRegions) {
  if (!wantedRegions?.length) return true;
  const itemRegions = getItemMacroRegions(item);
  if (!itemRegions.length) return false;
  if (wantedRegions.length === 1) {
    const want = wantedRegions[0];
    if (!itemRegions.includes(want)) return false;
    const primary = getPrimaryMacroRegion(item);
    return primary === want || (primary == null && itemRegions.includes(want));
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
  resolveActiveRegionPreference,
  itemMatchesRegions,
  scoreRegionFit,
  formatRegionLabel
};
