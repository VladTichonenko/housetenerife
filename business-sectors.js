'use strict';

const { getItemPropertyCategories, detectPropertyTypePreference } = require('./property-types');

/** 7 секторов — покрывают ~95% бизнеса и инвест-проектов в каталоге */
const SECTORS = [
  {
    id: 'restaurant_cafe_bar',
    label: {
      ru: 'ресторан / кафе / бар / общепит',
      en: 'restaurant / café / bar / F&B',
      es: 'restaurante / café / bar / hostelería',
    },
    detect: /ресторан|restaurant|кафе|cafe|café|\bbar\b|бар\b|паб|pub|общепит|horeca|gastro|tapas|pizzer|пицц|бистро|bistro|night\s*club|ночной\s+клуб|discoteca|дискотек|hosteler|столов/i,
  },
  {
    id: 'hotel_hospitality',
    label: {
      ru: 'отель / apart-hotel / гостиничный бизнес',
      en: 'hotel / apart-hotel / hospitality',
      es: 'hotel / apart-hotel / hostelería',
    },
    detect: /отел|hotel|hostel|хостел|apart[\s-]?hotel|гостиниц|гостинич|hospitality|bnb|resort|мини[\s-]?отел/i,
  },
  {
    id: 'marine_water',
    label: {
      ru: 'море и водный бизнес — яхты, катера, экскурсии, jet-ski, дайвинг',
      en: 'marine & water — yachts, boats, tours, jet-ski, diving',
      es: 'náutico y mar — yates, barcos, excursiones, jet-ski, buceo',
    },
    detect: /яхт|yacht|катер|лодк|boat|marina|марин|jet[\s-]?ski|jetski|дайв|dive|diving|водн|nautica|лодочн|экскурсион|excursion|причал|гидроцикл|zodiac|sea\s+club|морск|море/i,
  },
  {
    id: 'auto_mobility',
    label: {
      ru: 'авто — прокат, багги, сервис, такси',
      en: 'auto — rental, buggies, service, taxi',
      es: 'auto — alquiler, buggies, taller, taxi',
    },
    detect: /аренд[аы]\s+авто|car\s+rent|rent\s+a\s+car|автопрокат|прокат\s+авто|автосервис|car\s+wash|мойк|автомоб|automotive|motorbike|мото|scooter|скутер|такси|taxi|buggy|бaggy|гидроцикл|(?:^|\s)прокат(?:\s|$)/i,
  },
  {
    id: 'development_project',
    label: {
      ru: 'девелоперский / инвест-проект — стройка, реновация, портфель',
      en: 'development / investment project — build, renovation, portfolio',
      es: 'proyecto de inversión / desarrollo — obra, renovación, cartera',
    },
    detect: /девелоп|develop|development|инвест[\s-]*проект|investment\s+project|renovation|реновац|реконструк|turnkey|под\s+стройк|building\s+permit|лиценз.*стро|участок.*проект|land.*project|terreno|flip|padel\s+center|спорт.*центр|стройк/i,
  },
  {
    id: 'commercial_building',
    label: {
      ru: 'коммерческое здание / офис / склад / помещение',
      en: 'commercial building / office / warehouse / premises',
      es: 'edificio comercial / oficina / nave / local',
    },
    detect: /коммерческ|commercial\s+prem|офис|office|склад|warehouse|здание|building|помещен|local\s+comercial|centro\s+comercial|торговый\s+центр|cowork|business\s+cent|на\s+продаже\s+здан|коммерц|склад/i,
  },
  {
    id: 'other',
    label: {
      ru: 'другое — опишу своими словами',
      en: 'other — I will describe',
      es: 'otro — lo describo yo',
    },
    detect: /^(?:другое|other|otro|прочее|не\s+знаю|не\s+определил|anything|open|surprise\s+me|не\s+важно|любой|all\s+options)$/i,
  },
];

const SECTOR_IDS = SECTORS.map((s) => s.id);

function normalizeLang(lang) {
  return String(lang || 'ru').toLowerCase().slice(0, 2);
}

function needsBusinessSectorQuestion(propertyTypes) {
  if (!propertyTypes?.length) return false;
  return propertyTypes.some((t) => t === 'business' || t === 'investment');
}

