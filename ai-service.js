const { chatCompletions, AI_MODEL, AI_API_KEY } = require('./ai-client');
const { searchForContext, getCatalogSiteUrl } = require('./property-catalog');
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
  pickLocalizedPrompts
} = require('./sales-localization');
const {
  analyzeConversation,
  buildCatalogSearchQuery,
  extractBudgetRange,
  derivePriceTarget
} = require('./dialog-context');

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

async function buildPromptParts(conversationHistory, userLanguage, tier = 'full') {
  const salesLang = normalizeSalesLang(userLanguage);
  const limitedHistory =
    tier === 'minimal' ? conversationHistory.slice(-8) : conversationHistory.slice(-16);
  const lastUserMessage = limitedHistory.filter((msg) => msg.sender === 'user').pop();
  const userQuery = lastUserMessage ? lastUserMessage.text : '';

  const dialog = analyzeConversation(limitedHistory, salesLang);
  const catalogQuery = buildCatalogSearchQuery(limitedHistory) || userQuery;
  const budget = extractBudgetRange(dialog.allUserText);
  const priceTarget = derivePriceTarget(budget);
  const showingListings =
    dialog.stage === 'SHOW_LISTINGS' || dialog.stage === 'REFINE' || dialog.wantsListings;
  const maySearchCatalog =
    dialog.hasType && dialog.hasPurpose && (showingListings || tier !== 'full');

  const catalogLimit =
    tier === 'minimal'
      ? 5
      : tier === 'compact'
        ? 10
        : showingListings
          ? 18
          : 8;

  let catalog = { found: false, text: '', totalInDb: 0 };
  if (maySearchCatalog) {
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

  const hints = getCatalogHints(salesLang);
  let catalogBlock = '';
  if (!dialog.hasPurpose && tier === 'full') {
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
          : 'покупка недвижимости Испания Канары';
    const extra = await webSearchSnippets(`${userQuery} ${webSuffix}`);
    if (extra) {
      webBlock = `\n\n**КРАТКАЯ ВЫДЕРЖКА ИЗ ВЕБ-ПОИСКА:**\n${extra}\n`;
    }
  }

  const consultantKnowledgeRaw = getKnowledgeBaseForPrompt();
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
      ? `**СОБРАННЫЕ КРИТЕРИИ (не спрашивай повторно, если уже есть):**
- Цель (жизнь/инвестиция): ${dialog.hasPurpose ? 'да' : 'ещё нет'}
- Бюджет в переписке: ${dialog.hasBudget ? 'да' : 'ещё нет'}${budget.maxPrice ? ` (ориентир до ~€${budget.maxPrice.toLocaleString('en-US')})` : ''}${budget.minPrice && !budget.maxPrice ? ` (от ~€${budget.minPrice.toLocaleString('en-US')})` : ''}
- Регион: ${dialog.hasRegion ? `да (${dialog.regionLabel})` : `ещё нет — ${dialog.regionOptions}`}
- Район / зона: ${dialog.hasLocation ? `да (${dialog.microAreaLabel || 'уточнено'})` : dialog.needsMicroArea ? `ещё нет (примеры: ${dialog.areaOptionsPrompt || 'уточнить у клиента'})` : 'не требуется'}
- Тип объекта: ${dialog.hasType ? `да (${dialog.propertyTypeLabel})` : 'ещё нет — обязательно уточни до подборки'}`
      : blocks.criteria;

  const conversationRules =
    salesLang === 'ru'
      ? `**ПРАВИЛА РАЗГОВОРА (обязательно):**
- Веди как опытный продавец-аналитик: сначала пойми человека, потом дай ценность (подборка), потом углубляй, потом мягко созвон.
- Отзеркаль последнюю реплику клиента («понял, вам важен доход от аренды…»).
- Один понятный вопрос в конце (не три сразу).
- Не предлагай объекты, пока не ясны цель и тип.
- Запрещено: «благодарим за обращение», «запрос передан», «уважаемый клиент», «чем могу помочь» без продолжения.
- 2–5 коротких строк + список объектов, когда пора.`
      : `**CONVERSATION RULES (mandatory):**
${blocks.conversation}`;

  const salesPlaybookBlock =
    tier === 'full' ? getSalesPlaybookBlock(salesLang) : '';

  const catalogRules =
    salesLang === 'ru'
      ? `**КАТАЛОГ ОБЪЕКТОВ:**
Поиск идёт по всей базе (${catalog.totalInDb || 'все'} объектов на сайте); в блоке ниже — лучшие совпадения по критериям переписки. Не утверждай, что «других нет» — предложи уточнить бюджет/район или каталог на сайте.
На этапах SHOW_LISTINGS / REFINE — покажи 3–5 РАЗНЫХ объектов из блока ниже (название, цена, ссылка, одна фраза почему подходит). Только тот регион${dialog.microAreaLabel ? ` и район (${dialog.microAreaLabel})` : ''}, что выбрал клиент — не подмешивай Adeje, если просили Los Cristianos, и наоборот.
**Цена:** не предлагай варианты сильно дешевле бюджета клиента — только около названной суммы или чуть дороже (премиум/больше метраж), если клиент не просил именно дешевле.
На этапах FIRST_CONTACT / NEED_* — объекты не вываливай. Регионы каталога: ${dialog.regionOptions} (housetenerife.eu).
Подборка только когда ясны *цель*, тип, бюджет, регион и конкретная зона/район; ссылки только из блока ниже.
После подборки — один вопрос: какой вариант ближе или что скорректировать (бюджет/район).
**Ипотека/кредит:** если спрашивают шаги, процесс, «как получить ипотеку» — ответь по mortgage_process (5–7 нумерованных шагов), без выдуманных ставок и гарантий одобрения.
**Конкретный объект:** если клиент выбрал вариант — уточни деньги *сейчас на руках*, нужна ли ипотека; при ипотеке — шаги (mortgage_process) + документы и справка о доходах. Потом — предложи созвон с менеджером (да/нет).
**Связь с менеджером:** если клиент хочет человека / звонок / просмотр — тепло предложи короткий созвон, чтобы обсудить текущий шаг диалога. Не проси писать слово «менеджер» и не давай телефон вместо заявки.`
      : `**PROPERTY CATALOG (${catalog.totalInDb || 'full'} listings on site; block below = best matches):**
${blocks.catalog}
**Pricing:** stay around budget or slightly above — not much cheaper unless they asked.
${blocks.mortgage}
${blocks.propertyFinance}
${blocks.managerHandoff}`;

  const langRule =
    salesLang === 'ru'
      ? `Ответ на языке пользователя: ${userLanguage}.`
      : blocks.replyLanguage;

  const disclaimerLabel = salesLang === 'es' ? '**AVISO LEGAL:**' : salesLang === 'en' ? '**DISCLAIMER:**' : '**ДИСКЛЕЙМЕР:**';
  const knowledgeLabel =
    salesLang === 'es' ? '**BASE DE CONOCIMIENTO:**' : salesLang === 'en' ? '**KNOWLEDGE BASE:**' : '**БАЗА ЗНАНИЙ:**';
  const siteLabel =
    salesLang === 'es' ? '*Catálogo:*' : salesLang === 'en' ? '*Catalog site:*' : '*Сайт каталога:*';

  const fileDocBlock =
    tier === 'full' ? getFileDocKnowledgeForPrompt(userQuery || dialog.allUserText) : '';

  const systemPrompt = `${mainPrompt}

${siteLabel} ${siteUrl}

${extraConditions}
${dialogPathBlock}

${stageHeader}
${dialog.stageInstruction}

${criteriaBlock}

${dialog.financeSummaryBlock || ''}

${conversationRules}

${salesPlaybookBlock}

${getWritingQualityBlock(salesLang)}

${langRule}

${disclaimerLabel}
${consultantKnowledge.disclaimer || 'Not a lawyer or tax adviser.'}

${knowledgeLabel}
${ck}

${catalogRules}
${catalogBlock}
${fileDocBlock ? `\n${fileDocBlock}\n` : ''}${webBlock}

**WHATSAPP:** *bold*, bullets • or 1. No emojis.`;


  const messages = [
    { role: 'system', content: systemPrompt },
    ...limitedHistory.map((msg) => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.text
    }))
  ];

  return { messages };
}

