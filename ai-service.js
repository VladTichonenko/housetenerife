const { chatCompletions, AI_MODEL, AI_API_KEY, resolveGptModel } = require('./ai-client');
const { searchForContext, getCatalogSiteUrl, getLocalizedItem } = require('./property-catalog');
const { webSearchSnippets, shouldAugmentWithWeb } = require('./web-search');
const { getBotConfig } = require('./bot-config');
const { getKnowledgeBaseForPrompt } = require('./knowledge-base');
const { getFileDocKnowledgeForPrompt } = require('./file-doc-knowledge');
const { getSalesPlaybookBlock } = require('./sales-playbook');
const {
  normalizeSalesLang,
  formatLocalizedDialogPath,
  buildSystemPromptBlocks,
  getCatalogHints,
  pickLocalizedPrompts,
  buildReplyLanguageRule
} = require('./sales-localization');
const {
  analyzeConversation,
  buildCatalogSearchQuery,
  extractBudgetRange,
  derivePriceTarget,
  formatBudgetLabel
} = require('./dialog-context');
const { maybeAddWarmSmiley, getWarmTonePromptBlock, softenRoboticPunctuation } = require('./reply-warmth');
const { formatHumanToneExamples, formatGlobalHumanChatRules } = require('./conversational-flow');
const {
  repairPropertyUrlsInText,
  hasValidCatalogPropertyLinks,
  hasInventedHtLinks,
  hasDuplicatePropertyUrls,
  hasMismatchedPropertyTypeUrls,
  collectRecentPropertyUrls,
  findItemByUrl,
  getShareUrl,
  stripNonCatalogUrls
} = require('./property-share');
const { itemMatchesPropertyTypes } = require('./property-types');
const {
  fixPhoneticTransliterations,
  replyMismatchesLanguage,
  languageRewriteInstruction,
  stripUnexpectedScripts
} = require('./reply-language');
const {
  mirrorUserEmojiInReply,
  isEmojiOnlyMessage,
  pickUserEmoji,
  limitEmojis
} = require('./emoji-react');
const {
  getUserProfile,
  updateUserProfileFromConversation,
  formatUserProfileForPrompt,
} = require('./user-profile');
const { evaluateIntentGate, formatIntentGateForPrompt } = require('./intent-gate');
const {
  prepareAndSaveTopicContext,
  recordTopicAssistantReply,
  formatTopicSummaryForPrompt,
} = require('./topic-memory');
const { formatCoreRulesForPrompt } = require('./bot-core-rules');

