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
  de: [
    'Damit ich wirklich passende Optionen vorschlage und klar ungeeignete Objekte vermeide: an welchem Preisrahmen sollen wir uns orientieren?',
    'Ich möchte nur relevante Optionen zeigen — in welchem Budgetrahmen fühlen Sie sich wohl?',
    'Damit wir keine Zeit mit unpassenden Objekten verlieren: welche Preisspanne sollen wir anschauen?',
    'Damit die Auswahl Sinn ergibt — welcher Preisrahmen ist für Sie komfortabel?',
    'Ich möchte die Suche auf wirklich passende Objekte eingrenzen — welcher Preisrahmen gilt als Orientierung?',
    'Um irrelevante Angebote zu vermeiden: welchen Preisrahmen sollen wir anstreben?',
  ],
  fr: [
    'Pour proposer des options vraiment adaptées et éviter les biens clairement inadaptés, sur quelle fourchette de prix souhaitez-vous vous orienter ?',
    'Je voudrais ne montrer que des options pertinentes — quelle fourchette budgétaire vous convient ?',
    'Pour ne pas perdre de temps avec des biens inadaptés, quelle tranche de prix regardons-nous ?',
    'Pour que la sélection ait du sens, quelle fourchette de coût vous est confortable ?',
    'Je veux restreindre la recherche à des options pertinentes — quelle fourchette de prix servir de référence ?',
    'Pour éviter les options hors sujet, dans quelle fourchette de prix préférez-vous nous situer ?',
  ],
};

function normalizeBudgetLang(lang) {
  const code = String(lang || 'ru').toLowerCase().slice(0, 2);
  if (code === 'ru' || code === 'en' || code === 'es' || code === 'de' || code === 'fr') return code;
  return 'en';
}

function pickBudgetQuestionExample(lang) {
  const code = normalizeBudgetLang(lang);
  const list = BUDGET_QUESTIONS[code] || BUDGET_QUESTIONS.en;
  return list[Math.floor(Math.random() * list.length)];
}

module.exports = { pickBudgetQuestionExample, BUDGET_QUESTIONS };
