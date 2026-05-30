const {
  detectPropertyTypePreference,
  formatPropertyTypeOptions
} = require('./property-types');
const {
  detectRegionPreference,
  REGION_OPTIONS_PROMPT,
  formatRegionLabel
} = require('./catalog-regions');
const {
  analyzePurchaseFinance,
  detectMortgageStepsQuestion,
  getFinanceStageInstruction,
  getMortgageStepsInstruction,
  formatFinanceSummaryForPrompt
} = require('./purchase-finance');
const { normalizeSalesLang, getStageInstruction } = require('./sales-localization');

const LOCATION_KEYWORDS = [
  'las americas',
  'las américas',
  'лас америк',
  'los cristianos',
  'лос кристиан',
  'adeje',
  'адехе',
  'playa de las americas',
  'costa adeje',
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
  'south',
  'юг',
  'north',
  'север',
  'west',
  'запад',
  'tenerife',
  'тенериф'
];

/**
 * @param {Array<{sender:string,text:string}>} history
 * @param {string} [lang]
 */
function analyzeConversation(history, lang = 'ru') {
  const salesLang = normalizeSalesLang(lang);
  const userMsgs = (history || []).filter((m) => m.sender === 'user');
  const allUserText = userMsgs.map((m) => m.text).join('\n');
  const lower = allUserText.toLowerCase();
  const lastUser = userMsgs[userMsgs.length - 1]?.text || '';

  const hasPurpose =
    /инвест|invest|inversi[oó]n|доход|аренд|rental|alquiler|бизнес|business|negocio|для жизни|для себя|переезд|relocate|live in|residen|vivir|para vivir|holiday home|segunda residencia|second home/i.test(
      lower
    );
  const hasBudget =
    /€|eur|euro|евро|бюджет|budget|до\s*\d|от\s*\d|\d{2,3}[\s.]?\d{3}|\d+\s*(тыс|k|млн|million)/i.test(
      lower
    );
  const hasLocation = LOCATION_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
  const regionPref = detectRegionPreference(allUserText, salesLang);
  const hasRegion = regionPref.hasRegion;
  const macroRegions = regionPref.regions;
  const regionLabel = regionPref.label;
  const typePref = detectPropertyTypePreference(allUserText, salesLang);
  const hasType = typePref.hasType;
  const propertyTypes = typePref.types;
  const propertyTypeLabel = typePref.label;
  const wantsListings =
    /покаж|подбер|вариант|объект|каталог|ссылк|show me|send me|options|listings|properties|shortlist|mu[eé]strame|ens[eé]ñame|opciones|fichas|propiedades|selecci[oó]n/i.test(
      lower
    );
  const userTurns = userMsgs.length;

  let stage = 'FIRST_CONTACT';

  const wantsTenerifeArea =
    macroRegions.includes('tenerife') || (!hasRegion && !macroRegions.length);
  const needsTenerifeMicro = wantsTenerifeArea && !hasLocation;

  const readyForListings =
    hasType &&
    hasBudget &&
    (hasRegion || hasLocation) &&
    (!needsTenerifeMicro || hasLocation || !macroRegions.includes('tenerife'));

  if (readyForListings || (wantsListings && hasType && hasBudget && (hasRegion || hasLocation))) {
    stage = 'SHOW_LISTINGS';
  } else if (userTurns <= 1 && !hasPurpose && !hasBudget && !hasLocation && !hasType && !hasRegion) {
    stage = 'FIRST_CONTACT';
  } else if (!hasType) {
    stage = 'NEED_PROPERTY_TYPE';
  } else if (!hasRegion && !hasLocation) {
    stage = 'NEED_REGION';
  } else if (!hasPurpose) {
    stage = 'NEED_PURPOSE';
  } else if (!hasBudget) {
    stage = 'NEED_BUDGET';
  } else if (needsTenerifeMicro) {
    stage = 'NEED_LOCATION';
  } else {
    stage = 'REFINE';
  }

  if (userTurns >= 4 && hasBudget && hasType && (hasRegion || hasLocation)) {
    stage = 'SHOW_LISTINGS';
  }

  const wantsMortgageSteps = detectMortgageStepsQuestion(lastUser || allUserText);

  const finance = analyzePurchaseFinance(history, allUserText, salesLang);
  if (finance.financeStage) {
    stage = finance.financeStage;
  }

  const dialogCtx = { propertyTypeLabel, regionLabel };
  let stageInstruction = finance.financeStage
    ? getFinanceStageInstruction(finance.financeStage, salesLang)
    : getStageInstruction(salesLang, stage, dialogCtx) ||
      resolveStageInstruction(stage, dialogCtx);

  if (wantsMortgageSteps) {
    stageInstruction = `${getMortgageStepsInstruction(salesLang)}\n\n${stageInstruction}`;
  }

  const financeSummaryBlock = formatFinanceSummaryForPrompt(finance, salesLang);

  return {
    userTurns,
    lastUser,
    allUserText,
    hasPurpose,
    hasBudget,
    hasLocation,
    hasRegion,
    macroRegions,
    regionLabel,
    hasType,
    propertyTypes,
    propertyTypeLabel,
    wantsListings,
    regionOptions: REGION_OPTIONS_PROMPT[salesLang] || REGION_OPTIONS_PROMPT.en,
    salesLang,
    stage,
    stageInstruction,
    wantsMortgageSteps,
    propertyTypeOptions: formatPropertyTypeOptions(salesLang),
    ...finance,
    financeSummaryBlock
  };
}

