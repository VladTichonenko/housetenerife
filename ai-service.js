const { chatCompletions, AI_MODEL } = require('./ai-client');
const { searchForContext, getCatalogSiteUrl } = require('./property-catalog');
const { webSearchSnippets, shouldAugmentWithWeb } = require('./web-search');
const { getBotConfig, formatDialogPathForPrompt } = require('./bot-config');
const { getKnowledgeBaseForPrompt } = require('./knowledge-base');
const {
  analyzeConversation,
  buildCatalogSearchQuery,
  extractBudgetRange
} = require('./dialog-context');

const STAGE_FALLBACK = {
  ru: {
    FIRST_CONTACT:
      'Здравствуйте! Я консультант *House Tenerife* — помогаю с недвижимостью на Тенерифе. Подскажите, покупка для жизни или как инвестиция?',
    NEED_PURPOSE:
      'Чтобы подобрать район и тип жилья: вам важнее дом для себя и семьи или доход от аренды/инвестиция?',
    NEED_BUDGET:
      'Какой у вас ориентир по бюджету (€)? Можно диапазон — например до €400k или €400–700k.',
    NEED_LOCATION:
      'Какой район Тенерифе вам ближе — Costa Adeje, Los Cristianos, юг у океана или что-то потише на западе?',
    SHOW_LISTINGS_INTRO: 'Под ваш запрос подобрала несколько вариантов из каталога:\n\n',
    SHOW_LISTINGS_OUTRO: '\n\nКакой вариант ближе? Могу сузить по бюджету, спальням или району.',
    REFINE:
      'Поняла ваш запрос. Уточните, пожалуйста, что важнее изменить — бюджет, район или тип жилья (вилла / апартаменты)?'
  },
  en: {
    FIRST_CONTACT:
      'Hello! I\'m a *House Tenerife* consultant for property in Tenerife. Are you looking to buy for living or as an investment?',
    NEED_PURPOSE:
      'To narrow the area and property type: is this mainly for your own use or rental/investment income?',
    NEED_BUDGET:
      'What budget range (€) are you working with? A rough bracket is fine — e.g. up to €400k or €400–700k.',
    NEED_LOCATION:
      'Which area do you prefer — Costa Adeje, Los Cristianos, south coast, or something quieter on the west?',
    SHOW_LISTINGS_INTRO: 'Here are a few options from our catalogue that may fit:\n\n',
    SHOW_LISTINGS_OUTRO: '\n\nWhich one is closest? I can refine by budget, bedrooms, or area.',
    REFINE:
      'Got it. What should we adjust — budget, area, or property type (villa / apartment)?'
  },
  es: {
    FIRST_CONTACT:
      '¡Hola! Soy consultor de *House Tenerife* — inmobiliaria en Tenerife. ¿Compra para vivir o como inversión?',
    NEED_PURPOSE:
      'Para acotar zona y tipo: ¿es principalmente para vivir o para alquiler/inversión?',
    NEED_BUDGET:
      '¿Qué presupuesto orientativo (€) maneja? Puede ser un rango — p. ej. hasta 400.000 € o 400–700 mil.',
    NEED_LOCATION:
      '¿Qué zona prefiere — Costa Adeje, Los Cristianos, sur costero u oeste más tranquilo?',
    SHOW_LISTINGS_INTRO: 'Estas opciones del catálogo pueden encajar con su búsqueda:\n\n',
    SHOW_LISTINGS_OUTRO: '\n\n¿Cuál se acerca más? Puedo afinar por presupuesto, dormitorios o zona.',
    REFINE:
      'Entendido. ¿Qué ajustamos — presupuesto, zona o tipo (villa / apartamento)?'
  }
};

function normalizeLang(lang) {
  const l = String(lang || 'ru').toLowerCase().slice(0, 2);
  return STAGE_FALLBACK[l] ? l : 'ru';
}

