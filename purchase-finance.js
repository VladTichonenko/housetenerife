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
    /(?:option|listing|property|apartment|villa)\s*(?:#|no\.?|number)?\s*[12345]/i.test(lower) ||
    /(?:the\s+)?(?:first|second|third|fourth|fifth)\s+(?:one|option|listing|property)/i.test(lower) ||
    /(?:opción|ficha|propiedad|apartamento|villa)\s*(?:#|n[ºo]\.?)?\s*[12345]/i.test(lower) ||
    /(?:la\s+)?(?:primera|segunda|tercera|cuarta|quinta)\s+(?:opción|ficha|propiedad)/i.test(lower) ||
    /(?:this|that)\s+(?:one|property|listing|apartment|villa)/i.test(lower) ||
    /(?:esta|ese|esa)\s+(?:ficha|propiedad|opción|villa|apartamento)/i.test(lower) ||
    /housetenerife\.eu\/[a-z]{0,3}\/?property\//i.test(lower) ||
    /\bhz\d{2,5}\b/i.test(lower);

  const strongInterest =
    /(?:понравил|нравится|интересует|хочу\s+(?:его|эту|этот|смотреть|купить)|выбираю|остановлюсь|беру)/i.test(
      lower
    ) ||
    /(?:i\s+like|love\s+this|interested\s+in|want\s+to\s+(?:see|view|buy)|i(?:'ll| will)\s+take|this\s+one\s+works)/i.test(
      lower
    ) ||
    /(?:me\s+gusta|me\s+interesa|quiero\s+(?:ver|comprar)|me\s+quedo\s+con|esta\s+me\s+encaja)/i.test(lower) ||
    /(?:просмотр|посмотреть|запиш|бронир|связ.*менеджер|организуй.*просмотр)/i.test(lower) ||
    /(?:viewing|schedule\s+a\s+view|book\s+a\s+view|arrange\s+a\s+visit)/i.test(lower) ||
    /(?:visita|ver\s+en\s+persona|agendar\s+visita)/i.test(lower) ||
    /(?:как\s+оформ|как\s+куп|что\s+дальше|следующий\s+шаг|как\s+проходит\s+сделк)/i.test(lower) ||
    /(?:how\s+to\s+buy|next\s+step|what(?:'s|\s+is)\s+next|how\s+does\s+the\s+deal)/i.test(lower) ||
    /(?:cómo\s+comprar|siguiente\s+paso|qué\s+sigue)/i.test(lower);

  if (pickedObject) return true;
  if (listingsShown && strongInterest && userTurns >= 2) return true;
  if (
    listingsShown &&
    /(?:какой|какая).{0,15}(?:ближе|подходит)|этот\s+подходит|which\s+one.{0,20}(?:closest|best)|this\s+one\s+fits|cuál.{0,20}(?:encaja|mejor)/i.test(
      lower
    )
  ) {
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
    /(?:на\s+руках|сейчас\s+(?:есть|могу|готов)|готов\s+внести|накоплен|собственн(?:ые|ых)\s+средств|внесу\s+сразу|имею\s+сейчас|own\s+funds|cash\s+ready|cash\s+available|money\s+available|ready\s+to\s+pay|внесу|готов\s+оплат|efectivo\s+disponible|dinero\s+ahora|tengo\s+ahora)/i;

  const budgetOnly =
    /(?:бюджет|budget|presupuesto|budgetrahmen|ищу\s+до|максимум\s+до|до\s+\d|подборк|вариант.*(?:до|до\s*€)|ориентир\s+до|hasta\s+\d|up\s*to\s+\d|bis\s+\d)/i;

  const tryExtract = (chunk) => {
    const c = String(chunk || '').toLowerCase();
    if (!c) return null;
    // Бюджет поиска в этом же сообщении — не путать с «на руках»
    if (budgetOnly.test(c) && !fundsContext.test(c)) return null;

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

  const segments = String(s || '')
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const segment of segments) {
    const fromSegment = tryExtract(segment);
    if (fromSegment) return fromSegment;
  }

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
    /без\s+(?:ипотек|кредит)|наличными|своими\s+средств|не\s+нужен\s+(?:кредит|ипотек)|cash\s+only|полная\s+оплата|100\s*%|только\s+сво|все\s+(?:своими|наличн|деньг)|полностью\s+(?:своими|наличн)|all\s+cash|sin\s+hipoteca|ohne\s+hypothek|sans\s+cr[eé]dit/i.test(
      s
    );
  const yesMortgage =
    /(?:нужн|хочу|рассматриваю|планирую|возьму|через\s+банк|остальное|часть).{0,30}(?:ипотек|кредит|mortgage|рассроч)/i.test(
      s
    ) ||
    /(?:ипотек|кредит|mortgage).{0,25}(?:нужн|да|интерес|рассматрива|остальное)/i.test(s) ||
    /(?:часть\s*(?:\+|и|плюс)|частичн|первый\s+взнос|down\s+payment).{0,25}(?:ипотек|кредит|mortgage|банк)/i.test(
      s
    ) ||
    /(?:ипотек|кредит|mortgage|hipoteca|hypothek|hypotheek)/i.test(s);

  if (noMortgage && !yesMortgage) return { answered: true, needsMortgage: false };
  if (yesMortgage && !noMortgage) return { answered: true, needsMortgage: true };
  if (noMortgage && yesMortgage) return { answered: true, needsMortgage: null };
  return { answered: false, needsMortgage: null };
}

/**
 * Ответ на «сколько есть сейчас / все / часть / ипотека» — до подборки.
 * @param {string} text
 * @param {{ lastUserMessage?: string }} [opts]
 */
function analyzeFinanceCapability(text, opts = {}) {
  const full = String(text || '');
  const last = String(opts.lastUserMessage || '').trim();
  const combined = [full, last].filter(Boolean).join('\n');

  // «весь миллион на руках» / «всё на руках» = оплата своими, ипотека не нужна
  const allCash =
    /(?:все\s+(?:своими|наличн|деньг)|вся\s+сумм|весь\s+(?:бюджет|миллион|млн)|(?:весь|вся|всё|все)\s+.{0,35}на\s+руках|на\s+руках\s+(?:весь|вся|всё|все|полный)|полностью\s+(?:своими|наличн)|100\s*%|без\s+(?:ипотек|кредит)|наличными|только\s+сво|cash\s+only|all\s+cash|full\s+amount\s+(?:on\s+hand|available)|tout\s+cash|todo\s+(?:en\s+)?efectivo|volle\s+bar|sin\s+hipoteca|sans\s+(?:cr[eé]dit|hypoth[eè]que)|ohne\s+hypothek|полная\s+оплата)/i.test(
      combined
    );
  const partial =
    /(?:часть\s*(?:\+|и|плюс)|частичн|часть\s+своими|часть\s+деньг|первый\s+взнос|down\s+payment|часть.{0,30}(?:ипотек|кредит|mortgage)|partie\s*\+|teilweise)/i.test(
      combined
    );

  let fundsNow = extractFundsAvailableNow(combined, { lastUserMessage: last });
  if ((allCash || partial) && (fundsNow === null || fundsNow === false)) {
    fundsNow = true;
  }

  const mortgage = detectMortgagePreference(combined);
  let hasMortgageAnswered = mortgage.answered;
  let needsMortgage = mortgage.needsMortgage;

  if (allCash && !partial) {
    hasMortgageAnswered = true;
    needsMortgage = false;
  } else if (partial && !mortgage.answered) {
    hasMortgageAnswered = true;
    needsMortgage = true;
  }

  const hasFundsNow = fundsNow !== null && fundsNow !== false;
  const fundsNowLabel =
    typeof fundsNow === 'number'
      ? `~€${fundsNow.toLocaleString('en-US')}`
      : hasFundsNow
        ? allCash
          ? 'все своими'
          : partial
            ? 'часть + кредит'
            : 'указано'
        : '';

  return {
    hasFundsNow,
    fundsNow,
    fundsNowLabel,
    hasMortgageAnswered,
    needsMortgage,
  };
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
 * @param {{ requireBeforeListings?: boolean }} [opts]
 */
function analyzePurchaseFinance(history, allUserText, lang = 'ru', opts = {}) {
  const userMsgs = (history || []).filter((m) => m.sender === 'user');
  const lastUser = userMsgs[userMsgs.length - 1]?.text || '';
  const text = allUserText || userMsgs.map((m) => m.text).join('\n');
  const scopedText = getFinanceScopedUserText(history);

  const hasPropertyInterest = detectPropertyInterest(history, text);
  const requireBeforeListings = Boolean(opts.requireBeforeListings);

  // До подборки — смотрим всю переписку; после интереса к объекту — scoped после ссылок
  const capabilitySource =
    requireBeforeListings || !hasPropertyInterest ? text : scopedText || text;
  const capability = analyzeFinanceCapability(capabilitySource, {
    lastUserMessage: lastUser,
  });

  const {
    hasFundsNow,
    fundsNow,
    fundsNowLabel,
    hasMortgageAnswered,
    needsMortgage,
  } = capability;

  const documentsDiscussed = detectDocumentsDiscussed(text);

  let financeStage = null;

  // Документы / закрытие — только после интереса к конкретному объекту
  if (hasPropertyInterest) {
    if (!hasFundsNow) financeStage = 'NEED_FUNDS_NOW';
    else if (!hasMortgageAnswered) financeStage = 'NEED_MORTGAGE';
    else if (!documentsDiscussed) {
      financeStage = needsMortgage ? 'FINANCE_DOCUMENTS' : 'FINANCE_DOCUMENTS_CASH';
    } else financeStage = 'PROPERTY_CLOSING';
  }

  return {
    hasPropertyInterest,
    hasFundsNow,
    fundsNow,
    fundsNowLabel,
    hasMortgageAnswered,
    needsMortgage,
    documentsDiscussed,
    financeStage,
    financeReadyForListings: hasFundsNow && hasMortgageAnswered,
  };
}

const FINANCE_STAGE_INSTRUCTIONS = {
  NEED_FUNDS_NOW: `Сейчас этап финансов ДО подборки (или клиент уже выбрал объект). Один вопрос: сколько денег есть *сейчас* на руках — можно ответить «все своими», «часть + ипотека» или сумму в €. Это не общий бюджет поиска. Без длинной лекции. Объекты пока НЕ показывай.`,

  NEED_MORTGAGE: `Сумма/форма оплаты на руках понятна. Один вопрос — нужна ипотека/кредит в Испании или свои средства? Если нужна ипотека — скажи, что House Tenerife помогает с оформлением (банк, документы, NIE, счёт) и предложи коротко разобрать на созвоне; не отправляй клиента «самому в банк» и не рекламируй юристов. Если спрашивают ставки/шаги — mortgage_process + mortgage_lending_official + mortgage_rates_official (Euríbor BdE / Ley 5/2019). Не выдумывай оферту банка. Объекты пока НЕ показывай, если этап до подборки.`,

  FINANCE_DOCUMENTS: `Клиенту нужна ипотека/кредит. Если ещё не объяснял процесс — 5–7 шагов из mortgage_process (нумерованный список) + при необходимости FEIN/FiAE из mortgage_lending_official. Затем кратко документы из purchase_documents (mortgage_purchase_typical): NIE, паспорт, справка о доходах, выписка, одобрение банка. Один вопрос: есть ли справка о доходах. House Tenerife — сопровождение ипотеки (пакет €3 000). Без ставок «от юриста», без имён адвокатов и без гарантий одобрения.`,

  FINANCE_DOCUMENTS_CASH: `Покупка своими средствами (без ипотеки). Кратко (3–5 пунктов) из purchase_documents (cash_purchase_typical): паспорт, NIE, счёт в Испании, подтверждение происхождения средств, этапы arras/escritura. Справку о доходах не требуй — только если клиент сам спросит про кредит. Один вопрос: готовы ли документы или нужен чек-лист от менеджера.`,

  PROPERTY_CLOSING: `Финансы по объекту ясны. Коротко резюмируй: объект, сумма на руках, ипотека да/нет. Предложи созвон с менеджером для просмотра и расчёта сделки — один вопрос да/нет. Или ответь на последний вопрос клиента по документам.`
};

const MORTGAGE_STEPS_INSTRUCTION = `Клиент спрашивает про ипотеку/кредит в Испании. 
1) Скажи, что *House Tenerife помогает с оформлением ипотеки* (NIE, счёт, пакет документов, подбор банка, оценка) в пакете сопровождения €3 000 — не нужно уходить оформлять самому «на стороне» и не рекламируй сторонних юристов.
2) Дай *основные шаги* из mortgage_process (5–7 пунктов, 1. … 2. …). При вопросе про закон/FEIN — добавь 1–2 факта из mortgage_lending_official (BdE / Ley 5/2019).
3) По ставкам: опирайся на mortgage_rates_official (Euríbor 12 мес. и средний тип BdE за указанный месяц) + оговорка «финальная ставка — у банка». Можно кратко сослаться на Banco de España. Не выдумывай оферту конкретного банка и не гарантируй одобрение.
4) Источники правды: Banco de España Cliente Bancario, BOE Ley 5/2019, база HT. ЗАПРЕЩЕНО цитировать адвокатов, юрфирмы и их рекламные гайды.
5) По сайту: нерезиденты часто до ~70% LTV, резиденты ЕС до ~80%; комиссия открытия часто ~1,5–2% (ориентиры housetenerife.eu).
6) В конце — один вопрос (NIE/счёт, взнос, справка о доходах) ИЛИ мягкий созвон 10–15 мин по ипотеке.`;

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
  if (!finance.hasPropertyInterest && !finance.hasFundsNow && !finance.hasMortgageAnswered) {
    return '';
  }

  const lines = [
    finance.hasPropertyInterest
      ? '**ФИНАНСЫ / КОНКРЕТНЫЙ ОБЪЕКТ:**'
      : '**ФИНАНСЫ ДО ПОДБОРКИ:**',
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
  ];
  if (finance.hasPropertyInterest) {
    lines.push(
      `- Документы/справка о доходах: ${
        finance.documentsDiscussed
          ? 'обсуждались'
          : finance.needsMortgage
            ? 'расскажи кратко и спроси про справку'
            : 'краткий чек-лист для наличной покупки'
      }`
    );
  }
  return lines.join('\n');
}

module.exports = {
  analyzePurchaseFinance,
  analyzeFinanceCapability,
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