function itemTextBlob(item) {
  return [
    item?.title,
    item?.titles?.ru,
    item?.titles?.en,
    item?.titles?.es,
    item?.description,
    item?.descriptions?.ru,
    item?.descriptions?.en,
    item?.overview,
    item?.overviews?.ru,
    item?.url,
    item?.urls?.ru,
    item?.urls?.en,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function classifyItemBusinessSector(item) {
  const text = itemTextBlob(item);

  if (/аптек|pharmacy|farmacia/.test(text)) return 'commercial_building';
  if (/азс|gas\s*station|заправ/.test(text)) return 'commercial_building';
  if (/аренд[аы]\s+авто|car\s+rent|прокат\s+авто|rent\s+a\s+car|автопрокат|buggy|бaggy|гидроцикл/.test(text)) {
    return 'auto_mobility';
  }
  if (/автосервис|car\s+wash|мойк|garage|автомоб|automotive|motorbike|мото|scooter|скутер|такси|taxi/.test(text)) {
    return 'auto_mobility';
  }
  if (/яхт|yacht|катер|лодк|boat|marina|марин|jet[\s-]?ski|jetski|дайв|dive|diving|водн|nautica|лодочн|экскурсион|excursion|причал|zodiac/.test(text)) {
    return 'marine_water';
  }
  if (/отел|hotel|hostel|хостел|apart[\s-]?hotel|гостиниц|bnb|resort|мини[\s-]?отел/.test(text)) {
    return 'hotel_hospitality';
  }
  if (/ресторан|restaurant|кафе|cafe|café|\bbar\b|бар\b|паб|pub|tapas|pizzer|пицц|бистро|bistro|night\s*club|ночной\s+клуб|discoteca|дискотек|общепит|gastro|столов|horeca/.test(text)) {
    return 'restaurant_cafe_bar';
  }
  if (/супермаркет|supermarket|minimarket|магазин|shop\b|store\b|boutique|ритейл|retail|торгов|kiosk|киоск|tabaco|салон\s+красот|beauty|spa\b|wellness|фитнес|fitness|gym/.test(text)) {
    return 'commercial_building';
  }
  if (/инвест.*проект|investment\s+project|девелоп|develop|development|renovation|реновац|реконструк|turnkey|padel|спорт.*центр|(\d+\s*(?:квартир|apart|таунhaus|townhouse|вилл|villa))|здание\s+с\s+\d+|building\s+with\s+\d+|портфел|portfolio/.test(text)) {
    return 'development_project';
  }
  if (/коммерческ|commercial|офис|office|склад|warehouse|здание|building|помещен|local\s+comercial|cowork|business\s+cent|склад/.test(text)) {
    return 'commercial_building';
  }
  if (/ферм|farm|agricult|vin[ey]ard|виноград|winery|финка|finca/.test(text)) {
    return 'other';
  }

  const cats = getItemPropertyCategories(item);
  if (cats.includes('investment')) return 'development_project';
  if (cats.includes('business')) return 'other';
  return 'other';
}

function sameTypeList(a, b) {
  const left = [...(a || [])].sort().join(',');
  const right = [...(b || [])].sort().join(',');
  return left.length > 0 && left === right;
}

function detectSectorByNumber(text) {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(/^(\d)\s*[.)]?/);
  if (!match) return null;
  const idx = parseInt(match[1], 10);
  const ordered = SECTORS.filter((s) => s.id !== 'other');
  if (idx >= 1 && idx <= ordered.length) return ordered[idx - 1].id;
  if (idx === ordered.length + 1) return 'other';
  return null;
}

function detectBusinessSectorPreference(text, lang = 'ru') {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();
  if (!lower) return { sectors: [], hasSector: false, label: '', isOther: false };

  const numbered = detectSectorByNumber(raw);
  if (numbered) {
    return {
      sectors: [numbered],
      hasSector: true,
      label: formatSectorLabel([numbered], lang),
      isOther: numbered === 'other',
    };
  }

  const matched = [];
  for (const sector of SECTORS) {
    if (sector.id === 'other') continue;
    if (sector.detect.test(lower)) matched.push(sector.id);
  }

  const isOther =
    /^(?:\d+\s*[.)]?\s*)?(?:другое|other|otro|прочее|не\s+знаю|не\s+определил|anything|open|surprise|не\s+важно|любой|all\s+options|не\s+принципиально)/i.test(
      lower.trim()
    ) ||
    (/не\s+(?:только|важно)|any\s+sector/i.test(lower) && !matched.length);

  if (isOther && !matched.length) {
    return {
      sectors: ['other'],
      hasSector: true,
      label: formatSectorLabel(['other'], lang),
      isOther: true,
    };
  }

  if (matched.length) {
    const unique = [...new Set(matched)];
    return {
      sectors: unique,
      hasSector: true,
      label: formatSectorLabel(unique, lang),
      isOther: unique.length === 1 && unique[0] === 'other',
    };
  }

  return { sectors: [], hasSector: false, label: '', isOther: false };
}

