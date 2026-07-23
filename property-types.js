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
  },
  de: {
    apartments: 'Apartments / Wohnungen',
    villas: 'Villen',
    houses: 'Häuser / Reihenhäuser',
    land: 'Grundstücke',
    commercial: 'Gewerbeimmobilien',
    business: 'Business zum Verkauf',
    investment: 'Investment- / Entwicklungsprojekte'
  },
  fr: {
    apartments: 'appartements',
    villas: 'villas',
    houses: 'maisons / townhouses',
    land: 'terrains',
    commercial: 'immobilier commercial',
    business: 'business à vendre',
    investment: 'projets d’investissement'
  },
  pl: {
    apartments: 'apartamenty / mieszkania',
    villas: 'wille',
    houses: 'domy / szeregowce',
    land: 'działki / grunty',
    commercial: 'nieruchomości komercyjne',
    business: 'biznes na sprzedaż',
    investment: 'projekty inwestycyjne / deweloperskie'
  },
  nl: {
    apartments: 'appartementen',
    villas: 'villa’s',
    houses: 'huizen / townhouses',
    land: 'grond / kavels',
    commercial: 'commercieel vastgoed',
    business: 'business te koop',
    investment: 'investerings- / ontwikkelingsprojecten'
  }
};

/** Порядок вопроса клиенту (не «только виллы») */
const TYPE_OPTIONS_PROMPT = {
  ru: 'апартаменты, вилла, дом, земля, коммерция, готовый бизнес, инвест-проект',
  en: 'apartments, villa, house, land, commercial, business, investment project',
  es: 'apartamentos, villa, casa, terreno, comercial, negocio, proyecto de inversión',
  de: 'Apartment, Villa, Haus, Grundstück, Gewerbe, Business, Investitionsprojekt',
  fr: 'appartement, villa, maison, terrain, commercial, business, projet d’investissement',
  pl: 'apartament, willa, dom, działka, lokal, biznes, projekt inwestycyjny',
  nl: 'appartement, villa, huis, grond, commercieel, business, investeringsproject'
};

/** Если точного типа нет в зоне — мягкий fallback только внутри «семьи» (не бизнес↔жильё). */
const SOFT_TYPE_FALLBACK = {
  apartments: ['houses'],
  houses: ['apartments', 'villas'],
  villas: ['houses'],
  land: ['investment'],
  commercial: ['business'],
  business: ['commercial'],
  investment: ['land']
};

function extractPropertyTypeFromOverview(overview) {
  const m = String(overview || '').match(/Property type\s*\|\s*([^|]+)/i);
  return m ? m[1].trim() : '';
}

/**
 * Разбор одной метки «Property type | …» → категории.
 * Порядок важен: первая метка = primary.
 */
function categoriesFromTypeLabel(label) {
  const lower = String(label || '').toLowerCase();
  if (!lower.trim()) return [];
  const cats = [];
  const add = (id) => {
    if (!cats.includes(id)) cats.push(id);
  };

  // Явные составные / каталожные формулировки
  if (/апартамент|apartments?|apartamentos?|appartement|wohnung|pisos?|flats?|mieszkan|apartament|пентхаус|penthouse|студи|studio/i.test(lower)) {
    add('apartments');
  }
  if (/вилл|villas?|villen?|will[aeiyę]/i.test(lower)) add('villas');
  if (
    /таунхаус|townhouse|reihenhaus|коттедж|дома\b|\bhouses?\b|\bcasas?\b|\bhäuser\b|\bhauser\b|\bmaisons?\b|\bdomy?\b|\bhuizen?\b/i.test(
      lower
    )
  ) {
    add('houses');
  }
  if (/земл|\bland\b|terreno|grundstück|grundstuck|terrain|участк|działk|dzialk|kavel|\bgrond\b/i.test(lower)) add('land');
  if (
    /коммерческ|commercial\s+propert|inmuebles?\s+comercial|gewerbeimmobil|immobilier\s+commercial|local\s+comercial|nieruchomośc[iy]?\s+komerc|commercieel\s+vastgoed/i.test(
      lower
    )
  ) {
    add('commercial');
  }
  if (
    /бизнес\s+на\s+продаж|business\s+for\s+sale|negocio\s+en\s+venta|ресторан|бар(?:ы|а|ов)?|кафе|\bотел|\bhotel|car\s+rental|аренд[аы]\s+авто|fonds\s+de\s+commerce|geschäft\s+zu\s+verkaufen|biznes\s+na\s+sprzedaż|business\s+te\s+koop/i.test(
      lower
    )
  ) {
    add('business');
  }
  if (/инвест|девелоп|investment|development|anlageprojekt|projet\s+d.?investissement|projekt\s+inwestycyj|investeringsproject/i.test(lower)) {
    add('investment');
  }

  return cats;
}

function collectOverviews(item) {
  const parts = [item?.overview];
  for (const lang of ['ru', 'es', 'en', 'de', 'fr', 'pl', 'nl']) {
    parts.push(item?.overviews?.[lang]);
  }
  return parts.filter(Boolean);
}