function truncateKnowledge(knowledge, maxChars) {
  const raw = JSON.stringify(knowledge, null, 2);
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n…(truncated)`;
}

function localizeKnowledgeBase(kb, salesLang) {
  if (!kb || salesLang === 'ru') return kb;
  const next = { ...kb };
  if (salesLang === 'en' && kb.mortgage_process_en) {
    next.mortgage_process = kb.mortgage_process_en;
  }
  if (salesLang === 'es' && kb.mortgage_process_es) {
    next.mortgage_process = kb.mortgage_process_es;
  }
  return next;
}

async function buildPromptParts(
  conversationHistory,
  userLanguage,
  tier = 'full',
  runtimeContext = {}
) {
  const salesLang = normalizeSalesLang(userLanguage);
  const limitedHistory =
    tier === 'minimal' ? conversationHistory.slice(-8) : conversationHistory.slice(-16);
  const analysisHistory = Array.isArray(runtimeContext.analysisHistory)
    ? runtimeContext.analysisHistory
    : limitedHistory;
  const lastUserMessage = limitedHistory.filter((msg) => msg.sender === 'user').pop();
  const userQuery = lastUserMessage ? lastUserMessage.text : '';

  const dialog = analyzeConversation(analysisHistory, salesLang);
  const catalogQuery = buildCatalogSearchQuery(analysisHistory) || userQuery;
  const budget = dialog.ignoreBudget
    ? { minPrice: null, maxPrice: null }
    : dialog.budget || extractBudgetRange(dialog.allUserText);
  const priceTarget = dialog.ignoreBudget ? null : derivePriceTarget(budget);
  const showingListings =
    dialog.stage === 'SHOW_LISTINGS' ||
    (dialog.stage === 'REFINE' &&
      (dialog.hasBudget || dialog.ignoreBudget) &&
      Boolean(dialog.readyForListings || dialog.wantsListings || dialog.wantsMoreLikeThese));
  // Правило: без бюджета каталог не подмешиваем (кроме «любой бюджет»)
  const maySearchCatalog =
    !dialog.offTopicChatter &&
    dialog.hasType &&
    dialog.hasPurpose &&
    (dialog.hasBudget || dialog.ignoreBudget) &&
    (dialog.financeReadyForListings || dialog.ignoreBudget) &&
    (showingListings || (tier !== 'full' && (dialog.hasBudget || dialog.ignoreBudget)));

  const {
    extractPropertyItemsFromText,
    formatLinkedPropertiesForPrompt,
    getLinkedPropertyStageInstruction
  } = require('./property-interest');
  const linkedItems = extractPropertyItemsFromText(userQuery);
  const hasLinkedProperty = linkedItems.length > 0;

  const catalogLimit =
    tier === 'minimal'
      ? 5
      : tier === 'compact'
        ? 10
        : showingListings
          ? 18
          : 8;

  let catalog = { found: false, text: '', totalInDb: 0, urls: [] };
  if (maySearchCatalog && !hasLinkedProperty) {
    catalog = searchForContext(catalogQuery, catalogLimit, {
      minPrice: budget.minPrice,
      maxPrice: budget.maxPrice,
      priceTarget,
      propertyTypes: dialog.propertyTypes,
      macroRegions: dialog.macroRegions,
      microAreaGroupIds: dialog.microAreaGroupIds || [],
      microDetection: dialog.microAreas,
      lang: userLanguage,
      contextText: dialog.allUserText,
      allowBudgetFallback: showingListings,
      allowTypeFamilyFallback: showingListings || dialog.wantsPropertyLinks
    });
  } else {
    try {
      const { load } = require('./property-catalog');
      catalog.totalInDb = load().items?.length || 0;
    } catch {
      /* ignore */
    }
  }

  if (hasLinkedProperty) {
    const { getShareUrl } = require('./property-share');
    catalog.found = true;
    catalog.urls = linkedItems.map((it) => getShareUrl(it, userLanguage)).filter(Boolean);
  }

  const hints = getCatalogHints(salesLang);
  let catalogBlock = '';
  if (hasLinkedProperty) {
    catalogBlock = formatLinkedPropertiesForPrompt(linkedItems, userLanguage);
    if (!catalogBlock.trim()) {
      catalogBlock =
        salesLang === 'es'
          ? '\n\n(El cliente envió un enlace housetenerife.eu, pero el objeto no está en el catálogo local. Pide la zona/tipo o ofrece llamada.)\n'
          : salesLang === 'en'
            ? '\n\n(Client sent a housetenerife.eu link, but it is not in the local catalog. Ask area/type or offer a call.)\n'
            : '\n\n(Клиент прислал ссылку housetenerife.eu, но объекта нет в локальном каталоге. Уточни район/тип или предложи созвон.)\n';
    }
  } else if (!dialog.hasPurpose && tier === 'full') {
    catalogBlock =
      hints?.noPurpose ||
      '\n\n(Цель покупки не ясна — сначала один вопрос: для жизни/переезда или инвестиция? Без объектов и ссылок.)\n';
  } else if (!dialog.hasBudget && !dialog.ignoreBudget && tier === 'full') {
    // Клиент просит объекты / любой этап без бюджета — каталог не даём, только запрос бюджета
    catalogBlock =
      salesLang === 'es'
        ? '\n\n(**SIN PRESUPUESTO — PROHIBIDO mostrar fichas.** El cliente pidió ver opciones o aún no dijo presupuesto. Agradece el interés y pregunta el presupuesto en €. Di que luego mostrarás en banda ±20%. Sin villas, sin precios, sin enlaces.)\n'
        : salesLang === 'en'
          ? '\n\n(**NO BUDGET — FORBIDDEN to show listings.** Client asked to see options or has not stated a budget. Thank them and ask for budget in €. Say you’ll then shortlist within ±20%. No villas, no prices, no links.)\n'
          : '\n\n(**БЮДЖЕТ НЕ ИЗВЕСТЕН — ЗАПРЕЩЕНО показывать объекты.** Клиент просит варианты или ещё не назвал бюджет. Поблагодари за интерес и спроси бюджет в €. Скажи, что после этого покажешь варианты в коридоре ±20%. Без вилл, без цен 500k–9M, без ссылок.)\n';
  } else if (!dialog.hasType && tier === 'full' && hints) {
    catalogBlock = hints.noType;
  } else if (!dialog.hasRegion && !dialog.hasLocation && tier === 'full' && hints) {
    catalogBlock =
      typeof hints.noRegion === 'function'
        ? hints.noRegion(dialog.regionOptions)
        : hints.noRegion;
  } else if (catalog.text) {
    const header = hints
      ? hints.listingsHeader(dialog.propertyTypeLabel)
      : `\n\n**LISTINGS:**\n`;
    catalogBlock = `${header}${catalog.text}\n`;
    if (tier === 'full' && !showingListings && hints) {
      catalogBlock += hints.waitForShortlist;
    }
  } else if (showingListings || dialog.wantsPropertyLinks) {
    // Пустой каталог: запрет выдумывать объекты с ценами без URL
    const emptyHint =
      salesLang === 'es'
        ? `\n\n**CATÁLOGO VACÍO para estos criterios** (${dialog.propertyTypeLabel || 'tipo'} / ${dialog.regionLabel || 'región'}). PROHIBIDO inventar apartamentos, precios o nombres. Di honestamente que ahora no hay fichas en el catálogo House Tenerife para estos parámetros y pregunta qué ajustar (zona/presupuesto/tipo). Sin enlaces inventados.\n`
        : salesLang === 'en'
          ? `\n\n**EMPTY CATALOG for these criteria** (${dialog.propertyTypeLabel || 'type'} / ${dialog.regionLabel || 'region'}). NEVER invent apartments, prices or names. Honestly say there are no House Tenerife listings for these parameters now and ask what to adjust (area/budget/type). No invented links.\n`
          : `\n\n**КАТАЛОГ ПУСТ по этим критериям** (${dialog.propertyTypeLabel || 'тип'} / ${dialog.regionLabel || 'регион'}). ЗАПРЕЩЕНО выдумывать объекты, цены и названия. Честно скажи, что в каталоге House Tenerife сейчас нет карточек под эти параметры, и спроси что скорректировать (район/бюджет/тип). Без выдуманных ссылок.\n`;
    catalogBlock = emptyHint;
  }

  let webBlock = '';
  if (tier === 'full' && !showingListings && shouldAugmentWithWeb(userQuery)) {
    const webSuffix = [
      dialog.regionLabel || '',
      salesLang === 'es'
        ? 'compra inmueble'
        : salesLang === 'en'
          ? 'property purchase'
          : salesLang === 'de'
            ? 'Immobilienkauf'
            : salesLang === 'fr'
              ? 'achat immobilier'
              : salesLang === 'pl'
                ? 'zakup nieruchomości'
                : salesLang === 'nl'
                  ? 'vastgoed kopen'
                  : 'покупка недвижимости'
    ]
      .filter(Boolean)
      .join(' ');
    const extra = await webSearchSnippets(`${userQuery} ${webSuffix}`);
    if (extra) {
      webBlock = `\n\n**КРАТКАЯ ВЫДЕРЖКА ИЗ ВЕБ-ПОИСКА:**\n${extra}\n`;
    }
  }

  const knowledgeQuery = [
    userQuery,
    dialog.allUserText,
    dialog.propertyTypeLabel,
    dialog.regionLabel,
    dialog.microAreaLabel,
  ]
    .filter(Boolean)
    .join(' ');
  const activeScenario = runtimeContext.intentGate?.scenario || 'general';
  const mortgageKnowledgeFocus =
    activeScenario === 'mortgage_docs' ||
    Boolean(dialog.wantsMortgageSteps) ||
    /ипотек|кредит|mortgage|hipoteca|eur[ií]bor|fein|fiae/i.test(knowledgeQuery);
  const consultantKnowledgeRaw = getKnowledgeBaseForPrompt({
    query: knowledgeQuery,
    scenario: activeScenario,
    language: salesLang,
    maxSections: mortgageKnowledgeFocus
      ? tier === 'minimal'
        ? 4
        : 6
      : tier === 'minimal'
        ? 2
        : tier === 'compact'
          ? 3
          : 4,
  });
  const consultantKnowledge = localizeKnowledgeBase(consultantKnowledgeRaw, salesLang);
  const mortgageKnowledgeSlice = {
    disclaimer: consultantKnowledge.disclaimer,
    mortgage_process: consultantKnowledge.mortgage_process,
    mortgage_assistance: consultantKnowledge.mortgage_assistance,
    mortgage_lending_official: consultantKnowledge.mortgage_lending_official,
    mortgage_rates_official: consultantKnowledge.mortgage_rates_official,
    purchase_documents: consultantKnowledge.purchase_documents,
  };
  const ck =
    tier === 'minimal'
      ? truncateKnowledge(
          dialog.wantsMortgageSteps
            ? mortgageKnowledgeSlice
            : {
                disclaimer: consultantKnowledge.disclaimer,
                contacts: consultantKnowledge.contacts,
                company: consultantKnowledge.company
              },
          dialog.wantsMortgageSteps ? 5000 : 2500
        )
      : tier === 'compact'
        ? truncateKnowledge(
            dialog.wantsMortgageSteps
              ? { ...consultantKnowledge, mortgage_process: consultantKnowledge.mortgage_process }
              : consultantKnowledge,
            8000
          )
        : truncateKnowledge(consultantKnowledge, 12000);

  const botConfig = getBotConfig();
  const localized = pickLocalizedPrompts(salesLang, botConfig);
  const userProfileBlock = formatUserProfileForPrompt(runtimeContext.userProfile);
  const intentGateBlock = formatIntentGateForPrompt(runtimeContext.intentGate);
  const topicSummaryBlock = formatTopicSummaryForPrompt(runtimeContext.topicSummary);
  const dialogPathBlock =
    tier === 'minimal' ? '' : formatLocalizedDialogPath(salesLang, botConfig.dialogPath);
  const siteUrl = getCatalogSiteUrl(userLanguage);
  const blocks = buildSystemPromptBlocks(salesLang, dialog, budget);

  const mainPrompt =
    tier === 'minimal'
      ? localized.minimalPrompt ||
        `House Tenerife concierge. Reply in ${salesLang}, 2–4 lines. WhatsApp: *bold*, bullets • or 1.`
      : localized.mainPrompt;

  const extraConditions = tier === 'minimal' ? '' : localized.additionalConditions;

  const stageHeader =
    salesLang === 'ru'
      ? `**ТЕКУЩИЙ ЭТАП ДИАЛОГА (${dialog.stage}, сообщений клиента: ${dialog.userTurns}):**`
      : blocks
        ? blocks.stageHeader(dialog.stage, dialog.userTurns)
        : `**CURRENT STAGE (${dialog.stage}):**`;

  const criteriaBlock =
    salesLang === 'ru'
      ? `**СОБРАННЫЕ КРИТЕРИИ (из ВСЕЙ переписки — не спрашивай повторно то, что уже есть):**
- Ветка: ${dialog.isInvestment ? 'ИНВЕСТИЦИИ' : dialog.hasPurpose ? 'ДЛЯ СЕБЯ / ЖИЗНЬ' : 'цель ещё не ясна'}
- Цель (жизнь/инвестиция): ${dialog.hasPurpose ? 'да' : 'ещё нет'}
- Бюджет: ${dialog.hasBudget ? `да${dialog.budgetLabel || formatBudgetLabel(budget, 'ru') ? ` — ${dialog.budgetLabel || formatBudgetLabel(budget, 'ru')}` : ''}` : 'ещё нет'}
- Срок покупки/инвестиции: ${dialog.hasTimeline ? 'да' : dialog.isInvestment ? 'ещё нет (обязательно для инвестиций)' : 'ещё нет'}
- Деньги на руках / форма оплаты: ${dialog.hasFundsNow ? `да${dialog.fundsNowLabel ? ` — ${dialog.fundsNowLabel}` : ''}` : 'ещё нет'}
- Ипотека: ${dialog.hasMortgageAnswered ? (dialog.needsMortgage ? 'нужна' : 'не нужна') : 'ещё нет'}
- Регион: ${dialog.hasRegion ? `да (${dialog.regionLabel})` : `ещё нет — ${dialog.regionOptions}`}
- Район / зона: ${dialog.hasLocation ? `да (${dialog.microAreaLabel || 'уточнено'})` : dialog.needsMicroArea ? `ещё нет (примеры: ${dialog.areaOptionsPrompt || 'уточнить у клиента'})` : 'не требуется'}
- Тип объекта: ${dialog.hasType ? `да (${dialog.propertyTypeLabel})` : 'ещё нет'}
${dialog.hasBudget ? `- ⛔ Бюджет уже назван${dialog.budgetLabel ? ` (${dialog.budgetLabel})` : ''} — НЕ переспрашивай его. Если клиент только что назвал сумму — коротко подтверди «запомнил» и иди к следующему шагу.\n` : '- ⛔ Без бюджета объекты и ссылки НЕ отправляй. Если просят «покажи объекты» — сначала спроси бюджет, потом подборка ±20%.\n'}${!dialog.financeReadyForListings && !dialog.ignoreBudget ? '- ⛔ Без финансов (деньги на руках + ипотека да/нет) подборку НЕ отправляй.\n' : ''}${dialog.hasType && dialog.hasRegion && dialog.hasLocation ? '- ⛔ Тип, регион и район известны — не переспрашивай.\n' : ''}${dialog.needsEscalation ? '- ⚠️ Жалоба/сложный запрос — эскалируй к менеджеру (созвон 10–15 мин), не спорь.\n' : ''}`
      : blocks.criteria;

  const coreRulesBlock = formatCoreRulesForPrompt(salesLang);

  const conversationRules =
    salesLang === 'ru'
      ? `**ПРАВИЛА РАЗГОВОРА (обязательно):**
- Веди как опытный продавец-аналитик: сначала пойми человека, потом дай ценность (подборка), потом углубляй, потом мягко созвон.
- Не повторяй выбор клиента после каждого сообщения. Отражай его словами только если это снимает сомнение или помогает продать; чаще сразу переходи к следующему точному вопросу.
- Один понятный вопрос в конце (не три сразу).
- Не предлагай объекты, пока не ясны цель, тип и бюджет.
- Никогда не переспрашивай то, что клиент уже сказал (бюджет, район, тип, цель, срок) — смотри блок «ПАМЯТЬ ДИАЛОГА» / собранные критерии. История диалога сохраняется в БД между сообщениями. Если назвали бюджет — подтверди («Отлично, запомнил — …») и спроси следующий шаг, а не бюджет снова.
- Никогда не обещай «пришлю через пару минут / позже / через 90 секунд». Если пора показывать объекты — показывай их в этом же ответе. Если рано — задай следующий вопрос.
- Названия районов и городов копируй БУКВАЛЬНО из блока критериев / каталога (латиница: Costa Adeje, Los Cristianos, Las Américas, Golf del Sur, El Médano, Sant Antoni). Не транслитерируй («Лос Кристианос», «Коста Адеже») и не искажай орфографию.
- Запрещено: «благодарим за обращение», «запрос передан», «уважаемый клиент», «чем могу помочь» без продолжения.
- 2–5 коротких строк + список объектов, когда пора.`
      : `**CONVERSATION RULES (mandatory):**
${blocks.conversation}`;

  const salesPlaybookBlock =
    tier === 'full' ? getSalesPlaybookBlock(salesLang) : '';

  const catalogRules =
    hasLinkedProperty
      ? salesLang === 'ru'
        ? `**ОБЪЕКТ ПО ССЫЛКЕ:** В блоке ниже — карточка из каталога по ссылке клиента. Расскажи по этим данным (цена, тип, район, 2–3 факта). Не выдумывай. Не предлагай другие объекты, пока клиент не попросит похожие. URL копируй из блока.`
        : salesLang === 'es'
          ? `**ENLACE DEL CLIENTE:** El bloque inferior es la ficha del catálogo. Descríbela (precio, tipo, zona, 2–3 datos). No inventes. No ofrezcas otros inmuebles hasta que pida similares. Copia el URL del bloque.`
          : `**CLIENT LINK:** Block below is the catalog card. Describe it (price, type, area, 2–3 facts). Do not invent. Do not offer other listings until they ask for similar. Copy URL from the block.`
      : salesLang === 'ru'
      ? `**КАТАЛОГ ОБЪЕКТОВ:**
Поиск идёт по всей базе (${catalog.totalInDb || 'все'} объектов на сайте); в блоке ниже — лучшие совпадения по критериям переписки. Если блок каталога не пустой — ЗАПРЕЩЕНО писать «нет объектов / ничего нет / в этом районе нет». Показывай то, что есть; если мало — предложи соседний бюджет/зону или сайт. Не утверждай, что «других нет» — предложи уточнить бюджет/район или каталог на сайте.
На этапах SHOW_LISTINGS / REFINE — покажи 3–5 РАЗНЫХ объектов из блока ниже (название, цена, ссылка, одна фраза почему подходит). Только тот регион (${dialog.regionLabel || 'из критериев'})${dialog.microAreaLabel ? ` и район (${dialog.microAreaLabel})` : ''}, что выбрал клиент сейчас — не подмешивай Тенерифе/Дубай/другие, если просили Ибицу (и наоборот). Не подмешивай Adeje, если просили Los Cristianos.
**Тип объекта:** строго соблюдай запрошенный тип (${dialog.propertyTypeLabel || 'из критериев'}). Если просили виллы — только виллы (не апартаменты и не «виллы и апартаменты»). Если просили апартаменты — не давай виллы и тем более бизнес/рестораны. Если просили готовый бизнес — только бизнес/ресторан/бар из каталога; ЗАПРЕЩЕНО подменять апартаментами «под аренду». Копируй из блока каталога пары «название + URL» как есть — не подставляй одну ссылку к разным объектам и не повторяй ссылку из предыдущих сообщений чата.
**Цена:** ${
        dialog.ignoreBudget
          ? 'клиент снял ограничение по цене — показывай подходящие по типу и району объекты из блока без фильтра «около бюджета».'
          : 'коридор ±20% от бюджета клиента — не предлагай сильно дешевле или сильно дороже, если клиент не просил иначе.'
      }
**Ссылки:** копируй URL из блока каталога БУКВАЛЬНО (формат https://housetenerife.eu/…/property/slug/). Запрещено выдумывать /objekt/123, /object/ID и любые другие пути. Не давай ссылки на Idealista, Fotocasa, Habitaclia и любые внешние порталы — только карточки House Tenerife из блока.
Если клиент просит ссылки на объекты — ОБЯЗАТЕЛЬНО вставь в ответ URL из блока каталога по его параметрам (тип/регион/бюджет/район). Запрещено отвечать только «посмотрите на сайте / в разделе недвижимости» без конкретных карточек. Не описывай объекты без их URL.
На этапах FIRST_CONTACT / NEED_* — объекты не вываливай. Регионы каталога: ${dialog.regionOptions} (housetenerife.eu).
Подборка только когда ясны *цель*, тип, бюджет, регион и конкретная зона/район; ссылки только из блока ниже.
Никогда не пиши клиенту, что отправишь подборку позже. Системная задержка ссылок уже есть: твоя задача — сформировать подборку сразу в текущем ответе.
После подборки — один вопрос: какой вариант ближе или что скорректировать (бюджет/район).
**Ипотека/кредит:** House Tenerife *помогает оформить ипотеку* (NIE, счёт, документы, подбор банка) — всегда предлагай нашу помощь, не отправляй клиента заниматься этим самостоятельно. Шаги — из mortgage_process + mortgage_lending_official (FEIN/FiAE, Ley 5/2019). Ставки — только из mortgage_rates_official (Euríbor / средний тип Banco de España) с оговоркой «финальная ставка у банка». Источники правды: Banco de España Cliente Bancario и BOE — ЗАПРЕЩЕНО цитировать юристов, рекламу адвокатских бюро и блоги адвокатов. Нотариус — только как обязательный шаг по закону, без имён. Без гарантии одобрения и без выдуманных оферт банков.
**Конкретный объект:** если клиент выбрал вариант — уточни деньги *сейчас на руках*, нужна ли ипотека, какие документы уже есть; при ипотеке — шаги + наша помощь + созвон (да/нет).
**Связь с менеджером:** если клиент хочет человека / звонок / просмотр / жалоба / сложный запрос — тепло предложи короткий созвон 10–15 минут. Не проси писать слово «менеджер» и не давай телефон вместо заявки.`
      : `**PROPERTY CATALOG (${catalog.totalInDb || 'full'} listings on site; block below = best matches):**
${blocks.catalog}
**Pricing:** stay around budget or slightly above — not much cheaper unless they asked.
**Links:** copy URLs from the catalog block EXACTLY (https://housetenerife.eu/…/property/slug/). Never invent /objekt/123, /object/ID, or any other path. Never link Idealista, Fotocasa, Habitaclia, or other external portals in a listing response. If the client asks for links — you MUST paste catalog URLs matching their criteria in this reply; never only send them to a general website section without property cards. Never describe listings without their URLs.
${blocks.mortgage}
${blocks.propertyFinance}
${blocks.managerHandoff}`;

  const langRule = buildReplyLanguageRule(userLanguage);

  const disclaimerLabel = salesLang === 'es' ? '**AVISO LEGAL:**' : salesLang === 'en' ? '**DISCLAIMER:**' : '**ДИСКЛЕЙМЕР:**';
  const knowledgeLabel =
    salesLang === 'es' ? '**BASE DE CONOCIMIENTO:**' : salesLang === 'en' ? '**KNOWLEDGE BASE:**' : '**БАЗА ЗНАНИЙ:**';
  const siteLabel =
    salesLang === 'es' ? '*Catálogo:*' : salesLang === 'en' ? '*Catalog site:*' : '*Сайт каталога:*';

  // file_doc часто содержит внешние/рекламные материалы — на ипотеке не подмешиваем
  const fileDocBlock =
    tier === 'full' && !mortgageKnowledgeFocus
      ? getFileDocKnowledgeForPrompt(knowledgeQuery, 12000, {
          scenario: activeScenario,
          maxDocs: 3,
        })
      : '';

  const lastUserText = lastUserMessage?.text || '';
  const userEmoji = pickUserEmoji(lastUserText);
  const emojiReactBlock = userEmoji
    ? salesLang === 'es'
      ? `\n**EMOJI DEL CLIENTE:** El cliente usó «${userEmoji}». Incluye el MISMO emoji en tu respuesta (duplícalo). Si el mensaje es solo emoji — responde con ese emoji + una frase corta y la siguiente pregunta del diálogo.\n`
      : salesLang === 'en'
        ? `\n**CLIENT EMOJI:** The client used «${userEmoji}». Include the SAME emoji in your reply (mirror it). If the message is emoji-only — reply with that emoji + one short line and the next dialog question.\n`
        : `\n**СМАЙЛИК КЛИЕНТА:** Клиент прислал «${userEmoji}». Обязательно дублируй ЭТОТ же смайлик в ответе. Если сообщение только из смайлика — ответь им же + одна короткая фраза и следующий вопрос по этапу диалога.\n`
    : '';

  const linkedStageBlock = hasLinkedProperty
    ? getLinkedPropertyStageInstruction(salesLang)
    : '';
  const stageBlock = linkedStageBlock
    ? `${linkedStageBlock}\n\n(Дальше по воронке, после описания объекта: ${dialog.stageInstruction})`
    : dialog.stageInstruction;

  const systemPrompt = `${mainPrompt}

${siteLabel} ${siteUrl}

${extraConditions}
${userProfileBlock}
${intentGateBlock}
${topicSummaryBlock}
${dialogPathBlock}

${coreRulesBlock}

${stageHeader}
${stageBlock}

${criteriaBlock}

${dialog.financeSummaryBlock || ''}

${conversationRules}

${salesPlaybookBlock}

${getWritingQualityBlock(salesLang)}

${formatGlobalHumanChatRules(salesLang)}

${formatHumanToneExamples(salesLang)}

${getWarmTonePromptBlock(salesLang)}
${emojiReactBlock}
${langRule}

${disclaimerLabel}
${consultantKnowledge.disclaimer || 'Not a lawyer or tax adviser.'}

${knowledgeLabel}
${ck}

${catalogRules}
${catalogBlock}
${fileDocBlock ? `\n${fileDocBlock}\n` : ''}${webBlock}

**WHATSAPP:** *bold*, bullets • or 1. One warm 🙂 or :) on conversation stages (see WARM TONE block). If the client sent an emoji — mirror that same emoji.`;


  const messages = [
    { role: 'system', content: systemPrompt },
    ...limitedHistory.map((msg) => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.text
    }))
  ];

  return {
    messages,
    catalogUrls: Array.isArray(catalog.urls) ? catalog.urls : [],
    catalogFound: Boolean(catalog.found),
    catalogUsedBudgetFallback: Boolean(catalog.usedBudgetFallback),
    catalogUsedAreaFallback: Boolean(catalog.usedAreaFallback),
    catalogUsedLastResortTypeFallback: Boolean(catalog.usedLastResortTypeFallback)
  };
}

function apiErrorDetailFromResponse(error) {
  const data = error.response?.data;
  if (!data) return '';
  return data.error?.message || data.message || data.detail || '';
}

const URL_PLACEHOLDER_PREFIX = '__HT_URL_';

function protectUrls(text) {
  const urls = [];
  const protectedText = String(text || '').replace(
    /(?:https?:\/\/|www\.)[^\s<>\])"'}]+|housetenerife\.eu\/[^\s<>\])"'}]*/gi,
    (match) => {
      const token = `${URL_PLACEHOLDER_PREFIX}${urls.length}__`;
      urls.push(match);
      return token;
    }
  );
  return { protectedText, urls };
}

function restoreUrls(text, urls) {
  let s = String(text || '');
  urls.forEach((url, idx) => {
    s = s.replace(new RegExp(`${URL_PLACEHOLDER_PREFIX}${idx}__`, 'g'), url);
  });
  return s;
}

function repairKnownUrlSpacing(text) {
  return String(text || '')
    .replace(/https?:\s*\/\/\s*/gi, (match) => match.toLowerCase().startsWith('https') ? 'https://' : 'http://')
    .replace(/www\s*\.\s*/gi, 'www.')
    .replace(/housetenerife\s*\.\s*eu/gi, 'housetenerife.eu')
    .replace(/(housetenerife\.eu)\s*\/\s*/gi, '$1/')
    .replace(/(https?:\/\/(?:www\.)?housetenerife\.eu\/[^\s\n]*)\s+([a-z0-9-]+\/?)/gi, '$1$2');
}

function stripBrokenEmojiArtifacts(text) {
  // Убираем только «осиротевшие» ZWJ без пиктограммы — сами эмодзи не трогаем
  return String(text || '').replace(/\u200D(?!\p{Extended_Pictographic})/gu, '');
}

function polishReply(text) {
  if (!text || typeof text !== 'string') return text;
  // Раньше stripEmojis вырезал ВСЕ смайлики — из-за этого бот «не реагировал» на эмодзи клиента
  let s = repairKnownUrlSpacing(
    limitEmojis(stripBrokenEmojiArtifacts(text.replace(/\u00A0/g, ' ').replace(/\r\n/g, '\n')), 4)
  );
  const protected = protectUrls(s);
  s = protected.protectedText;
  // Склеенные слова: строчная + заглавная (латиница и кириллица)
  s = s.replace(/([a-zа-яё])([A-ZА-ЯЁ])/g, '$1 $2');
  // Пробел после знаков препинания, если модель его проглотила
  s = s.replace(/([.!?,:;])([^\s\n\d*🙂😊👍👋])/g, '$1 $2');
  s = restoreUrls(s, protected.urls);
  s = repairKnownUrlSpacing(s);
  s = s.replace(/ {2,}/g, ' ');
  s = s.replace(/ +\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function hasUnsupportedDelayedListingPromise(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return false;
  const hasLink = /(?:https?:\/\/|www\.|housetenerife\.eu)/i.test(s);
  if (hasLink) return false;
  return (
    /(?:через|в течение|спустя|за)\s+(?:пару|несколько|1-2|2|3|5|10|90)\s*(?:минут|мин|секунд|сек).{0,80}(?:пришлю|отправлю|скину|подберу|подборк|вариант|объект)/i.test(s) ||
    /(?:пришлю|отправлю|скину).{0,50}(?:позже|через|в течение|пару минут|вариант|подборк)/i.test(s) ||
    /(?:i(?:'ll| will)|will)\s+(?:send|share).{0,80}(?:in|within|later|shortly|a few minutes|couple of minutes)/i.test(s) ||
    /(?:te\s+(?:envío|mando|paso)|enviaré|mandaré).{0,80}(?:en|dentro de|luego|unos minutos)/i.test(s)
  );
}

function sanitizeDelayedListingPromise(text) {
  if (!hasUnsupportedDelayedListingPromise(text)) return text;
  return polishReply(
    String(text)
      .replace(
        /(?:через|в течение|спустя|за)\s+(?:пару|несколько|1-2|2|3|5|10|90)\s*(?:минут|мин|секунд|сек)[^.!?\n]*/gi,
        ''
      )
      .replace(
        /(?:i(?:'ll| will)|will)\s+(?:send|share)[^.!?\n]*(?:in|within|later|shortly|a few minutes|couple of minutes)[^.!?\n]*/gi,
        ''
      )
      .replace(
        /(?:te\s+(?:envío|mando|paso)|enviaré|mandaré)[^.!?\n]*(?:en|dentro de|luego|unos minutos)[^.!?\n]*/gi,
        ''
      )
  );
}

/** Убирает шаблонный ярлык «Почему вам:» / Why for you / Por qué encaja из подборок. */
function sanitizeListingWhyLabels(text) {
  if (!text || typeof text !== 'string') return text;
  return String(text)
    .replace(
      /^[ \t]*(?:\*+)?\s*(?:почему\s+вам|why\s+(?:for\s+you|it\s+fits(?:\s+you)?)|por\s+qu[eé]\s+encaja(?:\s+contigo)?)\s*[:：\-–—]?\s*/gim,
      ''
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getWritingQualityBlock(salesLang) {
  if (salesLang === 'en') {
    return `**TEXT QUALITY (critical for sales):**
- Spelling/grammar OK — no typos, no glued words.
- Natural WhatsApp chat — short lines, fragments OK; NOT a formal letter or brochure.
- At most ONE emoji or :) per message on warm stages.
- NEVER sound like: «I offer you the following investment options. A villa costs… It is suitable for…»
- DO sound like: «Great! Found a few around Marbella Villa for 2.5M — solid for long-term rental Want details?»
- Do not put a full stop at the end of every short line. Mix short phrases + a question. Light connectors (great / got it / then…).`;
  }
  if (salesLang === 'es') {
    return `**CALIDAD DEL TEXTO (crítico para ventas):**
- Ortografía correcta — sin faltas ni palabras pegadas.
- Chat WhatsApp natural — frases cortas; NO carta formal ni folleto.
- Un 🙂 o :) en etapas cálidas.
- NO: «Le ofrezco las siguientes opciones de inversión. Una villa cuesta…»
- SÍ: «Genial! Tengo opciones por Marbella Villa a 2,5M — buena para alquiler ¿Miramos?»
- No pongas punto al final de cada línea corta.`;
  }
  if (salesLang === 'de') {
    return `**TEXTQUALITÄT (kritisch für Verkauf):**
