'use strict';

/**
 * Глобально: человечный WhatsApp-тон + короткие реплики про тип объекта.
 * «а что по виллам?» / «What about villas?» — продолжение подбора, НЕ лекция
 * про доходность (лекция только по явной просьбе).
 */

function wantsInvestmentEducation(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  return (
    /(?:расскаж\w*|объясн\w*|поведай|в\s+чём\s+плюс|какие\s+плюс|плюсы\s+и\s+минусы|почему\s+(?:стоит|выгодн)|как\s+работает\s+инвест)/i.test(
      s
    ) ||
    /(?:tell\s+me\s+(?:about|more)|explain|why\s+(?:are|is|do)|pros?\s*(?:and|&)\s*cons?|benefits?\s+of|advantages?\s+of|is\s+it\s+(?:a\s+)?good\s+(?:idea|investment)|worth\s+investing)/i.test(
      s
    ) ||
    /(?:cu[eé]ntame|expl[ií]came|por\s+qu[eé]\s+(?:conviene|invertir)|ventajas\s+de|pros\s+y\s+contras)/i.test(
      s
    ) ||
    /(?:erkl[aä]r|warum\s+(?:sich|villen)|vorteile\s+(?:von|der)|lohnt\s+sich)/i.test(s) ||
    /(?:расскаж\w*|explain|tell\s+me|cu[eé]ntame).{0,50}(?:инвест|investment|inversi[oó]n|anlage)/i.test(
      s
    ) ||
    /(?:инвест(?:ировать|иции|иция).{0,40}(?:вилл|апартамент)|invest(?:ing|ment).{0,40}(?:villa|apartment)|invertir.{0,40}villa)/i.test(
      s
    )
  );
}

/**
 * Короткая человеческая реплика про тип/подбор — не запрос «расскажи про инвестиции».
 */
function isCasualSearchResume(text) {
  const s = String(text || '').trim();
  if (!s || wantsInvestmentEducation(s)) return false;
  if (s.length > 160) return false;

  return (
    /^(?:а\s+)?(?:что|как)\s+(?:по|насч[её]т|на\s*сч[её]т)\s+(?:нашим?\s+)?(?:вилл|апартамент|квартир|дом|объект)/i.test(
      s
    ) ||
    /^(?:а\s+)?(?:виллы?|апартаменты?|квартиры?|дома?)\s*\??$/i.test(s) ||
    /^(?:what|how)\s+about\s+(?:the\s+|our\s+|those\s+)?(?:villas?|apartments?|flats?|houses?|properties)\s*\??$/i.test(
      s
    ) ||
    /^(?:and\s+)?(?:the\s+)?(?:villas?|apartments?)\s*\??$/i.test(s) ||
    /^(?:y\s+)?(?:las?\s+)?(?:villas?|apartamentos?|pisos?)\s*\??$/i.test(s) ||
    /^(?:и\s+)?(?:назад\s+к|верн[её]мся\s+к|давай\s+(?:к|про))\s+(?:вилл|подбор|объект)/i.test(s) ||
    /^(?:back\s+to\s+(?:the\s+)?(?:villas?|search|listings|properties)|let'?s\s+(?:get\s+)?back\s+to\s+(?:villas?|search))/i.test(
      s
    ) ||
    /^(?:а\s+)?(?:по\s+)?(?:нашим?\s+)?вилл/i.test(s) ||
    /про\s+(?:наши?\s+)?виллы?\s*\??$/i.test(s) ||
    /^(?:ну\s+)?(?:давай|давайте)\s+(?:вилл|апартамент|квартир|подбор)/i.test(s) ||
    /^(?:so\s+)?(?:about\s+)?(?:the\s+)?villas?\s*(?:then)?\s*\??$/i.test(s) ||
    /^(?:ok|okay|alright)[,.]?\s+(?:and\s+)?(?:the\s+)?villas?\s*\??$/i.test(s) ||
    /^(?:ладно|окей|ок)[,.]?\s+(?:а\s+)?(?:что\s+)?(?:по\s+)?вилл/i.test(s)
  );
}

/**
 * Продолжить воронку без лекции: после сайд-темы ИЛИ любая casual-реплика про тип.
 */
function shouldResumePropertyFunnel(gate, previousScenario) {
  if (!gate || gate.scenario !== 'property_search') return false;
  if (wantsInvestmentEducation(gate.lastUserText)) return false;
  const fromSide =
    previousScenario === 'mortgage_docs' ||
    previousScenario === 'support_other' ||
    gate.reason === 'mortgage_docs_to_property_search' ||
    gate.reason === 'support_other_to_property_search';
  if (fromSide) return true;
  if (isCasualSearchResume(gate.lastUserText)) return true;
  return false;
}

