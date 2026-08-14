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
    return `Клиент выбрал *готовый бизнес* или *инвестиционный/девелоперский проект* — тип уже известен, регион ещё НЕ спрашивай.

Задай ОДИН живой вопрос про *сферу бизнеса*. Сформулируй своими словами — как в WhatsApp, 2–4 короткие строки.

${optionsRef}

Как писать клиенту:
- Упомяни направления *естественно в предложении* — через «или», запятые, 2–3 примера + «или свой вариант».
- Можно сгруппировать: «общепит, отель, что-то морское или авто» — не обязательно перечислять все 7.
- Заканчивай простым вопросом: «что Вам ближе?», «какое направление смотрим?» — без «напишите коротко», «достаточно короткого ответа» и подобного.
- ЗАПРЕЩЕНО: маркированный список (•), нумерация 1–7, «стена» из пунктов, копипаст шаблона.

Примеры тона (НЕ копировать дословно):
«Подскажите, что Вам ближе — ресторан, отель, что-то морское вроде яхт или прокат авто? Или другой формат?»
«Какое направление Вам ближе: общепит, гостиница, водный бизнес, девелоперский проект?»

Правила:
- Не показывай объекты и ссылки до ответа про сферу.
- Не переспрашивай бюджет, срок и тип.
- Если клиент уже назвал сферу («ресторан», «яхты», «прокат авто») — коротко подтверди и переходи к региону.
- Тон WhatsApp, обращение на «Вы».`;
  }
  if (code === 'es') {
    return `El cliente eligió *negocio en venta* o *proyecto de inversión* — tipo conocido; aún NO preguntes región.

Una pregunta viva sobre *sector*. Redacta con tus palabras — tono WhatsApp, 2–4 líneas cortas.

${optionsRef}

Cómo escribir al cliente:
- Menciona sectores de forma natural en la frase («restaurante, hotel, náutico o alquiler de coches…»).
- Cierra con una pregunta simple: «¿qué le encaja más?», «¿qué sector le interesa?» — sin «escríbalo brevemente» ni frases similares.
- PROHIBIDO: lista con viñetas, numeración 1–7, muro de puntos, copiar plantilla.

Sin fichas hasta tener sector. No repitas presupuesto/plazo/tipo.`;
  }
  return `Client chose *business for sale* or *investment/development project* — type is known; do NOT ask region yet.

Ask ONE natural *business sector* question — your own wording, WhatsApp tone, 2–4 short lines.

${optionsRef}

How to write to the client:
- Mention sectors naturally in prose («restaurant, hotel, marine/yachts, car rental… or your own idea»).
- End with a simple question: «what fits you best?», «which direction are you leaning toward?» — no «write briefly», «a short reply is enough», etc.
- FORBIDDEN: bullet lists, numbered 1–7 options, wall of items, copy-paste template.

No listings until sector is clear. Do not re-ask budget/timeline/type.`;
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
