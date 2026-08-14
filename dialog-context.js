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
  lastMessageConfirmsMortgage,
  getFinanceStageInstruction,
  getMortgageStepsInstruction,
  getMortgageConfirmedPitchInstruction,
  formatFinanceSummaryForPrompt,
  getPropertySelectedStageInstruction,
} = require('./purchase-finance');
const { normalizeSalesLang, getStageInstruction } = require('./sales-localization');
const { wantsManagerHandoff, buildCallOfferContext } = require('./manager-handoff');
const { pickBudgetQuestionExample } = require('./budget-questions');
const {
  detectInvestmentTimeline,
  wantsEscalation,
  expandBudgetBand,
} = require('./bot-core-rules');
const {
  needsBusinessSectorQuestion,
  resolveBusinessSectorPreference,
  formatSectorLabel,
  getBusinessSectorStageInstruction,
} = require('./business-sectors');
const {
  isOffTopicChatter,
  formatOffTopicInstruction,
  lastMessageHasGreeting,
} = require('./keyword-relevance');

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
  const sectorPref = resolveBusinessSectorPreference(history, salesLang, { propertyTypes });
  const needsBusinessSector =
    isInvestment && needsBusinessSectorQuestion(propertyTypes);
  const hasBusinessSector = !needsBusinessSector || sectorPref.hasSector;
  const businessSectors = sectorPref.sectors;
  const businessSectorLabel = sectorPref.label || formatSectorLabel(businessSectors, salesLang);
  const businessSectorIsOther = Boolean(sectorPref.isOther);
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
    /похож|ещё\s*(?:так|раз|вариант|объект|вилл|апартамент|квартир|опци)|еще\s*(?:так|раз|вариант|объект|вилл|апартамент|квартир|опци)|другие\s*(?:вариант|опци|вилл|объект)|все\s+(?:вилл|апартамент|квартир|вариант|объект)|по\s+моим\s+параметр|что\s+(?:ещё|еще)\s+есть|которые?\s+у\s+вас\s+есть|similar|more\s+(?:like|options|listings|villas?)|show\s+(?:me\s+)?(?:all|more)\s+(?:the\s+)?(?:villas?|apartments?|options)|otra\s+opci|otras?\s+(?:opcion|ficha)|parecid|ähnliche|aehnliche|weitere\s+(?:option|villen)|plus\s+d.?options|similaires|autres?\s+(?:options|fiches|villas)/i.test(
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
    hasType &&
    hasBusinessSector &&
    hasRegion &&
    !needsMicroArea;

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
    } else if (needsBusinessSector && !hasBusinessSector) {
      stage = 'NEED_BUSINESS_SECTOR';
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
      stage === 'NEED_BUSINESS_SECTOR' ||
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
    stage =
      finance.financeStage === 'NEED_FUNDS_NOW' ? 'PROPERTY_SELECTED' : finance.financeStage;
  }

  // После выбора объекта — не возвращаемся к подборке
  if (finance.hasPropertyInterest && stage === 'SHOW_LISTINGS') {
    if (finance.financeStage === 'PROPERTY_CLOSING') stage = 'OFFER_MANAGER_CALL';
    else if (finance.financeStage === 'NEED_MORTGAGE') stage = 'NEED_MORTGAGE';
    else if (finance.financeStage === 'NEED_FUNDS_NOW') stage = 'PROPERTY_SELECTED';
    else if (finance.financeStage === 'FINANCE_DOCUMENTS') stage = 'FINANCE_DOCUMENTS';
    else if (finance.financeStage === 'FINANCE_DOCUMENTS_CASH') stage = 'FINANCE_DOCUMENTS_CASH';
    else stage = 'PROPERTY_SELECTED';
  }

  const dialogCtx = {
    propertyTypeLabel,
    businessSectorLabel,
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
  if (hasBusinessSector && businessSectorLabel && !businessSectorIsOther) {
    dialogCtx.businessSectorHint =
      salesLang === 'ru'
        ? `, сфера ${businessSectorLabel}`
        : salesLang === 'es'
          ? `, sector ${businessSectorLabel}`
          : `, sector ${businessSectorLabel}`;
  } else {
    dialogCtx.businessSectorHint = '';
  }

  const useFinanceInstruction =
    stage === 'NEED_FUNDS_NOW' ||
    stage === 'NEED_MORTGAGE' ||
    stage === 'FINANCE_DOCUMENTS' ||
    stage === 'FINANCE_DOCUMENTS_CASH' ||
    stage === 'PROPERTY_SELECTED';

  let stageInstruction = useFinanceInstruction
    ? stage === 'PROPERTY_SELECTED'
      ? getPropertySelectedStageInstruction(salesLang)
      : getFinanceStageInstruction(stage, salesLang)
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
  } else if (stage === 'NEED_BUSINESS_SECTOR') {
    stageInstruction = getBusinessSectorStageInstruction(salesLang);
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
  } else if (
    finance.needsMortgage &&
    finance.hasMortgageAnswered &&
    lastMessageConfirmsMortgage(lastUser)
  ) {
    // «600к на руках, остальное ипотека» / «80% есть, 20% в ипотеку» — сразу помощь HT + ставки
    stageInstruction = `${getMortgageConfirmedPitchInstruction(salesLang)}\n\n${stageInstruction}`;
  }

  if (finance.hasPropertyInterest && stage !== 'SHOW_LISTINGS' && stage !== 'FIRST_CONTACT') {
    const postPickByLang = {
      ru: `**ПОСЛЕ ВЫБОРА ОБЪЕКТА:** Клиент выбрал вариант — подтверди выбор, затем финансы по объекту (если ещё не ясны) → документы → созвон с менеджером для просмотра и заявки. Не возвращайся к новой подборке.`,
      en: `**AFTER PROPERTY PICK:** Client chose a listing — confirm it, then object-level finances (if unclear) → documents → manager call for viewing and purchase request. Do not start a new shortlist.`,
      es: `**TRAS ELEGIR FICHA:** El cliente eligió — confirma, finanzas del objeto (si faltan) → documentos → llamada con el manager para visita y solicitud. No vuelvas a una nueva selección.`,
    };
    stageInstruction = `${postPickByLang[salesLang] || postPickByLang.en}\n\n${stageInstruction}`;
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
      hasBusinessSector,
      businessSectors,
      businessSectorLabel,
      businessSectorIsOther,
      needsBusinessSector,
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

  // Приветствие — в самом верху stageInstruction (после memory), иначе модель игнорирует
  // Срабатывает: 1-е сообщение ИЛИ клиент снова написал «привет/здравствуйте…» mid-chat
  const clientGreetedNow = lastMessageHasGreeting(lastUser);
  const needsGreetingReply =
    stage === 'FIRST_CONTACT' ||
    userTurns <= 1 ||
    clientGreetedNow;
  if (needsGreetingReply) {
    const greetingMustByLang = {
      ru: `**ПРИВЕТСТВИЕ (обязательно в ЭТОМ ответе — приоритет выше памяти/воронки):** Клиент${clientGreetedNow ? ' поздоровался («привет» / «здравствуйте»…)' : ' пишет первое сообщение'}. ОБЯЗАТЕЛЬНО начни ответ с приветствия и представления: «Здравствуйте! Меня зовут Максим, House Tenerife.» (или «Привет! Меня зовут Максим, House Tenerife.»). Затем — вопрос текущего этапа. ЗАПРЕЩЕНО начинать с «Отлично» / «Понял» / сразу с вопроса про регион без приветствия. Всегда на «Вы».`,
      en: `**GREETING (mandatory in THIS reply — overrides memory/funnel):** The client${clientGreetedNow ? ' greeted you («hi» / «hello»…)' : ' is on the first message'}. You MUST start with a greeting and introduction: “Hi! I’m Maxim from House Tenerife.” Then the current-stage question. FORBIDDEN to open with “Great” / “Got it” / a region question without greeting.`,
      es: `**SALUDO (obligatorio en ESTA respuesta — prioridad sobre memoria/embudo):** El cliente${clientGreetedNow ? ' saludó («hola»…)' : ' está en el primer mensaje'}. DEBES empezar con saludo y presentación: «¡Hola! Soy Maxim de House Tenerife.» Luego la pregunta de la etapa. PROHIBIDO empezar con «Perfecto» / «Entendido» sin saludo.`,
      de: `**BEGRÜSSUNG (pflicht in DIESER Antwort — Vorrang vor Gedächtnis/Trichter):** Der Kunde${clientGreetedNow ? ' hat gegrüßt («hallo»…)' : ' schreibt die erste Nachricht'}. Du MUSST mit Begrüßung und Vorstellung beginnen: «Hallo! Ich bin Maxim von House Tenerife.» Dann die Stufenfrage. VERBOTEN mit «Super» / «Verstanden» ohne Begrüßung zu starten.`,
      fr: `**SALUTATION (obligatoire dans CETTE réponse — priorité sur mémoire/entonnoir):** Le client${clientGreetedNow ? ' a salué («bonjour» / «salut»…)' : ' est au premier message'}. Tu DOIS commencer par salutation et présentation: «Bonjour! Je suis Maxim de House Tenerife.» Puis la question d’étape. INTERDIT de commencer par «Parfait» / «Compris» sans salutation.`,
      pl: `**POWITANIE (obowiązkowe w TEJ odpowiedzi — priorytet nad pamięcią/lejkiem):** Klient${clientGreetedNow ? ' się przywitał («cześć» / «dzień dobry»…)' : ' pisze pierwszą wiadomość'}. MUSISZ zacząć od powitania i przedstawienia: «Dzień dobry! Nazywam się Maxim, House Tenerife.» Potem pytanie etapu. ZAKAZ zaczynać od «Świetnie» / «Rozumiem» bez powitania.`,
      nl: `**BEGROETING (verplicht in DIT antwoord — voorrang op geheugen/trechter):** De klant${clientGreetedNow ? ' groette («hallo»…)' : ' stuurt het eerste bericht'}. Je MOET beginnen met begroeting en voorstelling: «Hallo! Ik ben Maxim van House Tenerife.» Daarna de fasevraag. VERBODEN te openen met «Top» / «Begrepen» zonder begroeting.`,
    };
    stageInstruction = `${greetingMustByLang[salesLang] || greetingMustByLang.en}\n\n${stageInstruction}`;
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
    hasBusinessSector,
    needsBusinessSector,
    businessSectors,
    businessSectorLabel,
    businessSectorIsOther,
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
  FIRST_CONTACT: `Первый контакт / приветствие. ОБЯЗАТЕЛЬНО начни с приветствия и представления: «Здравствуйте! Меня зовут Максим, House Tenerife» (допустимо «Привет!» — но не без представления). Помогаешь с недвижимостью и инвестициями. Не «бот». Обращение только на «Вы». Тон WhatsApp: коротко, тепло, один 🙂 или :). Если клиент написал «привет / как дела?» без темы недвижимости — НЕ присылай виллы и ссылки. Образец: «Здравствуйте! Меня зовут Максим, House Tenerife. Я здесь, чтобы помочь с инвестициями в недвижимость. Какой у Вас размер инвестиций?» (или: для себя / под инвестиции, если цель ещё не ясна). Не начинай сразу с «Отлично» без приветствия. Объекты и ссылки ЗАПРЕЩЕНЫ.`,

  NEED_PURPOSE: `Цель не ясна — обязательный шаг ДО любых предложений. Не повторяй вопрос клиента и не начинай с канцелярского «понял ваш запрос». Живо: один вопрос — жизнь/семья/переезд или инвестиция (аренда, перепродажа, бизнес)? Одна короткая фраза, зачем это важно. Без объектов.`,

  NEED_PROPERTY_TYPE: `Сразу уточни *тип*: апартаменты, вилла, дом, земля, коммерция, готовый бизнес, инвест-проект — не «жильё» в общем. Не предполагай виллу. Если тип УЖЕ известен и клиент просто вернулся («а что по виллам?») — НЕ читай лекцию про инвестиции в виллы, иди к следующему шагу воронки. Без ссылок и без переспроса уже известного бюджета.`,

  NEED_BUSINESS_SECTOR: `Клиент выбрал готовый бизнес или инвест-проект — один живой вопрос про *сферу* (7 направлений + «другое»), своими словами, без списка и нумерации. Регион пока не спрашивай. Без объектов и ссылок.`,

  NEED_REGION: `Один живой вопрос про регион/город: Тенерифе, Дубай, Ибица, Марбелья, Малага, Барселона? Если бюджет уже известен — мягко подскажи 1–2 сильные зоны под этот бюджет из каталога (напр. Adeje / Ибица / Марбелья — только реальные названия). Можно: «если не определились — подскажу сильные зоны под вашу цель и бюджет». Без подборки и без буклета.`,

  NEED_LOCATION: `Уточни район в ${'{regionLabel}'}. Предлагай ТОЛЬКО реальные зоны из каталога и копируй их написание БУКВАЛЬНО: ${'{areaOptionsPrompt}'}. Если бюджет известен — предложи 2–3 зоны, которые обычно хорошо стыкуются с этим бюджетом (из списка выше, без выдумок). Один короткий вопрос. Без подборки.`,

  NEED_BUDGET: `Спроси о бюджете / размере инвестиций мягко — не в лоб «какой у вас бюджет?». Для инвестиций лучше: «какой у вас размер инвестиций?». Образец: «{budgetQuestionExample}». Ориентиры по €: до 300k / 300–600k / от 600k. Уже известное (тип/регион/район) не переспрашивай. Один вопрос. Объекты НЕ показывай. Тон чата, не анкета.`,

  NEED_TIMELINE: `Бюджет / размер инвестиций уже известен — НЕ переспрашивай. Если клиент только что назвал сумму — коротко подтверди: «Отлично» или «Отлично, миллион евро» / «Отлично — 2 миллиона евро». Без канцелярита про память или запись. Подборку пока не высылай. Затем один мягкий вопрос про *срок покупки/инвестирования*. Образец: «Когда вы планируете совершить покупку? Через 2 месяца, 3 месяца или позже?» Коротко, тепло.`,

  NEED_FUNDS_NOW: `Финансы ДО подборки. Один вопрос: сколько денег есть *сейчас* на руках — «все своими», «часть + ипотека» или сумма в €. Это НЕ бюджет поиска: подборку потом строй по ранее названному размеру инвестиций/бюджету (например миллион), а не по сумме на руках. Объекты НЕ показывай.`,

  NEED_MORTGAGE: `Форма оплаты: один вопрос — нужна ипотека/кредит в Испании или свои средства? Если клиент сказал «весь миллион / всё на руках» — считай оплату своими, ипотека не нужна, можно к подборке. Объекты пока НЕ показывай, пока ипотека не прояснена.`,

  SHOW_LISTINGS: `ОБЯЗАТЕЛЬНО дай подборку 3–5 РАЗНЫХ объектов прямо сейчас (не обещай «пришлю позже», не ограничивайся одной ссылкой): тип ${'{propertyTypeLabel}'}${'{businessSectorHint}'}, регион ${'{regionLabel}'}, район ${'{microAreaLabel}'}. Только из блока каталога (система уже отфильтровала по бюджету и сфере). ЗАПРЕЩЕНО говорить клиенту про «±26%», «коридор €X–€Y» или что вы расширяете/сужаете бюджет — просто покажи варианты. Начни коротко: «Вот варианты…» без вилки цен. Формат:
• *Название* — €цена
  [одна живая фраза-выгода под цель — БЕЗ «Почему вам»]
  ссылка
Минимум 3 объекта, если в каталоге есть столько URL. Закрой: «Какой вариант ближе?» Критерии из памяти НЕ переспрашивай.`,

  REFINE: `Ответь по последней реплике. Если просят ещё/похожие — сразу новая подборка 3–5 из каталога по УЖЕ известным критериям. Один вопрос в конце.`,

  OFFER_MANAGER_CALL: `Клиент готов к живому контакту. НЕ пиши «запрос передан», телефон менеджера. Тёпло предложи созвон 10–15 минут. Один вопрос да/нет. 2–4 строки.`,
};

function formatFunnelPathBlock(isInvestment, lang = 'ru') {
  const code = normalizeSalesLang(lang);
  if (code === 'ru') {
    return isInvestment
      ? `**АКТИВНАЯ ВЕТКА: ИНВЕСТИЦИИ** (строгий порядок — не перескакивай к объектам):
1) Размер инвестиций в € → 2) Срок инвестирования → 3) Деньги сейчас (все / часть / ипотека) → 4) Потом критерии подбора БЕЗ переспроса цены (тип → сфера бизнеса*, если бизнес/инвест-проект → регион → район) → 5) Подборка ±26%.
*Сфера — только для готового бизнеса и инвест-проектов.
ЗАПРЕЩЕНО предлагать виллы/проекты до размера инвестиций, срока и финансов.`
      : `**АКТИВНАЯ ВЕТКА: ДЛЯ СЕБЯ / ЖИЗНЬ** (строгий порядок):
1) Цель (для себя или инвестиции) → 2) Город/регион → 3) Район → 4) Тип → 5) Бюджет € → 6) Деньги на руках / ипотека → 7) Подборка ±26%.
ЗАПРЕЩЕНО слать объекты до бюджета и финансов.`;
  }
  if (code === 'es') {
    return isInvestment
      ? `**EMBUDO ACTIVO: INVERSIÓN** (orden estricto):
1) Presupuesto de inversión € → 2) Plazo → 3) Dinero ahora / todo / parte / hipoteca → 4) Criterios de selección SIN repetir precio (tipo → sector de negocio*, si negocio/proyecto → región → zona) → 5) Selección ±26%.
*Sector solo para negocio en venta o proyecto de inversión.
NUNCA ofrezcas fichas antes de presupuesto + plazo + finanzas.`
      : `**EMBUDO ACTIVO: PARA VIVIR** (orden estricto):
1) Objetivo → 2) Ciudad/región → 3) Zona → 4) Tipo → 5) Presupuesto € → 6) Dinero en mano / hipoteca → 7) Selección ±26%.
NUNCA envíes fichas antes del presupuesto y las finanzas.`;
  }
  // en / de / fr / pl / nl — EN overlay (packs already localize stage text; never fall back to RU)
  return isInvestment
    ? `**ACTIVE FUNNEL: INVESTMENT** (strict order — never skip ahead to listings):
1) Investment budget in € → 2) Investment timeline → 3) Cash now / all / part / mortgage → 4) Then selection criteria WITHOUT re-asking price (type → business sector*, if business/investment project → region → area) → 5) Shortlist ±26%.
*Sector step only for business for sale or investment/development projects.
NEVER offer villas/projects before budget + timeline + finances. Client reply language = dialog language only.`
    : `**ACTIVE FUNNEL: FOR LIVING / SELF** (strict order):
1) Goal (self vs invest) → 2) City/region → 3) District → 4) Property type → 5) Budget € → 6) Cash on hand / mortgage → 7) Shortlist ±26%.
NEVER send listings before budget and finances. Client reply language = dialog language only.`;
}

function getAskBudgetBeforeListingsInstruction(lang, opts = {}) {
  const isInvestment = Boolean(opts.isInvestment);
  const code = normalizeSalesLang(lang);
  const example =
    opts.budgetQuestionExample ||
    pickBudgetQuestionExample(code, { investment: isInvestment });

  if (code === 'ru') {
    return `Клиент просит ПОКАЗАТЬ объекты, но бюджет НЕ известен. Коротко поблагодари за интерес. ЯВНО спроси ${
      isInvestment ? '*размер инвестиций* в €' : '*бюджет* / диапазон стоимости в €'
    }. Образец: «${example}». Скажи, что после этого покажешь подходящие варианты. ЗАПРЕЩЕНО: виллы, цены, вилки вроде 500k–9M, ссылки, а также фразы про «±26%» / «коридор €X–€Y». Только один вопрос.`;
  }
  if (code === 'es') {
    return `El cliente pide VER inmuebles, pero el presupuesto es DESCONOCIDO. Agradece el interés. Pregunta explícitamente el ${
      isInvestment ? '*presupuesto de inversión* en €' : '*presupuesto* en €'
    }. Ejemplo: «${example}». Di que luego mostrarás opciones adecuadas. PROHIBIDO: villas, precios, rangos 500k–9M, enlaces, o mencionar «±26%» / corredores de precio. Solo una pregunta.`;
  }
  return `Client asked to SHOW properties, but budget is UNKNOWN. Thank them briefly for the interest. Ask explicitly for ${
    isInvestment ? 'their *investment size* in €' : 'their *budget* in €'
  }. Example vibe: «${example}». Say you’ll then show matching options. FORBIDDEN: any villas, prices, ranges like 500k–9M, catalog links, or mentioning «±26%» / price corridors. One question only. Reply in the dialog language only.`;
}

function formatBudgetBandLabel(budget, lang = 'ru') {
  const band = expandBudgetBand(budget);
  if (!band) return '';
  const fmt = (n) => `€${Number(n).toLocaleString('en-US')}`;
  const range = `${fmt(band.floor)}–${fmt(band.ceiling)}`;
  const pct = Math.round((band.ratio || 0.26) * 100);
  if (lang === 'en') return `±${pct}% band ${range}`;
  if (lang === 'es') return `banda ±${pct}% ${range}`;
  return `коридор ±${pct}% ${range}`;
}

function getInvestmentBudgetInstruction(lang, dialog) {
  const code = normalizeSalesLang(lang);
  const example =
    dialog?.budgetQuestionExample ||
    pickBudgetQuestionExample(code, { investment: true });
  if (code === 'ru') {
    return `Ветка инвестиций. Спроси *размер инвестиций* в € мягко (не «какой у вас бюджет?» и не «диапазон бюджета»). Образец: «${example}». Ориентиры: до 300k / 300–600k / от 600k. Один вопрос. Объекты НЕ показывай. Дальше — срок и деньги на руках.`;
  }
  if (code === 'es') {
    return `Rama inversión. Pregunta el *tamaño de la inversión* en € con suavidad (no «¿cuál es su presupuesto?» en bruto). Ejemplo: «${example}». Orientación: hasta 300k / 300–600k / desde 600k. Una pregunta. Sin fichas. Luego plazo y dinero ahora.`;
  }
  return `Investment path. Ask *investment size* in € softly (not blunt "what's your budget?"). Example: «${example}». Hints: up to €300k / €300–600k / €600k+. One question. No listings yet. Timeline and cash-on-hand come next. Reply in the dialog language only.`;
}

function getInvestmentTimelineInstruction(lang) {
  const code = normalizeSalesLang(lang);
  if (code === 'ru') {
    return `Размер инвестиций уже известен — НЕ переспрашивай. Подборку пока не высылай. Сначала коротко подтверди: «Отлично» или «Отлично, миллион евро» / «Отлично — 2 миллиона евро». Без канцелярита про память или запись. Затем срок: «Когда вы планируете совершить покупку? Через 2 месяца, 3 месяца или позже?»`;
  }
  if (code === 'es') {
    return `Tamaño de inversión ya conocido — no lo repitas. Sin fichas. Primero confirma en breve SIN «lo anoté / recordé»: «Perfecto» o «Perfecto, un millón de euros.» Luego: *cuándo planean comprar/invertir*. Formulación: «¿Cuándo planean realizar la compra? ¿En 2 meses, 3 meses o más adelante?»`;
  }
  return `Investment size is known — do not re-ask. No listings yet. First briefly confirm warmly WITHOUT “I remembered / noted”: «Great» or «Great — €1M» / «Perfect, two million euros.» Then one short question about *when they plan to buy/invest*. Preferred wording: «When do you plan to make the purchase? In 2 months, 3 months, or later?» Reply in the dialog language only.`;
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
  const code = normalizeSalesLang(lang);
  const figure =
    formatBudgetAckFigure(budget, code) ||
    formatBudgetLabel(budget, code) ||
    (code === 'ru' ? 'эта сумма' : code === 'es' ? 'esa cantidad' : 'that amount');
  if (code === 'ru') {
    return `**ПАМЯТЬ КОНТЕКСТА (критично):** Клиент ТОЛЬКО ЧТО назвал размер инвестиций / бюджет (${figure}). Коротко подтверди — например: «Отлично» или «Отлично, ${figure}.» — без канцелярита про память или запись. Сразу спроси ТОЛЬКО следующий недостающий шаг. НИКОГДА не спрашивай снова про бюджет / размер инвестиций.`;
  }
  if (code === 'es') {
    return `**MEMORIA DE CONTEXTO (crítico):** El cliente ACABA de indicar el tamaño de inversión/presupuesto (${figure}). Confirma en breve — p. ej. «Perfecto» o «Perfecto, ${figure}.» — sin «anotado / lo guardé». Luego SOLO el siguiente paso. NUNCA vuelvas a preguntar el presupuesto.`;
  }
  return `**CONTEXT MEMORY (critical):** Client JUST stated the investment size/budget (${figure}). Confirm briefly — e.g. «Great» or «Great, ${figure}.» — no “I remembered / noted / saved”. Then ask ONLY the next missing step. NEVER ask the budget again. Reply in the dialog language only.`;
}

function getInvestmentSelectionPreamble(lang) {
  const code = normalizeSalesLang(lang);
  if (code === 'ru') {
    return `**Подбор для инвестиций (цена уже известна):** Бюджет, срок и финансы собраны. Сейчас только тип/регион/район — цену НЕ переспрашивай. Потом подборка.`;
  }
  if (code === 'es') {
    return `**Selección inversión (precio ya conocido):** Presupuesto, plazo y finanzas listos. Ahora solo tipo/región/zona — NO repitas el precio. Luego la selección.`;
  }
  return `**Investment selection (price already known):** Budget, timeline and finances are set. Now collect type/region/area only — do NOT re-ask price. Then shortlist. Reply in the dialog language only.`;
}

function getEscalationInstruction(lang = 'ru') {
  const code = normalizeSalesLang(lang);
  if (code === 'ru') {
    return `**ЭСКАЛАЦИЯ:** Клиент с жалобой или сложным запросом к специалисту. Спокойно и с эмпатией. Не спорь и не обещай юридически невозможное. Мягко предложи созвон 10–15 мин со специалистом/менеджером. Один вопрос да/нет.`;
  }
  if (code === 'es') {
    return `**ESCALADO:** Hay queja o tema complejo de especialista. Mantén la calma y empatía. No discutas ni inventes promesas legales. Ofrece con suavidad una llamada de 10–15 min con un especialista/manager. Una pregunta sí/no.`;
  }
  return `**ESCALATION:** The client raised a complaint or a complex specialist topic. Stay calm and empathetic. Do not argue or invent legal promises. Softly offer a 10–15 min call with a specialist/manager. One yes/no question. Reply in the dialog language only.`;
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
  const businessSectorHint = dialog.businessSectorHint || '';
  return text
    .replace(/\{propertyTypeLabel\}/g, typeLabel)
    .replace(/\{businessSectorHint\}/g, businessSectorHint)
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
  return /кроме\s+цен|без\s+(?:учёта|учета|ограничения|лимита)\s+цен|любой\s+цен|любой\s+бюджет|не\s+смотр(?:я|и)\s+на\s+цен|независимо\s+от\s+цен|все\s+(?:вилл|апартамент|квартир|вариант|объект).{0,40}(?:есть|имеете|можете)|(?:ещё|еще)\s+(?:вилл|апартамент|вариант).{0,40}(?:есть|у\s+вас)|что\s+(?:ещё|еще)\s+есть|все\s+что\s+есть|покаж(?:и|ите).{0,30}все.{0,20}(?:вилл|апартамент|вариант)|any\s+price|any\s+budget|regardless\s+of\s+(?:the\s+)?price|without\s+(?:a\s+)?(?:price|budget)\s+limit|ignore\s+(?:the\s+)?(?:price|budget)|show\s+(?:me\s+)?all\s+(?:the\s+)?(?:villas?|apartments?|options)|sin\s+(?:l[ií]mite\s+de\s+)?(?:precio|presupuesto)|ohne\s+(?:preis|budget)(?:limit)?|beliebiges\s+budget|peu\s+importe\s+le\s+prix|sans\s+limite\s+de\s+prix|n.?importe\s+quel\s+budget/i.test(
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
      // Одна цифра бюджета («2 миллиона») — якорь; коридор ±26% даст derivePriceTarget
      maxPrice = v;
      minPrice = null;
    } else {
      // around / около — тоже якорь, без предрасширения ±12% (иначе ±26% сверху раздувает вилку)
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
        // Одна сумма = якорь бюджета; ±26% применяется в derivePriceTarget
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
 * Целевой коридор цены для подборки: ±26% от бюджета (правило 6).
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
  const code = normalizeSalesLang(lang);
  /** RU / ES / иначе EN (для de/fr/pl/nl — без русской утечки в промпт) */
  const t = (ru, en, es) => (code === 'ru' ? ru : code === 'es' ? es : en);

  const known = [];
  const neverAsk = [];
  if (state.hasPurpose) {
    const purposeLabel =
      state.purposeKind === 'investment'
        ? t('цель: инвестиции', 'goal: investment', 'objetivo: inversión')
        : t('цель: для себя/жизнь', 'goal: living', 'objetivo: vivir');
    known.push(purposeLabel);
    neverAsk.push(t('цель (жизнь/инвестиция)', 'purpose/goal', 'objetivo'));
  }
  if (state.hasType) {
    known.push(state.propertyTypeLabel || t('тип', 'type', 'tipo'));
    neverAsk.push(t('тип объекта', 'property type', 'tipo de inmueble'));
  }
  if (state.hasBusinessSector && state.businessSectorLabel) {
    known.push(
      code === 'ru'
        ? `сфера: ${state.businessSectorLabel}`
        : code === 'es'
          ? `sector: ${state.businessSectorLabel}`
          : `sector: ${state.businessSectorLabel}`
    );
    neverAsk.push(t('сфера бизнеса', 'business sector', 'sector de negocio'));
  } else if (state.needsBusinessSector && state.hasType) {
    neverAsk.push(t('регион', 'region', 'región'));
  }
  if (state.hasRegion) {
    known.push(state.regionLabel || 'region');
    neverAsk.push(t('регион', 'region', 'región'));
  }
  if (state.hasLocation) {
    known.push(state.microAreaLabel || t('район', 'area', 'zona'));
    neverAsk.push(t('район/зона', 'area/district', 'zona/área'));
  }
  if (state.hasBudget) {
    const bl = formatBudgetLabel(state.budget, code);
    known.push(bl || t('бюджет', 'budget', 'presupuesto'));
    neverAsk.push(
      `${t('бюджет', 'budget', 'presupuesto')}${bl ? ` (${bl})` : ''}`
    );
  }
  if (state.hasTimeline) {
    known.push(t('срок покупки', 'timeline', 'plazo'));
    neverAsk.push(t('срок покупки/инвестиции', 'purchase timeline', 'plazo de compra'));
  }
  if (state.hasFundsNow) {
    known.push(t('деньги на руках', 'cash on hand', 'dinero ahora'));
    neverAsk.push(t('деньги сейчас на руках', 'cash available now', 'efectivo disponible'));
  }
  if (state.hasMortgageAnswered) {
    known.push(t('ипотека да/нет', 'mortgage', 'hipoteca'));
    neverAsk.push(t('нужна ли ипотека', 'mortgage yes/no', 'hipoteca sí/no'));
  }

  if (!neverAsk.length) return '';

  const locationLock =
    state.hasLocation && state.microAreaLabel
      ? {
          ru: ` Район уже указан: ${state.microAreaLabel} — не спрашивай другую зону.`,
          es: ` Zona ya indicada: ${state.microAreaLabel} — no preguntes otra zona.`,
          en: ` Area already given: ${state.microAreaLabel} — do not ask for another zone.`,
          de: ` Zone bereits genannt: ${state.microAreaLabel} — keine andere Zone fragen.`,
          fr: ` Zone déjà indiquée: ${state.microAreaLabel} — ne pas redemander la zone.`,
          pl: ` Strefa już podana: ${state.microAreaLabel} — nie pytaj o inną strefę.`,
          nl: ` Zone al genoemd: ${state.microAreaLabel} — vraag geen andere zone.`,
        }[code] || ` Area already given: ${state.microAreaLabel} — do not ask for another zone.`
      : '';

  const moreHint = state.wantsMoreLikeThese
    ? {
        ru: ' Клиент просит ещё/похожие — сразу новая подборка по этим критериям, без вопросов про бюджет/район/тип.',
        es: ' El cliente pide más/similares — envía nueva selección YA con estos criterios.',
        en: ' Client wants more/similar options — send a new shortlist NOW using these criteria.',
        de: ' Kunde will mehr/ähnliche — sofort neue Auswahl mit diesen Kriterien.',
        fr: ' Le client veut plus/similaires — nouvelle sélection MAINTENANT avec ces critères.',
        pl: ' Klient prosi o więcej/podobne — od razu nowa selekcja według tych kryteriów.',
        nl: ' Klant wil meer/vergelijkbaar — meteen nieuwe selectie met deze criteria.',
      }[code] ||
      ' Client wants more/similar options — send a new shortlist NOW using these criteria.'
    : '';

  const budgetLock = state.hasBudget
    ? {
        ru: ' Бюджет сохранён в этом чате (и в БД) — НИКОГДА не спрашивай снова «какой у вас бюджет?», пока клиент сам не изменит цифру.',
        es: ' El presupuesto está guardado en este chat (y en la base) — NUNCA preguntes de nuevo «¿cuál es su presupuesto?» salvo que el cliente lo cambie.',
        en: ' Budget is stored for this chat (and in DB) — NEVER ask «what is your budget?» again unless the client changes it.',
        de: ' Budget ist in diesem Chat gespeichert — NIEMALS erneut nach dem Budget fragen, außer der Kunde ändert es.',
        fr: ' Le budget est enregistré dans ce chat — NE JAMAIS redemander le budget sauf si le client le change.',
        pl: ' Budżet zapisany w tym czacie — NIGDY nie pytaj ponownie o budżet, chyba że klient go zmieni.',
        nl: ' Budget is in deze chat opgeslagen — NOOIT opnieuw naar budget vragen, tenzij de klant het wijzigt.',
      }[code] ||
      ' Budget is stored for this chat (and in DB) — NEVER ask «what is your budget?» again unless the client changes it.'
    : '';

  const headers = {
    ru: `**ПАМЯТЬ ДИАЛОГА (обязательно):** Уже известно: ${known.join('; ')}. НЕ переспрашивай: ${neverAsk.join(', ')}.${locationLock}${budgetLock}${moreHint} Спрашивай только то, чего ещё нет.`,
    es: `**MEMORIA DEL DIÁLOGO (obligatorio):** Ya sabemos: ${known.join('; ')}. NO vuelvas a preguntar: ${neverAsk.join(', ')}.${locationLock}${budgetLock}${moreHint} Pregunta solo lo que aún falta.`,
    en: `**DIALOG MEMORY (mandatory):** Already known: ${known.join('; ')}. Do NOT re-ask: ${neverAsk.join(', ')}.${locationLock}${budgetLock}${moreHint} Ask only for what is still missing.`,
    de: `**DIALOGGEDÄCHTNIS (pflicht):** Bereits bekannt: ${known.join('; ')}. NICHT erneut fragen: ${neverAsk.join(', ')}.${locationLock}${budgetLock}${moreHint} Nur fragen, was noch fehlt.`,
    fr: `**MÉMOIRE DU DIALOGUE (obligatoire):** Déjà connu: ${known.join('; ')}. NE PAS redemander: ${neverAsk.join(', ')}.${locationLock}${budgetLock}${moreHint} Demander seulement ce qui manque.`,
    pl: `**PAMIĘĆ DIALOGU (obowiązkowe):** Już wiadomo: ${known.join('; ')}. NIE pytaj ponownie: ${neverAsk.join(', ')}.${locationLock}${budgetLock}${moreHint} Pytaj tylko o to, czego jeszcze brakuje.`,
    nl: `**DIALOOGGEHEUGEN (verplicht):** Al bekend: ${known.join('; ')}. NIET opnieuw vragen: ${neverAsk.join(', ')}.${locationLock}${budgetLock}${moreHint} Vraag alleen wat nog ontbreekt.`,
  };
  return headers[code] || headers.en;
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