function formatResumeSearchInstruction(lang = 'ru') {
  const code = String(lang || 'ru').slice(0, 2);
  if (code === 'en') {
    return `**CONTINUE SELECTION (global — critical):**
Client wrote a casual human line about the property type («What about villas?», «and the villas?») — anytime in the chat, not only after mortgage.
FORBIDDEN: brochure lecture why villas/apartments are great for investment / yield / holiday guests.
DO: continue the active funnel with ALREADY known criteria. Ask only the NEXT missing step (budget → timeline → cash/mortgage → region → area → shortlist).
Explain investing ONLY if they explicitly ask («tell me about investing in villas», «why are villas good for investment»).
Tone: WhatsApp friend — short warm lines, light emoji ok, do NOT end every short line with a period.`;
  }
  if (code === 'es') {
    return `**CONTINUAR SELECCIÓN (global — crítico):**
El cliente escribió algo casual sobre el tipo («¿Y las villas?») — en cualquier momento del chat, no solo tras hipoteca.
PROHIBIDO: folleto sobre por qué las villas son buenas para invertir.
HAZ: sigue el embudo con criterios YA conocidos. Solo el SIGUIENTE paso faltante.
Explica inversión SOLO si lo piden explícitamente.
Tono WhatsApp — frases cortas, sin punto al final de cada línea corta.`;
  }
  return `**ПРОДОЛЖАЙ ПОДБОР (глобально — критично):**
Клиент написал по-человечески про тип («а что по виллам?», «What about villas?») — в любой момент диалога, не только после ипотеки.
ЗАПРЕЩЕНО: лекция/буклет «виллы отлично подходят для инвестиций / аренды / туристов…».
НУЖНО: продолжить активную ветку с УЖЕ известными критериями. Спроси только СЛЕДУЮЩИЙ недостающий шаг (бюджет → срок → деньги/ипотека → регион → район → подборка).
Рассказ про инвестиции — ТОЛЬКО если явно просят («расскажи про инвестиции в виллы»).
Тон: WhatsApp с другом — коротко, тепло, лёгкий смайлик ок; не точка в конце каждой короткой строки.`;
}

function formatHumanToneExamples(lang = 'ru') {
  const code = String(lang || 'ru').slice(0, 2);
  if (code === 'en') {
    return `**HUMAN TONE — always (every reply):**
BAD (robot): «I offer you the following investment options. A villa in Marbella costs 2.5 million euros. It is suitable for long-term rental.»
GOOD (WhatsApp): «Great! Found a few around Marbella Villa for 2.5M — strong for long-term rental Want to dig into one?»
Rules: short lines; do NOT put a period at the end of every short sentence; friendly, not official; light 🙂 or :) on warm stages; never unsolicited investment lectures.`;
  }
  if (code === 'es') {
    return `**TONO HUMANO — siempre:**
MAL: «Le ofrezco las siguientes opciones de inversión. Una villa en Marbella cuesta 2,5 millones.»
BIEN: «Genial! Tengo opciones por Marbella Villa a 2,5M — buena para alquiler ¿Miramos una?»
Frases cortas, sin punto en cada línea, cercano, emoji suave en etapas cálidas, sin folleto de inversión no pedido.`;
  }
  return `**ЖИВОЙ ТОН — всегда (каждый ответ):**
ПЛОХО (робот): «Я предлагаю вам следующие варианты инвестиций. Вилла в районе Марбелья стоит 2.5 миллиона евро. Она подходит для долгосрочной аренды.»
ХОРОШО (WhatsApp): «Отлично! Нашёл несколько вариантов около Марбельи Вилла за 2.5М — сильный вариант под долгосрочную аренду Хотите разобрать подробнее?»
Правила: короткие строки; не ставь точку в конце каждой короткой фразы; дружелюбно, не официоз; лёгкий 🙂 или :) на тёплых этапах; без непрошеной лекции про инвестиции.`;
}

/** Всегда в system prompt — глобальные правила чата */
function formatGlobalHumanChatRules(lang = 'ru') {
  const code = String(lang || 'ru').slice(0, 2);
  if (code === 'en') {
    return `**GLOBAL CHAT RULES (human WhatsApp — always on):**
1) Sound like a real person texting a client — warm, short, natural. Not a call-centre script, not a brochure, not a robot.
2) Do NOT end every short line with a full stop. Mix fragments, light connectors (great / got it / then…), question at the end.
3) Use at most one 🙂 or :) on warm stages (greeting, confirmations). Mirror the client's emoji if they sent one.
4) Casual lines like «What about villas?» / «and apartments?» = continue the selection funnel with known criteria — NEVER a lecture on why that type is good for investment unless they explicitly ask.
5) One question per message. No «Dear client» / «I offer you the following options».`;
  }
  if (code === 'es') {
    return `**REGLAS GLOBALES DE CHAT (WhatsApp humano — siempre):**
1) Habla como persona en chat — cálido, corto, natural. No script de call center ni folleto.
2) No pongas punto al final de cada línea corta.
3) Máximo un 🙂 o :) en etapas cálidas. Si el cliente envía emoji — duplícalo.
4) Frases como «¿Y las villas?» = seguir el embudo con criterios conocidos — NUNCA folleto de inversión salvo que lo pidan.
5) Una pregunta por mensaje. Sin «Estimado cliente» / «Le ofrezco las siguientes opciones».`;
  }
  return `**ГЛОБАЛЬНЫЕ ПРАВИЛА ЧАТА (живой WhatsApp — всегда):**
1) Пиши как живой человек клиенту в мессенджере — тепло, коротко, естественно. Не скрипт call-центра, не буклет, не робот.
2) Не ставь точку в конце каждой короткой строки подряд. Чередуй короткие фразы, связки («отлично», «понял», «тогда…»), вопрос в конце.
3) На тёплых этапах — максимум один 🙂 или :). Если клиент прислал смайлик — дублируй его.
4) Реплики вроде «а что по виллам?» / «What about villas?» в ЛЮБОЙ момент = продолжай алгоритм подбора с известными критериями — НИКОГДА не читай лекцию «почему виллы для инвестиций», если сами не попросили рассказать.
5) Один вопрос в сообщении. Без «Уважаемый клиент» / «Я предлагаю вам следующие варианты».`;
}

module.exports = {
  wantsInvestmentEducation,
  isCasualSearchResume,
  shouldResumePropertyFunnel,
  formatResumeSearchInstruction,
  formatHumanToneExamples,
  formatGlobalHumanChatRules,
};
