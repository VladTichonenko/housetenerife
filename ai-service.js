const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { searchForContext } = require('./property-catalog');
const { webSearchSnippets, shouldAugmentWithWeb } = require('./web-search');

const AI_API_URL =
  process.env.AI_API_URL || 'https://api.intelligence.io.solutions/api/v1/chat/completions';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-ai/DeepSeek-V3.2';
const AI_API_KEY = process.env.AI_API_KEY;

let consultantKnowledge = {};
try {
  const p = path.join(__dirname, 'consultant-knowledge.json');
  consultantKnowledge = JSON.parse(fs.readFileSync(p, 'utf8'));
} catch (e) {
  console.warn('⚠️ consultant-knowledge.json:', e.message);
}

/**
 * @param {Array<{sender:string,text:string}>} conversationHistory
 * @param {string} userLanguage
 */
async function askAI(conversationHistory, userLanguage = 'ru') {
  if (!AI_API_KEY || !String(AI_API_KEY).trim()) {
    return 'Сервис ИИ не настроен: задайте переменную AI_API_KEY в файле .env и перезапустите бота.';
  }

  const limitedHistory = conversationHistory.slice(-12);
  const lastUserMessage = limitedHistory.filter((msg) => msg.sender === 'user').pop();
  const userQuery = lastUserMessage ? lastUserMessage.text : '';

  const catalog = searchForContext(userQuery, 8);
  let catalogBlock = '';
  if (catalog.text) {
    catalogBlock = `\n\n**ОБЪЕКТЫ ИЗ ЛОКАЛЬНОГО КАТАЛОГА (сайт House Tenerife, синхронизация):**\n${catalog.text}\n`;
    if (catalog.syncedAt) {
      catalogBlock += `\n(Каталог обновлён: ${catalog.syncedAt}, записей: ${catalog.totalInDb})\n`;
    }
  }

  let webBlock = '';
  if (shouldAugmentWithWeb(userQuery)) {
    const extra = await webSearchSnippets(`${userQuery} покупка недвижимости Испания Канары`);
    if (extra) {
      webBlock = `\n\n**КРАТКАЯ ВЫДЕРЖКА ИЗ ВЕБ-ПОИСКА (может быть неполной; перепроверяй официальные источники):**\n${extra}\n`;
    }
  }

  const ck = JSON.stringify(consultantKnowledge, null, 2);

  const systemPrompt = `Ты — senior real estate concierge агентства *House Tenerife*: недвижимость на Тенерифе и в Испании (Канары).

*Сайт каталога:* ${consultantKnowledge.brand?.site_ru || 'https://housetenerife.eu/ru/'}

**Главная цель (порядок):** (1) понять запрос -> (2) показать релевантные объекты с сайта -> (3) уточнить предпочтения -> (4) набрать доверие -> (5) только потом мягко предложить менеджера или специалиста. Не дави на звонок в начале диалога.

**Стиль:** коротко (примерно 1-3 строки, если клиент не просит развернуто); один главный вопрос за сообщение; по-человечески; умеренные эмодзи допустимы как в playbook. Когда уместно - дай 2-5 вариантов со ссылками, затем уточняй по отклику. Ответ на языке пользователя: ${userLanguage}.

Данные ниже содержат concierge_playbook (старт, инвестор, частная, бизнес, коммерция, отели): сначала ценность - объекты, затем уточнение и точнее подборка, в конце мягкий переход к менеджеру.

**ДИСКЛЕЙМЕР (соблюдай):**
${consultantKnowledge.disclaimer || 'Не заменяй юриста и налогового консультанта.'}

**База знаний (плюсы/минусы, визы, Канары, playbook — не выдумывай ставки налогов без оговорки):**
${ck}

**КАТАЛОГ ОБЪЕКТОВ:**
Если в блоке ниже есть подходящие объекты — в первую очередь покажи их (название, цена, ссылка из каталога; URL не выдумывай). Если каталог пуст или нет совпадений — честно скажи и предложи уточнить или зайти на сайт.
${catalogBlock}
${webBlock}

**ИСТОЧНИКИ:** По налогам, визам, закону — официальные сайты и рекомендация местного юриста.

**WHATSAPP-ФОРМАТИРОВАНИЕ:**
- Жирный: *фраза* (одна пара звёздочек для WhatsApp)
- Не используй ** двойные, ## как в markdown-доках
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
      temperature: 0.65
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
    while (messageContent.includes('</redacted_thinking>')) {
      messageContent = messageContent.split('</redacted_thinking>').pop().trim();
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
