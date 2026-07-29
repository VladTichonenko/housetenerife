const fs = require('fs');
const path = require('path');
const { derivePriceTarget } = require('./dialog-context');
const {
  itemMatchesMicroAreas,
  scoreMicroAreaFit,
  detectMicroAreas,
  detectItemMicroAreas
} = require('./location-matching');
const {
  getItemPropertyCategories,
  itemMatchesPropertyTypes,
  scorePropertyTypeFit,
  formatDetectedTypes,
  expandSoftPropertyTypes,
  expandLastResortPropertyTypes
} = require('./property-types');
const {
  getPrimaryMacroRegion,
  itemMatchesRegions,
  scoreRegionFit,
  formatRegionLabel
} = require('./catalog-regions');

function resolveCatalogPath() {
  if (process.env.PROPERTIES_PATH) return process.env.PROPERTIES_PATH;
  return path.join(__dirname, 'data', 'properties.json');
}

const DATA = resolveCatalogPath();
const SUPPORTED_LANGS = ['ru', 'en', 'es', 'de', 'fr', 'pl', 'nl'];

let cache = null;
let cacheMtimeMs = 0;

function load() {
  try {
    const st = fs.statSync(DATA);
    if (cache && st.mtimeMs === cacheMtimeMs) return cache;
    cacheMtimeMs = st.mtimeMs;
    const raw = fs.readFileSync(DATA, 'utf8');
    cache = JSON.parse(raw);
  } catch {
    cache = { items: [], syncedAt: null, count: 0 };
    cacheMtimeMs = 0;
  }
  if (!cache.items) cache.items = [];
  cache.items = cache.items.map(normalizeItem);
  return cache;
}

/** Сброс кэша после npm run sync-db при долгоживущем процессе */
function reload() {
  cache = null;
  cacheMtimeMs = 0;
  try {
    require('./property-share').invalidateUrlIndex();
  } catch {
    /* property-share optional at load */
  }
  return load();
}

function extractPropertyId(item) {
  const blob = [item.description, item.overview, item.title].join(' ');
  const m = blob.match(/\bHZ\d+\b/i);
  return m ? m[0].toUpperCase() : null;
}

/** Приводит старые записи (только RU) к мультиязычной структуре */
function normalizeItem(item) {
  if (item.titles && item.descriptions) {
    if (!item.id) item.id = extractPropertyId(item);
    return item;
  }
  const ruUrl = item.url || '';
  return {
    ...item,
    id: extractPropertyId(item),
    urls: item.urls || { ru: ruUrl },
    titles: item.titles || { ru: item.title || '' },
    descriptions: item.descriptions || { ru: item.description || '' },
    overviews: item.overviews || { ru: item.overview || '' }
  };
}

function normalizeLang(lang) {
  const l = String(lang || 'ru').toLowerCase().slice(0, 2);
  return SUPPORTED_LANGS.includes(l) ? l : 'ru';
}

const FALLBACK_CHAIN = {
  ru: ['ru'],
  // У части объектов нет /es/ страницы на сайте — лучше EN, чем RU
  es: ['es', 'en', 'ru'],
  en: ['en', 'es', 'ru'],
  // DE/FR/PL/NL страницы есть на сайте; если в JSON ещё нет — fallback на EN
  de: ['de', 'en', 'es', 'ru'],
  fr: ['fr', 'en', 'es', 'ru'],
  pl: ['pl', 'en', 'es', 'ru'],
  nl: ['nl', 'en', 'es', 'ru']
};

function pickLocalized(map, langChain) {
  if (!map || typeof map !== 'object') return '';
  for (const code of langChain) {
    if (map[code]) return map[code];
  }
  return Object.values(map).find(Boolean) || '';
}

function getLocalizedItem(item, lang) {
  const l = normalizeLang(lang);
  const chain = FALLBACK_CHAIN[l] || ['ru'];
  const url = pickLocalized(item.urls, chain) || item.url || '';
  return {
    ...item,
    url,
    title: pickLocalized(item.titles, chain) || item.title || '',
    description: pickLocalized(item.descriptions, chain) || item.description || '',
    overview: pickLocalized(item.overviews, chain) || item.overview || ''
  };
}

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-zà-ÿа-яё0-9€]+/gi, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function itemSearchBlob(item) {
  const parts = [
    item.title,
    item.description,
    item.overview,
    item.price,
    item.url,
    item.id
  ];
  for (const lang of SUPPORTED_LANGS) {
    parts.push(item.titles?.[lang], item.descriptions?.[lang], item.overviews?.[lang], item.urls?.[lang]);
  }
  return parts.filter(Boolean).join(' ');
}

function parseItemPriceEur(item) {
  const raw = String(item.price || item.overview || '');
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return null;
  let v = parseInt(digits, 10);
  if (!Number.isFinite(v)) return null;
  const lower = raw.toLowerCase();
  if (v < 10000 && /млн|million|millon/i.test(lower)) v *= 1000000;
  else if (v < 10000 && /тыс|\bk\b/i.test(lower)) v *= 1000;
  if (v < 50000) return null;
  return v;
}