function truncateKnowledge(knowledge, maxChars) {
  const raw = JSON.stringify(knowledge, null, 2);
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n…(сокращено для запроса)`;
}

async function buildPromptParts(conversationHistory, userLanguage, tier = 'full') {
  const limitedHistory =
    tier === 'minimal' ? conversationHistory.slice(-8) : conversationHistory.slice(-16);
  const lastUserMessage = limitedHistory.filter((msg) => msg.sender === 'user').pop();
  const userQuery = lastUserMessage ? lastUserMessage.text : '';

  const dialog = analyzeConversation(limitedHistory);
  const catalogQuery = buildCatalogSearchQuery(limitedHistory) || userQuery;
  const budget = extractBudgetRange(dialog.allUserText);

  const catalogLimit =
    tier === 'minimal'
      ? 3
      : tier === 'compact'
        ? 5
        : dialog.stage === 'SHOW_LISTINGS' || dialog.stage === 'REFINE'
          ? 10
          : 6;

  const catalog = searchForContext(catalogQuery, catalogLimit, {
    minPrice: budget.minPrice,
    maxPrice: budget.maxPrice,
    lang: userLanguage
  });

  let catalogBlock = '';
  if (catalog.text) {
    catalogBlock = `\n\n**ОБЪЕКТЫ ИЗ КАТАЛОГА (только эти ссылки, не выдумывай):**\n${catalog.text}\n`;
    if (catalog.syncedAt && tier === 'full') {
      catalogBlock += `\n(Каталог обновлён: ${catalog.syncedAt}, записей: ${catalog.totalInDb})\n`;
    }
    if (
      tier === 'full' &&
      dialog.stage !== 'SHOW_LISTINGS' &&
      dialog.stage !== 'REFINE'
    ) {
      catalogBlock +=
        '\n(На этом шаге объекты в ответ клиенту обычно не показывай — используй каталог для ориентира, если клиент уже назвал критерии.)\n';
    }
  }

  let webBlock = '';
  if (tier === 'full' && shouldAugmentWithWeb(userQuery)) {
    const extra = await webSearchSnippets(`${userQuery} покупка недвижимости Испания Канары`);
    if (extra) {
      webBlock = `\n\n**КРАТКАЯ ВЫДЕРЖКА ИЗ ВЕБ-ПОИСКА (может быть неполной; перепроверяй официальные источники):**\n${extra}\n`;
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
        : JSON.stringify(consultantKnowledge, null, 2);

  const botConfig = getBotConfig();
  const dialogPathBlock =
    tier === 'minimal' ? '' : formatDialogPathForPrompt(botConfig.dialogPath);
  const siteUrl = getCatalogSiteUrl(userLanguage);

  const mainPrompt =
    tier === 'minimal'
      ? `Ты консультант House Tenerife по недвижимости на Тенерифе. Отвечай кратко (2–4 строки), на языке ${userLanguage}. WhatsApp: *жирный*, списки • или 1.`
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
- Локация/район: ${dialog.hasLocation ? 'да' : 'ещё нет'}
- Тип жилья: ${dialog.hasType ? 'да' : 'не уточнён'}

**ПРАВИЛА РАЗГОВОРА (обязательно):**
- Веди диалог вопрос → ответ: сначала пойми человека, потом подборка.
- Один понятный вопрос в конце сообщения (не три сразу).
- Отвечай на последнюю реплику клиента, не игнорируй её.
- Не используй канцелярит («благодарим за обращение», «наша компания рада»).
- 2–4 короткие строки + при необходимости список объектов.
- Если клиент в первом же сообщении дал бюджет и район — можно сразу показать 2–3 объекта.

Ответ на языке пользователя: ${userLanguage}. В блоке «ОБЪЕКТЫ ИЗ КАТАЛОГА» уже на этом языке — не переводи и не подменяй русским.

**ЯЗЫК КАТАЛОГА:** Показывай клиенту только названия, описания и ссылки на языке ${userLanguage}. Русский текст в ответе не используй, если клиент пишет на en/es.

**ДИСКЛЕЙМЕР (соблюдай):**
${consultantKnowledge.disclaimer || 'Не заменяй юриста и налогового консультанта.'}

**БАЗА ЗНАНИЙ:**
${ck}

**КАТАЛОГ ОБЪЕКТОВ:**
На этапах SHOW_LISTINGS / REFINE — покажи 2–3 лучших из блока ниже (название, цена, ссылка, почему подходит).
На этапах FIRST_CONTACT / NEED_* — объекты не вываливай, задай следующий вопрос.
Ссылки в блоке уже под язык клиента — вставляй их как есть.
${catalogBlock}
${webBlock}

**WHATSAPP-ФОРМАТИРОВАНИЕ:**
- Жирный: *фраза* (одна пара звёздочек)
- Не используй ** двойные, ## 
- Списки: 1. или •`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...limitedHistory.map((msg) => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.text
    }))
  ];

  return { messages, dialog, catalog, userQuery };
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

