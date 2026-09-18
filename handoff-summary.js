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
    ? `Ты помощник риелтора House Tenerife. По полной переписке клиента с ботом составь ОТЧЁТ для главного менеджера на русском языке.

Структура (коротко, по делу, 8–12 пунктов):
1) Кто клиент / язык общения
2) С чего начался диалог и что хотел
3) Какие критерии собрали (бюджет, цель жизнь/инвестиция, район, тип)
4) Какие объекты обсуждали / какой выбрал (название, цена, ссылка если есть)
5) Финансы: деньги на руках, ипотека, документы — если говорили
6) К чему пришли сейчас (интерес, готовность к созвону/просмотру, открытые вопросы)
7) Что менеджеру важно знать перед звонком / что клиент уже «помнил» из бота

${clientName ? `Имя клиента: ${clientName}.` : ''}
Контекст триггера: ${REASON_LABELS[reasonKey] || reasonKey}${preview ? ` («${preview.slice(0, 300)}»)` : ''}.
Язык клиента в WhatsApp: ${language}.

Не цитируй весь чат дословно. Не выдумывай факты. Если данных мало — явно напиши, что уточнить.`
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
        max_tokens: isReport ? 900 : 600,
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

module.exports = { generateHandoffSummary, buildFallbackSummary };