function scoreLocation(item, contextText, microDetection) {
  const detection =
    microDetection ||
    (contextText ? detectMicroAreas(contextText) : { groupIds: [], broadIds: [], keywords: [] });
  return scoreMicroAreaFit(item, detection, itemSearchBlob);
}

function scorePriceFit(price, options = {}) {
  if (price == null) return 0;
  const { minPrice, maxPrice, priceTarget } = options;

  if (priceTarget) {
    const { floor, ceiling, anchor } = priceTarget;
    if (price < floor * 0.98) return -30;
    if (price > ceiling * 1.2) return -45;
    if (price > ceiling * 1.12) return -22;
    if (price >= floor && price <= ceiling) return 18;
    if (price > ceiling && price <= Math.round(ceiling * 1.12)) return 10;
    if (price >= Math.round(anchor * 0.92) && price < floor) return -12;
    return -8;
  }

  if (minPrice != null && maxPrice != null) {
    if (price >= minPrice && price <= maxPrice) return 12;
    if (price >= minPrice * 0.95 && price <= maxPrice * 1.1) return 6;
    if (price < minPrice * 0.9) return -20;
    return -4;
  }
  if (maxPrice != null) {
    if (price > maxPrice * 1.12) return -55;
    if (price >= maxPrice * 0.78 && price <= maxPrice * 1.08) return 20;
    if (price < maxPrice * 0.65) return -28;
    if (price <= maxPrice * 1.2) return 4;
    return -8;
  }
  if (minPrice != null) {
    if (price >= minPrice && price <= minPrice * 1.15) return 12;
    if (price < minPrice * 0.92) return -18;
    if (price >= minPrice * 0.95) return 4;
  }
  return 0;
}

function scoreItem(item, tokens, options = {}) {
  const blob = itemSearchBlob(item);
  const hay = tokenize(blob);
  let sc = scoreLocation(item, options.contextText, options.microDetection);

  for (const t of tokens) {
    if (t.length < 2) continue;
    if (blob.toLowerCase().includes(t)) sc += 3;
    for (const h of hay) {
      if (h === t) sc += 2;
      else if (h.includes(t) || t.includes(h)) sc += 1;
    }
  }

  const price = parseItemPriceEur(item);
  if (price != null) sc += scorePriceFit(price, options);

  if (options.propertyTypes?.length) {
    sc += scorePropertyTypeFit(item, options.propertyTypes);
  }

  if (options.macroRegions?.length) {
    sc += scoreRegionFit(item, options.macroRegions);
  }

  return sc;
}

function filterByMacroRegions(ranked, macroRegions) {
  if (!macroRegions?.length) return ranked;
  return ranked.filter((r) => itemMatchesRegions(r.item, macroRegions));
}

function filterByMicroAreas(ranked, microAreaGroupIds) {
  if (!microAreaGroupIds?.length) return ranked;
  // Без тихого fallback на весь остров — иначе Golf del Sur → Adeje
  return ranked.filter((r) =>
    itemMatchesMicroAreas(r.item, microAreaGroupIds, itemSearchBlob)
  );
}

function filterByPropertyTypes(ranked, propertyTypes) {
  if (!propertyTypes?.length) return ranked;
  return ranked.filter((r) => itemMatchesPropertyTypes(r.item, propertyTypes));
}

/**
 * Жёсткий тип → при пустоте мягкий fallback только внутри «семьи».
 * При allowLastResort — крайняя подмена жилья (апартаменты↔дома/виллы), если в регионе 0 точного типа.
 * Никогда не подмешивает бизнес к апартаментам/виллам и наоборот.
 */
function applyPropertyTypeFilter(ranked, propertyTypes, options = {}) {
  if (!propertyTypes?.length) {
    return { ranked, usedSoftFallback: false, usedLastResortTypeFallback: false };
  }
  const exact = filterByPropertyTypes(ranked, propertyTypes);
  if (exact.length) {
    return { ranked: exact, usedSoftFallback: false, usedLastResortTypeFallback: false };
  }

  const softTypes = expandSoftPropertyTypes(propertyTypes);
  if (softTypes.length) {
    const soft = filterByPropertyTypes(ranked, softTypes);
    if (soft.length) {
      return { ranked: soft, usedSoftFallback: true, usedLastResortTypeFallback: false };
    }
  }

  if (options.allowLastResort) {
    const lastTypes = expandLastResortPropertyTypes(propertyTypes);
    if (lastTypes.length) {
      const last = filterByPropertyTypes(ranked, lastTypes);
      if (last.length) {
        return { ranked: last, usedSoftFallback: true, usedLastResortTypeFallback: true };
      }
    }
  }

  return { ranked: [], usedSoftFallback: false, usedLastResortTypeFallback: false };
}

function locationBucketForItem(item) {
  const region = getPrimaryMacroRegion(item) || 'unknown';
  const micro = detectItemMicroAreas(item, itemSearchBlob);
  if (micro.groupIds.length) return `${region}:${micro.groupIds[0]}`;
  return region;
}