/**
 * Категории объекта: сначала поле Property type (надёжно), иначе эвристика по тексту.
 * При рассинхроне языков (RU=Apartments, ES=Villas на разных объектах) — доверяем URL/EN/RU.
 * @returns {string[]}
 */
function getItemPropertyCategories(item) {
  const labelsByLang = {};
  for (const lang of ['ru', 'en', 'es', 'de', 'fr', 'pl', 'nl']) {
    const ov =
      item?.overviews?.[lang] ||
      (lang === 'ru' ? item?.overview : '') ||
      '';
    const label = extractPropertyTypeFromOverview(ov);
    if (!label) continue;
    labelsByLang[lang] = categoriesFromTypeLabel(label);
  }

  const fromLabels = [];
  for (const cats of Object.values(labelsByLang)) {
    for (const c of cats) {
      if (!fromLabels.includes(c)) fromLabels.push(c);
    }
  }

  if (fromLabels.length) {
    // Конфликт склейки WPML: в разных языках разные типы жилья (не составная метка)
    const residential = ['apartments', 'villas', 'houses'];
    const primaries = Object.values(labelsByLang)
      .map((cats) => cats.find((c) => residential.includes(c)))
      .filter(Boolean);
    const uniquePrimary = [...new Set(primaries)];
    const compoundInAny = Object.values(labelsByLang).some((cats) => cats.length > 1);

    if (uniquePrimary.length > 1 && !compoundInAny) {
      const urlTitle = [
        item?.url,
        item?.urls?.ru,
        item?.urls?.en,
        item?.titles?.ru,
        item?.titles?.en,
        item?.title
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (/apartment|apartament|apartamento|piso|flat|квартир|апартамент|wohnung|appartement/i.test(urlTitle)) {
        return ['apartments'];
      }
      if (/villa|вилл/i.test(urlTitle)) return ['villas'];
      if (/townhouse|таунхаус|house|casa|дом/i.test(urlTitle)) return ['houses'];
      // Иначе берём RU/EN метку
      const preferred =
        labelsByLang.ru?.[0] || labelsByLang.en?.[0] || uniquePrimary[0];
      return preferred ? [preferred] : fromLabels.slice(0, 1);
    }

    // Houzez иногда помечает таунхаусы как «Апартаменты»
    const titleBlob = [item?.title, item?.titles?.ru, item?.titles?.en, item?.titles?.es]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (/таунхаус|townhouses?|reihenhaus/i.test(titleBlob)) {
      const corrected = fromLabels.filter((c) => c !== 'apartments');
      if (!corrected.includes('houses')) corrected.unshift('houses');
      return corrected.length ? corrected : ['houses'];
    }
    return fromLabels;
  }

  // Fallback: заголовок + описание (без слова business/commerce в свободном тексте — слишком шумно)
  const blob = [
    item?.title,
    item?.titles?.ru,
    item?.titles?.en,
    item?.titles?.es,
    item?.description,
    item?.descriptions?.ru,
    ...collectOverviews(item)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const cats = [];
  const add = (id) => {
    if (!cats.includes(id)) cats.push(id);
  };

  if (/апартамент|\bapartments?\b|apartamentos?|appartement|\bwohnung|\bpisos?\b|\bflats?\b|пентхаус|penthouse/i.test(blob)) {
    add('apartments');
  }
  if (/\bвилл|\bvillas?\b|\bvillen?\b/i.test(blob)) add('villas');
  if (/таунхаус|townhouse|reihenhaus|коттедж|(?:^|[^а-яё])дом(?:а|у|ом|е)?(?:[^а-яё]|$)/i.test(blob)) {
    add('houses');
  }
  if (/участ[ое]к|\bземл|\bplot\b|\bland\b|terreno|grundstück/i.test(blob)) add('land');
  if (/ресторан|бар\b|кафе|готовый\s+бизнес|бизнес\s+на\s+продаж|negocio\s+en\s+venta|business\s+for\s+sale/i.test(blob)) {
    add('business');
  }
  if (/коммерческ|commercial\s+propert|local\s+comercial/i.test(blob)) add('commercial');
  if (/инвест(?:иционн|ировать)|девелоп|development\s+project/i.test(blob)) add('investment');

  return cats;
}

/**
 * @param {string} text — реплики клиента
 * @returns {{ types: string[], hasType: boolean, label: string }}
 */
function detectPropertyTypePreference(text, lang = 'ru') {
  const lower = String(text || '').toLowerCase();
  const types = new Set();

  const lifePurposeOnly =
    /(?:для\s+)?(?:жизни|себя|семьи|проживания)|переезд|relocate|live\s+in|para\s+vivir|wohnen|habiter/i.test(
      lower
    ) &&
    !/апартамент|\bapartments?\b|apartament|квартир|\bpisos?\b|вилл|\bvillas?\b|земл|коммерч|бизнес|участок|\bcasas?\b|wohnung|appartement|mieszkan|woning/i.test(
      lower
    );

  if (/земл|участок|terreno|\bplot\b|\bland\b|grundstück|grundstuck|terrain|działk|dzialk|kavel|\bgrond\b/i.test(lower)) {
    types.add('land');
  }
  if (
    /коммерческ|commercial\s+property|офис|магазин|склад|торгов|помещени|local\s+comercial|gewerbeimmobil|komerc|commercieel/i.test(
      lower
    )
  ) {
    types.add('commercial');
  }
  if (
    /бизнес\s+на\s+продаж|готовый\s+бизнес|ресторан|бар|кафе|\bотель\b|\bhotel\b|car\s+rental|аренд[аы]\s+авто|negocio\s+en\s+venta|business\s+for\s+sale|geschäft\s+zu\s+verkaufen|fonds\s+de\s+commerce|biznes\s+na\s+sprzedaż|business\s+te\s+koop/i.test(
      lower
    )
  ) {
    types.add('business');
  }
  if (
    /девелоп|инвестиционн(?:ый|ые|ых)?\s+проект|development\s+project|investment\s+project|anlageprojekt|projet\s+d.?investissement|projekt\s+inwestycyj|investeringsproject/i.test(
      lower
    )
  ) {
    types.add('investment');
  }

  // EN apartment(s) ≠ ES apartamento — оба варианта
  if (
    /апартамент|квартир|\bapartments?\b|apartamentos?|apartament|appartement|\bwohnung|\bpisos?\b|\bflats?\b|студи|studio|пентхаус|penthouse|mieszkan|woning/i.test(
      lower
    )
  ) {
    types.add('apartments');
  }
  if (/вилл|\bvillas?\b|\bvillen?\b|will[aeiyę]/i.test(lower)) types.add('villas');
  if (
    /таунхаус|townhouse|коттедж|частный\s+дом|\bcasas?\b|\bhäuser\b|\bhauser\b|\bmaisons?\b|reihenhaus|\bdomy?\b|\bhuizen?\b/i.test(
      lower
    )
  ) {
    types.add('houses');
  }
  if (!lifePurposeOnly && /\bдом\b/.test(lower) && !types.has('apartments')) {
    types.add('houses');
  }

  // Не смешивать жильё и бизнес в одном запросе без явного «и»
  if (types.has('apartments') || types.has('villas') || types.has('houses')) {
    if (!/и\s+(бизнес|ресторан)|plus\s+business|and\s+business|und\s+business/i.test(lower)) {
      types.delete('business');
      types.delete('commercial');
    }
  }

  const list = [...types];
  const chain = TYPE_LABELS[lang] ? lang : 'ru';
  const label = list.length === 0 ? '' : formatDetectedTypes(list, chain);

  return { types: list, hasType: list.length > 0, label };
}

function getPrimaryPropertyCategory(item) {
  // Единый путь с getItemPropertyCategories (в т.ч. коррекция таунхаусов)
  const all = getItemPropertyCategories(item);
  if (all.length) return all[0];
  return null;
}

function itemMatchesPropertyTypes(item, wantedTypes) {
  if (!wantedTypes?.length) return true;
  const itemCats = getItemPropertyCategories(item);
  if (!itemCats.length) return false;

  if (wantedTypes.length === 1) {
    const want = wantedTypes[0];
    if (!itemCats.includes(want)) return false;
    const primary = getPrimaryPropertyCategory(item);
    // Primary должен совпадать; исключает «Апартаменты, Виллы» когда primary=апартаменты — ок,
    // но если primary=вилла при запросе апартаментов — отсекаем.
    if (primary && primary !== want) return false;
    return true;
  }

  return wantedTypes.every((t) => itemCats.includes(t));
}

function scorePropertyTypeFit(item, wantedTypes) {
  if (!wantedTypes?.length) return 0;
  const itemCats = getItemPropertyCategories(item);
  if (!itemCats.length) return -8;
  const primary = getPrimaryPropertyCategory(item);
  if (wantedTypes.includes(primary)) return 36;
  if (wantedTypes.some((t) => itemCats.includes(t))) return 18;
  // Чужой тип (вилла при запросе апартаментов / бизнес при жилье) — сильный штраф
  return -55;
}

/**
 * Мягкие типы-замены, если точных совпадений в выборке нет.
 * Жильё никогда не подменяется бизнесом и наоборот.
 */
function expandSoftPropertyTypes(wantedTypes) {
  if (!wantedTypes?.length) return [];
  const out = new Set();
  for (const t of wantedTypes) {
    for (const s of SOFT_TYPE_FALLBACK[t] || []) out.add(s);
  }
  // Убрать пересечение с уже запрошенным
  for (const t of wantedTypes) out.delete(t);
  return [...out];
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
  SOFT_TYPE_FALLBACK,
  extractPropertyTypeFromOverview,
  getItemPropertyCategories,
  getPrimaryPropertyCategory,
  detectPropertyTypePreference,
  itemMatchesPropertyTypes,
  scorePropertyTypeFit,
  expandSoftPropertyTypes,
  formatPropertyTypeOptions,
  formatDetectedTypes
};
