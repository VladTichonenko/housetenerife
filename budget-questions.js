'use strict';

const BUDGET_QUESTIONS = {
  ru: [
    'Чтобы подобрать действительно подходящие варианты и не показывать объекты, которые заведомо не подойдут, подскажите, пожалуйста, на какой диапазон стоимости лучше ориентироваться?',
    'Хочу предложить только те варианты, которые реально могут вам подойти — подскажите, пожалуйста, в каком диапазоне стоимости лучше смотреть?',
    'Чтобы не тратить ваше время на нерелевантные объекты, уточните, пожалуйста: на какой ценовой диапазон ориентируемся?',
    'Мне важно показать варианты, которые действительно имеют смысл для вас — подскажите, пожалуйста, какой диапазон стоимости рассматриваете?',
    'Чтобы подборка была по делу, а не «наугад», подскажите, пожалуйста, на какую вилку по цене лучше ориентироваться?',
    'Хочу сузить поиск до действительно подходящих объектов — какой диапазон стоимости для вас сейчас актуален?',
  ],
  en: [
    'To suggest options that truly fit and avoid listings that clearly won’t work for you, what price range should we focus on?',
    'I’d like to show only relevant options — could you share what budget range feels right for you?',
    'So we don’t waste your time on mismatched properties, what price bracket should we look at?',
    'To keep the shortlist meaningful, what cost range are you comfortable with?',
    'I want to narrow the search to options that really make sense — what price range should we use as a guide?',
    'To avoid irrelevant listings, could you tell me what price range you’d like to target?',
  ],
  es: [
    'Para proponer opciones que encajen de verdad y no mostrar inmuebles que claramente no encajan, ¿en qué rango de precio prefiere orientarse?',
    'Quiero enseñarle solo opciones relevantes — ¿qué rango de precio le encaja mejor?',
    'Para no perder tiempo con inmuebles que no encajan, ¿en qué franja de precio miramos?',
    'Para que la selección tenga sentido, ¿qué rango de coste le resulta cómodo?',
    'Quiero acotar la búsqueda a opciones que de verdad encajen — ¿qué rango de precio le sirve de referencia?',
    'Para evitar opciones irrelevantes, ¿en qué rango de precio prefiere que nos movamos?',
  ],
};

function normalizeBudgetLang(lang) {
  const code = String(lang || 'ru').toLowerCase().slice(0, 2);
  if (code === 'ru' || code === 'en' || code === 'es') return code;
  return 'en';
}

function pickBudgetQuestionExample(lang) {
  const code = normalizeBudgetLang(lang);
  const list = BUDGET_QUESTIONS[code] || BUDGET_QUESTIONS.en;
  return list[Math.floor(Math.random() * list.length)];
}

module.exports = { pickBudgetQuestionExample, BUDGET_QUESTIONS };