/**
 * Подборка из 3 ценовых уровней: дешевле / около бюджета / дороже (если есть).
 * Если кандидатов мало — дополняет ближайшими по цене.
 */
function pickPriceTierListings(ranked, limit, priceTarget) {
  if (!ranked?.length) return [];
  const want = Math.min(Math.max(limit || 3, 3), 5);
  if (!priceTarget?.anchor || ranked.length <= 3) {
    return pickDiverseListings(ranked, want);
  }

  const anchor = priceTarget.anchor;
  const withPrice = ranked
    .map((r) => ({ ...r, price: parseItemPriceEur(r.item) }))
    .filter((r) => r.price != null);
  if (withPrice.length < 3) return pickDiverseListings(ranked, want);

  const cheaper = withPrice
    .filter((r) => r.price < anchor * 0.97)
    .sort((a, b) => b.price - a.price);
  const mid = withPrice
    .filter((r) => r.price >= anchor * 0.97 && r.price <= anchor * 1.08)
    .sort((a, b) => Math.abs(a.price - anchor) - Math.abs(b.price - anchor));
  const dearer = withPrice
    .filter((r) => r.price > anchor * 1.08)
    .sort((a, b) => a.price - b.price);

  const picked = [];
  const seen = new Set();
  const take = (list) => {
    for (const entry of list) {
      const key = entry.item.url || entry.item.id || entry.item.title;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(entry);
      return true;
    }
    return false;
  };

  take(cheaper);
  take(mid.length ? mid : withPrice.sort((a, b) => Math.abs(a.price - anchor) - Math.abs(b.price - anchor)));
  take(dearer);

  // Добить до 3–5 разными районами
  const rest = pickDiverseListings(
    ranked.filter((r) => !seen.has(r.item.url || r.item.id || r.item.title)),
    want
  );
  for (const entry of rest) {
    if (picked.length >= want) break;
    const key = entry.item.url || entry.item.id || entry.item.title;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(entry);
  }

  while (picked.length < Math.min(3, ranked.length)) {
    const next = ranked.find((r) => !seen.has(r.item.url || r.item.id || r.item.title));
    if (!next) break;
    seen.add(next.item.url || next.item.id || next.item.title);
    picked.push(next);
  }

  return picked.slice(0, want);
}

/** Разнообразие: не отдавать 5 объектов из одного района подряд */
function pickDiverseListings(ranked, limit) {
  const poolSize = Math.min(ranked.length, Math.max(limit * 6, 30));
  const pool = ranked.slice(0, poolSize);
  const picked = [];
  const usedBuckets = new Set();

  for (const entry of pool) {
    if (picked.length >= limit) break;
    const bucket = locationBucketForItem(entry.item) || entry.item.url || entry.item.id || '';
    if (bucket && usedBuckets.has(bucket) && picked.length < limit - 1) continue;
    if (bucket) usedBuckets.add(bucket);
    picked.push(entry);
  }

  for (const entry of pool) {
    if (picked.length >= limit) break;
    if (!picked.includes(entry)) picked.push(entry);
  }

  return picked.slice(0, limit);
}

function itemMatchesPriceTarget(item, priceTarget, relax = 0) {
  const p = parseItemPriceEur(item);
  if (p == null) return relax >= 2;
  const { floor, ceiling, anchor, hardMax, hardMin } = priceTarget;
  // Жёсткий потолок/пол — даже при relax не показывать 890к при бюджете «до 400к»
  if (hardMax != null && p > hardMax) return false;
  if (hardMin != null && relax < 2 && p < hardMin * 0.92) return false;

  const minP = Math.round(anchor * (0.88 - relax * 0.06));
  const maxP = Math.round(ceiling * (1.05 + relax * 0.05));
  const lo = Math.min(floor, minP);
  const hi = Math.max(ceiling, maxP);
  return p >= lo && p <= hi;
}

function filterByPriceTarget(ranked, priceTarget) {
  if (!priceTarget) return ranked;
  for (const relax of [0, 1, 2]) {
    const filtered = ranked.filter((r) => itemMatchesPriceTarget(r.item, priceTarget, relax));
    if (filtered.length >= 3) {
      return sortByPriceProximity(filtered, priceTarget.anchor);
    }
    if (filtered.length > 0 && relax === 2) {
      return sortByPriceProximity(filtered, priceTarget.anchor);
    }
  }
  const { hardMin, hardMax, anchor } = priceTarget;
  const hard = ranked.filter((r) => {
    const p = parseItemPriceEur(r.item);
    if (p == null) return false;
    if (hardMax != null && p > hardMax) return false;
    if (hardMin != null && p < hardMin * 0.85) return false;
    return true;
  });
  return sortByPriceProximity(hard.length ? hard : [], anchor);
}

