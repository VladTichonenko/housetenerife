/**
 * Категории объектов каталога и сопоставление с запросом клиента.
 */

const TYPE_LABELS = {
  ru: {
    apartments: 'апартаменты / квартиры',
    villas: 'виллы',
    houses: 'дома / таунхаусы',
    land: 'земля / участки',
    commercial: 'коммерческая недвижимость',
    business: 'бизнес на продажу',
    investment: 'инвестиционные / девелоперские проекты'
  },
  en: {
    apartments: 'apartments',
    villas: 'villas',
    houses: 'houses / townhouses',
    land: 'land / plots',
    commercial: 'commercial property',
    business: 'business for sale',
    investment: 'investment / development projects'
  },
  es: {
    apartments: 'apartamentos',
    villas: 'villas',
    houses: 'casas / townhouses',
    land: 'terrenos',
    commercial: 'inmuebles comerciales',
    business: 'negocio en venta',
    investment: 'proyectos de inversión'
  }
};

/** Порядок вопроса клиенту (не «только виллы») */
const TYPE_OPTIONS_PROMPT = {
  ru: 'апартаменты, вилла, дом, земля, коммерция, готовый бизнес, инвест-проект',
  en: 'apartments, villa, house, land, commercial, business, investment project',
  es: 'apartamentos, villa, casa, terreno, comercial, negocio, proyecto de inversión'
};

function extractPropertyTypeFromOverview(overview) {
  const m = String(overview || '').match(/Property type\s*\|\s*([^|]+)/i);
  return m ? m[1].trim() : '';
}

/**
 * Категории объекта из поля overview каталога.
 * @returns {string[]}
 */
function getItemPropertyCategories(item) {
  const parts = [item?.overview];
  for (const lang of ['ru', 'es', 'en']) {
    parts.push(item?.overviews?.[lang]);
  }
  const raw = parts.filter(Boolean).join(' | ');
  const lower = raw.toLowerCase();
  const cats = new Set();

  if (/апартамент|apartment/i.test(lower)) cats.add('apartments');
  if (/вилл|\bvillas?\b/i.test(lower)) cats.add('villas');
  if (/\bдом|\bhouses?\b|\bcasas?\b/i.test(lower) && !/апартамент/i.test(lower)) cats.add('houses');
  if (/земл|\bland\b|terreno/i.test(lower)) cats.add('land');
  if (/коммерческ|commercial/i.test(lower)) cats.add('commercial');
  if (/бизнес|business|ресторан|бар|кафе|negocio/i.test(lower)) cats.add('business');
  if (/инвест|девелоп|investment|development/i.test(lower)) cats.add('investment');

  if (!cats.size && raw) {
    if (/вилл/i.test(lower)) cats.add('villas');
    else if (/апартамент/i.test(lower)) cats.add('apartments');
  }

  return [...cats];
}

/**
 * @param {string} text — реплики клиента
 * @returns {{ types: string[], hasType: boolean, label: string }}
 */
function detectPropertyTypePreference(text) {
  const lower = String(text || '').toLowerCase();
  const types = new Set();

  const lifePurposeOnly =
    /(?:для\s+)?(?:жизни|себя|семьи|проживания)|переезд|relocate|live\s+in/i.test(lower) &&
    !/апартамент|вилл|земл|коммерч|бизнес|участок|квартир/i.test(lower);

  if (/земл|участок|terreno|\bplot\b|\bland\b/i.test(lower)) types.add('land');
  if (/коммерческ|commercial\s+property|офис|магазин|склад|торгов|помещени|local\s+comercial/i.test(lower)) {
    types.add('commercial');
  }
  if (
    /бизнес\s+на\s+продаж|готовый\s+бизнес|ресторан|бар|кафе|\bотель\b|\bhotel\b|car\s+rental|аренд[аы]\s+авто|negocio/i.test(
      lower
    )
  ) {
    types.add('business');
  }
  if (/девелоп|инвестиционн|development\s+project|investment\s+project/i.test(lower)) {
    types.add('investment');
  }
  if (/апартамент|квартир|apartment|\bflat\b|студи|studio|пентхаус|penthouse/i.test(lower)) {
    types.add('apartments');
  }
  if (/dubai|дубай|dubaj/i.test(lower) && /апартамент|apartment|вилл|villa/i.test(lower)) {
    types.add('apartments');
  }
  if (/вилл|\bvilla\b/i.test(lower)) types.add('villas');
  if (/таунхаус|townhouse|коттедж|частный\s+дом/i.test(lower)) types.add('houses');
  if (!lifePurposeOnly && /\bдом\b/.test(lower) && !types.has('apartments')) types.add('houses');

  const list = [...types];
  const label =
    list.length === 0
      ? ''
      : list.map((t) => TYPE_LABELS.ru[t] || t).join(', ');

  return { types: list, hasType: list.length > 0, label };
}

function getPrimaryPropertyCategory(item) {
  const parts = [item?.overview, item?.overviews?.ru, item?.overviews?.es, item?.overviews?.en];
  for (const ov of parts) {
    const raw = extractPropertyTypeFromOverview(ov);
    if (!raw) continue;
    const first = raw.split(',')[0].trim();
    const cats = new Set();
    const lower = first.toLowerCase();
    if (/апартамент|apartment|dubai/i.test(lower)) cats.add('apartments');
    if (/вилл|\bvillas?\b/i.test(lower)) cats.add('villas');
    if (/\bдом|\bhouses?\b|\bcasas?\b/i.test(lower)) cats.add('houses');
    if (/земл|\bland\b|terreno/i.test(lower)) cats.add('land');
    if (/коммерческ|commercial/i.test(lower)) cats.add('commercial');
    if (/бизнес|business|ресторан|бар|кафе|negocio/i.test(lower)) cats.add('business');
    if (/инвест|девелоп|investment|development/i.test(lower)) cats.add('investment');
    if (cats.size) return [...cats][0];
  }
  const all = getItemPropertyCategories(item);
  return all[0] || null;
}

function itemMatchesPropertyTypes(item, wantedTypes) {
  if (!wantedTypes?.length) return true;
  const itemCats = getItemPropertyCategories(item);
  if (!itemCats.length) return false;

  if (wantedTypes.length === 1) {
    const want = wantedTypes[0];
    if (!itemCats.includes(want)) return false;
    const primary = getPrimaryPropertyCategory(item);
    return !primary || primary === want;
  }

  return wantedTypes.every((t) => itemCats.includes(t));
}

function scorePropertyTypeFit(item, wantedTypes) {
  if (!wantedTypes?.length) return 0;
  const itemCats = getItemPropertyCategories(item);
  if (!itemCats.length) return -8;
  const match = wantedTypes.some((t) => itemCats.includes(t));
  if (match) return 28;
  return -40;
}

function formatPropertyTypeOptions(lang = 'ru') {
  const l = TYPE_OPTIONS_PROMPT[lang] ? lang : 'ru';
  return TYPE_OPTIONS_PROMPT[l];
}

function formatDetectedTypes(types, lang = 'ru') {
  const chain = TYPE_LABELS[lang] ? lang : 'ru';
  return types.map((t) => TYPE_LABELS[chain][t] || t).join(', ');
}

module.exports = {
  TYPE_LABELS,
  TYPE_OPTIONS_PROMPT,
  extractPropertyTypeFromOverview,
  getItemPropertyCategories,
  getPrimaryPropertyCategory,
  detectPropertyTypePreference,
  itemMatchesPropertyTypes,
  scorePropertyTypeFit,
  formatPropertyTypeOptions,
  formatDetectedTypes
};