- Korrekte Rechtschreibung — keine Tippfehler.
- Natürlicher WhatsApp-Chat — kurze Zeilen, kein Behördendeutsch.
- Ein 🙂 oder :) in warmen Phasen.
- Kein Broschüren-Ton. Nicht nach jedem kurzen Satz einen Punkt. Frage am Ende.`;
  }
  if (salesLang === 'fr') {
    return `**QUALITÉ DU TEXTE (critique pour la vente):**
- Orthographe correcte — pas de fautes ni mots collés.
- Chat WhatsApp naturel — phrases courtes, pas une lettre formelle.
- Un 🙂 ou :) aux étapes chaleureuses.
- Pas de ton brochure. Pas de point à la fin de chaque courte ligne.`;
  }
  if (salesLang === 'pl') {
    return `**JAKOŚĆ TEKSTU (krytyczne dla sprzedaży):**
- Poprawna ortografia — bez literówek.
- Naturalny czat WhatsApp — krótkie linie, nie formalny list.
- Jeden 🙂 lub :) na ciepłych etapach.
- Bez tonu ulotki. Bez kropki na końcu każdej krótkiej linii.`;
  }
  if (salesLang === 'nl') {
    return `**TEKSTKWALITEIT (kritisch voor verkoop):**
- Correcte spelling — geen typfouten.
- Natuurlijke WhatsApp-chat — korte regels, geen formele brief.
- Eén 🙂 of :) in warme fasen.
- Geen brochure-toon. Geen punt aan het eind van elke korte regel.`;
  }
  return `**КАЧЕСТВО ТЕКСТА (критично для продаж):**