function sortByPriceProximity(ranked, anchor) {
  if (!anchor || !ranked?.length) return ranked;
  return [...ranked].sort((a, b) => {
    const pa = parseItemPriceEur(a.item);
    const pb = parseItemPriceEur(b.item);
    if (pa == null && pb == null) return b.s - a.s;
    if (pa == null) return 1;
    if (pb == null) return -1;
    const da = Math.abs(pa - anchor);
    const db = Math.abs(pb - anchor);
    if (da !== db) return da - db;
    return b.s - a.s;
  });
}

/** Жёсткий отсев по min/max бюджета (после soft priceTarget). */
function filterByHardBudget(ranked, budget) {
  if (!budget) return ranked;
  const { minPrice, maxPrice } = budget;
  if (minPrice == null && maxPrice == null) return ranked;
  const filtered = ranked.filter((r) => {
    const p = parseItemPriceEur(r.item);
    if (p == null) return false;
    if (maxPrice != null && p > maxPrice * 1.12) return false;
    if (minPrice != null && p < minPrice * 0.85) return false;
    return true;
  });
  return filtered.length ? filtered : ranked.filter((r) => {
    // Если совсем пусто — всё равно не отдаём объекты сильно выше max
    const p = parseItemPriceEur(r.item);
    if (p == null) return false;
    if (maxPrice != null && p > maxPrice * 1.12) return false;
    return true;
  });
}

const EMPTY_CATALOG_MSG = {
  ru: 'Локальный каталог пуст. Администратору: npm run sync-db. Пока направляй на https://housetenerife.eu/ru/',
  en: 'Local catalog is empty. Admin: run npm run sync-db. For now direct clients to https://housetenerife.eu/',
  es: 'Catálogo local vacío. Admin: ejecute npm run sync-db. Mientras tanto: https://housetenerife.eu/es/',
  de: 'Lokaler Katalog ist leer. Admin: npm run sync-db. Vorerst: https://housetenerife.eu/de/',
  fr: 'Catalogue local vide. Admin: npm run sync-db. En attendant: https://housetenerife.eu/fr/',
  pl: 'Lokalny katalog jest pusty. Admin: npm run sync-db. Na razie: https://housetenerife.eu/pl/',
  nl: 'Lokale catalogus is leeg. Admin: npm run sync-db. Voorlopig: https://housetenerife.eu/nl/'
};

const NO_MATCH_MSG = {
  ru: 'По этому запросу совпадений нет. Уточни бюджет и район; каталог: https://housetenerife.eu/ru/',
  en: 'No matches for this query. Ask for budget and area; catalog: https://housetenerife.eu/',
  es: 'Sin coincidencias. Pida presupuesto y zona; catálogo: https://housetenerife.eu/es/',
  de: 'Keine Treffer für diese Anfrage. Budget und Zone klären; Katalog: https://housetenerife.eu/de/',
  fr: 'Aucune correspondance. Précisez budget et zone; catalogue: https://housetenerife.eu/fr/',
  pl: 'Brak trafień dla tego zapytania. Uściślij budżet i strefę; katalog: https://housetenerife.eu/pl/',
  nl: 'Geen treffers voor deze zoekopdracht. Budget en zone verduidelijken; catalogus: https://housetenerife.eu/nl/'
};

const PRICE_FALLBACK = {
  ru: 'цена уточняется',
  en: 'price on request',
  es: 'precio a consultar',
  de: 'Preis auf Anfrage',
  fr: 'prix sur demande',
  pl: 'cena do ustalenia',
  nl: 'prijs op aanvraag'
};

/**
 * Подбор объектов из локального JSON для контекста модели.
 * @param {string} query
 * @param {number} limit
 * @param {{ minPrice?: number, maxPrice?: number, lang?: string }} options
 */
