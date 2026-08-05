const {
  detectPropertyTypePreference,
  formatPropertyTypeOptions
} = require('./property-types');
const {
  detectRegionPreference,
  resolveActiveRegionPreference,
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
const {
  detectInvestmentTimeline,
  wantsEscalation,
  expandBudgetBand,
} = require('./bot-core-rules');
const { isOffTopicChatter, formatOffTopicInstruction } = require('./keyword-relevance');

const INVEST_PURPOSE_RE =
  /инвест|invest|inversi[oó]n|anlage|investissement|доход|аренд|rental|alquiler|miete|location|бизнес|business|negocio|geschäft|pour\s+investir|zum\s+investieren|инвест(?:иционн)?\s*проект|investment\s+project/i;

const LIVING_PURPOSE_RE =
  /для жизни|для себя|для семьи|личн(?:ой|ая)?\s+жизн|переезд|relocate|live in|residen|vivir|para vivir|wohnen|umzug|habiter|pour\s+vivre|zum\s+wohnen|déménagement|demenagement|holiday home|segunda residencia|second home|ferien|résidence secondaire|residence secondaire/i;

/**
 * @param {string} text
 * @returns {'investment'|'living'|null}
 */
function detectPurposeKind(text) {
  const s = String(text || '');
  const invest = INVEST_PURPOSE_RE.test(s);
  const living = LIVING_PURPOSE_RE.test(s);
  if (invest && !living) return 'investment';
  if (living && !invest) return 'living';
  if (invest && living) {
    // Последний явный сигнал важнее
    const lastInvest = Math.max(
      ...[...s.matchAll(new RegExp(INVEST_PURPOSE_RE.source, 'gi'))].map((m) => m.index ?? -1),
      -1
    );
    const lastLiving = Math.max(
      ...[...s.matchAll(new RegExp(LIVING_PURPOSE_RE.source, 'gi'))].map((m) => m.index ?? -1),
      -1
    );
    return lastInvest >= lastLiving ? 'investment' : 'living';
  }
  return null;
}

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

  const purposeKind =
    detectPurposeKind(lastUser) || detectPurposeKind(allUserText);
  const hasPurpose = Boolean(purposeKind) || INVEST_PURPOSE_RE.test(lower) || LIVING_PURPOSE_RE.test(lower);
  const isInvestment = purposeKind === 'investment';
  const isLiving = purposeKind === 'living' || (hasPurpose && !isInvestment);

  const budget = resolveEffectiveBudget(history, allUserText, lastUser);
  const lastBudget = extractBudgetRange(lastUser);
  const lastHasBudget =
    !isFundsOnHandAmountMessage(lastUser) && budgetHasSignal(lastUser, lastBudget);
  // «любой бюджет» / «кроме цены» — не фильтровать каталог по цене
  const ignoreBudget =
    wantsIgnoreBudget(lastUser) || (!lastHasBudget && wantsIgnoreBudget(allUserText));
  const hasBudget =
    budget?.minPrice != null ||
    budget?.maxPrice != null ||
    ignoreBudget ||
    lastHasBudget;
  const hasTimeline =
    detectInvestmentTimeline(lastUser) || detectInvestmentTimeline(allUserText);
  const needsEscalation = wantsEscalation(lastUser);

  const regionPref = resolveActiveRegionPreference(history, salesLang);
  const hasRegion = regionPref.hasRegion;
  const macroRegions = regionPref.regions;
  const regionLabel = regionPref.label;
  // Районы — только из реплик после последнего выбора региона (не тащим Adeje с Тенерифе на Ибицу)
  const regionContextText = regionPref.contextText || allUserText;
  const microAreas = detectMicroAreas(regionContextText, salesLang);
  const hasLocation = microAreas.hasSpecific || microAreas.broadIds.length > 0;
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
  const lastUserLower = lastUser.toLowerCase();
  /** Явная просьба дать ссылки на объекты (не «посмотреть сайт»). */
  const wantsPropertyLinks =
    /(?:дай|дайте|скинь|скиньте|пришли|пришлите|отправь|отправьте|покажи|покажите|нужн[аы]|хочу|можно).{0,40}ссылк|(?:ссылк|линк).{0,30}(?:на\s+(?:них|не[её]|объект|вариант|этот|эти|карт)|пожалуйста)|ссылк[аиуеы]?\s*$|send(?:\s+me)?\s+(?:the\s+)?links?|give(?:\s+me)?\s+(?:the\s+)?links?|links?\s+(?:to|for)\s+(?:them|it|the|these|those)|proporcion(?:a|e|ar)?\s+(?:me\s+)?(?:los\s+)?enlaces?|muéstrame\s+los\s+enlaces|dame\s+(?:los\s+)?(?:enlaces?|links?)|env[ií]ame\s+(?:los\s+)?enlaces?|enlaces?\s+a\s+(?:estos|esas|ellos|ellas|las|los|dichos)|los\s+enlaces\s+(?:por\s+favor)?|Zeig(?:e)?\s+(?:mir\s+)?(?:die\s+)?Links?|donne(?:z)?[- ]moi\s+les\s+liens|les\s+liens\s+(?:s'?il\s+vous\s+pla[iî]t)?/i.test(
      lastUserLower
    );
  const wantsMoreLikeThese =
    /похож|ещё\s*(?:так|раз|вариант|объект)|еще\s*(?:так|раз|вариант)|другие\s*(?:вариант|опци)|по\s+моим\s+параметр|similar|more\s+(?:like|options|listings)|otra\s+opci|otras?\s+(?:opcion|ficha)|parecid|ähnliche|aehnliche|weitere\s+option|plus\s+d.?options|similaires|autres?\s+(?:options|fiches)/i.test(
      lastUserLower
    );
  const userTurns = userMsgs.length;

  const needsMicroArea =
    hasRegion &&
    needsMicroAreaSelection(macroRegions, microAreas) &&
    !propertyTypeSkipsMicroArea(propertyTypes);
  const areaOptionsPrompt = getAreaOptionsPrompt(macroRegions, salesLang);
  const microAreaGroupIds = filterMicroGroupsForMacro(microAreas.groupIds, macroRegions);

  const wantsMortgageSteps = detectMortgageStepsQuestion(lastUser || allUserText);
  const offTopicChatter = isOffTopicChatter(lastUser);

  const finance = analyzePurchaseFinance(history, allUserText, salesLang, {
    requireBeforeListings: true,
  });
  const financeReady =
    Boolean(finance.financeReadyForListings) || ignoreBudget;

  // Критерии подбора без цены (тип / регион / район)
  const selectionReady =
    hasType && hasRegion && !needsMicroArea;

  const readyForListings =
    hasPurpose &&
    hasBudget &&
    selectionReady &&
    financeReady &&
    (!isInvestment || hasTimeline || ignoreBudget);

  let stage = 'FIRST_CONTACT';

  if (userTurns <= 1 && !hasPurpose && !hasBudget && !hasLocation && !hasType && !hasRegion) {
    stage = 'FIRST_CONTACT';
  } else if (!hasPurpose) {
    stage = 'NEED_PURPOSE';
  } else if (isInvestment) {
    // Инвестиции: бюджет → срок → финансы → подбор (тип/регион/район, без переспроса цены)
    if (!hasBudget) {
      stage = 'NEED_BUDGET';
    } else if (!hasTimeline && !ignoreBudget) {
      stage = 'NEED_TIMELINE';
    } else if (!finance.hasFundsNow && !ignoreBudget) {
      stage = 'NEED_FUNDS_NOW';
    } else if (!finance.hasMortgageAnswered && !ignoreBudget) {
      stage = 'NEED_MORTGAGE';
    } else if (!hasType) {
      stage = 'NEED_PROPERTY_TYPE';
    } else if (!hasRegion && !hasLocation) {
      stage = 'NEED_REGION';
    } else if (needsMicroArea) {
      stage = 'NEED_LOCATION';
    } else if (readyForListings) {
      stage = 'SHOW_LISTINGS';
    } else {
      stage = 'REFINE';
    }
  } else {
    // Для себя: цель → регион → район → тип → бюджет → финансы → подборка
    if (!hasRegion && !hasLocation) {
      stage = 'NEED_REGION';
    } else if (needsMicroArea) {
      stage = 'NEED_LOCATION';
    } else if (!hasType) {
      stage = 'NEED_PROPERTY_TYPE';
    } else if (!hasBudget) {
      stage = 'NEED_BUDGET';
    } else if (!finance.hasFundsNow && !ignoreBudget) {
      stage = 'NEED_FUNDS_NOW';
    } else if (!finance.hasMortgageAnswered && !ignoreBudget) {
      stage = 'NEED_MORTGAGE';
    } else if (readyForListings) {
      stage = 'SHOW_LISTINGS';
    } else {
      stage = 'REFINE';
    }
  }

  if (
    readyForListings ||
    (wantsListings && readyForListings) ||
    (userTurns >= 5 && readyForListings)
  ) {
    stage = 'SHOW_LISTINGS';
  }

  // «Ещё похожие» / «кроме цены» при уже собранных критериях — всегда подборка
  if (
    (wantsMoreLikeThese || ignoreBudget) &&
    selectionReady &&
    hasPurpose &&
    (hasBudget || ignoreBudget) &&
    (financeReady || ignoreBudget) &&
    (!isInvestment || hasTimeline || ignoreBudget)
  ) {
    stage = 'SHOW_LISTINGS';
  }

  // «Дай ссылки» по уже названным параметрам — сразу карточки с URL
  if (
    wantsPropertyLinks &&
    selectionReady &&
    hasPurpose &&
    (hasBudget || ignoreBudget) &&
    (financeReady || ignoreBudget) &&
    (!isInvestment || hasTimeline || ignoreBudget)
  ) {
    stage = 'SHOW_LISTINGS';
  }

  // Инвестиции: без срока покупки нельзя уходить в подборку (даже если просят ссылки)
  if (isInvestment && hasBudget && !hasTimeline && !ignoreBudget && !wantsMortgageSteps) {
    const tryingToSkipTimeline =
      stage === 'SHOW_LISTINGS' ||
      stage === 'NEED_PROPERTY_TYPE' ||
      stage === 'NEED_REGION' ||
      stage === 'NEED_LOCATION' ||
      stage === 'REFINE' ||
      stage === 'NEED_FUNDS_NOW' ||
      stage === 'NEED_MORTGAGE';
    // Финансы только после срока; подбор/ссылки — тоже
    if (tryingToSkipTimeline) {
      stage = 'NEED_TIMELINE';
    }
  }

  // Жёстко: просьба «покажи объекты» БЕЗ бюджета → только запрос бюджета (не подборка)
  const askedForListingsWithoutBudget =
    (wantsListings || wantsPropertyLinks || wantsMoreLikeThese) &&
    !hasBudget &&
    !ignoreBudget;
  if (askedForListingsWithoutBudget) {
    stage = hasPurpose ? 'NEED_BUDGET' : 'NEED_PURPOSE';
  }

  // Правило 10: приветствие/small talk без ключевых слов — не в подборку
  if (offTopicChatter && !hasPurpose && !hasBudget && !hasType && !hasRegion) {
    stage = 'FIRST_CONTACT';
  }

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

  // После интереса к конкретному объекту — документы / закрытие имеют приоритет
  if (needsEscalation) {
    stage = 'OFFER_MANAGER_CALL';
  } else if (
    finance.hasPropertyInterest &&
    finance.financeStage &&
    ['FINANCE_DOCUMENTS', 'FINANCE_DOCUMENTS_CASH', 'PROPERTY_CLOSING'].includes(
      finance.financeStage
    )
  ) {
    stage = finance.financeStage === 'PROPERTY_CLOSING' ? 'OFFER_MANAGER_CALL' : finance.financeStage;
  } else if (managerCallRequested) {
    stage = 'OFFER_MANAGER_CALL';
  } else if (
    finance.hasPropertyInterest &&
    finance.financeStage &&
    !financeReady &&
    (finance.financeStage === 'NEED_FUNDS_NOW' || finance.financeStage === 'NEED_MORTGAGE')
  ) {
    stage = finance.financeStage;
  }

  const dialogCtx = {
    propertyTypeLabel,
    regionLabel,
    areaOptionsPrompt,
    microAreaLabel: microAreas.label,
    callOfferContext,
    purposeKind: isInvestment ? 'investment' : isLiving ? 'living' : null,
    isInvestment,
  };
  if (stage === 'NEED_BUDGET') {
    dialogCtx.budgetQuestionExample = pickBudgetQuestionExample(salesLang, {
      investment: isInvestment,
    });
    dialogCtx.askedForListingsWithoutBudget = askedForListingsWithoutBudget;
  }
  if (stage === 'SHOW_LISTINGS' && hasBudget && !ignoreBudget) {
    dialogCtx.budgetBandLabel = formatBudgetBandLabel(budget, salesLang);
  }

  const useFinanceInstruction =
    stage === 'NEED_FUNDS_NOW' ||
    stage === 'NEED_MORTGAGE' ||
    stage === 'FINANCE_DOCUMENTS' ||
    stage === 'FINANCE_DOCUMENTS_CASH';

  let stageInstruction = useFinanceInstruction
    ? getFinanceStageInstruction(stage, salesLang)
    : getStageInstruction(salesLang, stage, dialogCtx) ||
      resolveStageInstruction(stage, dialogCtx);

  // Уточняем инструкции под ветку инвестиции / для себя
  if (stage === 'NEED_BUDGET' && askedForListingsWithoutBudget) {
    stageInstruction = getAskBudgetBeforeListingsInstruction(salesLang, {
      isInvestment,
      budgetQuestionExample: dialogCtx.budgetQuestionExample,
    });
  } else if (stage === 'NEED_BUDGET' && isInvestment) {
    stageInstruction = getInvestmentBudgetInstruction(salesLang, dialogCtx);
  } else if (stage === 'NEED_TIMELINE' && isInvestment) {
    stageInstruction = getInvestmentTimelineInstruction(salesLang);
  } else if (stage === 'NEED_PROPERTY_TYPE' && isInvestment && financeReady) {
    stageInstruction = `${getInvestmentSelectionPreamble(salesLang)}\n\n${stageInstruction}`;
  } else if (
    (stage === 'NEED_REGION' || stage === 'NEED_LOCATION') &&
    isInvestment &&
    financeReady
  ) {
    stageInstruction = `${getInvestmentSelectionPreamble(salesLang)}\n\n${stageInstruction}`;
  }

  // Клиент только что назвал бюджет — короткое «Отлично» (без «запомнил») и не переспрашивать
  if (lastHasBudget && hasBudget && stage !== 'NEED_BUDGET') {
    stageInstruction = `${getJustRememberedBudgetInstruction(salesLang, budget)}\n\n${stageInstruction}`;
  }

  // Правило 10: small talk / оффтоп — без вилл, только вход в воронку
  if (offTopicChatter) {
    stageInstruction = `${formatOffTopicInstruction(salesLang, {
      hasBudget,
      hasPurpose,
      isInvestment,
      hasTimeline,
    })}\n\n${stageInstruction}`;
  }

  if (needsEscalation) {
    stageInstruction = `${getEscalationInstruction(salesLang)}\n\n${stageInstruction}`;
  }

  if (wantsMortgageSteps) {
    stageInstruction = `${getMortgageStepsInstruction(salesLang)}\n\n${stageInstruction}`;
  }

  const funnelBlock = formatFunnelPathBlock(isInvestment, salesLang);
  if (funnelBlock) {
    stageInstruction = `${funnelBlock}\n\n${stageInstruction}`;
  }

  // Память диалога: явный запрет переспрашивать известное
  const memoryBlock = buildDialogMemoryBlock(
    {
      hasPurpose,
      hasBudget,
      hasType,
      hasRegion,
      hasLocation,
      hasTimeline,
      hasFundsNow: finance.hasFundsNow,
      hasMortgageAnswered: finance.hasMortgageAnswered,
      needsMicroArea,
      propertyTypeLabel,
      regionLabel,
      microAreaLabel: microAreas.label,
      budget,
      wantsMoreLikeThese,
      stage,
      purposeKind: isInvestment ? 'investment' : 'living',
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
    purposeKind: isInvestment ? 'investment' : hasPurpose ? 'living' : null,
    isInvestment,
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
    wantsPropertyLinks,
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
              : salesLang === 'pl'
                ? 'bez limitu ceny'
                : salesLang === 'nl'
                  ? 'geen prijslimiet'
                  : 'без ограничения цены'
      : formatBudgetLabel(budget, salesLang),
    hasTimeline,
    needsEscalation,
    financeReadyForListings: financeReady,
    readyForListings,
    regionOptions: REGION_OPTIONS_PROMPT[salesLang] || REGION_OPTIONS_PROMPT.en,
    salesLang,
    stage,
    stageInstruction,
    memoryBlock,
    wantsMortgageSteps,
    managerCallRequested,
    callOfferContext,
    propertyTypeOptions: formatPropertyTypeOptions(salesLang),
    offTopicChatter,
    ...finance,
    financeSummaryBlock
  };
}

const stageInstructions = {
  FIRST_CONTACT: `Первый контакт / приветствие. Представься: «Меня зовут Максим», помогаешь с недвижимостью и инвестициями (House Tenerife). Не «бот». Тон WhatsApp: коротко, тепло, один 🙂 или :). Если клиент написал «привет / как дела?» без темы недвижимости — НЕ присылай виллы и ссылки. Образец: «Привет! Я здесь, чтобы помочь с инвестициями в недвижимость. Какой у вас бюджет?» (или: для себя / под инвестиции, если цель ещё не ясна). Объекты и ссылки ЗАПРЕЩЕНЫ.`,

  NEED_PURPOSE: `Цель не ясна — обязательный шаг ДО любых предложений. Не повторяй вопрос клиента и не начинай с канцелярского «понял ваш запрос». Живо: один вопрос — жизнь/семья/переезд или инвестиция (аренда, перепродажа, бизнес)? Одна короткая фраза, зачем это важно. Без объектов.`,

  NEED_PROPERTY_TYPE: `Сразу уточни *тип*: апартаменты, вилла, дом, земля, коммерция, готовый бизнес, инвест-проект — не «жильё» в общем. Не предполагай виллу. Если тип УЖЕ известен и клиент просто вернулся («а что по виллам?») — НЕ читай лекцию про инвестиции в виллы, иди к следующему шагу воронки. Без ссылок и без переспроса уже известного бюджета.`,

  NEED_REGION: `Один живой вопрос про регион/город: Тенерифе, Дубай, Ибица, Марбелья, Малага, Барселона? Если бюджет уже известен — мягко подскажи 1–2 сильные зоны под этот бюджет из каталога (напр. Adeje / Ибица / Марбелья — только реальные названия). Можно: «если не определились — подскажу сильные зоны под вашу цель и бюджет». Без подборки и без буклета.`,

  NEED_LOCATION: `Уточни район в ${'{regionLabel}'}. Предлагай ТОЛЬКО реальные зоны из каталога и копируй их написание БУКВАЛЬНО: ${'{areaOptionsPrompt}'}. Если бюджет известен — предложи 2–3 зоны, которые обычно хорошо стыкуются с этим бюджетом (из списка выше, без выдумок). Один короткий вопрос. Без подборки.`,

  NEED_BUDGET: `Спроси о бюджете / размере инвестиций мягко — не в лоб «какой у вас бюджет?». Для инвестиций лучше: «какой у вас размер инвестиций?». Образец: «{budgetQuestionExample}». Ориентиры по €: до 300k / 300–600k / от 600k. Уже известное (тип/регион/район) не переспрашивай. Один вопрос. Объекты НЕ показывай. Тон чата, не анкета.`,

  NEED_TIMELINE: `Бюджет / размер инвестиций уже известен — НЕ переспрашивай. Если клиент только что назвал сумму — коротко подтверди: «Отлично» или «Отлично, миллион евро» / «Отлично — 2 миллиона евро». Без канцелярита про память или запись. Подборку пока не высылай. Затем один мягкий вопрос про *срок покупки/инвестирования*. Образец: «Когда вы планируете совершить покупку? Через 2 месяца, 3 месяца или позже?» Коротко, тепло.`,

  NEED_FUNDS_NOW: `Финансы ДО подборки. Один вопрос: сколько денег есть *сейчас* на руках — «все своими», «часть + ипотека» или сумма в €. Это НЕ бюджет поиска: подборку потом строй по ранее названному размеру инвестиций/бюджету (например миллион), а не по сумме на руках. Объекты НЕ показывай.`,

  NEED_MORTGAGE: `Форма оплаты: один вопрос — нужна ипотека/кредит в Испании или свои средства? Если клиент сказал «весь миллион / всё на руках» — считай оплату своими, ипотека не нужна, можно к подборке. Объекты пока НЕ показывай, пока ипотека не прояснена.`,

  SHOW_LISTINGS: `ОБЯЗАТЕЛЬНО дай подборку 3–5 РАЗНЫХ объектов прямо сейчас (не обещай «пришлю позже», не ограничивайся одной ссылкой): тип ${'{propertyTypeLabel}'}, регион ${'{regionLabel}'}, район ${'{microAreaLabel}'}. Только из блока каталога (система уже отфильтровала по бюджету). ЗАПРЕЩЕНО говорить клиенту про «±20%», «коридор €X–€Y» или что вы расширяете/сужаете бюджет — просто покажи варианты. Начни коротко: «Вот варианты…» без вилки цен. Формат:
• *Название* — €цена
  [одна живая фраза-выгода под цель — БЕЗ «Почему вам»]
  ссылка
Минимум 3 объекта, если в каталоге есть столько URL. Закрой: «Какой вариант ближе?» Критерии из памяти НЕ переспрашивай.`,

  REFINE: `Ответь по последней реплике. Если просят ещё/похожие — сразу новая подборка 3–5 из каталога по УЖЕ известным критериям. Один вопрос в конце.`,

  OFFER_MANAGER_CALL: `Клиент готов к живому контакту. НЕ пиши «запрос передан», телефон менеджера. Тёпло предложи созвон 10–15 минут. Один вопрос да/нет. 2–4 строки.`,
};

function formatFunnelPathBlock(isInvestment, lang = 'ru') {
  if (lang === 'en') {
    return isInvestment
      ? `**ACTIVE FUNNEL: INVESTMENT** (strict order — never skip ahead to listings):
1) Investment budget in € → 2) Investment timeline → 3) Cash now / all / part / mortgage → 4) Then selection criteria WITHOUT re-asking price (type → region → area) → 5) Shortlist ±20%.
NEVER offer villas/projects before budget + timeline + finances.`
      : `**ACTIVE FUNNEL: FOR LIVING / SELF** (strict order):
1) Goal (self vs invest) → 2) City/region → 3) District → 4) Property type → 5) Budget € → 6) Cash on hand / mortgage → 7) Shortlist ±20%.
NEVER send listings before budget and finances.`;
  }
  if (lang === 'es') {
    return isInvestment
      ? `**EMBUDO ACTIVO: INVERSIÓN** (orden estricto):
1) Presupuesto de inversión € → 2) Plazo → 3) Dinero ahora / todo / parte / hipoteca → 4) Criterios de selección SIN repetir precio (tipo → región → zona) → 5) Selección ±20%.
NUNCA ofrezcas fichas antes de presupuesto + plazo + finanzas.`
      : `**EMBUDO ACTIVO: PARA VIVIR** (orden estricto):
1) Objetivo → 2) Ciudad/región → 3) Zona → 4) Tipo → 5) Presupuesto € → 6) Dinero en mano / hipoteca → 7) Selección ±20%.
NUNCA envíes fichas antes del presupuesto y las finanzas.`;
  }
  return isInvestment
    ? `**АКТИВНАЯ ВЕТКА: ИНВЕСТИЦИИ** (строгий порядок — не перескакивай к объектам):
1) Размер инвестиций в € → 2) Срок инвестирования → 3) Деньги сейчас (все / часть / ипотека) → 4) Потом критерии подбора БЕЗ переспроса цены (тип → регион → район) → 5) Подборка ±20%.
ЗАПРЕЩЕНО предлагать виллы/проекты до размера инвестиций, срока и финансов.`
    : `**АКТИВНАЯ ВЕТКА: ДЛЯ СЕБЯ / ЖИЗНЬ** (строгий порядок):
1) Цель (для себя или инвестиции) → 2) Город/регион → 3) Район → 4) Тип → 5) Бюджет € → 6) Деньги на руках / ипотека → 7) Подборка ±20%.
ЗАПРЕЩЕНО слать объекты до бюджета и финансов.`;
}

function getAskBudgetBeforeListingsInstruction(lang, opts = {}) {
  const isInvestment = Boolean(opts.isInvestment);
  const example =
    opts.budgetQuestionExample ||
    pickBudgetQuestionExample(lang === 'en' ? 'en' : lang === 'es' ? 'es' : 'ru', {
      investment: isInvestment,
    });

  if (lang === 'en') {
    return `Client asked to SHOW properties, but budget is UNKNOWN. Thank them briefly for the interest. Ask explicitly for ${
      isInvestment ? 'their *investment size* in €' : 'their *budget* in €'
    }. Example vibe: «${example}». Say you’ll then show matching options. FORBIDDEN: any villas, prices, ranges like 500k–9M, catalog links, or mentioning «±20%» / price corridors. One question only.`;
  }
  if (lang === 'es') {
    return `El cliente pide VER inmuebles, pero el presupuesto es DESCONOCIDO. Agradece el interés. Pregunta explícitamente el ${
      isInvestment ? '*presupuesto de inversión* en €' : '*presupuesto* en €'
    }. Ejemplo: «${example}». Di que luego mostrarás opciones adecuadas. PROHIBIDO: villas, precios, rangos 500k–9M, enlaces, o mencionar «±20%» / corredores de precio. Solo una pregunta.`;
  }
  return `Клиент просит ПОКАЗАТЬ объекты, но бюджет НЕ известен. Коротко поблагодари за интерес. ЯВНО спроси ${
    isInvestment ? '*размер инвестиций* в €' : '*бюджет* / диапазон стоимости в €'
  }. Образец: «${example}». Скажи, что после этого покажешь подходящие варианты. ЗАПРЕЩЕНО: виллы, цены, вилки вроде 500k–9M, ссылки, а также фразы про «±20%» / «коридор €X–€Y». Только один вопрос.`;
}

function formatBudgetBandLabel(budget, lang = 'ru') {
  const band = expandBudgetBand(budget);
  if (!band) return '';
  const fmt = (n) => `€${Number(n).toLocaleString('en-US')}`;
  const range = `${fmt(band.floor)}–${fmt(band.ceiling)}`;
  if (lang === 'en') return `±20% band ${range}`;
  if (lang === 'es') return `banda ±20% ${range}`;
  return `коридор ±20% ${range}`;
}

function getInvestmentBudgetInstruction(lang, dialog) {
  const example =
    dialog?.budgetQuestionExample ||
    pickBudgetQuestionExample(lang === 'en' ? 'en' : lang === 'es' ? 'es' : 'ru', {
      investment: true,
    });
  if (lang === 'en') {
    return `Investment path. Ask *investment size* in € softly (not blunt "what's your budget?"). Example: «${example}». Hints: up to €300k / €300–600k / €600k+. One question. No listings yet. Timeline and cash-on-hand come next.`;
  }
  if (lang === 'es') {
    return `Rama inversión. Pregunta el *tamaño de la inversión* en € con suavidad (no «¿cuál es su presupuesto?» en bruto). Ejemplo: «${example}». Orientación: hasta 300k / 300–600k / desde 600k. Una pregunta. Sin fichas. Luego plazo y dinero ahora.`;
  }
  return `Ветка инвестиций. Спроси *размер инвестиций* в € мягко (не «какой у вас бюджет?» и не «диапазон бюджета»). Образец: «${example}». Ориентиры: до 300k / 300–600k / от 600k. Один вопрос. Объекты НЕ показывай. Дальше — срок и деньги на руках.`;
}

function getInvestmentTimelineInstruction(lang) {
  if (lang === 'en') {
    return `Investment size is known — do not re-ask. No listings yet. First briefly confirm warmly WITHOUT “I remembered / noted”: «Great» or «Great — €1M» / «Perfect, two million euros.» Then one short question about *when they plan to buy/invest*. Preferred wording: «When do you plan to make the purchase? In 2 months, 3 months, or later?»`;
  }
  if (lang === 'es') {
    return `Tamaño de inversión ya conocido — no lo repitas. Sin fichas. Primero confirma en breve SIN «lo anoté / recordé»: «Perfecto» o «Perfecto, un millón de euros.» Luego: *cuándo planean comprar/invertir*. Formulación: «¿Cuándo planean realizar la compra? ¿En 2 meses, 3 meses o más adelante?»`;
  }
  return `Размер инвестиций уже известен — НЕ переспрашивай. Подборку пока не высылай. Сначала коротко подтверди: «Отлично» или «Отлично, миллион евро» / «Отлично — 2 миллиона евро». Без канцелярита про память или запись. Затем срок: «Когда вы планируете совершить покупку? Через 2 месяца, 3 месяца или позже?»`;
}

/** Живая формулировка суммы для подтверждения («миллион евро», не «до €1,000,000»). */
function formatBudgetAckFigure(budget, lang = 'ru') {
  if (!budget) return '';
  const n = budget.maxPrice != null ? budget.maxPrice : budget.minPrice;
  if (n == null || !Number.isFinite(n)) return formatBudgetLabel(budget, lang);

  if (lang === 'ru') {
    if (n === 1_000_000) return 'миллион евро';
    if (n === 1_500_000) return 'полтора миллиона евро';
    if (n === 500_000) return '500 тысяч евро';
    if (n === 300_000) return '300 тысяч евро';
    if (n === 600_000) return '600 тысяч евро';
    if (n >= 1_000_000 && n % 1_000_000 === 0) {
      const m = n / 1_000_000;
      const word = m === 1 ? 'миллион' : m < 5 ? 'миллиона' : 'миллионов';
      return `${m} ${word} евро`;
    }
    if (n >= 1000 && n % 1000 === 0 && n < 1_000_000) {
      const k = n / 1000;
      return `${k} тысяч евро`;
    }
    return `${Number(n).toLocaleString('ru-RU')} евро`;
  }

  if (lang === 'en') {
    if (n === 1_000_000) return 'one million euros';
    if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000} million euros`;
    return `€${Number(n).toLocaleString('en-US')}`;
  }

  if (lang === 'es') {
    if (n === 1_000_000) return 'un millón de euros';
    if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000} millones de euros`;
    return `${Number(n).toLocaleString('es-ES')} €`;
  }

  return formatBudgetLabel(budget, lang);
}

