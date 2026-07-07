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
  detectMicroAreas,
  LOCATION_KEYWORDS,
  needsMicroAreaSelection,
  getAreaOptionsPrompt,
  filterMicroGroupsForMacro,
} = require('./location-matching');
const {
  analyzePurchaseFinance,
  detectMortgageStepsQuestion,
  getFinanceStageInstruction,
  getMortgageStepsInstruction,
  formatFinanceSummaryForPrompt
} = require('./purchase-finance');
const { normalizeSalesLang, getStageInstruction } = require('./sales-localization');
const { wantsManagerHandoff, buildCallOfferContext } = require('./manager-handoff');
const { pickBudgetQuestionExample } = require('./budget-questions');


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
    /инвест|invest|inversi[oó]n|доход|аренд|rental|alquiler|бизнес|business|negocio|для жизни|для себя|для семьи|личн(?:ой|ая)?\s+жизн|переезд|relocate|live in|residen|vivir|para vivir|holiday home|segunda residencia|second home/i.test(
      lower
    );
  const hasBudget =
    /€|eur|euro|евро|бюджет|budget|до\s*\d|от\s*\d|\d{2,3}[\s.]?\d{3}|\d+\s*(тыс|k|млн|million)/i.test(
      lower
    );
  const microAreas = detectMicroAreas(allUserText, salesLang);
  const hasLocation = microAreas.hasSpecific || microAreas.broadIds.length > 0;
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

  const needsMicroArea = hasRegion && needsMicroAreaSelection(macroRegions, microAreas);
  const areaOptionsPrompt = getAreaOptionsPrompt(macroRegions, salesLang);
  const microAreaGroupIds = filterMicroGroupsForMacro(microAreas.groupIds, macroRegions);

  const readyForListings =
    hasType &&
    hasBudget &&
    hasPurpose &&
    hasRegion &&
    !needsMicroArea;

  if (
    readyForListings ||
    (wantsListings && hasType && hasBudget && hasPurpose && hasRegion && !needsMicroArea)
  ) {
    stage = 'SHOW_LISTINGS';
  } else if (userTurns <= 1 && !hasPurpose && !hasBudget && !hasLocation && !hasType && !hasRegion) {
    stage = 'FIRST_CONTACT';
  } else if (!hasPurpose) {
    stage = 'NEED_PURPOSE';
  } else if (!hasType) {
    stage = 'NEED_PROPERTY_TYPE';
  } else if (!hasRegion && !hasLocation) {
    stage = 'NEED_REGION';
  } else if (!hasBudget) {
    stage = 'NEED_BUDGET';
  } else if (needsMicroArea) {
    stage = 'NEED_LOCATION';
  } else {
    stage = 'REFINE';
  }

  if (
    userTurns >= 5 &&
    hasBudget &&
    hasType &&
    hasPurpose &&
    hasRegion &&
    !needsMicroArea
  ) {
    stage = 'SHOW_LISTINGS';
  }

  const wantsMortgageSteps = detectMortgageStepsQuestion(lastUser || allUserText);

  const finance = analyzePurchaseFinance(history, allUserText, salesLang);
  const managerCallRequested = wantsManagerHandoff(lastUser || allUserText);

  const callOfferContext = buildCallOfferContext(
    {
      propertyTypeLabel,
      regionLabel,
      microAreaLabel: microAreas.label,
      stage: finance.hasPropertyInterest ? 'SHOW_LISTINGS' : stage,
      hasPropertyInterest: finance.hasPropertyInterest,
    },
    salesLang
  );

  if (finance.financeStage && finance.financeStage !== 'PROPERTY_CLOSING') {
    stage = finance.financeStage;
  } else if (managerCallRequested || finance.financeStage === 'PROPERTY_CLOSING') {
    stage = 'OFFER_MANAGER_CALL';
  }

  const dialogCtx = {
    propertyTypeLabel,
    regionLabel,
    areaOptionsPrompt,
    microAreaLabel: microAreas.label,
    callOfferContext,
  };
  if (stage === 'NEED_BUDGET') {
    dialogCtx.budgetQuestionExample = pickBudgetQuestionExample(salesLang);
  }
  let stageInstruction = finance.financeStage && finance.financeStage !== 'PROPERTY_CLOSING'
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
    microAreas,
    microAreaLabel: microAreas.label,
    microAreaGroupIds,
    needsMicroArea,
    areaOptionsPrompt,
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
    managerCallRequested,
    callOfferContext,
    propertyTypeOptions: formatPropertyTypeOptions(salesLang),
    ...finance,
    financeSummaryBlock
  };
}

