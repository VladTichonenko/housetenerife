'use strict';

const { analyzeConversation, extractBudgetRange } = require('./dialog-context');
const { REASON_LABELS } = require('./manager-handoff');
const { chatCompletions, AI_MODEL, AI_API_KEY } = require('./ai-client');

function buildFallbackSummary(conversationHistory, reasonKey, preview, clientName) {
  const dialog = analyzeConversation(conversationHistory || []);
  const budget = extractBudgetRange(dialog.allUserText);
  const parts = [];

  if (clientName) parts.push(`Имя клиента: ${clientName}.`);
  parts.push(`Причина передачи менеджеру: ${REASON_LABELS[reasonKey] || reasonKey}.`);

  if (budget.maxPrice || budget.minPrice) {
    if (budget.minPrice && budget.maxPrice) {
      parts.push(
        `Бюджет: €${budget.minPrice.toLocaleString('en-US')} – €${budget.maxPrice.toLocaleString('en-US')}.`
      );
    } else if (budget.maxPrice) {
      parts.push(`Бюджет: до ~€${budget.maxPrice.toLocaleString('en-US')}.`);
    } else {
      parts.push(`Бюджет: от ~€${budget.minPrice.toLocaleString('en-US')}.`);
    }
  } else if (dialog.hasBudget) {
    parts.push('Бюджет упоминался в переписке (точная сумма не выделена).');
  }

  if (dialog.hasPurpose) parts.push('Цель: жизнь или инвестиция (упоминалось в диалоге).');
  if (dialog.hasRegion) {
    parts.push(`Регион: ${dialog.regionLabel || dialog.macroRegions?.join(', ')}.`);
  }
  if (dialog.hasLocation) parts.push('Район на Тенерифе: есть пожелания.');
  if (dialog.hasType) {
    parts.push(`Тип объекта: ${dialog.propertyTypeLabel || 'уточнялся в диалоге'}.`);
  }
  if (dialog.hasPropertyInterest) {
    parts.push('Интерес к конкретному объекту из переписки.');
    if (dialog.hasFundsNow) {
      parts.push(`Деньги на руках сейчас: ${dialog.fundsNowLabel || 'упоминались'}.`);
    }
    if (dialog.hasMortgageAnswered) {
      parts.push(
        dialog.needsMortgage ? 'Нужна ипотека/кредит.' : 'Покупка без ипотеки (свои средства).'
      );
    }
    if (dialog.documentsDiscussed) parts.push('Обсуждались документы/справка о доходах.');
  }

  const lastUser = dialog.lastUser?.trim();
  if (lastUser) {
    parts.push(`Последняя реплика клиента: «${lastUser.length > 200 ? `${lastUser.slice(0, 200)}…` : lastUser}».`);
  } else if (preview) {
    parts.push(`Триггер: «${preview.length > 200 ? `${preview.slice(0, 200)}…` : preview}».`);
  }

  if (dialog.userTurns <= 1 && !dialog.hasBudget && !dialog.hasLocation) {
    parts.push('Диалог короткий — мало критериев, уточните у клиента при звонке.');
  }

  return parts.join('\n');
}

/**
 * Выжимка для менеджера по (по возможности полной) переписке.
 * @param {Array<{sender:string,text:string}>} conversationHistory
 * @param {{ reasonKey: string, preview?: string, language?: string, clientName?: string, mode?: string }} meta
 */
async function generateHandoffSummary(conversationHistory, meta = {}) {
  const {
    reasonKey = 'handoff',
    preview = '',
    language = 'ru',
    clientName = '',
    mode = 'handoff',
  } = meta;
  // Берём длинный хвост: после деплоя история восстанавливается из SQLite
  const history = (conversationHistory || []).slice(-120);

  if (!AI_API_KEY || !String(AI_API_KEY).trim()) {
    return buildFallbackSummary(history, reasonKey, preview, clientName);
  }

  const transcript = history
    .map((m) => `${m.sender === 'user' ? 'Клиент' : 'Бот'}: ${m.text}`)
    .join('\n');

  const isReport = mode === 'manager_report';
  const systemPrompt = isReport
    ? `Ты помощник риелтора House Tenerife. По переписке составь КОРОТКИЙ отчёт менеджеру на русском:

Имя: …
Язык: …
Объект: … (название/тип, цена если есть)
Бюджет: …
Срок: … (когда хочет купить: сейчас / через N мес. / позже)
Ипотека: нужна / не нужна / не уточнено

О разговоре:
2–4 предложения — о чём говорил клиент с ботом, что хочет, какие вопросы задавал. Не выдумывай.

${clientName ? `Имя клиента: ${clientName}.` : ''}
Язык клиента в WhatsApp: ${language}.
Не выдумывай факты. Если поля нет в переписке — пиши «не указан» / «не уточнено». Без вступления.`
    : `Ты помощник риелтора House Tenerife. По переписке клиента с ботом составь КРАТКУЮ выжимку для менеджера на русском языке (5–8 коротких пунктов или абзацев).

${clientName ? `Имя клиента (уже известно): ${clientName}.` : ''}

Обязательно укажи, если есть в переписке:
- главный вопрос или запрос клиента;
- бюджет (€);
- цель (жизнь / инвестиция);
- район или пожелания по локации;
- тип жилья;
- интерес к конкретным объектам (название/ссылка, если упоминались);
- причину передачи менеджеру: ${REASON_LABELS[reasonKey] || reasonKey}${preview ? ` (триггер: «${preview.slice(0, 300)}»)` : ''}.

Не цитируй весь чат. Не выдумывай факты, которых нет в переписке. Если данных мало — так и напиши, что уточнить у клиента.
Язык клиента в WhatsApp: ${language}.`;

  const userContent = transcript.trim()
    ? `Переписка (${history.length} сообщ.):\n${transcript}`
    : `Переписки почти нет. Триггер: ${preview || REASON_LABELS[reasonKey] || reasonKey}.`;

  try {
    const response = await chatCompletions(
      {
        model: AI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.35,
        max_tokens: isReport ? 420 : 600,
      },
      { purpose: 'background', label: isReport ? 'manager-dialog-report' : 'handoff-summary', maxAttempts: 4, timeout: 60000 }
    );

    let text = response.data?.choices?.[0]?.message?.content || '';
    while (text.includes('</think>')) {
      text = text.split('</think>').pop().trim();
    }
    text = text.replace(/<\/?redacted_reasoning>/g, '').trim();
    if (text) return text;
  } catch (e) {
    console.warn('⚠️ handoff-summary AI:', e.message);
  }

  return buildFallbackSummary(history, reasonKey, preview, clientName);
}