function buildLocalFallback(dialog, catalog, userLanguage) {
  const lang = normalizeLang(userLanguage);
  const t = STAGE_FALLBACK[lang];
  const showListings =
    dialog.stage === 'SHOW_LISTINGS' ||
    dialog.stage === 'REFINE' ||
    (catalog.found && dialog.hasBudget && dialog.hasLocation);

  if (showListings && catalog.text && catalog.found) {
    return `${t.SHOW_LISTINGS_INTRO}${catalog.text}${t.SHOW_LISTINGS_OUTRO}`;
  }

  const stageKey = dialog.stage in t ? dialog.stage : 'REFINE';
  return t[stageKey] || t.REFINE;
}

async function requestCompletion(messages, label, maxAttempts) {
  const response = await chatCompletions(
    {
      model: process.env.AI_MODEL || AI_MODEL,
      messages,
      temperature: label === 'minimal' ? 0.65 : 0.78
    },
    { label, maxAttempts }
  );
  const text = formatModelReply(response.data);
  if (!text) {
    throw new Error('empty model reply');
  }
  return text;
}

/**
 * @param {Array<{sender:string,text:string}>} conversationHistory
 * @param {string} userLanguage
 */
async function askAI(conversationHistory, userLanguage = 'ru') {
  const { AI_API_KEY } = require('./ai-client');
  if (!AI_API_KEY || !String(AI_API_KEY).trim()) {
    return 'Сервис ИИ не настроен: задайте переменную AI_API_KEY в файле .env и перезапустите бота.';
  }

  const tiers = [
    { name: 'full', maxAttempts: 6 },
    { name: 'compact', maxAttempts: 4 },
    { name: 'minimal', maxAttempts: 3 }
  ];

  let lastParts = null;

  for (const tier of tiers) {
    try {
      const parts = await buildPromptParts(conversationHistory, userLanguage, tier.name);
      lastParts = parts;
      const text = await requestCompletion(parts.messages, tier.name, tier.maxAttempts);
      return text;
    } catch (error) {
      console.error(`ai-service [${tier.name}]:`, error.response?.status || error.code || error.message);
      if (error.code === 'AI_KEY_MISSING') {
        return 'Сервис ИИ не настроен: задайте переменную AI_API_KEY в файле .env и перезапустите бота.';
      }
      if (error.response?.status === 401) {
        console.error('ai-service: неверный AI_API_KEY');
      }
    }
  }

  if (lastParts) {
    console.warn('ai-service: все попытки к API исчерпаны — локальный ответ по каталогу');
    return buildLocalFallback(lastParts.dialog, lastParts.catalog, userLanguage);
  }

  const dialog = analyzeConversation(conversationHistory.slice(-16));
  const catalog = searchForContext(
    buildCatalogSearchQuery(conversationHistory) || '',
    3,
    { lang: userLanguage }
  );
  return buildLocalFallback(dialog, catalog, userLanguage);
}

module.exports = { askAI };