const stageInstructions = {
  FIRST_CONTACT: `Первый контакт. Представься от первого лица: «Меня зовут Максим», консультант House Tenerife — готов помочь с недвижимостью (каталог housetenerife.eu: Тенерифе, Дубай, Ибица, Марбелья, Малага, Барселона и др.). Не называй себя «ботом» или «ИИ». Тёпло, по-человечески. Один вопрос: тип объекта или регион поиска. Объекты НЕ показывай.`,

  NEED_PROPERTY_TYPE: `Тип объекта не ясен — уточни до подборки: апартаменты, вилла, дом, земля, коммерция, бизнес, инвест-проект. Не предполагай виллу. Без ссылок.`,

  NEED_REGION: `Регион не выбран — один вопрос: где ищете — Тенерифе, Дубай, Ибица, Марбелья, Малага, Барселона? Можно кратко перечислить. Не предполагай Тенерифе по умолчанию. Без подборки.`,

  NEED_PURPOSE: `Уточни цель: для себя/семьи или инвестиция/доход? Коротко зачем спрашиваешь. Без объектов.`,

  NEED_BUDGET: `Спроси бюджет в € (ориентиры: до 300k / 300–600k / от 600k). Тип: ${'{propertyTypeLabel}'}, регион: ${'{regionLabel}'}. Без подборки.`,

  NEED_LOCATION: `Уточни район на Тенерифе (Costa Adeje, Los Cristianos, Las Américas, юг/запад и т.д.) — только если клиент выбрал Тенерифе. Один вопрос.`,

  SHOW_LISTINGS: `Покажи 3–5 объектов из каталога: тип ${'{propertyTypeLabel}'}, регион ${'{regionLabel}'}. Не подмешивай другие регионы и типы. Название, цена, ссылка, почему подходит. Не дешевле бюджета без запроса.`,

  REFINE: `Ответь по сути. Подборка: тип ${'{propertyTypeLabel}'}, регион ${'{regionLabel}'}, 3–5 объектов. Если сменили регион или тип — пересобери.`
};

function resolveStageInstruction(stage, dialog) {
  let text = stageInstructions[stage] || stageInstructions.REFINE;
  const typeLabel = dialog.propertyTypeLabel || 'уточняется';
  const regionLabel = dialog.regionLabel || 'уточняется';
  return text
    .replace(/\{propertyTypeLabel\}/g, typeLabel)
    .replace(/\{regionLabel\}/g, regionLabel);
}

function buildCatalogSearchQuery(history) {
  const userTexts = (history || [])
    .filter((m) => m.sender === 'user')
    .map((m) => m.text)
    .join(' ');
  return userTexts.trim();
}

/**
 * @param {string} text
 * @returns {{ minPrice: number|null, maxPrice: number|null }}
 */
function extractBudgetRange(text) {
  const s = String(text || '').toLowerCase().replace(/\s/g, ' ');
  let minPrice = null;
  let maxPrice = null;

  const range = s.match(/от\s*(\d[\d\s.]*)\s*(?:до|–|-)\s*(\d[\d\s.]*)/i);
  if (range) {
    minPrice = parseMoneyToken(range[1]);
    maxPrice = parseMoneyToken(range[2]);
    return { minPrice, maxPrice };
  }

  const upTo = s.match(/(?:до|макс|не\s*более|up\s*to)\s*(\d[\d\s.]*)/i);
  if (upTo) maxPrice = parseMoneyToken(upTo[1]);

  const from = s.match(/(?:от|from|минимум)\s*(\d[\d\s.]*)/i);
  if (from) minPrice = parseMoneyToken(from[1]);

  const plain = s.match(/(\d{2,3})[\s.]?(\d{3})\s*(?:€|eur|евро)?/);
  if (plain && !maxPrice && !minPrice) {
    const mid = parseInt(plain[1] + plain[2], 10);
    minPrice = Math.round(mid * 0.92);
    maxPrice = Math.round(mid * 1.15);
  }

  return { minPrice, maxPrice };
}

/**
 * Целевой коридор цены для подборки: не уводить клиента на сильно дешёвые объекты.
 * @param {{ minPrice: number|null, maxPrice: number|null }} budget
 * @returns {{ anchor: number, floor: number, ceiling: number }|null}
 */
function derivePriceTarget(budget) {
  const { minPrice, maxPrice } = budget || {};
  if (minPrice == null && maxPrice == null) return null;

  let anchor;
  let floor;
  let ceiling;

  if (minPrice != null && maxPrice != null) {
    anchor = Math.round((minPrice + maxPrice) / 2);
    floor = Math.round(minPrice * 0.95);
    ceiling = Math.round(maxPrice * 1.1);
  } else if (maxPrice != null) {
    anchor = maxPrice;
    floor = Math.round(maxPrice * 0.9);
    ceiling = Math.round(maxPrice * 1.12);
  } else {
    anchor = minPrice;
    floor = Math.round(minPrice * 0.95);
    ceiling = Math.round(minPrice * 1.15);
  }

  return { anchor, floor, ceiling };
}

function parseMoneyToken(raw) {
  let n = String(raw || '').replace(/[^\d]/g, '');
  if (!n) return null;
  let v = parseInt(n, 10);
  if (v < 1000) v *= 1000;
  if (v < 50000) v *= 1000;
  return v;
}

module.exports = {
  analyzeConversation,
  buildCatalogSearchQuery,
  extractBudgetRange,
  derivePriceTarget,
  LOCATION_KEYWORDS,
  detectRegionPreference,
  REGION_OPTIONS_PROMPT,
  analyzePurchaseFinance
};
