'use strict';

/**
 * Правило 10: фильтрация по ключевым словам.
 * Small talk («привет, как дела?») ≠ запрос объектов — не слать виллы.
 */

const PROPERTY_RELEVANT_RE =
  /(?:недвижимост|инвест|бюджет|куп(?:ить|лю|им)|продаж|апартамент|квартир|вилл|дом\b|участок|земл|коммерц|бизнес|ипотек|кредит|объект|подборк|вариант|район|регион|тенериф|дубай|ибиц|марбель|малаг|барселон|адехе|property|real\s*estate|invest|budget|buy|purchase|villa|apartment|flat|house\b|mortgage|listing|shortlist|inmueble|propiedad|inversi[oó]n|presupuesto|hipoteca|wohnung|immobil|anlage|appartement|maison|investir|woning|vastgoed|invester)/i;

const SMALL_TALK_RE =
  /^(?:привет|здравствуй(?:те)?|добр(?:ый|ое|ого)\s+(?:день|утро|вечер)|хай|хеллоу|hi\b|hello|hey\b|hola|bonjour|salut|hallo|cześć|dzie[nń]\s+dobry)?[\s,.!]*?(?:как\s+дела|как\s+ты|как\s+вы|что\s+нового|как\s+жизнь|how\s+are\s+you|how'?s\s+it\s+going|what'?s\s+up|qu[eé]\s+tal|c[oó]mo\s+est[aá]s|wie\s+geht'?s|comment\s+[cç]a\s+va|jak\s+si[eę]\s+masz|hoe\s+gaat\s+het)?[\s,.!?😊🙂]*$/i;

const GREETING_ONLY_RE =
  /^(?:привет|здравствуй(?:те)?|добр(?:ый|ое|ого)\s+(?:день|утро|вечер)|хай|hello|hi|hey|hola|bonjour|salut|hallo|cześć)[\s,.!🙂😊]*$/i;

/** Клиент поздоровался в этом сообщении (в т.ч. «привет, хочу купить…») — нужно ответить приветствием.
 * Нельзя опираться на \\b: в JS \\b не работает с кириллицей. */
const MESSAGE_OPENS_WITH_GREETING_RE =
  /^(?:привет|здравствуй(?:те)?|добр(?:ый|ое|ого)\s+(?:день|утро|вечер)|хай|хеллоу|hello|hi|hey|hola|bonjour|salut|hallo|cześć|dzie[nń]\s+dobry|goedemorgen|goedemiddag|goedenavond)(?![\p{L}\p{N}])/iu;

function hasPropertyRelevantKeywords(text) {
  return PROPERTY_RELEVANT_RE.test(String(text || ''));
}

function lastMessageHasGreeting(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  return MESSAGE_OPENS_WITH_GREETING_RE.test(s);
}

function isGreetingOrSmallTalk(text) {
  const s = String(text || '').trim();
  if (!s || s.length > 120) return false;
  if (hasPropertyRelevantKeywords(s)) return false;
  return SMALL_TALK_RE.test(s) || GREETING_ONLY_RE.test(s);
}

/**
 * Оффтоп / болтовня без сигналов поиска недвижимости.
 */
function isOffTopicChatter(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (hasPropertyRelevantKeywords(s)) return false;
  if (isGreetingOrSmallTalk(s)) return true;
  // Короткие реплики без тематики недвижимости
  if (
    s.length <= 40 &&
    /^(?:ок|окей|ok|okay|спасибо|thanks|thank\s+you|отлично|супер|cool|nice|👍|🙂|😊)[\s!.]*$/i.test(s)
  ) {
    return true;
  }
  return false;
}

function formatOffTopicInstruction(lang = 'ru', opts = {}) {
  const { normalizeSalesLang } = require('./sales-localization');
  const code = normalizeSalesLang(lang);
  const hasBudget = Boolean(opts.hasBudget);
  const hasPurpose = Boolean(opts.hasPurpose);
  const nextStepRu =
    hasBudget && opts.isInvestment && !opts.hasTimeline
      ? 'Спроси срок покупки: через 2 месяца, 3 месяца или позже.'
      : hasPurpose && !hasBudget
        ? 'Спроси размер инвестиций в €.'
        : 'Спроси: для себя или под инвестиции? (если уже про инвестиции — размер инвестиций в €).';
  const nextStepEs =
    hasBudget && opts.isInvestment && !opts.hasTimeline
      ? 'Pregunta cuándo planean comprar (2 / 3 meses / más adelante).'
      : hasPurpose && !hasBudget
        ? 'Pregunta el presupuesto en €.'
        : 'Pregunta: ¿para vivir o invertir? (o tamaño de inversión en € si ya van a inversión).';
  const nextStepEn =
    hasBudget && opts.isInvestment && !opts.hasTimeline
      ? 'Ask when they plan to buy (2 months / 3 months / later).'
      : hasPurpose && !hasBudget
        ? 'Ask for budget in €.'
        : 'Ask: looking to live or to invest? (or investment size in € if they already lean investment).';
  const nextStepDe =
    hasBudget && opts.isInvestment && !opts.hasTimeline
      ? 'Frage nach dem Kaufzeitpunkt (2 / 3 Monate / später).'
      : hasPurpose && !hasBudget
        ? 'Frage nach dem Budget in €.'
        : 'Frage: zum Wohnen oder als Investition? (oder Investitionsgröße in €, wenn schon klar).';
  const nextStepFr =
    hasBudget && opts.isInvestment && !opts.hasTimeline
      ? 'Demandez quand ils prévoient d’acheter (2 / 3 mois / plus tard).'
      : hasPurpose && !hasBudget
        ? 'Demandez le budget en €.'
        : 'Demandez: pour habiter ou investir ? (ou taille d’investissement en € si déjà clair).';
  const nextStepPl =
    hasBudget && opts.isInvestment && !opts.hasTimeline
      ? 'Zapytaj o termin zakupu (2 / 3 miesiące / później).'
      : hasPurpose && !hasBudget
        ? 'Zapytaj o budżet w €.'
        : 'Zapytaj: na życie czy inwestycja? (lub wielkość inwestycji w €, jeśli już wiadomo).';
  const nextStepNl =
    hasBudget && opts.isInvestment && !opts.hasTimeline
      ? 'Vraag wanneer ze willen kopen (2 / 3 maanden / later).'
      : hasPurpose && !hasBudget
        ? 'Vraag naar het budget in €.'
        : 'Vraag: om te wonen of te investeren? (of investeringsgrootte in € als dat al duidelijk is).';

  if (code === 'ru') {
    return `**ФИЛЬТР ПО КЛЮЧЕВЫМ СЛОВАМ / НЕ ПО ТЕМЕ (критично):**
Клиент написал приветствие/small talk без ключевых слов недвижимости (напр. «Привет, как дела?»).
ЗАПРЕЩЕНО: виллы, апартаменты, цены, ссылки, «вот вам варианты…» — это не по теме.
НУЖНО: коротко поздороваться + сказать, что помогаешь с недвижимостью/инвестициями + ОДИН следующий вопрос воронки.
Образец: «Приветствую! Максим, House Tenerife. Какой у вас размер инвестиций?»
(Если цель ещё не ясна — можно вместо этого спросить: для себя или под инвестиции.)
${nextStepRu}
Отвечай ТОЛЬКО на русском. Не уходи в общие темы.`;
  }
  if (code === 'es') {
    return `**FILTRO DE PALABRAS / OFF-TOPIC (crítico):**
El cliente escribió saludo/charla sin keywords de inmuebles (p. ej. «Hola, ¿qué tal?»).
PROHIBIDO: villas, precios, enlaces, «aquí tiene opciones…».
HAZ: saludo breve + ayudas con inmuebles/inversiones + UNA pregunta del embudo.
Ejemplo: «¡Hola! Estoy aquí para ayudar con inversiones inmobiliarias. ¿Cuál es el tamaño de su inversión?»
${nextStepEs}
Responde SOLO en español. No te desvíes del tema inmobiliario.`;
  }
  if (code === 'de') {
    return `**STICHWORT-FILTER / OFF-TOPIC (kritisch):**
Kunde schrieb Begrüßung/Smalltalk ohne Immobilien-Keywords (z. B. «Hallo, wie geht’s?»).
VERBOTEN: Villen, Preise, Links, «hier sind Optionen…».
TUN: kurzer Gruß + du hilfst bei Immobilien/Investitionen + EINE Trichterfrage.
Beispiel: «Hallo! Ich helfe bei Immobilieninvestments. Wie groß ist Ihr Investitionsvolumen?»
${nextStepDe}
Antworte NUR auf Deutsch. Bleib beim Immobilien-Thema.`;
  }
  if (code === 'fr') {
    return `**FILTRE MOTS-CLÉS / HORS SUJET (critique):**
Le client a écrit un salut/bavardage sans mots-clés immobiliers (ex. « Bonjour, ça va ? »).
INTERDIT: villas, prix, liens, « voici des options… ».
FAIRE: salut bref + tu aides en immobilier/investissements + UNE question d’entonnoir.
Exemple: « Bonjour ! Je vous aide pour l’investissement immobilier. Quelle est la taille de votre investissement ? »
${nextStepFr}
Réponds UNIQUEMENT en français. Reste sur l’immobilier.`;
  }
  if (code === 'pl') {
    return `**FILTR SŁÓW KLUCZOWYCH / OFF-TOPIC (krytyczne):**
Klient napisał powitanie/small talk bez słów o nieruchomościach (np. «Cześć, co słychać?»).
ZAKAZANE: wille, ceny, linki, «oto opcje…».
Zrób: krótkie powitanie + pomagasz przy nieruchomościach/inwestycjach + JEDNO pytanie lejka.
Przykład: «Cześć! Pomagam przy inwestycjach w nieruchomości. Jaki jest rozmiar inwestycji?»
${nextStepPl}
Odpowiadaj TYLKO po polsku. Trzymaj się tematu nieruchomości.`;
  }
  if (code === 'nl') {
    return `**TREFWOORDFILTER / OFF-TOPIC (kritiek):**
Klant schreef begroeting/smalltalk zonder vastgoed-keywords (bijv. «Hallo, hoe gaat het?»).
VERBODEN: villa’s, prijzen, links, «hier zijn opties…».
DOE: korte groet + je helpt met vastgoed/investeringen + ÉÉN trechtervraag.
Voorbeeld: «Hallo! Ik help bij vastgoedinvesteringen. Wat is de omvang van uw investering?»
${nextStepNl}
Antwoord ALLEEN in het Nederlands. Blijf bij vastgoed.`;
  }
  return `**KEYWORD FILTER / OFF-TOPIC (critical):**
Client wrote greeting/small talk without property keywords (e.g. «Hi, how are you?»).
FORBIDDEN: villas, apartments, prices, catalog links, «here are some options…».
DO: warm short reply + you help with real estate / investments + ONE next funnel question.
Example vibe: «Hi! I'm here to help with real estate investments. What’s your investment size?» (or purpose if still unknown).
${nextStepEn}
Reply in the dialog language only — never mix Russian into non-Russian chats. Stay on real estate.`;
}

module.exports = {
  hasPropertyRelevantKeywords,
  isGreetingOrSmallTalk,
  lastMessageHasGreeting,
  isOffTopicChatter,
  formatOffTopicInstruction,
};
