/**
 * Этап «конкретный объект» — уточнение финансов и документов перед менеджером.
 */

const CYR_WORD = '[а-яёА-ЯЁ]*';

/**
 * @param {Array<{sender:string,text:string}>} history
 */
function getFinanceScopedUserText(history) {
  const userMsgs = (history || []).filter((m) => m.sender === 'user');
  let afterListings = false;
  const scoped = [];

  for (const m of history || []) {
    if (m.sender !== 'user') {
      if (/housetenerife\.eu/i.test(m.text || '')) afterListings = true;
      continue;
    }
    if (afterListings) scoped.push(m.text || '');
  }

  if (scoped.length) return scoped.join('\n');
  return userMsgs
    .slice(-4)
    .map((m) => m.text)
    .join('\n');
}

/**
 * @param {Array<{sender:string,text:string}>} history
 * @param {string} allUserText
 */
function detectPropertyInterest(history, allUserText) {
  const lower = String(allUserText || '').toLowerCase();
  const userMsgs = (history || []).filter((m) => m.sender === 'user');
  const assistantMsgs = (history || []).filter((m) => m.sender !== 'user');

  const listingsShown = assistantMsgs.some((m) => /housetenerife\.eu/i.test(m.text || ''));
  const userTurns = userMsgs.length;

  const pickedObject =
    /(?:вариант|объект|квартир|вилл|апартамент)\s*(?:№\s*)?[12345]|(?:первый|второй|третий|четвёрт|пятый)\s+вариант/i.test(
      lower
    ) ||
    /(?:этот|эту|это)\s+(?:объект|вариант|квартир|вилл)/i.test(lower) ||
    /housetenerife\.eu\/[a-z]{0,3}\/?property\//i.test(lower) ||
    /\bhz\d{2,5}\b/i.test(lower);

  const strongInterest =
    /(?:понравил|нравится|интересует|хочу\s+(?:его|эту|этот|смотреть|купить)|выбираю|остановлюсь|беру)/i.test(
      lower
    ) ||
    /(?:просмотр|посмотреть|запиш|бронир|связ.*менеджер|организуй.*просмотр)/i.test(lower) ||
    /(?:как\s+оформ|как\s+куп|что\s+дальше|следующий\s+шаг|как\s+проходит\s+сделк)/i.test(lower);

  if (pickedObject) return true;
  if (listingsShown && strongInterest && userTurns >= 2) return true;
  if (listingsShown && /(?:какой|какая).{0,15}(?:ближе|подходит)|этот\s+подходит/i.test(lower)) {
    return true;
  }

  return false;
}

function parseMoneyAmount(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  if (digits.length < 4) return null;
  const v = parseInt(digits, 10);
  return Number.isFinite(v) && v >= 10000 ? v : null;
}

/**
 * Сумма «на руках сейчас», не общий бюджет поиска.
 * @param {string} text
 * @param {{ lastUserMessage?: string }} [opts]
 */
function extractFundsAvailableNow(text, opts = {}) {
  const s = String(text || '').toLowerCase();
  const last = String(opts.lastUserMessage || '').toLowerCase().trim();

  const fundsContext =
    /(?:на\s+руках|сейчас\s+(?:есть|могу|готов)|готов\s+внести|накоплен|собственн(?:ые|ых)\s+средств|внесу\s+сразу|имею\s+сейчас|own\s+funds|cash\s+ready|внесу|готов\s+оплат)/i;

  const budgetOnly =
    /(?:бюджет|ищу\s+до|максимум\s+до|до\s+\d|подборк|вариант.*(?:до|до\s*€)|ориентир\s+до)/i;

  const tryExtract = (chunk) => {
    const c = String(chunk || '').toLowerCase();
    if (!c || budgetOnly.test(c)) return null;

    if (fundsContext.test(c)) {
      const num = c.match(/(\d[\d\s.]{3,})\s*(?:€|eur|евро|e)?/i);
      const v = num ? parseMoneyAmount(num[1]) : null;
      if (v) return v;
      return true;
    }

    const withContext = c.match(
      /(?:есть|имею|на\s+руках|внесу|готов).{0,40}(\d[\d\s.]{3,})\s*(?:€|eur|евро|тыс|k)?/i
    );
    if (withContext) {
      let v = parseMoneyAmount(withContext[1]);
      if (v && /тыс|k\b/i.test(withContext[0]) && v < 10000) v *= 1000;
      if (v) return v;
    }
    return null;
  };

  const fromScoped = tryExtract(s);
  if (fromScoped) return fromScoped;

  if (last && !budgetOnly.test(last)) {
    if (fundsContext.test(last)) {
      const fromLast = tryExtract(last);
      if (fromLast) return fromLast;
    }
    if (/^\d[\d\s.]{4,}\s*(?:€|eur|евро|e)?$/i.test(last)) {
      return parseMoneyAmount(last);
    }
    const plain = last.match(/(\d[\d\s.]{4,})\s*(?:€|eur|евро)?/i);
    if (plain && !/(?:тыс|k\b)/i.test(last)) {
      const v = parseMoneyAmount(plain[1]);
      if (v) return v;
    }
  }

  return null;
}

