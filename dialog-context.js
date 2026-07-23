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
    /инвест|invest|inversi[oó]n|anlage|investissement|доход|аренд|rental|alquiler|miete|location|бизнес|business|negocio|geschäft|для жизни|для себя|для семьи|личн(?:ой|ая)?\s+жизн|переезд|relocate|live in|residen|vivir|para vivir|wohnen|umzug|habiter|déménagement|demenagement|holiday home|segunda residencia|second home|ferien|résidence secondaire|residence secondaire/i.test(
      lower
    );

  const budget = extractBudgetRange(allUserText);
  const lastBudget = extractBudgetRange(lastUser);
  const lastHasBudget = budgetHasSignal(lastUser, lastBudget);
  // «любой бюджет» / «кроме цены» — не фильтровать каталог по цене
  const ignoreBudget =
    wantsIgnoreBudget(lastUser) || (!lastHasBudget && wantsIgnoreBudget(allUserText));
  const hasBudget = budgetHasSignal(allUserText, budget) || ignoreBudget;

  const microAreas = detectMicroAreas(allUserText, salesLang);
  const hasLocation = microAreas.hasSpecific || microAreas.broadIds.length > 0;
  const regionPref = detectRegionPreference(allUserText, salesLang);
  const hasRegion = regionPref.hasRegion;
  const macroRegions = regionPref.regions;
  const regionLabel = regionPref.label;
  const typePrefLast = detectPropertyTypePreference(lastUser, salesLang);
  const typePrefAll = detectPropertyTypePreference(allUserText, salesLang);
  // Последняя реплика важнее: «вилла» ранее не должна затирать «готовый бизнес» сейчас
  const typePref = typePrefLast.hasType ? typePrefLast : typePrefAll;
  const hasType = typePref.hasType;
  const propertyTypes = typePref.types;
  const propertyTypeLabel = typePref.label;
  const wantsListings =
    /покаж|подбер|вариант|объект|каталог|ссылк|похож|ещё\s*(?:раз|вариант|объект|опци)|еще\s*(?:раз|вариант|объект|опци)|другие\s*(?:вариант|опци|объект)|по\s+моим\s+параметр|кроме\s+цен|show me|send me|options|listings|properties|shortlist|similar|more\s+options|another|mu[eé]strame|ens[eé]ñame|opciones|fichas|propiedades|selecci[oó]n|parecid|otras?\s+opcion|zeig|optionen|objekte|vorschl[aä]ge|montre|montrez|options|fiches|biens|s[ée]lection/i.test(
      lower
    );
  const wantsMoreLikeThese =
    /похож|ещё\s*(?:так|раз|вариант|объект)|еще\s*(?:так|раз|вариант)|другие\s*(?:вариант|опци)|по\s+моим\s+параметр|similar|more\s+(?:like|options|listings)|otra\s+opci|otras?\s+(?:opcion|ficha)|parecid|ähnliche|aehnliche|weitere\s+option|plus\s+d.?options|similaires|autres?\s+(?:options|fiches)/i.test(
      lastUser.toLowerCase()
    );
  const userTurns = userMsgs.length;

  let stage = 'FIRST_CONTACT';

  const needsMicroArea =
    hasRegion &&
    needsMicroAreaSelection(macroRegions, microAreas) &&
    !propertyTypeSkipsMicroArea(propertyTypes);
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
  } else if (needsMicroArea) {
    // Сначала район/зона — потом бюджет (доверие до цифр)
    stage = 'NEED_LOCATION';
  } else if (!hasBudget) {
    stage = 'NEED_BUDGET';
  } else {
    stage = 'REFINE';
  }

  if (
    userTurns >= 4 &&
    hasBudget &&
    hasType &&
    hasPurpose &&
    hasRegion &&
    !needsMicroArea
  ) {
    stage = 'SHOW_LISTINGS';
  }

  // «Ещё похожие» / «кроме цены» при уже собранных критериях — всегда подборка
  if (
    (wantsMoreLikeThese || ignoreBudget) &&
    hasType &&
    hasPurpose &&
    hasRegion &&
    !needsMicroArea &&
    (hasBudget || ignoreBudget)
  ) {
    stage = 'SHOW_LISTINGS';
  }

  const wantsMortgageSteps = detectMortgageStepsQuestion(lastUser || allUserText);

  const finance = analyzePurchaseFinance(history, allUserText, salesLang);
  const managerCallRequested = wantsManagerHandoff(lastUser);

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

  // Память диалога: явный запрет переспрашивать известное
  const memoryBlock = buildDialogMemoryBlock(
    {
      hasPurpose,
      hasBudget,
      hasType,
      hasRegion,
      hasLocation,
      needsMicroArea,
      propertyTypeLabel,
      regionLabel,
      microAreaLabel: microAreas.label,
      budget,
      wantsMoreLikeThese,
      stage
    },
    salesLang
  );
  if (memoryBlock) {
    stageInstruction = `${memoryBlock}\n\n${stageInstruction}`;
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
    wantsMoreLikeThese,
    ignoreBudget,
    budget,
    budgetLabel: ignoreBudget
      ? salesLang === 'es'
        ? 'sin límite de precio'
        : salesLang === 'en'
          ? 'any price'
          : salesLang === 'de'
            ? 'ohne Preislimit'
            : salesLang === 'fr'
              ? 'sans limite de prix'
              : 'без ограничения цены'
      : formatBudgetLabel(budget, salesLang),
    regionOptions: REGION_OPTIONS_PROMPT[salesLang] || REGION_OPTIONS_PROMPT.en,
    salesLang,
    stage,
    stageInstruction,
    memoryBlock,
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

  NEED_LOCATION: `Уточни район в ${'{regionLabel}'}. Предлагай ТОЛЬКО реальные зоны из каталога и копируй их написание БУКВАЛЬНО: ${'{areaOptionsPrompt}'}. Не выдумывай и не искажай названия (не «Лос Кристианос» / «Коста Адеже»). Один вопрос. Бюджет пока НЕ спрашивай. Без подборки.`,

  NEED_BUDGET: `Район уже известен. Спроси о бюджете мягко — не в лоб «какой у вас бюджет?». Смысл: подобрать подходящие варианты и не показывать заведомо неподходящие. Образец (можно слегка перефразировать, сохраняя смысл и тон): «{budgetQuestionExample}». Ориентиры по €: до 300k / 300–600k / от 600k. Тип: {propertyTypeLabel}, регион: {regionLabel}, район: {microAreaLabel} — название района пиши точно как здесь. Один вопрос в конце. Срок покупки — отдельным сообщением позже, не вместе с бюджетом.`,

  SHOW_LISTINGS: `ОБЯЗАТЕЛЬНО дай подборку 3–5 объектов прямо сейчас (не обещай «пришлю позже» и не ходи кругами с уточнениями): тип ${'{propertyTypeLabel}'}, регион ${'{regionLabel}'}, район ${'{microAreaLabel}'} (название района — точно как в этой строке, латиницей). Только из блока каталога. Весь текст ответа — на языке диалога клиента. Формат:
• *Название* — €цена
  [одна живая фраза-выгода под цель клиента — БЕЗ заголовка «Почему вам» / «Why for you»]
  ссылка
Закрой: «Какой вариант ближе — или скорректируем бюджет/район?» Не предлагай дешевле бюджета без запроса. Критерии из памяти диалога НЕ переспрашивай.`,

  REFINE: `Ответь по последней реплике. Если клиент просит ещё/похожие — сразу новая подборка 3–5 объектов из каталога по УЖЕ известным критериям (не спрашивай бюджет/район/тип снова). Формат: название, цена, одна фраза-выгода без ярлыка «Почему вам», ссылка. Если клиент сомневается — предложи альтернативу. Один вопрос в конце.`,

  OFFER_MANAGER_CALL: `Клиент готов к живому контакту (просил менеджера/звонок/запись на просмотр — или финансы по объекту ясны). Не путай с «посмотреть район/варианты в каталоге». Не повторяй весь запрос клиента. НЕ пиши «запрос передан», «спасибо за обращение», телефон менеджера. Тёпло предложи короткий созвон 10–15 минут, чтобы обсудить детали и варианты не из открытого каталога. Один вопрос да/нет в конце. 2–4 строки.`,
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

/** Клиент просит подборку без фильтра по цене (оставить район/тип). */
function wantsIgnoreBudget(text) {
  return /кроме\s+цен|без\s+(?:учёта|учета|ограничения|лимита)\s+цен|любой\s+цен|любой\s+бюджет|не\s+смотр(?:я|и)\s+на\s+цен|независимо\s+от\s+цен|any\s+price|any\s+budget|regardless\s+of\s+(?:the\s+)?price|without\s+(?:a\s+)?(?:price|budget)\s+limit|ignore\s+(?:the\s+)?(?:price|budget)|sin\s+(?:l[ií]mite\s+de\s+)?(?:precio|presupuesto)|ohne\s+(?:preis|budget)(?:limit)?|beliebiges\s+budget|peu\s+importe\s+le\s+prix|sans\s+limite\s+de\s+prix|n.?importe\s+quel\s+budget/i.test(
    String(text || '')
  );
}

/** Для бизнеса/земли/коммерции район часто не обязателен — достаточно региона. */
function propertyTypeSkipsMicroArea(propertyTypes) {
  if (!propertyTypes?.length) return false;
  return propertyTypes.every((t) =>
    ['business', 'commercial', 'land', 'investment'].includes(t)
  );
}

/**
 * @param {string} text
 * @returns {{ minPrice: number|null, maxPrice: number|null }}
 */
function extractBudgetRange(text) {
  const s = String(text || '')
    .toLowerCase()
    .replace(/(\d)\s+(\d{3})\b/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();

  let minPrice = null;
  let maxPrice = null;

  const take = (num, unit, mode) => {
    const v = parseBudgetNumber(num, unit, s);
    if (v == null) return;
    if (mode === 'max') maxPrice = maxPrice == null ? v : Math.max(maxPrice, v);
    else if (mode === 'min') minPrice = minPrice == null ? v : Math.min(minPrice, v);
    else {
      // around / plain → коридор
      const floor = Math.round(v * 0.92);
      const ceil = Math.round(v * 1.12);
      minPrice = minPrice == null ? floor : Math.min(minPrice, floor);
      maxPrice = maxPrice == null ? ceil : Math.max(maxPrice, ceil);
    }
  };

  // от X до Y [единица]
  const range = s.match(
    /(?:от|from|desde)\s*(\d+(?:[.,]\d+)?)\s*(?:до|–|-|to|hasta)\s*(\d+(?:[.,]\d+)?)\s*(млн|миллион[а-яё]*|million[a-z]*|millon[a-z]*|тыс[а-яё]*|thousand|k|к)?/i
  );
  if (range) {
    take(range[1], range[3], 'min');
    take(range[2], range[3], 'max');
    return { minPrice, maxPrice };
  }

  // до / hasta / up to / максимум
  const upTo = s.match(
    /(?:до|макс(?:имум)?|не\s*более|up\s*to|hasta|under|below|bis|jusqu.?à|maximum)\s*(\d+(?:[.,]\d+)?)\s*(млн|миллион[а-яё]*|million[a-z]*|millon[a-z]*|тыс[а-яё]*|thousand|k|к|tausend)?/i
  );
  if (upTo) take(upTo[1], upTo[2], 'max');

  // от / from / минимум
  const from = s.match(
    /(?:от|from|минимум|desde|starting)\s*(\d+(?:[.,]\d+)?)\s*(млн|миллион[а-яё]*|million[a-z]*|millon[a-z]*|тыс[а-яё]*|thousand|k|к)?/i
  );
  if (from) take(from[1], from[2], 'min');

  // около / в районе / around / ~
  const around = s.match(
    /(?:около|примерно|в\s+районе|around|about|cerca\s+de|~\s*)\s*(\d+(?:[.,]\d+)?)\s*(млн|миллион[а-яё]*|million[a-z]*|millon[a-z]*|тыс[а-яё]*|thousand|k|к)?/i
  );
  if (around) take(around[1], around[2], 'around');

  // «бюджет 2 миллиона» / «2 млн» / «500к» / «2.5 million»
  const withUnit = s.matchAll(
    /(\d+(?:[.,]\d+)?)\s*(млн|миллион[а-яё]*|million[a-z]*|millon[a-z]*|тыс[а-яё]*|thousand|k|к)(?![а-яёa-z])/gi
  );
  for (const m of withUnit) {
    if (maxPrice == null && minPrice == null) take(m[1], m[2], 'around');
    else if (maxPrice == null) take(m[1], m[2], 'max');
  }

  // словесные: до двух миллионов
  const wordMillions = s.match(
    /(?:до|hasta|up\s*to|около|around)?\s*(одного|одной|двух|трёх|трех|четырех|четырёх|пяти|шести|семи|восьми|девяти|десяти|one|two|three|four|five|un|una|dos|tres|cuatro|cinco)\s+(миллион\w*|million\w*|millon\w*)/i
  );
  if (wordMillions && maxPrice == null && minPrice == null) {
    const n = wordToNumber(wordMillions[1]);
    if (n != null) {
      const v = n * 1_000_000;
      if (/(?:до|hasta|up\s*to)/i.test(wordMillions[0])) maxPrice = v;
      else {
        minPrice = Math.round(v * 0.92);
        maxPrice = Math.round(v * 1.12);
      }
    }
  }

  // «350 000» / «350000€»
  if (minPrice == null && maxPrice == null) {
    const plain = s.match(/(\d{2,3})[\s.]?(\d{3})\s*(?:€|eur|евро|euro)?/);
    if (plain) {
      const mid = parseInt(plain[1] + plain[2], 10);
      minPrice = Math.round(mid * 0.92);
      maxPrice = Math.round(mid * 1.15);
    }
  }

  return { minPrice, maxPrice };
}

function wordToNumber(word) {
  const map = {
    одного: 1,
    одной: 1,
    one: 1,
    un: 1,
    una: 1,
    двух: 2,
    two: 2,
    dos: 2,
    трёх: 3,
    трех: 3,
    three: 3,
    tres: 3,
    четырех: 4,
    четырёх: 4,
    four: 4,
    cuatro: 4,
    пяти: 5,
    five: 5,
    cinco: 5,
    шести: 6,
    семи: 7,
    восьми: 8,
    девяти: 9,
    десяти: 10
  };
  return map[String(word || '').toLowerCase()] ?? null;
}

function parseBudgetNumber(numStr, unit, fullText) {
  const raw = String(numStr || '').replace(',', '.');
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v <= 0) return null;

  const u = String(unit || '').toLowerCase();
  if (/млн|миллион|million|millon/.test(u)) return Math.round(v * 1_000_000);
  if (/тыс|thousand|^k$|^к$/.test(u)) return Math.round(v * 1000);

  // Голые числа без единицы
  if (v >= 50000) return Math.round(v); // 350000
  if (v >= 1000) return Math.round(v); // 15000 € и т.п.
  if (v >= 100) return Math.round(v * 1000); // 350 → 350k
  if (v >= 10) return Math.round(v * 1000); // 50 → 50k
  // 1–9: в бюджетном контексте обычно миллионы («до 2»)
  if (/(?:до|hasta|up\s*to|бюджет|budget|млн|million|миллион|около|around)/i.test(fullText || '')) {
    return Math.round(v * 1_000_000);
  }
  return Math.round(v * 1_000_000);
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

function budgetHasSignal(text, budget) {
  if (budget?.minPrice != null || budget?.maxPrice != null) return true;
  const lower = String(text || '').toLowerCase();
  return /€|eur|euro|евро|бюджет|budget|presupuesto|budgetrahmen|\d+\s*(?:тыс|тысяч|млн|миллион|million|millon|\bk\b|\bк\b|tausend)|(?:до|от|up\s*to|around|около|hasta|under|bis|jusqu.?à|ab)\s*\d/i.test(
    lower
  );
}

function formatBudgetLabel(budget, lang = 'ru') {
  if (!budget) return '';
  const { minPrice, maxPrice } = budget;
  const fmt = (n) => `€${Number(n).toLocaleString('en-US')}`;
  if (minPrice != null && maxPrice != null) {
    if (lang === 'es') return `desde ${fmt(minPrice)} hasta ${fmt(maxPrice)}`;
    if (lang === 'en') return `${fmt(minPrice)}–${fmt(maxPrice)}`;
    if (lang === 'de') return `${fmt(minPrice)}–${fmt(maxPrice)}`;
    if (lang === 'fr') return `de ${fmt(minPrice)} à ${fmt(maxPrice)}`;
    return `от ${fmt(minPrice)} до ${fmt(maxPrice)}`;
  }
  if (maxPrice != null) {
    if (lang === 'es') return `hasta ${fmt(maxPrice)}`;
    if (lang === 'en') return `up to ${fmt(maxPrice)}`;
    if (lang === 'de') return `bis ${fmt(maxPrice)}`;
    if (lang === 'fr') return `jusqu’à ${fmt(maxPrice)}`;
    return `до ${fmt(maxPrice)}`;
  }
  if (minPrice != null) {
    if (lang === 'es') return `desde ${fmt(minPrice)}`;
    if (lang === 'en') return `from ${fmt(minPrice)}`;
    if (lang === 'de') return `ab ${fmt(minPrice)}`;
    if (lang === 'fr') return `à partir de ${fmt(minPrice)}`;
    return `от ${fmt(minPrice)}`;
  }
  return '';
}

function buildDialogMemoryBlock(state, lang = 'ru') {
  const known = [];
  const neverAsk = [];
  if (state.hasPurpose) {
    known.push(lang === 'es' ? 'objetivo' : lang === 'en' ? 'purpose' : 'цель');
    neverAsk.push(lang === 'es' ? 'objetivo' : lang === 'en' ? 'purpose/goal' : 'цель (жизнь/инвестиция)');
  }
  if (state.hasType) {
    known.push(state.propertyTypeLabel || (lang === 'en' ? 'type' : 'тип'));
    neverAsk.push(lang === 'es' ? 'tipo de inmueble' : lang === 'en' ? 'property type' : 'тип объекта');
  }
  if (state.hasRegion) {
    known.push(state.regionLabel || 'region');
    neverAsk.push(lang === 'es' ? 'región' : lang === 'en' ? 'region' : 'регион');
  }
  if (state.hasLocation || !state.needsMicroArea) {
    if (state.hasLocation) {
      known.push(state.microAreaLabel || (lang === 'en' ? 'area' : 'район'));
      neverAsk.push(lang === 'es' ? 'zona/área' : lang === 'en' ? 'area/district' : 'район/зона');
    }
  }
  if (state.hasBudget) {
    const bl = formatBudgetLabel(state.budget, lang);
    known.push(bl || (lang === 'es' ? 'presupuesto' : lang === 'en' ? 'budget' : 'бюджет'));
    neverAsk.push(
      lang === 'es'
        ? `presupuesto${bl ? ` (${bl})` : ''}`
        : lang === 'en'
          ? `budget${bl ? ` (${bl})` : ''}`
          : `бюджет${bl ? ` (${bl})` : ''}`
    );
  }

  if (!neverAsk.length) return '';

  if (lang === 'es') {
    return `**MEMORIA DEL DIÁLOGO (obligatorio):** Ya sabemos: ${known.join('; ')}. NO vuelvas a preguntar: ${neverAsk.join(', ')}.${
      state.wantsMoreLikeThese
        ? ' El cliente pide más/similares — envía nueva selección YA con estos criterios.'
        : ''
    } Pregunta solo lo que aún falta.`;
  }
  if (lang === 'en') {
    return `**DIALOG MEMORY (mandatory):** Already known: ${known.join('; ')}. Do NOT re-ask: ${neverAsk.join(', ')}.${
      state.wantsMoreLikeThese
        ? ' Client wants more/similar options — send a new shortlist NOW using these criteria.'
        : ''
    } Ask only for what is still missing.`;
  }
  return `**ПАМЯТЬ ДИАЛОГА (обязательно):** Уже известно: ${known.join('; ')}. НЕ переспрашивай: ${neverAsk.join(', ')}.${
    state.wantsMoreLikeThese
      ? ' Клиент просит ещё/похожие — сразу новая подборка по этим критериям, без вопросов про бюджет/район/тип.'
      : ''
  } Спрашивай только то, чего ещё нет.`;
}

/** @deprecated use parseBudgetNumber — оставлено для совместимости тестов */
function parseMoneyToken(raw) {
  return parseBudgetNumber(raw, null, '');
}

module.exports = {
  analyzeConversation,
  buildCatalogSearchQuery,
  extractBudgetRange,
  derivePriceTarget,
  formatBudgetLabel,
  buildDialogMemoryBlock,
  budgetHasSignal,
  wantsIgnoreBudget,
  LOCATION_KEYWORDS,
  detectMicroAreas,
  detectRegionPreference,
  REGION_OPTIONS_PROMPT,
  analyzePurchaseFinance
};
