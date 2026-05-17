const axios = require('axios');
const { searchForContext } = require('./property-catalog');
const { webSearchSnippets, shouldAugmentWithWeb } = require('./web-search');
const { getBotConfig, formatDialogPathForPrompt } = require('./bot-config');
const { getKnowledgeBaseForPrompt } = require('./knowledge-base');
const {
  analyzeConversation,
  buildCatalogSearchQuery,
  extractBudgetRange
} = require('./dialog-context');

const AI_API_URL =
  process.env.AI_API_URL || 'https://api.intelligence.io.solutions/api/v1/chat/completions';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-ai/DeepSeek-V3.2';
const AI_API_KEY = process.env.AI_API_KEY;

/**
 * @param {Array<{sender:string,text:string}>} conversationHistory
 * @param {string} userLanguage
 */
async function askAI(conversationHistory, userLanguage = 'ru') {
  if (!AI_API_KEY || !String(AI_API_KEY).trim()) {
    return 'Сервис ИИ не настроен: задайте переменную AI_API_KEY в файле .env и перезапустите бота.';
  }

  const limitedHistory = conversationHistory.slice(-16);
  const lastUserMessage = limitedHistory.filter((msg) => msg.sender === 'user').pop();
  const userQuery = lastUserMessage ? lastUserMessage.text : '';

  const dialog = analyzeConversation(limitedHistory);
  const catalogQuery = buildCatalogSearchQuery(limitedHistory) || userQuery;
  const budget = extractBudgetRange(dialog.allUserText);

  const catalogLimit = dialog.stage === 'SHOW_LISTINGS' || dialog.stage === 'REFINE' ? 10 : 6;
  const catalog = searchForContext(catalogQuery, catalogLimit, {
    minPrice: budget.minPrice,
    maxPrice: budget.maxPrice
  });

  let catalogBlock = '';
  if (catalog.text) {
    catalogBlock = `\n\n**ОБЪЕКТЫ ИЗ КАТАЛОГА (только эти ссылки, не выдумывай):**\n${catalog.text}\n`;
    if (catalog.syncedAt) {
      catalogBlock += `\n(Каталог обновлён: ${catalog.syncedAt}, записей: ${catalog.totalInDb})\n`;
    }
    if (dialog.stage !== 'SHOW_LISTINGS' && dialog.stage !== 'REFINE') {
      catalogBlock +=
        '\n(На этом шаге объекты в ответ клиенту обычно не показывай — используй каталог для ориентира, если клиент уже назвал критерии.)\n';
    }
  }

  let webBlock = '';
  if (shouldAugmentWithWeb(userQuery)) {
    const extra = await webSearchSnippets(`${userQuery} покупка недвижимости Испания Канары`);
    if (extra) {
      webBlock = `\n\n**КРАТКАЯ ВЫДЕРЖКА ИЗ ВЕБ-ПОИСКА (может быть неполной; перепроверяй официальные источники):**\n${extra}\n`;
    }
  }

  const consultantKnowledge = getKnowledgeBaseForPrompt();
  const ck = JSON.stringify(consultantKnowledge, null, 2);
  const botConfig = getBotConfig();
  const dialogPathBlock = formatDialogPathForPrompt(botConfig.dialogPath);
  const siteUrl = consultantKnowledge.brand?.site_ru || 'https://housetenerife.eu/ru/';

  const systemPrompt = `${botConfig.mainPrompt}

*Сайт каталога:* ${siteUrl}

${botConfig.additionalConditions}
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

Ответ на языке пользователя: ${userLanguage}.

**ДИСКЛЕЙМЕР (соблюдай):**
${consultantKnowledge.disclaimer || 'Не заменяй юриста и налогового консультанта.'}

**БАЗА ЗНАНИЙ (ОБЯЗАТЕЛЬНО — факты о компании, услугах, налогах, визах, контактах):**
${ck}

**КАТАЛОГ ОБЪЕКТОВ:**
На этапах SHOW_LISTINGS / REFINE — покажи 2–3 лучших из блока ниже (название, цена, ссылка, почему подходит).
На этапах FIRST_CONTACT / NEED_* — объекты не вываливай, задай следующий вопрос.
${catalogBlock}
${webBlock}

**ИСТОЧНИКИ:** По налогам, визам, закону — официальные сайты и рекомендация местного юриста.

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

  try {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`
    };
    const payload = {
      model: AI_MODEL,
      messages,
      temperature: 0.78
    };

    let response;
    try {
      response = await axios.post(AI_API_URL, payload, { headers, timeout: 90000 });
    } catch (err) {
      if (err.code === 'ECONNABORTED' || String(err.message || '').includes('timeout')) {
        await new Promise((r) => setTimeout(r, 2000));
        response = await axios.post(AI_API_URL, payload, { headers, timeout: 90000 });
      } else {
        throw err;
      }
    }

    if (response.status < 200 || response.status >= 300) {
      return 'Временная ошибка сервиса ИИ. Попробуйте позже.';
    }

    const data = response.data;
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

    if (!messageContent.trim()) {
      return 'Не удалось сформулировать ответ. Переформулируйте вопрос, пожалуйста.';
    }
    return messageContent;
  } catch (error) {
    console.error('ai-service:', error.message);
    if (error.response?.status === 401) {
      return 'Ошибка: неверный AI_API_KEY.';
    }
    if (error.response?.status === 429) {
      return 'Слишком много запросов к ИИ. Подождите немного.';
    }
    return 'Ошибка при обращении к ИИ. Попробуйте позже.';
  }
}

module.exports = { askAI };