/**
 * Короткое пояснение для менеджера: о чём был разговор (2–4 предложения).
 * Используется в WhatsApp-отчётах и в webchat-лидах.
 */
function buildFallbackDialogBrief(conversationHistory, meta = {}) {
  const history = conversationHistory || [];
  const dialog = analyzeConversation(history, meta.language || 'ru');
  const parts = [];
  const title = String(meta.pageTitle || '').trim();
  const userTurns = history.filter((m) => m.sender === 'user').length;

  if (title) {
    parts.push(`Клиент смотрел объект «${title}».`);
  } else if (dialog.hasPropertyInterest) {
    parts.push('Клиент интересовался конкретным объектом из переписки.');
  }

  if (dialog.hasPurpose) {
    parts.push('Уточняли цель: жизнь или инвестиция.');
  }
  if (dialog.hasBudget || dialog.budgetLabel) {
    parts.push(`Бюджет: ${dialog.budgetLabel || 'упоминался'}.`);
  }
  if (dialog.hasMortgageAnswered) {
    parts.push(dialog.needsMortgage ? 'Нужна ипотека.' : 'Покупка без ипотеки.');
  }

  const lastUser = String(dialog.lastUser || '').trim();
  if (lastUser) {
    parts.push(
      `Последний запрос: «${lastUser.length > 160 ? `${lastUser.slice(0, 160)}…` : lastUser}».`
    );
  }

  if (!parts.length) {
    if (userTurns <= 1) {
      return 'Разговор только начался — клиент оставил контакты, деталей по запросу пока мало.';
    }
    return 'Клиент общался с ботом; деталей для краткой выжимки недостаточно.';
  }

  if (userTurns <= 2 && !dialog.hasBudget && !dialog.hasPurpose) {
    parts.push('Диалог короткий — деталей пока немного.');
  }

  return parts.join(' ');
}

async function generateDialogBrief(conversationHistory, meta = {}) {
  const {
    clientName = '',
    language = 'ru',
    pageTitle = '',
    source = 'whatsapp',
  } = meta;
  const history = (conversationHistory || []).slice(-100);

  if (!AI_API_KEY || !String(AI_API_KEY).trim()) {
    return buildFallbackDialogBrief(history, meta);
  }

  const transcript = history
    .map((m) => `${m.sender === 'user' ? 'Клиент' : 'Бот'}: ${String(m.text || '').slice(0, 600)}`)
    .join('\n');

  const sourceLabel =
    source === 'webchat' ? 'чат на сайте (webchat)' : 'WhatsApp-бот';

  const systemPrompt = `Ты помощник риелтора House Tenerife. По переписке клиента с ботом напиши КОРОТКОЕ пояснение для менеджера на русском языке.

Требования:
- 2–4 предложения, максимум ~450 символов;
- объясни, о чём был разговор и что хочет клиент;
- упомяни ключевые вопросы (цена, локация, ипотека, жизнь/инвестиция), если они реально были;
- не выдумывай факты, которых нет в переписке;
- не повторяй шаблонные поля вроде «Имя:», «Тел:», «Объект:»;
- без приветствий, списков и markdown.

Канал: ${sourceLabel}.
${clientName ? `Имя клиента: ${clientName}.` : ''}
${pageTitle ? `Объект со страницы: ${pageTitle}.` : ''}
Язык клиента: ${language}.`;

  const userContent = transcript.trim()
    ? `Переписка (${history.length} сообщ.):\n${transcript}`
    : `Переписки почти нет.${pageTitle ? ` Клиент на странице: ${pageTitle}.` : ''}`;

  try {
    const response = await chatCompletions(
      {
        model: AI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.3,
        max_tokens: 220,
      },
      {
        purpose: 'background',
        label: 'dialog-brief',
        maxAttempts: 3,
        timeout: 45000,
      }
    );

    let text = response.data?.choices?.[0]?.message?.content || '';
    while (text.includes('</think>')) {
      text = text.split('</think>').pop().trim();
    }
    text = text.replace(/<\/?redacted_reasoning>/g, '').trim();
    text = text.replace(/^["«]|["»]$/g, '').trim();
    if (text) {
      if (text.length > 500) text = `${text.slice(0, 480).trim()}…`;
      return text;
    }
  } catch (e) {
    console.warn('⚠️ dialog-brief AI:', e.message);
  }

  return buildFallbackDialogBrief(history, meta);
}

module.exports = {
  generateHandoffSummary,
  generateDialogBrief,
  buildFallbackSummary,
  buildFallbackDialogBrief,
};
