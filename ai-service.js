const { chatCompletions, AI_MODEL, AI_API_KEY } = require('./ai-client');
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
const { maybeAddWarmSmiley, getWarmTonePromptBlock } = require('./reply-warmth');
const {
  repairPropertyUrlsInText,
  hasValidCatalogPropertyLinks,
  hasInventedHtLinks,
  hasDuplicatePropertyUrls,
  hasMismatchedPropertyTypeUrls,
  collectRecentPropertyUrls,
  findItemByUrl,
  getShareUrl
} = require('./property-share');
const { itemMatchesPropertyTypes } = require('./property-types');
const {
  fixPhoneticTransliterations,
  replyMismatchesLanguage,
  languageRewriteInstruction
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
    dialog.stage === 'SHOW_LISTINGS' || dialog.stage === 'REFINE' || dialog.wantsListings;
  const maySearchCatalog =
    dialog.hasType && dialog.hasPurpose && (showingListings || tier !== 'full');

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
      contextText: dialog.allUserText
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
  }

  let webBlock = '';
  if (tier === 'full' && shouldAugmentWithWeb(userQuery)) {
    const webSuffix =
      salesLang === 'es'
        ? 'compra inmueble España Canarias'
        : salesLang === 'en'
          ? 'property purchase Spain Canary Islands'
          : salesLang === 'de'
            ? 'Immobilienkauf Spanien Kanaren'
            : salesLang === 'fr'
              ? 'achat immobilier Espagne Canaries'
              : salesLang === 'pl'
                ? 'zakup nieruchomości Hiszpania Wyspy Kanaryjskie'
                : salesLang === 'nl'
                  ? 'vastgoed kopen Spanje Canarische Eilanden'
                  : 'покупка недвижимости Испания Канары';
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
  const consultantKnowledgeRaw = getKnowledgeBaseForPrompt({
    query: knowledgeQuery,
    scenario: activeScenario,
    language: salesLang,
    maxSections: tier === 'minimal' ? 2 : tier === 'compact' ? 3 : 4,
  });
  const consultantKnowledge = localizeKnowledgeBase(consultantKnowledgeRaw, salesLang);
  const mortgageKnowledgeSlice = {
    disclaimer: consultantKnowledge.disclaimer,
    mortgage_process: consultantKnowledge.mortgage_process,
    purchase_documents: consultantKnowledge.purchase_documents
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
- Цель (жизнь/инвестиция): ${dialog.hasPurpose ? 'да' : 'ещё нет'}
- Бюджет: ${dialog.hasBudget ? `да${dialog.budgetLabel || formatBudgetLabel(budget, 'ru') ? ` — ${dialog.budgetLabel || formatBudgetLabel(budget, 'ru')}` : ''}` : 'ещё нет'}
- Регион: ${dialog.hasRegion ? `да (${dialog.regionLabel})` : `ещё нет — ${dialog.regionOptions}`}
- Район / зона: ${dialog.hasLocation ? `да (${dialog.microAreaLabel || 'уточнено'})` : dialog.needsMicroArea ? `ещё нет (примеры: ${dialog.areaOptionsPrompt || 'уточнить у клиента'})` : 'не требуется'}
- Тип объекта: ${dialog.hasType ? `да (${dialog.propertyTypeLabel})` : 'ещё нет — обязательно уточни до подборки'}
${dialog.hasBudget ? '- ⛔ Бюджет уже назван — НЕ переспрашивай его. Если просят «ещё/похожие» — сразу новая подборка.\n' : ''}${dialog.hasType && dialog.hasRegion && dialog.hasLocation ? '- ⛔ Тип, регион и район известны — не переспрашивай.\n' : ''}`
      : blocks.criteria;

  const conversationRules =
    salesLang === 'ru'
      ? `**ПРАВИЛА РАЗГОВОРА (обязательно):**
- Веди как опытный продавец-аналитик: сначала пойми человека, потом дай ценность (подборка), потом углубляй, потом мягко созвон.
- Не повторяй выбор клиента после каждого сообщения. Отражай его словами только если это снимает сомнение или помогает продать; чаще сразу переходи к следующему точному вопросу.
- Один понятный вопрос в конце (не три сразу).
- Не предлагай объекты, пока не ясны цель и тип.
- Никогда не переспрашивай то, что клиент уже сказал (бюджет, район, тип, цель) — смотри блок «ПАМЯТЬ ДИАЛОГА» / собранные критерии.
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
На этапах SHOW_LISTINGS / REFINE — покажи 3–5 РАЗНЫХ объектов из блока ниже (название, цена, ссылка, одна фраза почему подходит). Только тот регион${dialog.microAreaLabel ? ` и район (${dialog.microAreaLabel})` : ''}, что выбрал клиент — не подмешивай Adeje, если просили Los Cristianos, и наоборот.
**Тип объекта:** строго соблюдай запрошенный тип (${dialog.propertyTypeLabel || 'из критериев'}). Если просили виллы — только виллы (не апартаменты и не «виллы и апартаменты»). Если просили апартаменты — не давай виллы и тем более бизнес/рестораны. Если просили готовый бизнес — только бизнес/ресторан/бар из каталога; ЗАПРЕЩЕНО подменять апартаментами «под аренду». Копируй из блока каталога пары «название + URL» как есть — не подставляй одну ссылку к разным объектам и не повторяй ссылку из предыдущих сообщений чата.
**Цена:** ${
        dialog.ignoreBudget
          ? 'клиент снял ограничение по цене — показывай подходящие по типу и району объекты из блока без фильтра «около бюджета».'
          : 'не предлагай варианты сильно дешевле бюджета клиента — только около названной суммы или чуть дороже (премиум/больше метраж), если клиент не просил именно дешевле.'
      }
**Ссылки:** копируй URL из блока каталога БУКВАЛЬНО (формат https://housetenerife.eu/…/property/slug/). Запрещено выдумывать /objekt/123, /object/ID и любые другие пути.
На этапах FIRST_CONTACT / NEED_* — объекты не вываливай. Регионы каталога: ${dialog.regionOptions} (housetenerife.eu).
Подборка только когда ясны *цель*, тип, бюджет, регион и конкретная зона/район; ссылки только из блока ниже.
Никогда не пиши клиенту, что отправишь подборку позже. Системная задержка ссылок уже есть: твоя задача — сформировать подборку сразу в текущем ответе.
После подборки — один вопрос: какой вариант ближе или что скорректировать (бюджет/район).
**Ипотека/кредит:** если спрашивают шаги, процесс, «как получить ипотеку» — ответь по mortgage_process (5–7 нумерованных шагов), без выдуманных ставок и гарантий одобрения.
**Конкретный объект:** если клиент выбрал вариант — уточни деньги *сейчас на руках*, нужна ли ипотека; при ипотеке — шаги (mortgage_process) + документы и справка о доходах. Потом — предложи созвон с менеджером (да/нет).
**Связь с менеджером:** если клиент хочет человека / звонок / просмотр — тепло предложи короткий созвон, чтобы обсудить текущий шаг диалога. Не проси писать слово «менеджер» и не давай телефон вместо заявки.`
      : `**PROPERTY CATALOG (${catalog.totalInDb || 'full'} listings on site; block below = best matches):**
${blocks.catalog}
**Pricing:** stay around budget or slightly above — not much cheaper unless they asked.
**Links:** copy URLs from the catalog block EXACTLY (https://housetenerife.eu/…/property/slug/). Never invent /objekt/123, /object/ID, or any other path.
${blocks.mortgage}
${blocks.propertyFinance}
${blocks.managerHandoff}`;

  const langRule = buildReplyLanguageRule(userLanguage);

  const disclaimerLabel = salesLang === 'es' ? '**AVISO LEGAL:**' : salesLang === 'en' ? '**DISCLAIMER:**' : '**ДИСКЛЕЙМЕР:**';
  const knowledgeLabel =
    salesLang === 'es' ? '**BASE DE CONOCIMIENTO:**' : salesLang === 'en' ? '**KNOWLEDGE BASE:**' : '**БАЗА ЗНАНИЙ:**';
  const siteLabel =
    salesLang === 'es' ? '*Catálogo:*' : salesLang === 'en' ? '*Catalog site:*' : '*Сайт каталога:*';

  const fileDocBlock =
    tier === 'full'
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

${stageHeader}
${stageBlock}

${criteriaBlock}

${dialog.financeSummaryBlock || ''}

${conversationRules}

${salesPlaybookBlock}

${getWritingQualityBlock(salesLang)}

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
    catalogFound: Boolean(catalog.found)
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
- Flawless spelling, grammar, and punctuation — no typos, no glued words, no broken phrases.
- Every word must have a space; complete sentences only.
- Natural fluent English — never Russian transliteration, never Spanglish.
- At most ONE emoji or text smiley :) per message — add it on greeting and warm replies (Perfecto, Got it, Hi…). Skip only on listings, mortgage, documents, errors.
- Sound like a real advisor texting on WhatsApp — warm, natural, never robotic or like machine translation.`;
  }
  if (salesLang === 'es') {
    return `**CALIDAD DEL TEXTO (crítico para ventas):**
- Ortografía, gramática y puntuación impecables — sin faltas, sin palabras pegadas ni frases rotas.
- Español natural — sin ruso, sin calcos del inglés, sin transliteraciones raras.
- Cada palabra con su espacio; frases completas.
- En saludo y confirmaciones cálidas (Perfecto, Hola, Genial) incluye un 🙂 o :) — uno por mensaje. No en fichas, hipoteca ni documentos.
- Tono humano en WhatsApp — cercano y natural, nunca robótico ni traducción automática.`;
  }
  if (salesLang === 'de') {
    return `**TEXTQUALITÄT (kritisch für Verkauf):**
- Einwandfreie Rechtschreibung, Grammatik und Zeichensetzung — keine Tippfehler, keine zusammengeklebten Wörter.
- Natürliches Deutsch — kein Russisch, kein steifes Maschinendeutsch.
- Jedes Wort mit Abstand; vollständige Sätze.
- Bei Begrüßung und warmen Bestätigungen (Perfekt, Hallo) ein 🙂 oder :) — eines pro Nachricht. Nicht bei Objektlisten, Hypothek oder Dokumenten.
- Klinge wie ein echter Berater auf WhatsApp — warm, natürlich, nie roboterhaft.`;
  }
  if (salesLang === 'fr') {
    return `**QUALITÉ DU TEXTE (critique pour la vente):**
- Orthographe, grammaire et ponctuation impeccables — pas de fautes ni mots collés.
- Français naturel — pas de russe, pas de calques d’anglais.
- Chaque mot espacé; phrases complètes.
- À l’accueil et confirmations chaleureuses (Parfait, Bonjour) un 🙂 ou :) — un par message. Pas sur les fiches, l’hypothèque ni les documents.
- Ton humain WhatsApp — chaleureux et naturel, jamais robotique.`;
  }
  if (salesLang === 'pl') {
    return `**JAKOŚĆ TEKSTU (krytyczne dla sprzedaży):**
- Bezbłędna ortografia, gramatyka i interpunkcja — bez literówek i sklejonych słów.
- Naturalny polski — bez rosyjskiego i angielskich kalków.
- Każde słowo z odstępem; pełne zdania.
- Przy powitaniu i ciepłych potwierdzeniach (Świetnie, Cześć) jeden 🙂 lub :) — jeden na wiadomość. Nie przy listach ofert, kredycie ani dokumentach.
- Ludzki ton WhatsApp — ciepło i naturalnie, nigdy jak robot.`;
  }
  if (salesLang === 'nl') {
    return `**TEKSTKWALITEIT (kritisch voor verkoop):**
- Flawless spelling, grammatica en interpunctie — geen typfouten of plakwoorden.
- Natuurlijk Nederlands — geen Russisch, geen Engelse calques.
- Elk woord met spatie; volledige zinnen.
- Bij begroeting en warme bevestigingen (Top, Hallo) één 🙂 of :) — één per bericht. Niet bij objectlijsten, hypotheek of documenten.
- Menselijke WhatsApp-toon — warm en natuurlijk, nooit robotachtig.`;
  }
  return `**КАЧЕСТВО ТЕКСТА (критично для продаж):**
- Без орфографических ошибок, без «склеенных» слов, без обрывков и канцелярита.
- Пиши НАСТОЯЩИМ русским — запрещена транслитерация английских слов кириллицей.
  Плохо: «Арор», «баджет», «проперти», «листинг», «хеллоу», «сорри», «плиз».
  Хорошо: «Ошибка», «бюджет», «объект», «объявление», «привет», «извините», «пожалуйста».
- Каждое слово отдельно, предложения законченные — перечитай ответ перед отправкой.
- На приветствии и тёплых репликах (Отлично, Понял, Привет) — один 🙂 или :). Не в подборке, ипотеке, документах.
- Живой язык опытного риелтора в WhatsApp — тепло и по-человечески, не call-центр и не «переводчик».`;
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
  const model = process.env.AI_MODEL || AI_MODEL;
  if (model === 'openrouter/free') {
    console.warn(
      '⚠️ AI_MODEL=openrouter/free — качество нестабильно (случайные слабые модели). ' +
        'Рекомендуем: deepseek/deepseek-chat-v3-0324 или meta-llama/llama-3.3-70b-instruct'
    );
  }
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
function buildDeterministicListingsReply(urls, lang, dialog, avoidUrls = []) {
  const salesLang = normalizeSalesLang(lang);
  const wanted = dialog.propertyTypes || [];
  const avoidKeys = new Set(
    (avoidUrls || []).map((u) =>
      String(u || '')
        .toLowerCase()
        .replace(/\/+$/, '')
    )
  );
  const lines = [];
  const seen = new Set();

  const ranked = [...(urls || [])].sort((a, b) => {
    const aAvoid = avoidKeys.has(String(a || '').toLowerCase().replace(/\/+$/, '')) ? 1 : 0;
    const bAvoid = avoidKeys.has(String(b || '').toLowerCase().replace(/\/+$/, '')) ? 1 : 0;
    return aAvoid - bAvoid;
  });

  for (const raw of ranked) {
    const item = findItemByUrl(raw);
    if (!item) continue;
    if (wanted.length && !itemMatchesPropertyTypes(item, wanted)) continue;
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
    const { messages, catalogUrls } = await buildPromptParts(
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
      (dialog.stage === 'REFINE' && dialog.wantsListings);
    const recentUrls = collectRecentPropertyUrls(conversationHistory);
    let urlsForRepair = Array.isArray(catalogUrls) ? [...catalogUrls] : [];
    const replyHasPropertyLink = /housetenerife\.eu[^.\s]*\/property\//i.test(reply);
    // Чужой тип / дубли / выдумки — даже если этап ещё не SHOW_LISTINGS (модель часто тащит старую ссылку из истории)
    const badTypeOrLinks =
      Boolean(dialog.propertyTypes?.length) &&
      replyHasPropertyLink &&
      replyNeedsCatalogForce(reply, dialog.propertyTypes);

    if ((hasInventedHtLinks(reply) || badTypeOrLinks || (listingStage && !urlsForRepair.length)) && !urlsForRepair.length) {
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
          contextText: dialog.allUserText
        }
      );
      urlsForRepair = Array.isArray(fallback.urls) ? fallback.urls : [];
    }

    const needsListingLinks =
      urlsForRepair.length > 0 &&
      (listingStage || badTypeOrLinks) &&
      replyNeedsCatalogForce(reply, dialog.propertyTypes);

    if (needsListingLinks) {
      const safe = buildDeterministicListingsReply(
        urlsForRepair,
        userLanguage,
        dialog,
        recentUrls
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
    const lastUserMsg =
      [...(conversationHistory || [])].reverse().find((m) => m.sender === 'user')?.text || '';
    reply = repairPropertyUrlsInText(
      fixPhoneticTransliterations(
        sanitizeListingWhyLabels(
          mirrorUserEmojiInReply(
            maybeAddWarmSmiley(sanitizeDelayedListingPromise(reply), salesLang, dialog.stage),
            lastUserMsg,
            { force: isEmojiOnlyMessage(lastUserMsg) }
          )
        ),
        salesLang
      ),
      userLanguage,
      urlsForRepair,
      { wantedTypes: dialog.propertyTypes || [], avoidUrls: recentUrls }
    );

    // Финальный предохранитель: тип/дубли после починки
    if (
      urlsForRepair.length > 0 &&
      (listingStage || badTypeOrLinks) &&
      replyNeedsCatalogForce(reply, dialog.propertyTypes)
    ) {
      const safe = buildDeterministicListingsReply(
        urlsForRepair,
        userLanguage,
        dialog,
        recentUrls
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
            : 'На счёте DeepSeek нет средств (402). Для бесплатного ИИ зарегистрируйтесь на openrouter.ai, ' +
              'создайте ключ и в Railway укажите AI_API_URL=https://openrouter.ai/api/v1/chat/completions и AI_MODEL=openrouter/free.'
      );
    }
    if (status === 429 || error.code === 'AI_RATE_LIMIT') {
      return salesLangEarly === 'es'
        ? 'Límite de peticiones a la IA (429). Espera un minuto.'
        : salesLangEarly === 'en'
          ? 'AI rate limit (429). Wait a minute or switch provider.'
          : 'Лимит запросов к ИИ (429). Подождите минуту или смените провайдера (OpenRouter free).';
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
              mirrorUserEmojiInReply(
                maybeAddWarmSmiley(
                  sanitizeDelayedListingPromise(retryReply),
                  salesLangRetry,
                  dialog.stage
                ),
                lastUserRetry,
                { force: isEmojiOnlyMessage(lastUserRetry) }
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
  const model = process.env.AI_MODEL || AI_MODEL;
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
      'Модель вернула пустой ответ. Попробуйте AI_MODEL=openrouter/free или перезапустите npm start.',
    model,
    latencyMs: Date.now() - started
  };
}

module.exports = { askAI, checkAIHealth };