function searchForContext(query, limit = 8, options = {}) {
  if (typeof limit === 'object' && limit !== null) {
    options = limit;
    limit = options.limit ?? 8;
  }
  limit = Math.min(25, Math.max(1, parseInt(limit, 10) || 8));

  const lang = normalizeLang(options.lang);
  const data = load();
  const totalInDb = data.items.length;
  if (!totalInDb) {
    return {
      found: false,
      text: EMPTY_CATALOG_MSG[lang] || EMPTY_CATALOG_MSG.ru,
      totalInDb: 0,
      urls: []
    };
  }
  const tokens = tokenize(query);
  const priceTarget =
    options.priceTarget ??
    derivePriceTarget({
      minPrice: options.minPrice ?? null,
      maxPrice: options.maxPrice ?? null
    });
  const propertyTypes = options.propertyTypes ?? [];
  const macroRegions = options.macroRegions ?? [];
  const microAreaGroupIds = options.microAreaGroupIds ?? [];
  const microDetection =
    options.microDetection ||
    detectMicroAreas(options.contextText || query || '', lang);
  const scoreOpts = {
    minPrice: options.minPrice ?? null,
    maxPrice: options.maxPrice ?? null,
    priceTarget,
    propertyTypes,
    macroRegions,
    microDetection,
    contextText: options.contextText || query || ''
  };

  let ranked = data.items.map((item) => ({ item, s: scoreItem(item, tokens, scoreOpts) }));
  let usedAreaFallback = false;
  let usedBudgetFallback = false;

  if (!tokens.length && (scoreOpts.minPrice || scoreOpts.maxPrice || priceTarget)) {
    ranked = ranked.filter((x) => x.s > 0);
  } else if (tokens.length) {
    const withScore = ranked.filter((x) => x.s > 0);
    if (withScore.length) ranked = withScore;
    else if (priceTarget || scoreOpts.minPrice || scoreOpts.maxPrice) {
      ranked = filterByPriceTarget(ranked, priceTarget || derivePriceTarget(scoreOpts));
      if (!ranked.length) {
        ranked = data.items.map((item) => ({ item, s: scoreItem(item, tokens, scoreOpts) }));
      }
    }
  } else {
    ranked = data.items
      .map((item) => ({ item, s: scoreItem(item, tokens, scoreOpts) }))
      .filter((x) => x.s > -15);
  }

  ranked = ranked.sort((a, b) => b.s - a.s);

  // Сначала регион, потом тип: точное совпадение типа обязательно, если есть;
  // пустой тип в регионе → мягкий fallback только внутри семьи (жильё↔жильё).
  if (macroRegions.length) {
    const regional = filterByMacroRegions(ranked, macroRegions);
    ranked = regional;
  }

  let usedSoftTypeFallback = false;
  let usedLastResortTypeFallback = false;
  const allowLastResortType =
    Boolean(options.allowBudgetFallback) || Boolean(options.allowTypeFamilyFallback);
  if (propertyTypes.length) {
    const typed = applyPropertyTypeFilter(ranked, propertyTypes, {
      allowLastResort: allowLastResortType
    });
    ranked = typed.ranked;
    usedSoftTypeFallback = typed.usedSoftFallback;
    usedLastResortTypeFallback = typed.usedLastResortTypeFallback;
  }

  if (microAreaGroupIds.length) {
    const regionalTypePool = ranked;
    const exactArea = filterByMicroAreas(ranked, microAreaGroupIds);
    if (exactArea.length) {
      ranked = exactArea;
    } else if (
      macroRegions.length &&
      !macroRegions.includes('tenerife') &&
      regionalTypePool.length
    ) {
      // Для небольших региональных выборок (Ibiza и др.) лучше показать
      // соседние зоны того же региона, чем оставить клиента без карточек.
      ranked = regionalTypePool;
      usedAreaFallback = true;
    } else {
      ranked = exactArea;
    }
    // После района тип мог «размыться» через soft micro fallback — снова зафиксировать тип
    if (propertyTypes.length && ranked.length) {
      const typedAgain = applyPropertyTypeFilter(ranked, propertyTypes, {
        allowLastResort: allowLastResortType
      });
      if (typedAgain.ranked.length) {
        ranked = typedAgain.ranked;
        usedSoftTypeFallback = usedSoftTypeFallback || typedAgain.usedSoftFallback;
        usedLastResortTypeFallback =
          usedLastResortTypeFallback || typedAgain.usedLastResortTypeFallback;
      }
    }
  }

  const budgetFallbackPool = ranked.slice();
  if (priceTarget) {
    const priceFiltered = filterByPriceTarget(ranked, priceTarget);
    if (priceFiltered.length) ranked = priceFiltered;
  }

  // Жёсткий потолок бюджета (AI/score не должны протаскивать 890к при «до 400к»)
  const hardBudget = {
    minPrice: options.minPrice ?? null,
    maxPrice: options.maxPrice ?? null
  };
  if (hardBudget.minPrice != null || hardBudget.maxPrice != null) {
    const withinBudget = filterByHardBudget(ranked, hardBudget);
    if (withinBudget.length) {
      ranked = withinBudget;
    } else if (options.allowBudgetFallback && budgetFallbackPool.length) {
      // Нет карточек в бюджете: сохраняем регион и тип, показываем ближайшие
      // реальные варианты и явно сообщаем модели о превышении бюджета.
      ranked = sortByPriceProximity(budgetFallbackPool, priceTarget?.anchor);
      usedBudgetFallback = true;
    } else {
      ranked = [];
    }
  }

  ranked = pickPriceTierListings(ranked, limit, priceTarget);

  if (!ranked.length) {
    ranked = data.items
      .map((item) => ({ item, s: scoreItem(item, tokens, scoreOpts) }))
      .sort((a, b) => b.s - a.s);
    if (macroRegions.length) {
      const regional = filterByMacroRegions(ranked, macroRegions);
      ranked = regional;
    }
    if (propertyTypes.length) {
      const typed = applyPropertyTypeFilter(ranked, propertyTypes, {
        allowLastResort: allowLastResortType
      });
      ranked = typed.ranked;
      usedSoftTypeFallback = typed.usedSoftFallback;
      usedLastResortTypeFallback = typed.usedLastResortTypeFallback;
    }
    if (microAreaGroupIds.length) {
      const regionalTypePool = ranked;
      const exactArea = filterByMicroAreas(ranked, microAreaGroupIds);
      if (exactArea.length) {
        ranked = exactArea;
      } else if (
        macroRegions.length &&
        !macroRegions.includes('tenerife') &&
        regionalTypePool.length
      ) {
        ranked = regionalTypePool;
        usedAreaFallback = true;
      } else {
        ranked = exactArea;
      }
    }
    if (propertyTypes.length && ranked.length) {
      const typedAgain = applyPropertyTypeFilter(ranked, propertyTypes, {
        allowLastResort: allowLastResortType
      });
      if (typedAgain.ranked.length) {
        ranked = typedAgain.ranked;
        usedSoftTypeFallback = usedSoftTypeFallback || typedAgain.usedSoftFallback;
        usedLastResortTypeFallback =
          usedLastResortTypeFallback || typedAgain.usedLastResortTypeFallback;
      }
    }
    if (priceTarget) {
      const priceFiltered = filterByPriceTarget(ranked, priceTarget);
      if (priceFiltered.length) ranked = priceFiltered;
    }
    if (hardBudget.minPrice != null || hardBudget.maxPrice != null) {
      const beforeBudget = ranked.slice();
      const withinBudget = filterByHardBudget(ranked, hardBudget);
      if (withinBudget.length) {
        ranked = withinBudget;
      } else if (options.allowBudgetFallback && beforeBudget.length) {
        ranked = sortByPriceProximity(beforeBudget, priceTarget?.anchor);
        usedBudgetFallback = true;
      } else {
        ranked = [];
      }
    }
    ranked = ranked.slice(0, Math.max(limit, 1));
  }

  if (!ranked.length) {
    return { found: false, text: NO_MATCH_MSG[lang] || NO_MATCH_MSG.ru, totalInDb, urls: [] };
  }
  let lines;
  const shareUrls = [];
  const { getShareUrl } = require('./property-share');
  try {
    lines = ranked.map((r, i) => {
      const loc = getLocalizedItem(r.item, lang);
      const desc = (loc.description || '').replace(/\s+/g, ' ').trim();
      const short = desc.length > 240 ? `${desc.slice(0, 240)}…` : desc;
      const priceLabel = loc.price || PRICE_FALLBACK[lang] || PRICE_FALLBACK.ru;
      const shareUrl = getShareUrl(r.item, lang);
      if (shareUrl) shareUrls.push(shareUrl);
      const typeCats = getItemPropertyCategories(r.item);
      const typeNote = typeCats.length ? ` [${formatDetectedTypes(typeCats, lang)}]` : '';
      const regionId = getPrimaryMacroRegion(r.item);
      const regionNote = regionId ? ` · ${formatRegionLabel([regionId], lang)}` : '';
      return `${i + 1}. ${loc.title} — ${priceLabel}${typeNote}${regionNote}\n   ${shareUrl}\n   ${short}`;
    });
  } catch (e) {
    console.warn('⚠️ searchForContext format:', e.message);
    return { found: false, text: NO_MATCH_MSG[lang] || NO_MATCH_MSG.ru, totalInDb, urls: [] };
  }
  const priceHint =
    priceTarget && lang === 'en'
      ? ` Price band ~€${priceTarget.floor.toLocaleString('en-US')}–€${priceTarget.ceiling.toLocaleString('en-US')} (do not suggest much cheaper).`
      : priceTarget && lang === 'es'
        ? ` Rango ~€${priceTarget.floor.toLocaleString('en-US')}–€${priceTarget.ceiling.toLocaleString('en-US')} (no ofrezcas mucho más barato).`
        : priceTarget && lang === 'de'
          ? ` Preiskorridor ~€${priceTarget.floor.toLocaleString('en-US')}–€${priceTarget.ceiling.toLocaleString('en-US')} (nicht deutlich günstiger vorschlagen).`
          : priceTarget && lang === 'fr'
            ? ` Fourchette ~€${priceTarget.floor.toLocaleString('en-US')}–€${priceTarget.ceiling.toLocaleString('en-US')} (ne pas proposer nettement moins cher).`
            : priceTarget && lang === 'pl'
              ? ` Przedział ~€${priceTarget.floor.toLocaleString('en-US')}–€${priceTarget.ceiling.toLocaleString('en-US')} (nie proponuj dużo taniej).`
              : priceTarget && lang === 'nl'
                ? ` Prijsband ~€${priceTarget.floor.toLocaleString('en-US')}–€${priceTarget.ceiling.toLocaleString('en-US')} (niet veel goedkoper voorstellen).`
                : priceTarget
                  ? ` Коридор цены ~€${priceTarget.floor.toLocaleString('en-US')}–€${priceTarget.ceiling.toLocaleString('en-US')} (не предлагай сильно дешевле).`
                  : '';

  const typeHint =
    usedLastResortTypeFallback && lang === 'en'
      ? ' IMPORTANT: no exact property type in this region — showing nearest residential alternatives WITH catalog URLs. Say honestly that exact type is unavailable.'
      : usedLastResortTypeFallback && lang === 'es'
        ? ' IMPORTANTE: no hay el tipo exacto en esta región — alternativas residenciales cercanas CON enlaces del catálogo. Di con claridad que el tipo exacto no está disponible.'
        : usedLastResortTypeFallback && lang === 'de'
          ? ' WICHTIG: exakter Typ in dieser Region fehlt — nächste Wohn-Alternativen MIT Katalog-URLs. Klar sagen, dass der exakte Typ fehlt.'
          : usedLastResortTypeFallback && lang === 'fr'
            ? ' IMPORTANT: pas le type exact dans cette région — alternatives résidentielles proches AVEC URLs catalogue. Dire clairement que le type exact manque.'
            : usedLastResortTypeFallback && lang === 'pl'
              ? ' WAŻNE: brak dokładnego typu w regionie — najbliższe alternatywy mieszkaniowe Z URL katalogu. Jasno powiedz, że dokładnego typu brak.'
              : usedLastResortTypeFallback && lang === 'nl'
                ? ' BELANGRIJK: geen exact type in deze regio — dichtstbijzijnde woonalternatieven MET catalogus-URL’s. Zeg eerlijk dat het exacte type ontbreekt.'
                : usedLastResortTypeFallback
                  ? ' ВАЖНО: в этом регионе нет объектов нужного типа — ниже ближайшее жильё того же региона со ссылками из каталога. Честно скажи, что точного типа сейчас нет.'
                  : usedSoftTypeFallback && lang === 'en'
                    ? ' NOTE: exact type scarce here — close residential alternatives only (never mix business into homes). Tell the client briefly.'
                    : usedSoftTypeFallback && lang === 'es'
                      ? ' NOTA: poco stock del tipo exacto — solo alternativas residenciales cercanas (nunca mezclar negocio con vivienda). Dilo brevemente.'
                      : usedSoftTypeFallback && lang === 'de'
                        ? ' HINWEIS: wenig exakter Typ — nur nahe Wohn-Alternativen (nie Business unter Wohnungen mischen). Kurz erwähnen.'
                        : usedSoftTypeFallback && lang === 'fr'
                          ? ' NOTE: peu de stock du type exact — seulement alternatives résidentielles proches (jamais mélanger business et logement). À dire brièvement.'
                          : usedSoftTypeFallback && lang === 'pl'
                            ? ' UWAGA: mało dokładnego typu — tylko bliskie alternatywy mieszkaniowe (nigdy nie mieszaj biznesu z mieszkaniami). Krótko powiedz klientowi.'
                            : usedSoftTypeFallback && lang === 'nl'
                              ? ' LET OP: weinig exact type — alleen nabije woonalternatieven (nooit business met woningen mengen). Kort vermelden.'
                              : usedSoftTypeFallback
                                ? ' ВАЖНО: точного типа в зоне мало — только близкие жилые альтернативы (никогда не подмешивай бизнес к апартаментам/виллам). Кратко скажи клиенту.'
                                : '';

  const budgetFallbackHints = {
    ru: ' ВАЖНО: в этом бюджете нет объектов нужного типа и региона; ниже ближайшие доступные. Прямо скажи, что они выше бюджета.',
    en: ' IMPORTANT: no same-type listings in this region fit the budget; these are the nearest available. Clearly say they are over budget.',
    es: ' IMPORTANTE: no hay opciones del mismo tipo y región dentro del presupuesto; estas son las más cercanas. Indica claramente que superan el presupuesto.',
    de: ' WICHTIG: Keine passenden Objekte dieses Typs in der Region liegen im Budget; dies sind die nächstgelegenen. Budgetüberschreitung klar nennen.',
    fr: ' IMPORTANT : aucun bien de ce type dans cette région ne respecte le budget ; voici les plus proches. Indiquer clairement le dépassement.',
    pl: ' WAŻNE: brak ofert tego typu w regionie w podanym budżecie; to najbliższe dostępne opcje. Wyraźnie zaznacz przekroczenie budżetu.',
    nl: ' BELANGRIJK: geen objecten van dit type in deze regio passen binnen het budget; dit zijn de dichtstbijzijnde. Benoem duidelijk de overschrijding.'
  };
  const areaFallbackHints = {
    ru: ' В точной зоне мало предложений; показаны соседние районы только того же региона.',
    en: ' Exact-area stock is scarce; nearby areas in the same region are shown.',
    es: ' La zona exacta tiene poca oferta; se muestran zonas cercanas dentro de la misma región.',
    de: ' In der exakten Zone gibt es wenig Angebot; gezeigt werden nahe Zonen derselben Region.',
    fr: ' Peu de biens dans la zone exacte ; les zones voisines de la même région sont affichées.',
    pl: ' W dokładnej strefie jest mało ofert; pokazano pobliskie strefy tego samego regionu.',
    nl: ' In de exacte zone is weinig aanbod; nabije zones binnen dezelfde regio worden getoond.'
  };
  const fallbackHint = usedBudgetFallback ? budgetFallbackHints[lang] || budgetFallbackHints.ru : '';
  const areaHint = usedAreaFallback ? areaFallbackHints[lang] || areaFallbackHints.ru : '';

  const header =
    lang === 'en'
      ? `[Full catalog: ${totalInDb} listings; search picked ${lines.length} diverse matches below — use only these URLs.${priceHint}${typeHint}${fallbackHint}${areaHint}]`
      : lang === 'es'
        ? `[Catálogo completo: ${totalInDb} anuncios; abajo ${lines.length} opciones variadas — solo estos enlaces.${priceHint}${typeHint}${fallbackHint}${areaHint}]`
        : lang === 'de'
          ? `[Vollständiger Katalog: ${totalInDb} Objekte; unten ${lines.length} passende Varianten — nur diese URLs verwenden.${priceHint}${typeHint}${fallbackHint}${areaHint}]`
          : lang === 'fr'
            ? `[Catalogue complet: ${totalInDb} annonces; ci-dessous ${lines.length} options — utiliser uniquement ces liens.${priceHint}${typeHint}${fallbackHint}${areaHint}]`
            : lang === 'pl'
              ? `[Pełny katalog: ${totalInDb} ofert; poniżej ${lines.length} dopasowanych wariantów — używaj tylko tych URL.${priceHint}${typeHint}${fallbackHint}${areaHint}]`
              : lang === 'nl'
                ? `[Volledige catalogus: ${totalInDb} objecten; hieronder ${lines.length} passende opties — gebruik alleen deze URL’s.${priceHint}${typeHint}${fallbackHint}${areaHint}]`
                : `[Полный каталог: ${totalInDb} объектов; ниже ${lines.length} разных вариантов по запросу — другие ссылки не выдумывай.${priceHint}${typeHint}${fallbackHint}${areaHint}]`;

  return {
    found: true,
    text: `${header}\n\n${lines.join('\n\n')}`,
    syncedAt: data.syncedAt || null,
    totalInDb,
    urls: shareUrls,
    usedBudgetFallback,
    usedAreaFallback,
    usedSoftTypeFallback,
    usedLastResortTypeFallback
  };
}