function apiErrorDetailFromResponse(error) {
  const data = error.response?.data;
  if (!data) return '';
  return data.error?.message || data.message || data.detail || '';
}

function stripEmojis(text) {
  return text.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/gu,
    ''
  );
}

function polishReply(text) {
  if (!text || typeof text !== 'string') return text;
  let s = stripEmojis(text.replace(/\u00A0/g, ' ').replace(/\r\n/g, '\n'));
  // Склеенные слова: строчная + заглавная (латиница и кириллица)
  s = s.replace(/([a-zа-яё])([A-ZА-ЯЁ])/g, '$1 $2');
  // Пробел после знаков препинания, если модель его проглотила
  s = s.replace(/([.!?,:;])([^\s\n\d*])/g, '$1 $2');
  s = s.replace(/ {2,}/g, ' ');
  s = s.replace(/ +\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function getWritingQualityBlock(salesLang) {
  if (salesLang === 'en') {
    return `**TEXT QUALITY (critical for sales):**
- Flawless spelling, grammar, and punctuation — no typos, no glued words, no broken phrases.
- Every word must have a space; complete sentences only.
- No emojis or smileys — text only.
- Sound like a real advisor texting on WhatsApp — warm, natural, never robotic or like machine translation.`;
  }
  if (salesLang === 'es') {
    return `**CALIDAD DEL TEXTO (crítico para ventas):**
- Ortografía, gramática y puntuación impecables — sin faltas, sin palabras pegadas ni frases rotas.
- Cada palabra con su espacio; frases completas.
- Sin emojis ni emoticonos — solo texto.
- Tono humano en WhatsApp — cercano y natural, nunca robótico ni traducción automática.`;
  }
  return `**КАЧЕСТВО ТЕКСТА (критично для продаж):**
- Без орфографических ошибок, без «склеенных» слов, без обрывков и канцелярита.
- Каждое слово отдельно, предложения законченные — перечитай ответ перед отправкой.
- Без смайликов и эмодзи — только текст.
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

/**
 * Один запрос к ИИ (без каскада 6× повторов). При 429 — сразу запасной ключ, если задан.
 * @param {Array<{sender:string,text:string}>} conversationHistory
 * @param {string} userLanguage
 */
async function askAI(conversationHistory, userLanguage = 'ru') {
  if (!AI_API_KEY || !String(AI_API_KEY).trim()) {
    return 'Сервис ИИ не настроен: задайте AI_API_KEY в Railway Variables и перезапустите бота.';
  }

  try {
    const { messages } = await buildPromptParts(conversationHistory, userLanguage, 'full');
    return await callAI(messages, 'chat');
  } catch (error) {
    const status = error.response?.status;
    console.error('ai-service:', status || error.code || error.message);

    if (error.code === 'AI_KEY_MISSING') {
      return 'Сервис ИИ не настроен: задайте AI_API_KEY в Railway Variables и перезапустите бота.';
    }
    if (status === 401) {
      return 'Ошибка авторизации ИИ: проверьте AI_API_KEY в Railway Variables.';
    }
    if (status === 402) {
      return (
        'На счёте DeepSeek нет средств (402). Для бесплатного ИИ зарегистрируйтесь на openrouter.ai, ' +
        'создайте ключ и в Railway укажите AI_API_URL=https://openrouter.ai/api/v1/chat/completions и AI_MODEL=openrouter/free.'
      );
    }
    if (status === 429 || error.code === 'AI_RATE_LIMIT') {
      return 'Лимит запросов к ИИ (429). Подождите минуту или смените провайдера (OpenRouter free).';
    }

    // Только при таймауте/сети — один компактный повтор
    const msg = String(error.message || '');
    if (
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT' ||
      msg.includes('timeout')
    ) {
      try {
        const { messages } = await buildPromptParts(conversationHistory, userLanguage, 'compact');
        return await callAI(messages, 'chat-retry');
      } catch (retryErr) {
        console.error('ai-service retry:', retryErr.message);
      }
    }

    return 'Не удалось получить ответ от ИИ. Попробуйте ещё раз через минуту.';
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