/**
 * Сфера из истории: последняя явная реплика, но только после последнего выбора типа.
 * @param {Array<{sender:string,text:string}>} history
 * @param {string} lang
 * @param {{ propertyTypes?: string[] }} options
 */
function resolveBusinessSectorPreference(history, lang = 'ru', options = {}) {
  const propertyTypes = options.propertyTypes || [];
  const userTexts = (history || [])
    .filter((m) => m?.sender === 'user' && m.text)
    .map((m) => String(m.text));
  const empty = { sectors: [], hasSector: false, label: '', isOther: false };
  if (!userTexts.length) return empty;

  const lastPref = detectBusinessSectorPreference(userTexts[userTexts.length - 1], lang);
  if (lastPref.hasSector) return lastPref;

  let contextStart = 0;
  if (propertyTypes.length) {
    for (let i = userTexts.length - 1; i >= 0; i -= 1) {
      const typePref = detectPropertyTypePreference(userTexts[i], lang);
      if (typePref.hasType && sameTypeList(typePref.types, propertyTypes)) {
        contextStart = i;
        break;
      }
    }
  }

  for (let i = userTexts.length - 2; i >= contextStart; i -= 1) {
    const pref = detectBusinessSectorPreference(userTexts[i], lang);
    if (pref.hasSector) return pref;
  }

  return empty;
}

function formatSectorLabel(sectorIds, lang = 'ru') {
  const code = normalizeLang(lang);
  const labels = (sectorIds || [])
    .map((id) => SECTORS.find((s) => s.id === id)?.label?.[code] || SECTORS.find((s) => s.id === id)?.label?.ru)
    .filter(Boolean);
  return labels.join('; ');
}

function formatSectorOptionsList(lang = 'ru') {
  const code = normalizeLang(lang);
  const lines = SECTORS.filter((s) => s.id !== 'other').map((s, i) => {
    const label = s.label[code] || s.label.ru;
    return `${i + 1}. ${label}`;
  });
  lines.push(`${lines.length + 1}. ${SECTORS.find((s) => s.id === 'other').label[code] || 'другое'}`);
  return lines.join('\n');
}

/** Внутренний справочник сфер для промпта — НЕ отдавать клиенту списком. */
function getBusinessSectorOptionsReference(lang = 'ru') {
  const code = normalizeLang(lang);
  const labels = SECTORS.map((s) => s.label[code] || s.label.ru);
  if (code === 'en') {
    return `Reference sectors (for you only — weave into natural text, never dump as a list):
${labels.map((l) => `- ${l}`).join('\n')}`;
  }
  if (code === 'es') {
    return `Sectores de referencia (solo para ti — intégralos en texto natural, nunca como lista):
${labels.map((l) => `- ${l}`).join('\n')}`;
  }
  return `Справочник сфер (только для тебя — вплетай в живой текст, клиенту списком НЕ выдавай):
${labels.map((l) => `- ${l}`).join('\n')}`;
}