function detectMortgagePreference(text) {
  const s = String(text || '').toLowerCase();

  const noMortgage =
    /без\s+(?:ипотек|кредит)|наличными|своими\s+средств|не\s+нужен\s+(?:кредит|ипотек)|cash\s+only|полная\s+оплата|100\s*%|только\s+сво/i.test(
      s
    );
  const yesMortgage =
    /(?:нужн|хочу|рассматриваю|планирую|возьму|через\s+банк|остальное|часть).{0,30}(?:ипотек|кредит|mortgage|рассроч)/i.test(
      s
    ) ||
    /(?:ипотек|кредит|mortgage).{0,25}(?:нужн|да|интерес|рассматрива|остальное)/i.test(s) ||
    /(?:ипотек|кредит|mortgage)/i.test(s);

  if (noMortgage && !yesMortgage) return { answered: true, needsMortgage: false };
  if (yesMortgage && !noMortgage) return { answered: true, needsMortgage: true };
  if (noMortgage && yesMortgage) return { answered: true, needsMortgage: null };
  return { answered: false, needsMortgage: null };
}

function detectMortgageStepsQuestion(text) {
  const s = String(text || '').toLowerCase();
  return (
    /(?:как\s+(?:получить|оформить|взять)|шаги|порядок|процесс|этапы|с\s+чего\s+начать|что\s+нужно\s+для|расскаж\w*|объясни\w*).{0,45}(?:ипотек|кредит|mortgage)/i.test(
      s
    ) ||
    /(?:ипотек|кредит|mortgage).{0,35}(?:как\s+получить|шаги|порядок|процесс|этапы|оформить)/i.test(s) ||
    /(?:получить|оформить)\s+ипотек/i.test(s) ||
    /(?:how\s+to\s+get|steps?\s+for|process\s+for|what\s+do\s+i\s+need).{0,40}(?:mortgage|home\s+loan|bank\s+loan)/i.test(
      s
    ) ||
    /(?:mortgage|home\s+loan).{0,35}(?:how\s+to|steps?|process)/i.test(s) ||
    /(?:cómo\s+obtener|pasos\s+para|proceso\s+de|qué\s+necesito).{0,40}(?:hipoteca|crédito|préstamo)/i.test(s) ||
    /(?:hipoteca|crédito).{0,35}(?:cómo|pasos|proceso)/i.test(s)
  );
}

function detectDocumentsDiscussed(text) {
  const s = String(text || '').toLowerCase();
  return (
    /какие\s+документ|какой\s+пакет\s+документ|справк[а-яё]*.{0,18}доход|доходн[а-яё]*\s+справк|2-?ндфл|ндфл|income\s+certificate|есть\s+справк|справк[а-яё]*\s+(?:о\s+)?доход|подготовил[а-яё]*\s+документ|(?:нет|не\s+готов).{0,25}справк|\bnie\b|паспорт/i.test(
      s
    ) || /(?:расскаж|объясни).{0,20}(?:документ|ипотек|оформлен)/i.test(s)
  );
}

const {
  getFinanceStageInstruction: getLocalizedFinanceInstruction,
  getMortgageStepsInstruction: getLocalizedMortgageSteps,
  formatFinanceSummaryForPrompt: formatLocalizedFinanceSummary
} = require('./sales-localization');

/**
 * @param {Array<{sender:string,text:string}>} history
 * @param {string} [allUserText]
 * @param {string} [lang]
 */
function analyzePurchaseFinance(history, allUserText, lang = 'ru') {
  const userMsgs = (history || []).filter((m) => m.sender === 'user');
  const lastUser = userMsgs[userMsgs.length - 1]?.text || '';
  const text = allUserText || userMsgs.map((m) => m.text).join('\n');
  const scopedText = getFinanceScopedUserText(history);

  const hasPropertyInterest = detectPropertyInterest(history, text);
  const fundsNow = extractFundsAvailableNow(scopedText, { lastUserMessage: lastUser });
  const hasFundsNow = fundsNow !== null && fundsNow !== false;
  const fundsNowLabel =
    typeof fundsNow === 'number' ? `~€${fundsNow.toLocaleString('en-US')}` : hasFundsNow ? 'указано' : '';

  const mortgage = detectMortgagePreference(scopedText || lastUser);
  const documentsDiscussed = detectDocumentsDiscussed(text);

  let financeStage = null;
  if (hasPropertyInterest) {
    if (!hasFundsNow) financeStage = 'NEED_FUNDS_NOW';
    else if (!mortgage.answered) financeStage = 'NEED_MORTGAGE';
    else if (!documentsDiscussed) {
      financeStage = mortgage.needsMortgage ? 'FINANCE_DOCUMENTS' : 'FINANCE_DOCUMENTS_CASH';
    } else financeStage = 'PROPERTY_CLOSING';
  }

  return {
    hasPropertyInterest,
    hasFundsNow,
    fundsNow,
    fundsNowLabel,
    hasMortgageAnswered: mortgage.answered,
    needsMortgage: mortgage.needsMortgage,
    documentsDiscussed,
    financeStage
  };
}