function cleanDescription(s) {
  let d = String(s || '').replace(/\s+/g, ' ').trim();
  const cut = d.search(/\bDetails\b|\t{3,}/i);
  if (cut > 80) d = d.slice(0, cut).trim();
  if (d.length > 320) d = `${d.slice(0, 320)}…`;
  return d;
}

function extractPropertyType(overview) {
  const { extractPropertyTypeFromOverview } = require('./property-types');
  return extractPropertyTypeFromOverview(overview);
}

/**
 * Список объектов для админ-панели (поиск + пагинация).
 */
function listProperties({ q = '', page = 1, limit = 24, lang = 'ru' } = {}) {
  const data = load();
  const items = data.items || [];
  const query = String(q || '').trim().toLowerCase();
  let filtered = items;

  if (query) {
    const tokens = tokenize(query);
    filtered = items
      .map((item) => ({ item, s: scoreItem(item, tokens) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.item);
    if (!filtered.length) {
      filtered = items.filter((item) => itemSearchBlob(item).toLowerCase().includes(query));
    }
  } else {
    filtered = [...items].sort((a, b) =>
      String(a.title || '').localeCompare(String(b.title || ''), 'ru')
    );
  }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 24, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const currentPage = Math.min(safePage, totalPages);
  const start = (currentPage - 1) * safeLimit;
  const slice = filtered.slice(start, start + safeLimit);
  const l = normalizeLang(lang);

  return {
    items: slice.map((item) => {
      const loc = getLocalizedItem(item, l);
      return {
        id: item.id,
        url: loc.url,
        title: loc.title || 'Без названия',
        price: loc.price || null,
        overview: loc.overview || null,
        propertyType: extractPropertyType(loc.overview),
        description: cleanDescription(loc.description)
      };
    }),
    total,
    page: currentPage,
    limit: safeLimit,
    totalPages,
    syncedAt: data.syncedAt || null,
    source: data.source || null,
    countInDb: data.count ?? items.length
  };
}

function getCatalogSiteUrl(lang) {
  const l = normalizeLang(lang);
  if (l === 'es') return 'https://housetenerife.eu/es/';
  if (l === 'en') return 'https://housetenerife.eu/';
  if (l === 'de') return 'https://housetenerife.eu/de/';
  if (l === 'fr') return 'https://housetenerife.eu/fr/';
  if (l === 'pl') return 'https://housetenerife.eu/pl/';
  if (l === 'nl') return 'https://housetenerife.eu/nl/';
  return 'https://housetenerife.eu/ru/';
}

module.exports = {
  load,
  reload,
  searchForContext,
  listProperties,
  getLocalizedItem,
  normalizeItem,
  normalizeLang,
  getCatalogSiteUrl,
  cleanDescription,
  parseItemPriceEur,
  SUPPORTED_LANGS
};