- Без орфографических ошибок и «склеенных» слов.
- Пиши НАСТОЯЩИМ русским — без транслита («баджет», «проперти» — нельзя).
- Тон WhatsApp с другом, НЕ робот и НЕ call-центр: короткие строки, обрывки норм; не ставь точку в конце каждой короткой реплики подряд.
- ПЛОХО: «Я предлагаю вам следующие варианты инвестиций. Вилла стоит 2.5 миллиона евро. Она подходит для долгосрочной аренды.»
- ХОРОШО: «Отлично! Нашёл варианты около Марбельи Вилла за 2.5М — сильный вариант под долгосрочную аренду Хотите подробнее?»
- На приветствии и тёплых репликах — один 🙂 или :). Лёгкие связки: отлично / понял / тогда…
- Не читай лекцию про «почему виллы для инвестиций», если клиент просто продолжает подбор.`;
}

function formatModelReply(data) {
  let messageContent = data.choices?.[0]?.message?.content || '';
  while (messageContent.includes('</think>')) {
    messageContent = messageContent.split('</think>').pop().trim();
  }
  messageContent = messageContent.replace(/<\/?redacted_reasoning>/g, '').trim();
  messageContent = messageContent.replace(/^#{1,6}\s+/gm, '');
  messageContent = messageContent.replace(/\*\*\*([^*]+)\*\*\*/g, '*$1*');
  messageContent = messageContent.replace(/\*\*([^*]+)\*\*/g, '*$1*');
  messageContent = messageContent.replace(/^\s*\*\s+/gm, '• ');
  messageContent = messageContent.replace(/^[-=]{3,}$/gm, '');
  return polishReply(messageContent);
}

async function callAI(messages, tierLabel) {
  const model = resolveGptModel(process.env.AI_MODEL || AI_MODEL);
  const temperature = Math.min(
    1,
    Math.max(0, parseFloat(process.env.AI_TEMPERATURE || '0.55') || 0.55)
  );
  const response = await chatCompletions(
    {
      model,
      messages,
      max_tokens: 2048,
      temperature
    },
    { purpose: 'chat', label: tierLabel, maxAttempts: 1 }
  );
  const text = formatModelReply(response.data);
  if (!text) throw new Error('empty model reply');
  return text;
}

/** Подборка строго из каталога, если модель снова путает тип или дублирует ссылки. */
function buildDeterministicListingsReply(urls, lang, dialog, avoidUrls = [], fallbackMeta = {}) {
  const salesLang = normalizeSalesLang(lang);
  const wanted = dialog.propertyTypes || [];
  const avoidKeys = new Set(
    (avoidUrls || []).map((u) =>
      String(u || '')
        .toLowerCase()
        .replace(/\/+$/, '')
    )
  );

  const collectLines = (typeFilter) => {
    const lines = [];
    const seen = new Set();
    const ranked = [...(urls || [])].sort((a, b) => {
      const aAvoid = avoidKeys.has(String(a || '').toLowerCase().replace(/\/+$/, '')) ? 1 : 0;
      const bAvoid = avoidKeys.has(String(b || '').toLowerCase().replace(/\/+$/, '')) ? 1 : 0;
      return aAvoid - bAvoid;
    });
    const { itemMatchesRegions } = require('./catalog-regions');
    const wantedRegions = dialog.macroRegions || [];

    for (const raw of ranked) {
      const item = findItemByUrl(raw);
      if (!item) continue;
      if (wantedRegions.length && !itemMatchesRegions(item, wantedRegions)) continue;
      if (typeFilter.length && !itemMatchesPropertyTypes(item, typeFilter)) continue;
      const share = getShareUrl(item, lang);
      if (!share || seen.has(share)) continue;
      seen.add(share);
      const loc = getLocalizedItem(item, lang);
      const desc = String(loc.description || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
      const price = loc.price || '';
      lines.push(
        `• *${loc.title || 'Object'}*${price ? ` — ${price}` : ''}\n${desc}${desc ? '\n' : ''}${share}`
      );
      if (lines.length >= 5) break;
    }
    return lines;
  };

  let lines = collectLines(wanted);
  let usedTypeFamilyFallback = Boolean(fallbackMeta.usedLastResortTypeFallback);
  if (!lines.length && wanted.length) {
    const { expandLastResortPropertyTypes } = require('./property-types');
    const broadened = [
      ...wanted,
      ...expandLastResortPropertyTypes(wanted),
      ...require('./property-types').expandSoftPropertyTypes(wanted)
    ];
    lines = collectLines([...new Set(broadened)]);
    if (lines.length) usedTypeFamilyFallback = true;
  }
  if (!lines.length) {
    lines = collectLines([]);
  }

  if (!lines.length) return '';

  const typeLabel = dialog.propertyTypeLabel || '';
  const area = dialog.microAreaLabel || dialog.regionLabel || '';
  const budgetNote = dialog.ignoreBudget
    ? salesLang === 'es'
      ? ' (sin límite de precio)'
      : salesLang === 'en'
        ? ' (any price)'
        : salesLang === 'de'
          ? ' (ohne Preislimit)'
          : salesLang === 'fr'
            ? ' (sans limite de prix)'
            : salesLang === 'pl'
              ? ' (bez limitu ceny)'
              : salesLang === 'nl'
                ? ' (geen prijslimiet)'
                : ' (без ограничения цены)'
    : '';

  let intro;
  if (salesLang === 'es') {
    intro = `Aquí tienes opciones${typeLabel ? ` de ${typeLabel}` : ''}${area ? ` en ${area}` : ''}${budgetNote}:`;
  } else if (salesLang === 'en') {
    intro = `Here are some options${typeLabel ? ` (${typeLabel})` : ''}${area ? ` in ${area}` : ''}${budgetNote}:`;
  } else if (salesLang === 'de') {
    intro = `Hier sind passende Optionen${typeLabel ? ` (${typeLabel})` : ''}${area ? ` in ${area}` : ''}${budgetNote}:`;
  } else if (salesLang === 'fr') {
    intro = `Voici des options${typeLabel ? ` (${typeLabel})` : ''}${area ? ` à ${area}` : ''}${budgetNote}:`;
  } else if (salesLang === 'pl') {
    intro = `Oto opcje${typeLabel ? ` (${typeLabel})` : ''}${area ? ` w ${area}` : ''}${budgetNote}:`;
  } else if (salesLang === 'nl') {
    intro = `Hier zijn passende opties${typeLabel ? ` (${typeLabel})` : ''}${area ? ` in ${area}` : ''}${budgetNote}:`;
  } else {
    intro = `Вот варианты${typeLabel ? ` (${typeLabel})` : ''}${area ? ` в ${area}` : ''}${budgetNote}:`;
  }

  if (usedTypeFamilyFallback) {
    const typeWarn =
      salesLang === 'es'
        ? 'En esta región no hay fichas del tipo exacto pedido; estas son las alternativas residenciales más cercanas del catálogo:'
        : salesLang === 'en'
          ? 'There are no exact-type listings in this region; these are the nearest residential alternatives from the catalog:'
          : salesLang === 'de'
            ? 'In dieser Region gibt es keine Objekte des exakten Typs; dies sind die nächsten Wohn-Alternativen aus dem Katalog:'
            : salesLang === 'fr'
              ? 'Pas de fiches du type exact dans cette région ; voici les alternatives résidentielles les plus proches du catalogue :'
              : salesLang === 'pl'
                ? 'W tym regionie nie ma ofert dokładnego typu; to najbliższe alternatywy mieszkaniowe z katalogu:'
                : salesLang === 'nl'
                  ? 'In deze regio zijn er geen objecten van het exacte type; dit zijn de dichtstbijzijnde woonalternatieven uit de catalogus:'
                  : 'В этом регионе нет объектов точного запрошенного типа; вот ближайшее жильё из каталога:';
    intro = `${typeWarn}\n\n${intro}`;
  }

  if (fallbackMeta.usedBudgetFallback) {
    const warning =
      salesLang === 'es'
        ? 'En el presupuesto indicado no hay opciones disponibles; estas son las más cercanas del mismo tipo y región, pero superan el presupuesto.'
        : salesLang === 'en'
          ? 'There are no available options within the stated budget; these are the nearest in the same region and type, but they are over budget.'
          : salesLang === 'de'
            ? 'Im genannten Budget gibt es keine verfügbaren Optionen; diese sind in Region und Typ am nächsten, liegen aber darüber.'
            : salesLang === 'fr'
              ? 'Aucune option disponible dans le budget indiqué ; voici les plus proches du même type et de la même région, mais au-dessus du budget.'
              : salesLang === 'pl'
                ? 'Brak dostępnych opcji w podanym budżecie; to najbliższe oferty tego samego typu i regionu, ale powyżej budżetu.'
                : salesLang === 'nl'
                  ? 'Binnen het opgegeven budget zijn geen opties beschikbaar; dit zijn de dichtstbijzijnde van hetzelfde type en in dezelfde regio, maar boven budget.'
                  : 'В указанном бюджете доступных вариантов нет; это ближайшие объекты того же типа и региона, но они выше бюджета.';
    intro = `${warning}\n\n${intro}`;
  }

  const closer =
    salesLang === 'es'
      ? '¿Cuál te encaja más o qué ajustamos?'
      : salesLang === 'en'
        ? 'Which feels closest, or what should we adjust?'
        : salesLang === 'de'
          ? 'Welcher passt besser, oder was sollen wir anpassen?'
          : salesLang === 'fr'
            ? 'Lequel vous convient le mieux, ou que faut-il ajuster ?'
            : salesLang === 'pl'
              ? 'Która bliższa, albo co skorygujemy?'
              : salesLang === 'nl'
                ? 'Welke past beter, of wat passen we aan?'
                : 'Какой ближе, или что скорректируем?';

  return `${intro}\n\n${lines.join('\n\n')}\n\n${closer}`;
}

function replyNeedsCatalogForce(reply, wantedTypes) {
  return (
    !hasValidCatalogPropertyLinks(reply) ||
    hasInventedHtLinks(reply) ||
    hasDuplicatePropertyUrls(reply) ||
    hasMismatchedPropertyTypeUrls(reply, wantedTypes)
  );
}

/** Подборка с ценами/типами жилья, но без реальных URL каталога — галлюцинация модели. */
function replyLooksLikeInventedListings(reply) {
  if (!reply || hasValidCatalogPropertyLinks(reply)) return false;
  const priceHits = (String(reply).match(/(?:€|eur)\s*[\d.,]+|[\d.,]+\s*(?:€|eur)/gi) || [])
    .length;
  const listingHints =
    /apartament|апартамент|квартир|villa|вилл|piso|wohnung|appartement|maison|дом\b|house\b|penthouse|студи/i.test(
      reply
    );
  return priceHits >= 2 && listingHints;
}

function buildHonestNoCatalogReply(lang, dialog) {
  const salesLang = normalizeSalesLang(lang);
  const typeLabel = dialog.propertyTypeLabel || '';
  const area = dialog.microAreaLabel || dialog.regionLabel || '';
  if (salesLang === 'es') {
    return (
      `Ahora mismo en el catálogo de House Tenerife no hay fichas${typeLabel ? ` de ${typeLabel}` : ''}` +
      `${area ? ` en ${area}` : ''} con enlace disponible bajo esos parámetros.\n\n` +
      `¿Ajustamos zona, presupuesto o tipo — o miramos otra región del catálogo?`
    );
  }
  if (salesLang === 'en') {
    return (
      `Right now the House Tenerife catalog has no${typeLabel ? ` ${typeLabel}` : ''} listings` +
      `${area ? ` in ${area}` : ''} with links for those parameters.\n\n` +
      `Shall we adjust area, budget or type — or look at another catalog region?`
    );
  }
  if (salesLang === 'de') {
    return (
      `Im House-Tenerife-Katalog gibt es derzeit keine${typeLabel ? ` ${typeLabel}-` : ' '}` +
      `Objekte${area ? ` in ${area}` : ''} mit Link zu diesen Parametern.\n\n` +
      `Zone, Budget oder Typ anpassen — oder eine andere Katalogregion ansehen?`
    );
  }
  if (salesLang === 'fr') {
    return (
      `Pour l’instant le catalogue House Tenerife n’a pas de fiches` +
      `${typeLabel ? ` (${typeLabel})` : ''}${area ? ` à ${area}` : ''} avec lien pour ces critères.\n\n` +
      `On ajuste zone, budget ou type — ou une autre région du catalogue ?`
    );
  }
  if (salesLang === 'pl') {
    return (
      `W katalogu House Tenerife nie ma teraz ofert` +
      `${typeLabel ? ` (${typeLabel})` : ''}${area ? ` w ${area}` : ''} z linkiem dla tych parametrów.\n\n` +
      `Skorygujemy strefę, budżet lub typ — albo inną region katalogu?`
    );
  }
  if (salesLang === 'nl') {
    return (
      `In de House Tenerife-catalogus zijn er nu geen` +
      `${typeLabel ? ` ${typeLabel}` : ''} objecten` +
      `${area ? ` in ${area}` : ''} met link voor die parameters.\n\n` +
      `Zone, budget of type aanpassen — of een andere catalogusregio bekijken?`
    );
  }
  return (
    `В каталоге House Tenerife сейчас нет карточек` +
    `${typeLabel ? ` (${typeLabel})` : ''}${area ? ` в ${area}` : ''} со ссылкой под эти параметры.\n\n` +
    `Скорректируем район, бюджет или тип — или посмотрим другой регион каталога?`
  );
}

function buildAskBudgetInsteadOfListingsReply(lang, dialog) {
  const salesLang = normalizeSalesLang(lang);
  const invest = dialog?.isInvestment;
  if (salesLang === 'es') {
    return invest
      ? 'Gracias por el interés :) ¿Cuál es su presupuesto de inversión en €? Con eso le muestro opciones en una banda de ±20%.'
      : 'Gracias por el interés :) ¿En qué rango de presupuesto en € nos orientamos? Después le muestro opciones en una banda de ±20%.';
  }
  if (salesLang === 'en') {
    return invest
      ? 'Thanks for the interest :) What’s your investment budget in €? I’ll then shortlist within about ±20% of that.'
      : 'Thanks for the interest :) What budget range in € should we use? I’ll then show options within about ±20%.';
  }
  return invest
    ? 'Спасибо за интерес :) Какой у вас бюджет для инвестиции в €? После этого покажу варианты в коридоре ±20%.'
    : 'Спасибо за интерес :) На какой бюджет в € ориентируемся? После этого покажу варианты в коридоре ±20%.';
}

function stripPropertyLinksKeepText(text) {
  return String(text || '')
    .replace(
      /https?:\/\/(?:www\.)?housetenerife\.eu(?:\/(?:ru|es|en|de|fr|pl|nl))?\/property\/[^\s<>\])"'}]+/gi,
      ''
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Один запрос к ИИ (без каскада 6× повторов). При 429 — сразу запасной ключ, если задан.
 * @param {Array<{sender:string,text:string}>} conversationHistory
 * @param {string} userLanguage
 * @param {{ chatId?: string, userProfile?: object }} [options]
 */
async function askAI(conversationHistory, userLanguage = 'ru', options = {}) {
  const salesLangEarly = normalizeSalesLang(userLanguage);
  let dialog = analyzeConversation(conversationHistory, userLanguage);
  let userProfile = options.userProfile || null;
  let intentGate = null;
  let topicSummary = null;
  let analysisHistory = conversationHistory;
  if (options.chatId && !String(options.chatId).endsWith('@g.us')) {
    try {
      const previousProfile = getUserProfile(options.chatId);
      intentGate = evaluateIntentGate(
        conversationHistory,
        userLanguage,
        previousProfile?.topicObservation
      );
      const topicContext = prepareAndSaveTopicContext(
        options.chatId,
        conversationHistory,
        intentGate
      );
      conversationHistory = topicContext.history;
      analysisHistory = topicContext.analysisHistory;
      topicSummary = topicContext.summary;
      dialog = analyzeConversation(analysisHistory, userLanguage);
      userProfile = updateUserProfileFromConversation(
        options.chatId,
        conversationHistory,
        dialog,
        userLanguage,
        { topicObservation: intentGate }
      );
      console.log(
        `🧭 Gate ${options.chatId}: ${intentGate.action} / ${intentGate.scenario} / ${intentGate.reason}`
      );
    } catch (e) {
      console.warn(`⚠️ Не удалось обновить профиль ${options.chatId}:`, e.message);
    }
  }
  const aiNotConfigured =
    salesLangEarly === 'es'
      ? 'El servicio de IA no está configurado: define AI_API_KEY y reinicia el bot.'
      : salesLangEarly === 'en'
        ? 'AI service is not configured: set AI_API_KEY and restart the bot.'
        : 'Сервис ИИ не настроен: задайте AI_API_KEY в Railway Variables и перезапустите бота.';

  if (!AI_API_KEY || !String(AI_API_KEY).trim()) {
    return aiNotConfigured;
  }

  try {
    const salesLang = normalizeSalesLang(userLanguage);
    const {
      messages,
      catalogUrls,
      catalogUsedBudgetFallback,
      catalogUsedAreaFallback,
      catalogUsedLastResortTypeFallback
    } = await buildPromptParts(
      conversationHistory,
      userLanguage,
      'full',
      { userProfile, intentGate, topicSummary, analysisHistory }
    );
    let reply = await callAI(messages, 'chat');
    if (hasUnsupportedDelayedListingPromise(reply)) {
      console.warn('⚠️ AI обещал отправить подборку позже — переписываю ответ без отложенного обещания');
      reply = await callAI(
        [
          ...messages,
          { role: 'assistant', content: reply },
          {
            role: 'user',
            content:
              'Перепиши последний ответ. Нельзя обещать отправить варианты позже, через пару минут или через 90 секунд. Если критерии достаточны — дай подборку объектов прямо сейчас из доступного каталога. Если критериев недостаточно — задай один следующий вопрос. Кратко, WhatsApp-стиль. Весь ответ строго на языке диалога (без смеси языков). Копируй URL только из блока каталога (формат /property/slug/), никогда не выдумывай /objekt/ID.'
          }
        ],
        'chat-no-delay-rewrite'
      );
    }
    const listingStage =
      dialog.stage === 'SHOW_LISTINGS' ||
      ((dialog.wantsPropertyLinks ||
        (dialog.stage === 'REFINE' && dialog.wantsListings)) &&
        (dialog.hasBudget || dialog.ignoreBudget) &&
        Boolean(dialog.readyForListings || dialog.financeReadyForListings || dialog.ignoreBudget));
    const recentUrls = collectRecentPropertyUrls(conversationHistory);
    let urlsForRepair = Array.isArray(catalogUrls) ? [...catalogUrls] : [];
    const fallbackMeta = {
      usedBudgetFallback: Boolean(catalogUsedBudgetFallback),
      usedAreaFallback: Boolean(catalogUsedAreaFallback),
      usedLastResortTypeFallback: Boolean(catalogUsedLastResortTypeFallback)
    };
    const replyHasPropertyLink = /housetenerife\.eu[^.\s]*\/property\//i.test(reply);
  // Чужой тип / дубли / выдумки / чужой регион — даже если этап ещё не SHOW_LISTINGS
    const replyHasWrongRegion =
      Boolean(dialog.macroRegions?.length) &&
      replyHasPropertyLink &&
      (() => {
        const { itemMatchesRegions } = require('./catalog-regions');
        const re = /https?:\/\/(?:www\.)?housetenerife\.eu(?:\/(?:ru|es|en|de|fr|pl|nl))?\/property\/[^\s<>\])"'}]+/gi;
        const urls = String(reply).match(re) || [];
        if (!urls.length) return false;
        return urls.some((u) => {
          const item = findItemByUrl(u);
          return item && !itemMatchesRegions(item, dialog.macroRegions);
        });
      })();

    const badTypeOrLinks =
      (Boolean(dialog.propertyTypes?.length) &&
        replyHasPropertyLink &&
        replyNeedsCatalogForce(reply, dialog.propertyTypes)) ||
      replyHasWrongRegion;

    // «Дай ссылки» / подборка без карточек — нельзя отсылать только на общий сайт
    const websiteOnlyNoCards =
      (dialog.wantsPropertyLinks || listingStage) &&
      !hasValidCatalogPropertyLinks(reply) &&
      /(?:на\s+наш(?:ем)?\s+сайт|на\s+сайте|раздел\s+с\s+недвижим|housetenerife\.eu(?!\/(?:ru|es|en|de|fr|pl|nl)?\/property)|look(?:ing)?\s+(?:at\s+)?(?:our\s+)?(?:web)?site|on\s+our\s+(?:web)?site|en\s+nuestro\s+sitio|auf\s+unserer\s+(?:web)?seite|sur\s+notre\s+site)/i.test(
        reply
      );

    const inventedListings =
      (listingStage || dialog.wantsPropertyLinks || dialog.wantsListings) &&
      replyLooksLikeInventedListings(reply);

    const admitsNoLinks =
      (dialog.wantsPropertyLinks || listingStage) &&
      !hasValidCatalogPropertyLinks(reply) &&
      /(?:no\s+dispongo|no\s+tengo\s+(?:fichas|enlaces)|sin\s+enlaces|don'?t\s+have\s+(?:the\s+)?links?|no\s+links?\s+available|нет\s+(?:точных\s+)?(?:ссылок|карточек)|не\s+могу\s+(?:дать|скинуть)\s+ссылк)/i.test(
        reply
      );

    if (
      (hasInventedHtLinks(reply) ||
        badTypeOrLinks ||
        websiteOnlyNoCards ||
        inventedListings ||
        admitsNoLinks ||
        ((listingStage || dialog.wantsPropertyLinks) && !urlsForRepair.length)) &&
      !urlsForRepair.length
    ) {
      const budget = dialog.ignoreBudget
        ? { minPrice: null, maxPrice: null }
        : extractBudgetRange(dialog.allUserText);
      const priceTarget = dialog.ignoreBudget ? null : derivePriceTarget(budget);
      const fallback = searchForContext(
        buildCatalogSearchQuery(conversationHistory) || dialog.allUserText,
        8,
        {
          minPrice: budget.minPrice,
          maxPrice: budget.maxPrice,
          priceTarget,
          propertyTypes: dialog.propertyTypes,
          macroRegions: dialog.macroRegions,
          microAreaGroupIds: dialog.microAreaGroupIds || [],
          microDetection: dialog.microAreas,
          lang: userLanguage,
          contextText: dialog.allUserText,
          allowBudgetFallback: true,
          allowTypeFamilyFallback: true
        }
      );
      urlsForRepair = Array.isArray(fallback.urls) ? fallback.urls : [];
      fallbackMeta.usedBudgetFallback = Boolean(fallback.usedBudgetFallback);
      fallbackMeta.usedAreaFallback = Boolean(fallback.usedAreaFallback);
      fallbackMeta.usedLastResortTypeFallback = Boolean(fallback.usedLastResortTypeFallback);
    }

    const needsListingLinks =
      urlsForRepair.length > 0 &&
      (listingStage ||
        badTypeOrLinks ||
        websiteOnlyNoCards ||
        inventedListings ||
        admitsNoLinks ||
        dialog.wantsPropertyLinks) &&
      (replyNeedsCatalogForce(reply, dialog.propertyTypes) ||
        replyHasWrongRegion ||
        inventedListings ||
        admitsNoLinks);

    if (needsListingLinks) {
      const safe = buildDeterministicListingsReply(
        urlsForRepair,
        userLanguage,
        dialog,
        recentUrls,
        fallbackMeta
      );
      if (safe) {
        console.warn('⚠️ AI подборка с битыми/чужими/дублирующими ссылками — ответ из каталога');
        reply = safe;
      } else {
        console.warn(
          '⚠️ AI подборка с битыми/чужими/дублирующими ссылками — переписываю из каталога'
        );
        const urlList = urlsForRepair.slice(0, 5).join('\n');
        reply = await callAI(
          [
            ...messages,
            { role: 'assistant', content: reply },
            {
              role: 'user',
              content:
                `Rewrite: include 3–5 property options NOW. Copy ONLY these exact housetenerife.eu /property/… URLs from the catalog (never invent /objekt/123 or other paths). Each option MUST use a different URL. Keep the requested property type only (${dialog.propertyTypeLabel || 'as in criteria'}). Never substitute apartments for business/villas.\n${urlList}\nKeep the entire reply in the dialog language only (no language mixing). WhatsApp style.`
            }
          ],
          'chat-force-listings'
        );
      }
    } else if (
      (listingStage || dialog.wantsPropertyLinks || inventedListings || admitsNoLinks) &&
      !urlsForRepair.length &&
      (inventedListings ||
        admitsNoLinks ||
        dialog.wantsPropertyLinks ||
        (listingStage && !hasValidCatalogPropertyLinks(reply)))
    ) {
      console.warn('⚠️ Каталог пуст по критериям — честный ответ без выдуманных объектов');
      reply = buildHonestNoCatalogReply(userLanguage, dialog);
    }
    if (replyMismatchesLanguage(reply, salesLang)) {
      console.warn(
        `⚠️ AI ответ не на языке диалога (${salesLang}) или с транслитом — переписываю`
      );
      reply = await callAI(
        [
          ...messages,
          { role: 'assistant', content: reply },
          { role: 'user', content: languageRewriteInstruction(salesLang) }
        ],
        'chat-lang-rewrite'
      );
    }
    // Страховка: убрать иероглифы, если модель снова вставила CJK
    reply = stripUnexpectedScripts(reply);
    const lastUserMsg =
      [...(conversationHistory || [])].reverse().find((m) => m.sender === 'user')?.text || '';
    reply = repairPropertyUrlsInText(
      fixPhoneticTransliterations(
        sanitizeListingWhyLabels(
          softenRoboticPunctuation(
            mirrorUserEmojiInReply(
              maybeAddWarmSmiley(sanitizeDelayedListingPromise(reply), salesLang, dialog.stage),
              lastUserMsg,
              { force: isEmojiOnlyMessage(lastUserMsg) }
            ),
            dialog.stage
          )
        ),
        salesLang
      ),
      userLanguage,
      urlsForRepair,
      { wantedTypes: dialog.propertyTypes || [], avoidUrls: recentUrls }
    );
    // Жёсткий гард: без бюджета нельзя отдавать карточки/ссылки (даже если модель выдумала)
    if (!dialog.hasBudget && !dialog.ignoreBudget) {
      const clientSentOwnLink = /housetenerife\.eu[^.\s]*\/property\//i.test(lastUserMsg);
      if (!clientSentOwnLink) {
        const hadListingLeak =
          /housetenerife\.eu[^.\s]*\/property\//i.test(reply) ||
          replyLooksLikeInventedListings(reply);
        if (hadListingLeak) {
          console.warn('⚠️ Ответ с объектами без бюджета — вырезаю ссылки и прошу бюджет');
          reply = stripPropertyLinksKeepText(reply);
          if (replyLooksLikeInventedListings(reply) || /(?:€|eur)\s*[\d.,]+/i.test(reply)) {
            reply = buildAskBudgetInsteadOfListingsReply(userLanguage, dialog);
          }
        }
      }
    }
    if (listingStage) {
      reply = stripNonCatalogUrls(reply);
    }

    // Финальный предохранитель: тип/дубли/чужой регион после починки
    if (
      urlsForRepair.length > 0 &&
      (listingStage || badTypeOrLinks || websiteOnlyNoCards || dialog.wantsPropertyLinks) &&
      (replyNeedsCatalogForce(reply, dialog.propertyTypes) ||
        (() => {
          if (!dialog.macroRegions?.length) return false;
          const { itemMatchesRegions } = require('./catalog-regions');
          const re =
            /https?:\/\/(?:www\.)?housetenerife\.eu(?:\/(?:ru|es|en|de|fr|pl|nl))?\/property\/[^\s<>\])"'}]+/gi;
          const urls = String(reply).match(re) || [];
          return urls.some((u) => {
            const item = findItemByUrl(u);
            return item && !itemMatchesRegions(item, dialog.macroRegions);
          });
        })())
    ) {
      const safe = buildDeterministicListingsReply(
        urlsForRepair,
        userLanguage,
        dialog,
        recentUrls,
        fallbackMeta
      );
      if (safe) {
        console.warn('⚠️ Подборка заменена на каталог (тип/дубли ссылок)');
        reply = safe;
      }
    }

    if (options.chatId) {
      try {
        recordTopicAssistantReply(options.chatId, reply);
      } catch (e) {
        console.warn(`⚠️ Не удалось сохранить ответ в теме ${options.chatId}:`, e.message);
      }
    }
    return reply;
  } catch (error) {
    const status = error.response?.status;
    console.error('ai-service:', status || error.code || error.message);

    if (error.code === 'AI_KEY_MISSING') {
      return aiNotConfigured;
    }
    if (status === 401) {
      return salesLangEarly === 'es'
        ? 'Error de autorización de IA: revisa AI_API_KEY.'
        : salesLangEarly === 'en'
          ? 'AI authorization error: check AI_API_KEY.'
          : 'Ошибка авторизации ИИ: проверьте AI_API_KEY в Railway Variables.';
    }
    if (status === 402) {
      return (
        salesLangEarly === 'es'
          ? 'Sin crédito en la cuenta de IA (402). Prueba OpenRouter free.'
          : salesLangEarly === 'en'
            ? 'AI account has no credit (402). Try OpenRouter free.'
            : 'На счёте ИИ нет средств (402). Пополните OpenRouter и проверьте AI_API_KEY / AI_MODEL=openai/gpt-4.1-mini в Railway Variables.'
      );
    }
    if (status === 429 || error.code === 'AI_RATE_LIMIT') {
      return salesLangEarly === 'es'
        ? 'Límite de peticiones a la IA (429). Espera un minuto.'
        : salesLangEarly === 'en'
          ? 'AI rate limit (429). Wait a minute or switch provider.'
          : 'Лимит запросов к ИИ (429). Подождите минуту или проверьте баланс OpenRouter (GPT).';
    }

    // Только при таймауте/сети — один компактный повтор
    const msg = String(error.message || '');
    if (
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT' ||
      msg.includes('timeout')
    ) {
      try {
        const { messages, catalogUrls } = await buildPromptParts(
          conversationHistory,
          userLanguage,
          'compact',
          { userProfile, intentGate, topicSummary, analysisHistory }
        );
        const retryReply = await callAI(messages, 'chat-retry');
        const salesLangRetry = normalizeSalesLang(userLanguage);
        const lastUserRetry =
          [...(conversationHistory || [])].reverse().find((m) => m.sender === 'user')?.text || '';
        const repairedRetry = repairPropertyUrlsInText(
          fixPhoneticTransliterations(
            sanitizeListingWhyLabels(
              softenRoboticPunctuation(
                mirrorUserEmojiInReply(
                  maybeAddWarmSmiley(
                    sanitizeDelayedListingPromise(stripUnexpectedScripts(retryReply)),
                    salesLangRetry,
                    dialog.stage
                  ),
                  lastUserRetry,
                  { force: isEmojiOnlyMessage(lastUserRetry) }
                ),
                dialog.stage
              )
            ),
            salesLangRetry
          ),
          userLanguage,
          catalogUrls,
          {
            wantedTypes: dialog.propertyTypes || []
          }
        );
        if (options.chatId) {
          try {
            recordTopicAssistantReply(options.chatId, repairedRetry);
          } catch (e) {
            console.warn(`⚠️ Не удалось сохранить retry в теме ${options.chatId}:`, e.message);
          }
        }
        return repairedRetry;
      } catch (retryErr) {
        console.error('ai-service retry:', retryErr.message);
      }
    }

    return salesLangEarly === 'es'
      ? 'No pude obtener respuesta de la IA. Inténtalo de nuevo en un minuto.'
      : salesLangEarly === 'en'
        ? 'Could not get an AI reply. Please try again in a minute.'
        : 'Не удалось получить ответ от ИИ. Попробуйте ещё раз через минуту.';
  }
}

/** Короткая проверка для Telegram /ai и мониторинга. */
async function checkAIHealth() {
  const model = resolveGptModel(process.env.AI_MODEL || AI_MODEL);
  const apiKey = process.env.AI_API_KEY || AI_API_KEY;
  const started = Date.now();

  if (!apiKey || !String(apiKey).trim()) {
    return {
      ok: false,
      code: 'AI_KEY_MISSING',
      message: 'AI_API_KEY не задан',
      model,
      latencyMs: 0
    };
  }

  let lastEmpty = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await chatCompletions(
        {
          model,
          messages: [{ role: 'user', content: 'Reply with one word only: ok' }],
          max_tokens: 128,
          temperature: 0
        },
        { purpose: 'chat', label: 'health-check', maxAttempts: 1, timeout: 60000 }
      );
      const usedModel = response.data?.model || model;
      const sample = formatModelReply(response.data);
      if (sample) {
        return {
          ok: true,
          model: usedModel,
          latencyMs: Date.now() - started,
          sample: sample.slice(0, 80)
        };
      }
      lastEmpty = true;
    } catch (error) {
      const status = error.response?.status;
      return {
        ok: false,
        code: error.code || (status ? `HTTP_${status}` : 'error'),
        message: apiErrorDetailFromResponse(error) || error.message,
        model,
        status,
        latencyMs: Date.now() - started
      };
    }
  }

  return {
    ok: false,
    code: 'EMPTY_REPLY',
    message:
      'Модель вернула пустой ответ. Проверьте AI_MODEL=openai/gpt-4.1-mini и перезапустите сервис.',
    model,
    latencyMs: Date.now() - started
  };
}

module.exports = { askAI, checkAIHealth };