const FINANCE_STAGE_INSTRUCTIONS = {
  NEED_FUNDS_NOW: `Клиент выбрал/заинтересовался конкретным объектом. Сначала коротко отзеркаль выбор. Один вопрос: сколько денег есть *сейчас* на руках (накопления, не общий «бюджет мечты») — в €. Можно: «сразу», «часть + кредит позже». Без длинной лекции.`,

  NEED_MORTGAGE: `Объект выбран, сумма на руках понятна. Сначала один вопрос: ипотека/кредит в Испании или свои средства? Если клиент спрашивает «как получить ипотеку» — дай 5–7 шагов из mortgage_process, затем этот вопрос. Не выдумывай ставки и LTV.`,

  FINANCE_DOCUMENTS: `Клиенту нужна ипотека/кредит. Если ещё не объяснял процесс — 5–7 шагов из mortgage_process (нумерованный список). Затем кратко документы из purchase_documents (mortgage_purchase_typical): NIE, паспорт, справка о доходах, выписка, одобрение банка. Один вопрос: есть ли справка о доходах. House Tenerife — сопровождение ипотеки (пакет €3 000). Без ставок и гарантий одобрения.`,

  FINANCE_DOCUMENTS_CASH: `Покупка своими средствами (без ипотеки). Кратко (3–5 пунктов) из purchase_documents (cash_purchase_typical): паспорт, NIE, счёт в Испании, подтверждение происхождения средств, этапы arras/escritura. Справку о доходах не требуй — только если клиент сам спросит про кредит. Один вопрос: готовы ли документы или нужен чек-лист от менеджера.`,

  PROPERTY_CLOSING: `Финансы по объекту ясны. Коротко резюмируй: объект, сумма на руках, ипотека да/нет. Предложи менеджера для просмотра и расчёта сделки (слово «менеджер» — заявка в боте). Или ответь на последний вопрос клиента по документам.`
};

const MORTGAGE_STEPS_INSTRUCTION = `Клиент спрашивает про ипотеку/кредит в Испании. Обязательно дай *основные шаги* из базы знаний mortgage_process (5–7 пунктов, формат 1. … 2. …, по 1–2 строки). Упомяни ориентир первого взноса для нерезидентов (30–40%, без точных ставок). Кратко — чем помогает House Tenerife (пакет сопровождения, без гарантии одобрения). В конце — один вопрос из follow_up_questions (NIE/счёт, сумма на руках или справка о доходах). Не перегружай — если уже на этапе конкретного объекта, свяжи шаги с его ситуацией.`;

function getFinanceStageInstruction(financeStage, lang = 'ru') {
  const localized = getLocalizedFinanceInstruction(lang, financeStage);
  if (localized) return localized;
  return FINANCE_STAGE_INSTRUCTIONS[financeStage] || '';
}

function getMortgageStepsInstruction(lang = 'ru') {
  const localized = getLocalizedMortgageSteps(lang);
  if (localized) return localized;
  return MORTGAGE_STEPS_INSTRUCTION;
}

function formatFinanceSummaryForPrompt(finance, lang = 'ru') {
  const localized = formatLocalizedFinanceSummary(lang, finance);
  if (localized) return localized;
  if (!finance.hasPropertyInterest) return '';

  const lines = [
    '**КОНКРЕТНЫЙ ОБЪЕКТ (приоритет этапа):**',
    `- Интерес к объекту: да`,
    `- Деньги сейчас на руках: ${finance.hasFundsNow ? finance.fundsNowLabel || 'да' : 'ещё уточни'}`,
    `- Ипотека/кредит: ${
      !finance.hasMortgageAnswered
        ? 'ещё не ясно — спроси'
        : finance.needsMortgage
          ? 'да, нужна'
          : finance.needsMortgage === false
            ? 'нет, свои средства'
            : 'уточни'
    }`,
    `- Документы/справка о доходах: ${
      finance.documentsDiscussed
        ? 'обсуждались'
        : finance.needsMortgage
          ? 'расскажи кратко и спроси про справку'
          : 'краткий чек-лист для наличной покупки'
    }`
  ];
  return lines.join('\n');
}

module.exports = {
  analyzePurchaseFinance,
  detectPropertyInterest,
  getFinanceScopedUserText,
  extractFundsAvailableNow,
  detectMortgagePreference,
  detectMortgageStepsQuestion,
  detectDocumentsDiscussed,
  getFinanceStageInstruction,
  getMortgageStepsInstruction,
  formatFinanceSummaryForPrompt,
  FINANCE_STAGE_INSTRUCTIONS,
  MORTGAGE_STEPS_INSTRUCTION
};