const stageInstructions = {
  FIRST_CONTACT: `Первый контакт. Представься: «Меня зовут Максим», *инвестиционный аналитик* House Tenerife. Не «бот», не «консультант». Тон: уверенный эксперт, тепло, без канцелярита. Добавь один мягкий смайлик 🙂 или :) в приветствии. Не повторяй очевидный текст клиента. Один вопрос: *для какой цели* покупка — для жизни/переезда или инвестиция/доход/бизнес? Объекты и ссылки НЕ показывай.`,

  NEED_PURPOSE: `Цель не ясна — обязательный шаг ДО любых предложений. Не повторяй вопрос клиента и не начинай с «понял». Один вопрос: жизнь/семья/переезд или инвестиция (аренда, перепродажа, бизнес)? Одна фраза, зачем это важно для подбора. Без объектов.`,

  NEED_PROPERTY_TYPE: `Цель ясна — не пересказывай её. Сразу уточни *тип*: апартаменты, вилла, дом, земля, коммерция, готовый бизнес, инвест-проект — не «жильё» в общем. Не предполагай виллу. Без ссылок.`,

  NEED_REGION: `Один вопрос про регион: Тенерифе, Дубай, Ибица, Марбелья, Малага, Барселона? Можно мягко подсказать: «если не определились — подскажу сильные зоны под вашу цель». Без подборки.`,

  NEED_BUDGET: `Спроси о бюджете мягко — не в лоб «какой у вас бюджет?». Смысл: подобрать подходящие варианты и не показывать заведомо неподходящие. Образец (можно слегка перефразировать, сохраняя смысл и тон): «{budgetQuestionExample}». Ориентиры по €: до 300k / 300–600k / от 600k. Тип: {propertyTypeLabel}, регион: {regionLabel}. Один вопрос в конце. Срок покупки — отдельным сообщением позже, не вместе с бюджетом.`,

  NEED_LOCATION: `Уточни район в ${'{regionLabel}'} (примеры: ${'{areaOptionsPrompt}'}). Покажи экспертизу: «для [цели] часто смотрят…». Один вопрос. Без подборки.`,

  SHOW_LISTINGS: `Подборка 3–5 объектов: тип ${'{propertyTypeLabel}'}, регион ${'{regionLabel}'}, район ${'{microAreaLabel}'}. Только из блока каталога. Формат:
• *Название* — €цена
  Почему вам: [1 фраза под цель клиента, не шаблон]
  ссылка
Закрой: «Какой вариант ближе — или скорректируем бюджет/район?» Не предлагай дешевле бюджета без запроса.`,

  REFINE: `Ответь по последней реплике. Если нужна новая подборка — 3–5 объектов с «почему вам». Если клиент сомневается — предложи альтернативу (другой район, чуть выше бюджета). Один вопрос в конце.`,

  OFFER_MANAGER_CALL: `Клиент готов к живому контакту (просил менеджера/звонок/просмотр — или финансы по объекту ясны). Не повторяй весь запрос клиента. НЕ пиши «запрос передан», «спасибо за обращение», телефон менеджера. Тёпло предложи короткий созвон 10–15 минут, чтобы обсудить детали и варианты не из открытого каталога. Один вопрос да/нет в конце. 2–4 строки.`,
};

function resolveStageInstruction(stage, dialog) {
  let text = stageInstructions[stage] || stageInstructions.REFINE;
  const typeLabel = dialog.propertyTypeLabel || 'уточняется';
  const regionLabel = dialog.regionLabel || 'уточняется';
  const microAreaLabel = dialog.microAreaLabel || (dialog.hasLocation ? 'уточняется' : '—');
  const areaOptionsPrompt = dialog.areaOptionsPrompt || 'уточните у клиента';
  const callOfferContext = dialog.callOfferContext || 'ваш запрос';
  const budgetQuestionExample =
    dialog.budgetQuestionExample || pickBudgetQuestionExample('ru');
  return text
    .replace(/\{propertyTypeLabel\}/g, typeLabel)
    .replace(/\{regionLabel\}/g, regionLabel)
    .replace(/\{microAreaLabel\}/g, microAreaLabel)
    .replace(/\{areaOptionsPrompt\}/g, areaOptionsPrompt)
    .replace(/\{callOfferContext\}/g, callOfferContext)
    .replace(/\{budgetQuestionExample\}/g, budgetQuestionExample);
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
  detectMicroAreas,
  detectRegionPreference,
  REGION_OPTIONS_PROMPT,
  analyzePurchaseFinance
};