/** Клиент только что назвал бюджет — короткое «Отлично» без «запомнил». */
function getJustRememberedBudgetInstruction(lang, budget) {
  const figure =
    formatBudgetAckFigure(budget, lang) ||
    formatBudgetLabel(budget, lang) ||
    (lang === 'en' ? 'that amount' : lang === 'es' ? 'esa cantidad' : 'эта сумма');
  if (lang === 'en') {
    return `**CONTEXT MEMORY (critical):** Client JUST stated the investment size/budget (${figure}). Confirm briefly — e.g. «Great» or «Great, ${figure}.» — no “I remembered / noted / saved”. Then ask ONLY the next missing step. NEVER ask the budget again.`;
  }
  if (lang === 'es') {
    return `**MEMORIA DE CONTEXTO (crítico):** El cliente ACABA de indicar el tamaño de inversión/presupuesto (${figure}). Confirma en breve — p. ej. «Perfecto» o «Perfecto, ${figure}.» — sin «anotado / lo guardé». Luego SOLO el siguiente paso. NUNCA vuelvas a preguntar el presupuesto.`;
  }
  return `**ПАМЯТЬ КОНТЕКСТА (критично):** Клиент ТОЛЬКО ЧТО назвал размер инвестиций / бюджет (${figure}). Коротко подтверди — например: «Отлично» или «Отлично, ${figure}.» — без канцелярита про память или запись. Сразу спроси ТОЛЬКО следующий недостающий шаг. НИКОГДА не спрашивай снова про бюджет / размер инвестиций.`;
}

