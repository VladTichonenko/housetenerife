const LOCATION_KEYWORDS = [
  'las americas',
  'las américas',
  'лас америк',
  'los cristianos',
  'лос кристиан',
  'adeje',
  'адехе',
  'playa de las americas',
  'costa adeje',
  'puerto de la cruz',
  'puerto colon',
  'golf del sur',
  'el medano',
  'medano',
  'santa cruz',
  'la laguna',
  'callao salvaje',
  'playa paraíso',
  'playa paraiso',
  'fanabe',
  'фанабе',
  'torviscas',
  'south',
  'юг',
  'north',
  'север',
  'west',
  'запад',
  'tenerife',
  'тенериф'
];

/**
 * @param {Array<{sender:string,text:string}>} history
 */
function analyzeConversation(history) {
  const userMsgs = (history || []).filter((m) => m.sender === 'user');
  const allUserText = userMsgs.map((m) => m.text).join('\n');
  const lower = allUserText.toLowerCase();
  const lastUser = userMsgs[userMsgs.length - 1]?.text || '';

  const hasPurpose =
    /инвест|invest|доход|аренд|rental|бизнес|business|для жизни|для себя|переезд|relocate|live in|residen/i.test(
      lower
    );
  const hasBudget =
    /€|eur|euro|евро|бюджет|budget|до\s*\d|от\s*\d|\d{2,3}[\s.]?\d{3}|\d+\s*(тыс|k|млн|million)/i.test(
      lower
    );
  const hasLocation = LOCATION_KEYWORDS.some((k) => lower.includes(k));
  const hasType =
    /вилл|villa|апартамент|apartment|penthouse|пентхаус|студи|studio|таунхаус|townhouse|дом|house|коммерч|commercial|отел|hotel/i.test(
      lower
    );
  const wantsListings =
    /покаж|подбер|вариант|объект|каталог|ссылк|show me|options|listings|properties/i.test(lower);
  const userTurns = userMsgs.length;

  let stage = 'FIRST_CONTACT';

  if ((hasBudget && hasLocation) || wantsListings || (hasBudget && hasType && userTurns >= 1)) {
    stage = 'SHOW_LISTINGS';
  } else if (userTurns <= 1 && !hasPurpose && !hasBudget && !hasLocation) {
    stage = 'FIRST_CONTACT';
  } else if (!hasPurpose) {
    stage = 'NEED_PURPOSE';
  } else if (!hasBudget) {
    stage = 'NEED_BUDGET';
  } else if (!hasLocation) {
    stage = 'NEED_LOCATION';
  } else {
    stage = 'REFINE';
  }

  if (userTurns >= 3 && hasBudget) {
    stage = 'SHOW_LISTINGS';
  }

  return {
    userTurns,
    lastUser,
    allUserText,
    hasPurpose,
    hasBudget,
    hasLocation,
    hasType,
    wantsListings,
    stage,
    stageInstruction: stageInstructions[stage] || stageInstructions.REFINE
  };
}

const stageInstructions = {
  FIRST_CONTACT: `Первый контакт. Тёплое живое приветствие (не шаблон «здравствуйте, чем помочь»). Представься: House Tenerife, помогаешь с недвижимостью на Тенерифе. Один вопрос: для жизни или как инвестиция/доход? Если клиент уже написал запрос — отзеркаль его словами и задай следующий логичный вопрос (бюджет). Объекты пока НЕ показывай.`,

  NEED_PURPOSE: `Уточни цель одним вопросом: дом для себя и семьи или инвестиция/аренда/бизнес? Коротко объясни, зачем спрашиваешь («чтобы подобрать район и тип»). Без списка объектов.`,

  NEED_BUDGET: `Спроси бюджет одним вопросом. Дай ориентиры: до €300k / €300–600k / от €600k / «пока смотрю». Если клиент назвал виллу или апартаменты — упомяни это. Объекты пока не показывай, если бюджет ещё не ясен.`,

  NEED_LOCATION: `Спроси район или предпочтения по локации на Тенерифе (юг у океана, Costa Adeje, Los Cristianos, Las Américas, тихий запад и т.д.). Один вопрос. Можно предложить 2–3 района на выбор.`,

  SHOW_LISTINGS: `Достаточно данных — покажи 2–3 объекта ИЗ КАТАЛОГА ниже (название, цена, ссылка). К каждому — одна фраза «почему вам подходит». В конце один вопрос: какой ближе / что поменять (дешевле, другой район, больше спален).`,

  REFINE: `Клиент уже в диалоге. Ответь на его последнюю реплику по сути. Если критерии яснее — обнови подборку (2–3 объекта из каталога). Если критериев мало — один уточняющий вопрос (бюджет, район или must-have). Не повторяй уже заданные вопросы.`
};

function buildCatalogSearchQuery(history) {
  const userTexts = (history || [])
    .filter((m) => m.sender === 'user')
    .map((m) => m.text)
    .join(' ');
  return userTexts.trim();
}

/**
 * @param {string} text
 * @returns {{ minPrice: number|null, maxPrice: number|null }}
 */
function extractBudgetRange(text) {
  const s = String(text || '').toLowerCase().replace(/\s/g, ' ');
  let minPrice = null;
  let maxPrice = null;

  const range = s.match(/от\s*(\d[\d\s.]*)\s*(?:до|–|-)\s*(\d[\d\s.]*)/i);
  if (range) {
    minPrice = parseMoneyToken(range[1]);
    maxPrice = parseMoneyToken(range[2]);
    return { minPrice, maxPrice };
  }

  const upTo = s.match(/(?:до|макс|не\s*более|up\s*to)\s*(\d[\d\s.]*)/i);
  if (upTo) maxPrice = parseMoneyToken(upTo[1]);

  const from = s.match(/(?:от|from|минимум)\s*(\d[\d\s.]*)/i);
  if (from) minPrice = parseMoneyToken(from[1]);

  const plain = s.match(/(\d{2,3})[\s.]?(\d{3})\s*(?:€|eur|евро)?/);
  if (plain && !maxPrice && !minPrice) {
    const mid = parseInt(plain[1] + plain[2], 10);
    minPrice = Math.round(mid * 0.75);
    maxPrice = Math.round(mid * 1.25);
  }

  return { minPrice, maxPrice };
}

function parseMoneyToken(raw) {
  let n = String(raw || '').replace(/[^\d]/g, '');
  if (!n) return null;
  let v = parseInt(n, 10);
  if (v < 1000) v *= 1000;
  if (v < 50000) v *= 1000;
  return v;
}

module.exports = {
  analyzeConversation,
  buildCatalogSearchQuery,
  extractBudgetRange,
  LOCATION_KEYWORDS
};
