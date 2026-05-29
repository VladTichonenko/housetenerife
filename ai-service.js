const { chatCompletions, AI_MODEL } = require('./ai-client');
const { searchForContext, getCatalogSiteUrl } = require('./property-catalog');
const { webSearchSnippets, shouldAugmentWithWeb } = require('./web-search');
const { getBotConfig, formatDialogPathForPrompt } = require('./bot-config');
const { getKnowledgeBaseForPrompt } = require('./knowledge-base');
const {
  analyzeConversation,
  buildCatalogSearchQuery,
  extractBudgetRange,
  derivePriceTarget
} = require('./dialog-context');

function truncateKnowledge(knowledge, maxChars) {
  const raw = JSON.stringify(knowledge, null, 2);
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n…(сокращено)`;
}

async function buildPromptParts(conversationHistory, userLanguage, tier = 'full') {
  const limitedHistory =
    tier === 'minimal' ? conversationHistory.slice(-8) : conversationHistory.slice(-16);
  const lastUserMessage = limitedHistory.filter((msg) => msg.sender === 'user').pop();
  const userQuery = lastUserMessage ? lastUserMessage.text : '';

  const dialog = analyzeConversation(limitedHistory);
  const catalogQuery = buildCatalogSearchQuery(limitedHistory) || userQuery;
  const budget = extractBudgetRange(dialog.allUserText);
  const priceTarget = derivePriceTarget(budget);
  const showingListings =
    dialog.stage === 'SHOW_LISTINGS' || dialog.stage === 'REFINE' || dialog.wantsListings;
  const maySearchCatalog = dialog.hasType && (showingListings || tier !== 'full');

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

  let catalogBlock = '';
  if (!dialog.hasType && tier === 'full') {
    catalogBlock =
      '\n\n(Тип объекта ещё не выбран — сначала уточни: апартаменты, вилла, дом, земля, коммерция, бизнес или инвест-проект. Ссылки не показывай.)\n';
  } else if (!dialog.hasRegion && !dialog.hasLocation && tier === 'full') {
    catalogBlock = `\n\n(Регион не выбран — уточни: ${dialog.regionOptions || 'Тенерифе, Дубай, Ибица, Марбелья'}. Не предполагай только Тенерифе. Ссылки не показывай.)\n`;
  } else if (catalog.text) {
    catalogBlock = `\n\n**ОБЪЕКТЫ ИЗ КАТАЛОГА (только эти ссылки, тип: ${dialog.propertyTypeLabel || 'по запросу'}):**\n${catalog.text}\n`;
    if (tier === 'full' && !showingListings) {
      catalogBlock +=
        '\n(На этом шаге объекты в ответ клиенту обычно не показывай — дождись этапа подборки.)\n';
    }
  }

  let webBlock = '';
  if (tier === 'full' && shouldAugmentWithWeb(userQuery)) {
    const extra = await webSearchSnippets(`${userQuery} покупка недвижимости Испания Канары`);
    if (extra) {
      webBlock = `\n\n**КРАТКАЯ ВЫДЕРЖКА ИЗ ВЕБ-ПОИСКА:**\n${extra}\n`;
    }
  }

  const consultantKnowledge = getKnowledgeBaseForPrompt();
  const ck =
    tier === 'minimal'
      ? truncateKnowledge(
          {
            disclaimer: consultantKnowledge.disclaimer,
            contacts: consultantKnowledge.contacts,
            company: consultantKnowledge.company
          },
          2500
        )
      : tier === 'compact'
        ? truncateKnowledge(consultantKnowledge, 8000)
        : truncateKnowledge(consultantKnowledge, 12000);

  const botConfig = getBotConfig();
  const dialogPathBlock =
    tier === 'minimal' ? '' : formatDialogPathForPrompt(botConfig.dialogPath);
  const siteUrl = getCatalogSiteUrl(userLanguage);

  const mainPrompt =
    tier === 'minimal'
      ? `Ты консультант House Tenerife (housetenerife.eu): Тенерифе, Дубай, Ибица, Марбелья. Отвечай кратко (2–4 строки), на языке ${userLanguage}. WhatsApp: *жирный*, списки • или 1.`
      : botConfig.mainPrompt;

  const extraConditions = tier === 'minimal' ? '' : botConfig.additionalConditions;

  const systemPrompt = `${mainPrompt}

*Сайт каталога:* ${siteUrl}

${extraConditions}
${dialogPathBlock}

**ТЕКУЩИЙ ЭТАП ДИАЛОГА (${dialog.stage}, сообщений клиента: ${dialog.userTurns}):**
${dialog.stageInstruction}

**СОБРАННЫЕ КРИТЕРИИ (не спрашивай повторно, если уже есть):**
- Цель (жизнь/инвестиция): ${dialog.hasPurpose ? 'да' : 'ещё нет'}
- Бюджет в переписке: ${dialog.hasBudget ? 'да' : 'ещё нет'}${budget.maxPrice ? ` (ориентир до ~€${budget.maxPrice.toLocaleString('en-US')})` : ''}${budget.minPrice && !budget.maxPrice ? ` (от ~€${budget.minPrice.toLocaleString('en-US')})` : ''}
- Регион: ${dialog.hasRegion ? `да (${dialog.regionLabel})` : dialog.hasLocation ? 'Тенерифе (район уточняется)' : 'ещё нет — Тенерифе / Дубай / Ибица / Марбелья'}
- Район (для Тенерифе): ${dialog.hasLocation ? 'да' : 'ещё нет'}
- Тип объекта: ${dialog.hasType ? `да (${dialog.propertyTypeLabel})` : 'ещё нет — обязательно уточни до подборки'}

**ПРАВИЛА РАЗГОВОРА (обязательно):**
- Веди диалог вопрос → ответ: сначала пойми человека, потом подборка.
- Один понятный вопрос в конце сообщения (не три сразу).
- Отвечай на последнюю реплику клиента, не игнорируй её.
- Не используй канцелярит («благодарим за обращение», «наша компания рада»).
- 2–4 короткие строки + при необходимости список объектов.

Ответ на языке пользователя: ${userLanguage}.

**ДИСКЛЕЙМЕР:**
${consultantKnowledge.disclaimer || 'Не заменяй юриста и налогового консультанта.'}

**БАЗА ЗНАНИЙ:**
${ck}

**КАТАЛОГ ОБЪЕКТОВ:**
Поиск идёт по всей базе (${catalog.totalInDb || 'все'} объектов на сайте); в блоке ниже — лучшие совпадения по критериям переписки. Не утверждай, что «других нет» — предложи уточнить бюджет/район или каталог на сайте.
На этапах SHOW_LISTINGS / REFINE — покажи 3–5 РАЗНЫХ объектов из блока ниже (название, цена, ссылка, одна фраза почему подходит). Не дублируй один и тот же район без причины.
**Цена:** не предлагай варианты сильно дешевле бюджета клиента — только около названной суммы или чуть дороже (премиум/больше метраж), если клиент не просил именно дешевле.
На этапах FIRST_CONTACT / NEED_* — объекты не вываливай. Агентство работает не только на Тенерифе: Дубай, Ибица, Марбелья — тоже в каталоге.
Подборка только когда ясны тип и регион; ссылки только из блока ниже, без подмешивания других регионов.
Если клиент просит живого менеджера / звонок / запись — НЕ давай телефон вместо заявки: попроси написать слово «менеджер» (бот спросит имя и передаст заявку).
${catalogBlock}
${webBlock}

**WHATSAPP:** *жирный*, списки • или 1.`;

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

function formatModelReply(data) {
  let messageContent = data.choices?.[0]?.message?.content || '';
  while (messageContent.includes('</think>')) {
    messageContent = messageContent.split('</think>').pop().trim();
  }
  messageContent = messageContent.replace(/<\/?redacted_reasoning>/g, '').trim();
  messageContent = messageContent.replace(/#+/g, '').trim();
  messageContent = messageContent.replace(/\*\*\*([^*]+)\*\*\*/g, '*$1*');
  messageContent = messageContent.replace(/\*\*([^*]+)\*\*/g, '*$1*');
  messageContent = messageContent.replace(/^\s*\*\s+/gm, '• ');
  messageContent = messageContent.replace(/^#{1,6}\s+/gm, '');
  messageContent = messageContent.replace(/^[-=]{3,}$/gm, '');
  return messageContent.trim();
}

async function callAI(messages, tierLabel) {
  const response = await chatCompletions(
    {
      model: process.env.AI_MODEL || AI_MODEL,
      messages,
      temperature: 0.78
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
  const { AI_API_KEY } = require('./ai-client');
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

module.exports = { askAI };