function getInvestmentSelectionPreamble(lang) {
  if (lang === 'en') {
    return `**Investment selection (price already known):** Budget, timeline and finances are set. Now collect type/region/area only — do NOT re-ask price. Then shortlist.`;
  }
  if (lang === 'es') {
    return `**Selección inversión (precio ya conocido):** Presupuesto, plazo y finanzas listos. Ahora solo tipo/región/zona — NO repitas el precio. Luego la selección.`;
  }
  return `**Подбор для инвестиций (цена уже известна):** Бюджет, срок и финансы собраны. Сейчас только тип/регион/район — цену НЕ переспрашивай. Потом подборка.`;
}

function getEscalationInstruction(lang = 'ru') {
  if (lang === 'en') {
    return `**ESCALATION:** The client raised a complaint or a complex specialist topic. Stay calm and empathetic. Do not argue or invent legal promises. Softly offer a 10–15 min call with a specialist/manager. One yes/no question.`;
  }
  if (lang === 'es') {
    return `**ESCALADO:** Hay queja o tema complejo de especialista. Mantén la calma y empatía. No discutas ni inventes promesas legales. Ofrece con suavidad una llamada de 10–15 min con un especialista/manager. Una pregunta sí/no.`;
  }
  return `**ЭСКАЛАЦИЯ:** Клиент с жалобой или сложным запросом к специалисту. Спокойно и с эмпатией. Не спорь и не обещай юридически невозможное. Мягко предложи созвон 10–15 мин со специалистом/менеджером. Один вопрос да/нет.`;
}

