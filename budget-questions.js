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
  pl: [
    'Żeby zaproponować naprawdę pasujące opcje i nie pokazywać obiektów, które ewidentnie nie pasują — na jaki zakres ceny lepiej się orientować?',
    'Chcę pokazać tylko trafne opcje — jaki zakres budżetu jest dla Państwa komfortowy?',
    'Żeby nie tracić czasu na niepasujące oferty — w jakim przedziale ceny patrzymy?',
    'Żeby selekcja miała sens — jaki zakres kosztów jest wygodny?',
    'Chcę zawęzić wyszukiwanie do naprawdę pasujących obiektów — jaki przedział ceny jako orientacja?',
    'Żeby uniknąć nietrafionych ofert — na jaki zakres ceny mamy się kierować?',
  ],
  nl: [
    'Om echt passende opties voor te stellen en duidelijk ongeschikte objecten te vermijden: op welk prijsbereik moeten we ons richten?',
    'Ik wil alleen relevante opties tonen — welk budgetbereik voelt comfortabel?',
    'Om geen tijd te verliezen met onpassende objecten: welke prijsklasse bekijken we?',
    'Om de selectie zinvol te houden — welk kostenbereik is comfortabel?',
    'Ik wil de zoektocht beperken tot echt passende objecten — welk prijsbereik als richtlijn?',
    'Om irrelevante opties te vermijden: welk prijsbereik willen jullie aanhouden?',
  ],
};

/** Инвест-ветка: «размер инвестиций», не «диапазон бюджета». */
const INVESTMENT_BUDGET_QUESTIONS = {
  ru: [
    'Какой у вас размер инвестиций? Ориентиры: до 300к, 300–600к или выше 600к евро',
    'Подскажите, какой размер инвестиций рассматриваете — до 300к, 300–600к или от 600к?',
    'Чтобы подобрать подходящие варианты — какой у вас размер инвестиций?',
    'Какой размер инвестиций вам комфортен: до 300к, 300–600к или выше 600к?',
  ],
  en: [
    'What’s your investment size? Rough guides: up to €300k, €300–600k, or above €600k',
    'What investment size are you looking at — up to €300k, €300–600k, or €600k+?',
    'To shortlist the right options — what’s your investment size?',
  ],
  es: [
    '¿Cuál es el tamaño de su inversión? Orientación: hasta 300k, 300–600k o más de 600k €',
    '¿Qué tamaño de inversión contempla — hasta 300k, 300–600k o desde 600k?',
    'Para acertar con las opciones — ¿cuál es el tamaño de su inversión?',
  ],
  de: [
    'Wie hoch ist Ihre Investitionssumme? Orientierung: bis €300k, €300–600k oder ab €600k',
    'Welche Investitionsgröße schwebt Ihnen vor — bis €300k, €300–600k oder €600k+?',
  ],
  fr: [
    'Quelle est la taille de votre investissement ? Repères : jusqu’à 300k, 300–600k ou au-delà de 600k €',
    'Quel montant d’investissement visez-vous — jusqu’à 300k, 300–600k ou 600k+ ?',
  ],
  pl: [
    'Jaka jest wielkość Państwa inwestycji? Orientacja: do 300k, 300–600k lub powyżej 600k €',
    'Jaką wielkość inwestycji rozważają Państwo — do 300k, 300–600k czy od 600k?',
  ],
  nl: [
    'Wat is de omvang van uw investering? Richtlijnen: tot €300k, €300–600k of boven €600k',
    'Welke investeringsomvang past — tot €300k, €300–600k of €600k+?',
  ],
};

function normalizeBudgetLang(lang) {
  const code = String(lang || 'ru').toLowerCase().slice(0, 2);
  if (code === 'ru' || code === 'en' || code === 'es' || code === 'de' || code === 'fr' || code === 'pl' || code === 'nl') {
    return code;
  }
  return 'en';
}

function pickFromList(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function pickBudgetQuestionExample(lang, options = {}) {
  const code = normalizeBudgetLang(lang);
  if (options.investment) {
    const inv = INVESTMENT_BUDGET_QUESTIONS[code] || INVESTMENT_BUDGET_QUESTIONS.en;
    return pickFromList(inv);
  }
  const list = BUDGET_QUESTIONS[code] || BUDGET_QUESTIONS.en;
  return pickFromList(list);
}

module.exports = {
  pickBudgetQuestionExample,
  BUDGET_QUESTIONS,
  INVESTMENT_BUDGET_QUESTIONS,
};