function getBusinessSectorStageInstruction(lang = 'ru') {
  const code = normalizeLang(lang);
  const optionsRef = getBusinessSectorOptionsReference(code);

  if (code === 'ru') {
    return `Клиент выбрал *готовый бизнес* или *инвестиционный/девелоперский проект* — тип уже известен.

ОБЯЗАТЕЛЬНО: один вопрос про *сферу бизнеса*. Регион / локации / подборку в ЭТОМ ответе НЕ спрашивай и НЕ предлагай.

${optionsRef}

Как писать клиенту:
- Упомяни 3–4 направления *естественно* в одном предложении (ресторан/общепит, отель, авто, коммерция…) + «или свой вариант».
- НЕ выбирай и НЕ навязывай одну сферу от себя (запрещено: «по морскому бизнесу могу подобрать…», «давайте посмотрим яхты» и т.п.).
- НЕ сужай разговор до одной отрасли, пока клиент сам не ответил.
- Заканчивай: «что Вам ближе?» / «какое направление смотрим?»
- ЗАПРЕЩЕНО: маркированный список (•), нумерация 1–7, «стена» из пунктов, регион в этом же сообщении, объекты и ссылки.

Пример тона (НЕ копировать дословно):
«Отлично, готовый бизнес. Какая сфера Вам ближе — ресторан или кафе, отель, прокат авто, коммерческое помещение — или другой формат?»

Правила:
- Не переспрашивай бюджет, срок и тип.
- Если клиент уже назвал сферу («ресторан», «яхты», «прокат авто») — коротко подтверди и только тогда спрашивай регион.
- Тон WhatsApp, обращение на «Вы».`;
  }
  if (code === 'es') {
    return `El cliente eligió *negocio en venta* o *proyecto de inversión* — tipo conocido.

OBLIGATORIO: una pregunta sobre *sector*. En ESTA respuesta NO preguntes región ni ofrezcas fichas.

${optionsRef}

Cómo escribir:
- Menciona 3–4 sectores de forma natural (restaurante, hotel, auto, local comercial…) + «u otro formato».
- NO asumas ni empujes un solo sector (prohibido: «en náutico puedo seleccionar…»).
- Cierra: «¿qué le encaja más?»
- PROHIBIDO: lista 1–7, región en el mismo mensaje, fichas/enlaces.

Sin repetir presupuesto/plazo/tipo.`;
  }
  return `Client chose *business for sale* or *investment/development project* — type is known.

MUST: ask ONE *business sector* question. In THIS reply do NOT ask region and do NOT offer listings.

${optionsRef}

How to write:
- Mention 3–4 sectors naturally (restaurant/F&B, hotel, auto rental, commercial premises…) + “or another format”.
- Do NOT assume or push one sector (forbidden: “for marine/yachts I can shortlist…”).
- End with: “what fits you best?”
- FORBIDDEN: numbered 1–7 list, region in the same message, property links.

Do not re-ask budget/timeline/type.`;
}

function itemMatchesBusinessSectors(item, sectorIds) {
  if (!sectorIds?.length || sectorIds.includes('other')) return true;
  const itemSector = classifyItemBusinessSector(item);
  if (sectorIds.includes(itemSector)) return true;
  if (itemSector === 'other' && sectorIds.length > 1) return false;
  return false;
}

function scoreBusinessSectorFit(item, sectorIds) {
  if (!sectorIds?.length || sectorIds.includes('other')) return 0;
  const itemSector = classifyItemBusinessSector(item);
  if (sectorIds.includes(itemSector)) return 18;
  return -12;
}

function filterByBusinessSectors(ranked, sectorIds, options = {}) {
  if (!sectorIds?.length || sectorIds.includes('other')) return ranked;
  const filtered = ranked.filter((r) => itemMatchesBusinessSectors(r.item, sectorIds));
  if (filtered.length) return filtered;
  if (options.allowSectorFallback) return ranked;
  return filtered;
}

module.exports = {
  SECTORS,
  SECTOR_IDS,
  needsBusinessSectorQuestion,
  detectBusinessSectorPreference,
  resolveBusinessSectorPreference,
  classifyItemBusinessSector,
  formatSectorLabel,
  formatSectorOptionsList,
  getBusinessSectorOptionsReference,
  getBusinessSectorStageInstruction,
  itemMatchesBusinessSectors,
  scoreBusinessSectorFit,
  filterByBusinessSectors,
};