function resolveStageInstruction(stage, dialog) {
  let text = stageInstructions[stage] || stageInstructions.REFINE;
  const typeLabel = dialog.propertyTypeLabel || 'уточняется';
  const regionLabel = dialog.regionLabel || 'уточняется';
  const microAreaLabel = dialog.microAreaLabel || (dialog.hasLocation ? 'уточняется' : '—');
  const areaOptionsPrompt = dialog.areaOptionsPrompt || 'уточните у клиента';
  const callOfferContext = dialog.callOfferContext || 'ваш запрос';
  const budgetQuestionExample =
    dialog.budgetQuestionExample || pickBudgetQuestionExample('ru');
  const budgetBandHint = '';
  return text
    .replace(/\{propertyTypeLabel\}/g, typeLabel)
    .replace(/\{regionLabel\}/g, regionLabel)
    .replace(/\{microAreaLabel\}/g, microAreaLabel)
    .replace(/\{areaOptionsPrompt\}/g, areaOptionsPrompt)
    .replace(/\{callOfferContext\}/g, callOfferContext)
    .replace(/\{budgetQuestionExample\}/g, budgetQuestionExample)
    .replace(/\{budgetBandHint\}/g, budgetBandHint);
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
    else if (mode === 'target') {
      // Одна цифра бюджета («2 миллиона») — якорь; коридор ±20% даст derivePriceTarget
      maxPrice = v;
      minPrice = null;
    } else {
      // around / около — тоже якорь, без предрасширения ±12% (иначе ±20% сверху раздувает вилку)
      maxPrice = v;
      minPrice = null;
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

  // до / hasta / up to / максимум — берём ПОСЛЕДНЕЕ «до X» в реплике (повысили бюджет)
  const upToAll = [
    ...s.matchAll(
      /(?:до|макс(?:имум)?|не\s*более|up\s*to|hasta|under|below|bis|jusqu.?à|maximum)\s*(\d+(?:[.,]\d+)?)\s*(млн|миллион[а-яё]*|million[a-z]*|millon[a-z]*|тыс[а-яё]*|thousand|k|к|tausend)?/gi
    )
  ];
  if (upToAll.length) {
    const last = upToAll[upToAll.length - 1];
    take(last[1], last[2], 'max');
  }

  // от / from / минимум — последнее
  const fromAll = [
    ...s.matchAll(
      /(?:от|from|минимум|desde|starting|ab)\s*(\d+(?:[.,]\d+)?)\s*(млн|миллион[а-яё]*|million[a-z]*|millon[a-z]*|тыс[а-яё]*|thousand|k|к)?/gi
    )
  ];
  if (fromAll.length) {
    const last = fromAll[fromAll.length - 1];
    take(last[1], last[2], 'min');
  }

  // около / в районе / around / alrededor / ~
  const around = s.match(
    /(?:около|примерно|в\s+районе|around|about|cerca\s+de|alrededor(?:\s+de)?|en\s+torno\s+a|~\s*)\s*(\d+(?:[.,]\d+)?)\s*(млн|миллион[а-яё]*|million[a-z]*|millon[a-z]*|тыс[а-яё]*|thousand|k|к)?/i
  );
  if (around) take(around[1], around[2], 'around');

  // «бюджет 2 миллиона» / «2 млн» / «500к» / «2.5 million» / «600000»
  const withUnit = [...s.matchAll(
    /(\d+(?:[.,]\d+)?)\s*(млн|миллион[а-яё]*|million[a-z]*|millon[a-z]*|тыс[а-яё]*|thousand|k|к)(?![а-яёa-z])/gi
  )];
  if (withUnit.length) {
    const m = withUnit[withUnit.length - 1];
    if (maxPrice == null && minPrice == null) take(m[1], m[2], 'target');
    else if (maxPrice == null) take(m[1], m[2], 'max');
  }

  // Голое крупное число рядом с бюджетом/ценой (600000, 400.000)
  if (minPrice == null && maxPrice == null) {
    const bare = [...s.matchAll(/\b(\d{1,3}(?:[.,\s]\d{3})+|\d{5,7})\b/g)];
    if (bare.length) {
      const digits = bare[bare.length - 1][1].replace(/[^\d]/g, '');
      const v = parseInt(digits, 10);
      if (Number.isFinite(v) && v >= 50000) {
        // Одна сумма = якорь бюджета; ±20% применяется в derivePriceTarget
        maxPrice = v;
      }
    }
  }

  // словесные: «двух миллионов» / «до двух миллионов» / «один миллион»
  const wordMillions = s.match(
    /(?:до|hasta|up\s*to|около|around|бюджет|budget|инвестиц\w*|investment)?\s*(одного|одной|один|одна|двух|трёх|трех|четырех|четырёх|пяти|шести|семи|восьми|девяти|десяти|one|two|three|four|five|un|una|dos|tres|cuatro|cinco)\s+(миллион\w*|million\w*|millon\w*)/i
  );
  if (wordMillions && maxPrice == null && minPrice == null) {
    const n = wordToNumber(wordMillions[1]);
    if (n != null) {
      maxPrice = n * 1_000_000;
    }
  }

  // «бюджет миллион» / «инвестиции миллион» / «миллион евро» без цифры = €1M
  // (\b после кириллицы в JS без флага u не срабатывает)
  if (minPrice == null && maxPrice == null) {
    if (
      /(?:бюджет|инвестиц[а-яё]*|investment|вкладыва[а-яё]*|размер\s+инвестиц[а-яё]*)\s*[:=]?\s*(?:в\s+)?(?:€\s*)?(?:один\s+|одну\s+|one\s+)?(?:миллион[а-яё]*|million[a-z]*|millon[a-z]*|млн)(?![а-яёa-z])/i.test(
        s
      ) ||
      /(?:^|[^\dа-яёa-z])(?:один\s+|одну\s+|one\s+)?(?:миллион[а-яё]*|million[a-z]*|millon[a-z]*)\s*(?:€|eur|евро|euro)(?![а-яёa-z])/i.test(
        s
      )
    ) {
      maxPrice = 1_000_000;
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
    один: 1,
    одна: 1,
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
 * Целевой коридор цены для подборки: ±20% от бюджета (правило 6).
 * @param {{ minPrice: number|null, maxPrice: number|null }} budget
 * @param {{ preferNearMax?: boolean }} [opts]
 * @returns {{ anchor: number, floor: number, ceiling: number, hardMax?: number, hardMin?: number, ratio?: number }|null}
 */
function derivePriceTarget(budget, opts = {}) {
  const band = expandBudgetBand(budget);
  if (!band) return null;
  if (budget?.maxPrice != null && budget?.minPrice == null && opts.preferNearMax === false) {
    band.anchor = Math.round(budget.maxPrice * 0.85);
  }
  return band;
}

/** Клиент просит дороже / повысить бюджет. */
function wantsMoreExpensive(text) {
  return /м[aá]s\s+caro|algo\s+m[aá]s\s+caro|дороже|подороже|повыс(?:им|ь|ить)\s+бюджет|увеличи(?:м|ть)\s+бюджет|more\s+expensive|higher\s+budget|bump\s+(?:the\s+)?budget|teurer|plus\s+cher|augmenter\s+le\s+budget/i.test(
    String(text || '')
  );
}

/**
 * Сумма «на руках» / первый взнос / часть под ипотеку — не бюджет поиска.
 * Инвестиция «миллион» + «800к на руках, остальное ипотека» → искать до €1M, не до €800k.
 */
function isFundsOnHandAmountMessage(text) {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return false;
  // В той же реплике явно задан бюджет/объём инвестиций — это якорь поиска
  if (
    /(?:бюджет|инвестир|вкладыва|покупа\w*\s+на|ищу\s+(?:до|около|за)|budget|presupuesto|invest(?:ment|ir)?|looking\s+(?:up\s+to|around))/i.test(
      s
    )
  ) {
    return false;
  }
  if (
    /(?:на\s+руках|сейчас\s+(?:есть|могу|готов)|готов\s+внести|накоплен|собственн(?:ые|ых)\s+средств|внесу\s+сразу|имею\s+сейчас|cash\s+(?:on\s+hand|ready|available)|money\s+available|ready\s+to\s+pay|efectivo\s+disponible|dinero\s+ahora|tengo\s+ahora|первый\s+взнос|down\s+payment)/i.test(
      s
    )
  ) {
    return true;
  }
  // «800к, остальное ипотека» / «часть + ипотека»
  if (
    /(?:остальное|часть).{0,40}(?:ипотек|кредит|mortgage|hipoteca)|(?:ипотек|кредит|mortgage).{0,40}остальн|(?:часть\s*(?:\+|и|плюс)|частичн).{0,30}(?:ипотек|кредит|mortgage)/i.test(
      s
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Бюджет: приоритет у последней реплики с цифрами (иначе старое «до 350к» затирает «600к»).
 * Суммы «на руках» / под ипотеку не затирают ранее названный объём инвестиций.
 */
function resolveEffectiveBudget(history, allUserText, lastUser) {
  const userMsgs = (history || []).filter((m) => m.sender === 'user');
  const lastBudget = extractBudgetRange(lastUser);
  if (lastBudget.minPrice != null || lastBudget.maxPrice != null) {
    if (isFundsOnHandAmountMessage(lastUser)) {
      for (let i = userMsgs.length - 2; i >= 0; i--) {
        const prevText = userMsgs[i].text;
        if (isFundsOnHandAmountMessage(prevText)) continue;
        const b = extractBudgetRange(prevText);
        if (b.minPrice != null || b.maxPrice != null) {
          return applyMoreExpensiveIntent(lastUser, b, userMsgs);
        }
      }
      // Только сумма на руках — не считаем её потолком каталога
      return { minPrice: null, maxPrice: null };
    }
    return applyMoreExpensiveIntent(lastUser, lastBudget, userMsgs);
  }

  // Идём с конца: первая сумма, которая не «на руках / ипотека»
  for (let i = userMsgs.length - 1; i >= 0; i--) {
    const text = userMsgs[i].text;
    if (isFundsOnHandAmountMessage(text)) continue;
    const b = extractBudgetRange(text);
    if (b.minPrice != null || b.maxPrice != null) {
      return applyMoreExpensiveIntent(lastUser, b, userMsgs);
    }
  }

  // Не склеиваем «на руках» с инвестициями — иначе 800k затирает миллион
  const investmentOnlyText = userMsgs
    .filter((m) => !isFundsOnHandAmountMessage(m.text))
    .map((m) => m.text)
    .join('\n');
  const fallback = extractBudgetRange(investmentOnlyText || allUserText);
  return applyMoreExpensiveIntent(lastUser, fallback, userMsgs);
}

function applyMoreExpensiveIntent(lastUser, budget, userMsgs) {
  let { minPrice, maxPrice } = budget || {};
  if (!wantsMoreExpensive(lastUser)) {
    return { minPrice: minPrice ?? null, maxPrice: maxPrice ?? null };
  }

  // «Más caro» без новой цифры — сдвигаем предыдущий бюджет вверх
  const lastHasNumber = extractBudgetRange(lastUser).minPrice != null || extractBudgetRange(lastUser).maxPrice != null;
  if (!lastHasNumber) {
    const prev = maxPrice ?? minPrice;
    if (prev != null) {
      const raised = Math.round(prev * 1.55);
      minPrice = Math.round(prev * 1.05);
      maxPrice = Math.round(raised * 1.12);
    }
  } else if (minPrice != null && maxPrice != null) {
    // Уже задали ~600к — чуть поджимаем пол снизу, чтобы не тащить 300к
    minPrice = Math.max(minPrice, Math.round(((minPrice + maxPrice) / 2) * 0.85));
  } else if (maxPrice != null && minPrice == null) {
    minPrice = Math.round(maxPrice * 0.75);
  }

  return { minPrice: minPrice ?? null, maxPrice: maxPrice ?? null };
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
    if (lang === 'pl') return `od ${fmt(minPrice)} do ${fmt(maxPrice)}`;
    if (lang === 'nl') return `${fmt(minPrice)}–${fmt(maxPrice)}`;
    return `от ${fmt(minPrice)} до ${fmt(maxPrice)}`;
  }
  if (maxPrice != null) {
    if (lang === 'es') return `hasta ${fmt(maxPrice)}`;
    if (lang === 'en') return `up to ${fmt(maxPrice)}`;
    if (lang === 'de') return `bis ${fmt(maxPrice)}`;
    if (lang === 'fr') return `jusqu’à ${fmt(maxPrice)}`;
    if (lang === 'pl') return `do ${fmt(maxPrice)}`;
    if (lang === 'nl') return `tot ${fmt(maxPrice)}`;
    return `до ${fmt(maxPrice)}`;
  }
  if (minPrice != null) {
    if (lang === 'es') return `desde ${fmt(minPrice)}`;
    if (lang === 'en') return `from ${fmt(minPrice)}`;
    if (lang === 'de') return `ab ${fmt(minPrice)}`;
    if (lang === 'fr') return `à partir de ${fmt(minPrice)}`;
    if (lang === 'pl') return `od ${fmt(minPrice)}`;
    if (lang === 'nl') return `vanaf ${fmt(minPrice)}`;
    return `от ${fmt(minPrice)}`;
  }
  return '';
}

function buildDialogMemoryBlock(state, lang = 'ru') {
  const known = [];
  const neverAsk = [];
  if (state.hasPurpose) {
    const purposeLabel =
      state.purposeKind === 'investment'
        ? lang === 'es'
          ? 'objetivo: inversión'
          : lang === 'en'
            ? 'goal: investment'
            : 'цель: инвестиции'
        : lang === 'es'
          ? 'objetivo: vivir'
          : lang === 'en'
            ? 'goal: living'
            : 'цель: для себя/жизнь';
    known.push(purposeLabel);
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
  if (state.hasLocation) {
    known.push(state.microAreaLabel || (lang === 'en' ? 'area' : 'район'));
    neverAsk.push(lang === 'es' ? 'zona/área' : lang === 'en' ? 'area/district' : 'район/зона');
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
  if (state.hasTimeline) {
    known.push(
      lang === 'es' ? 'plazo' : lang === 'en' ? 'timeline' : 'срок покупки'
    );
    neverAsk.push(
      lang === 'es'
        ? 'plazo de compra'
        : lang === 'en'
          ? 'purchase timeline'
          : 'срок покупки/инвестиции'
    );
  }
  if (state.hasFundsNow) {
    known.push(
      lang === 'es' ? 'dinero ahora' : lang === 'en' ? 'cash on hand' : 'деньги на руках'
    );
    neverAsk.push(
      lang === 'es'
        ? 'efectivo disponible'
        : lang === 'en'
          ? 'cash available now'
          : 'деньги сейчас на руках'
    );
  }
  if (state.hasMortgageAnswered) {
    known.push(lang === 'es' ? 'hipoteca' : lang === 'en' ? 'mortgage' : 'ипотека да/нет');
    neverAsk.push(
      lang === 'es' ? 'hipoteca sí/no' : lang === 'en' ? 'mortgage yes/no' : 'нужна ли ипотека'
    );
  }

  if (!neverAsk.length) return '';

  const locationLock =
    state.hasLocation && state.microAreaLabel
      ? lang === 'es'
        ? ` Zona ya indicada: ${state.microAreaLabel} — no preguntes otra zona.`
        : lang === 'en'
          ? ` Area already given: ${state.microAreaLabel} — do not ask for another zone.`
          : lang === 'de'
            ? ` Zone bereits genannt: ${state.microAreaLabel} — keine andere Zone fragen.`
            : lang === 'fr'
              ? ` Zone déjà indiquée: ${state.microAreaLabel} — ne pas redemander la zone.`
              : lang === 'pl'
                ? ` Strefa już podana: ${state.microAreaLabel} — nie pytaj o inną strefę.`
                : lang === 'nl'
                  ? ` Zone al genoemd: ${state.microAreaLabel} — vraag geen andere zone.`
                  : ` Район уже указан: ${state.microAreaLabel} — не спрашивай другую зону.`
      : '';

  const moreHint = state.wantsMoreLikeThese
    ? lang === 'es'
      ? ' El cliente pide más/similares — envía nueva selección YA con estos criterios.'
      : lang === 'en'
        ? ' Client wants more/similar options — send a new shortlist NOW using these criteria.'
        : lang === 'de'
          ? ' Kunde will mehr/ähnliche — sofort neue Auswahl mit diesen Kriterien.'
          : lang === 'fr'
            ? ' Le client veut plus/similaires — nouvelle sélection MAINTENANT avec ces critères.'
            : lang === 'pl'
              ? ' Klient prosi o więcej/podobne — od razu nowa selekcja według tych kryteriów.'
              : lang === 'nl'
                ? ' Klant wil meer/vergelijkbaar — meteen nieuwe selectie met deze criteria.'
                : ' Клиент просит ещё/похожие — сразу новая подборка по этим критериям, без вопросов про бюджет/район/тип.'
    : '';

  const budgetLock = state.hasBudget
    ? lang === 'es'
      ? ' El presupuesto está guardado en este chat (y en la base) — NUNCA preguntes de nuevo «¿cuál es su presupuesto?» salvo que el cliente lo cambie.'
      : lang === 'en'
        ? ' Budget is stored for this chat (and in DB) — NEVER ask «what is your budget?» again unless the client changes it.'
        : ' Бюджет сохранён в этом чате (и в БД) — НИКОГДА не спрашивай снова «какой у вас бюджет?», пока клиент сам не изменит цифру.'
    : '';

  if (lang === 'es') {
    return `**MEMORIA DEL DIÁLOGO (obligatorio):** Ya sabemos: ${known.join('; ')}. NO vuelvas a preguntar: ${neverAsk.join(', ')}.${locationLock}${budgetLock}${moreHint} Pregunta solo lo que aún falta.`;
  }
  if (lang === 'en') {
    return `**DIALOG MEMORY (mandatory):** Already known: ${known.join('; ')}. Do NOT re-ask: ${neverAsk.join(', ')}.${locationLock}${budgetLock}${moreHint} Ask only for what is still missing.`;
  }
  if (lang === 'de') {
    return `**DIALOGGEDÄCHTNIS (pflicht):** Bereits bekannt: ${known.join('; ')}. NICHT erneut fragen: ${neverAsk.join(', ')}.${locationLock}${budgetLock}${moreHint} Nur fragen, was noch fehlt.`;
  }
  if (lang === 'fr') {
    return `**MÉMOIRE DU DIALOGUE (obligatoire):** Déjà connu: ${known.join('; ')}. NE PAS redemander: ${neverAsk.join(', ')}.${locationLock}${budgetLock}${moreHint} Demander seulement ce qui manque.`;
  }
  if (lang === 'pl') {
    return `**PAMIĘĆ DIALOGU (obowiązkowe):** Już wiadomo: ${known.join('; ')}. NIE pytaj ponownie: ${neverAsk.join(', ')}.${locationLock}${budgetLock}${moreHint} Pytaj tylko o to, czego jeszcze brakuje.`;
  }
  if (lang === 'nl') {
    return `**DIALOOGGEHEUGEN (verplicht):** Al bekend: ${known.join('; ')}. NIET opnieuw vragen: ${neverAsk.join(', ')}.${locationLock}${budgetLock}${moreHint} Vraag alleen wat nog ontbreekt.`;
  }
  return `**ПАМЯТЬ ДИАЛОГА (обязательно):** Уже известно: ${known.join('; ')}. НЕ переспрашивай: ${neverAsk.join(', ')}.${locationLock}${budgetLock}${moreHint} Спрашивай только то, чего ещё нет.`;
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
  resolveEffectiveBudget,
  isFundsOnHandAmountMessage,
  wantsMoreExpensive,
  formatBudgetLabel,
  formatBudgetAckFigure,
  formatBudgetBandLabel,
  buildDialogMemoryBlock,
  budgetHasSignal,
  wantsIgnoreBudget,
  detectInvestmentTimeline,
  wantsEscalation,
  detectPurposeKind,
  LOCATION_KEYWORDS,
  detectMicroAreas,
  detectRegionPreference,
  REGION_OPTIONS_PROMPT,
  analyzePurchaseFinance
};
