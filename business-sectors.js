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
    // Не «отел» внутри «хотел» — только отель/гостиница/hotel…
    detect: /(?:^|[^\p{L}])(?:отел|гостиниц|гостинич|мини[\s-]?отел)|hotel|hostel|хостел|apart[\s-]?hotel|hospitality|\bbnb\b|resort/iu,
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

function itemTitleBlob(item) {
  return [
    item?.title,
    item?.titles?.ru,
    item?.titles?.en,
    item?.titles?.es,
    item?.url,
    item?.urls?.ru,
    item?.urls?.en,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function classifyBusinessSectorText(text) {
  if (/аптек|pharmacy|farmacia/.test(text)) return 'commercial_building';
  if (/азс|gas\s*station|заправ/.test(text)) return 'commercial_building';
  if (/аренд[аы]\s+авто|car\s+rent|прокат\s+авто|rent\s+a\s+car|автопрокат|buggy|бaggy|гидроцикл/.test(text)) {
    return 'auto_mobility';
  }
  if (/автосервис|car\s+wash|мойк|garage|автомоб|automotive|motorbike|мото|scooter|скутер|такси|taxi/.test(text)) {
    return 'auto_mobility';
  }
  if (/(?:^|[^\p{L}])(?:отел|гостиниц|мини[\s-]?отел)|hotel|hostel|хостел|apart[\s-]?hotel|\bbnb\b|resort/iu.test(text)) {
    return 'hotel_hospitality';
  }
  if (/ресторан|restaurant|кафе|cafe|café|\bbar\b|бар\b|паб|pub|tapas|pizzer|пицц|бистро|bistro|night\s*club|ночной\s+клуб|discoteca|дискотек|общепит|gastro|столов|horeca/.test(text)) {
    return 'restaurant_cafe_bar';
  }
  if (/яхт|yacht|катер|лодк|boat|marina|марин|jet[\s-]?ski|jetski|дайв|dive|diving|водн|nautica|лодочн|экскурсион|excursion|причал|zodiac/.test(text)) {
    return 'marine_water';
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
  return null;
}

function classifyItemBusinessSector(item) {
  // Заголовок и URL задают тип бизнеса надёжнее длинного описания:
  // ресторан у моря не становится «морским бизнесом» из-за слов в тексте.
  const titleSector = classifyBusinessSectorText(itemTitleBlob(item));
  if (titleSector) return titleSector;

  const textSector = classifyBusinessSectorText(itemTextBlob(item));
  if (textSector) return textSector;

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

function formatSectorLabel(sectorIds, lang = 'ru') {
  const code = normalizeLang(lang);
  const ids = Array.isArray(sectorIds) ? sectorIds : [];
  return ids
    .map((id) => {
      const sector = SECTORS.find((s) => s.id === id);
      return sector ? sector.label[code] || sector.label.ru : id;
    })
    .filter(Boolean)
    .join(', ');
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

function formatSectorOptionsList(lang = 'ru') {
  const code = normalizeLang(lang);
  const lines = SECTORS.filter((s) => s.id !== 'other').map((s, i) => {
    const label = s.label[code] || s.label.ru;
    return `${i + 1}. ${label}`;
  });
  lines.push(`${lines.length + 1}. ${SECTORS.find((s) => s.id === 'other').label[code] || 'другое'}`);
  return lines.join('\n');
}

/** Короткие названия сфер для живого вопроса клиенту (все направления). */
function formatSectorOptionsForClient(lang = 'ru') {
  const code = normalizeLang(lang);
  if (code === 'en') {
    return 'restaurant/café/bar, hotel/apart-hotel, marine & water (yachts, jet-ski, diving), car rental/auto, development/investment project, commercial premises/office/warehouse, or another format';
  }
  if (code === 'es') {
    return 'restaurante/café/bar, hotel/apart-hotel, náutico (yates, jet-ski, buceo), alquiler de coches/auto, proyecto de inversión/desarrollo, local/oficina/nave, u otro formato';
  }
  return 'ресторан/кафе/бар, отель/apart-hotel, море и водный бизнес (яхты, jet-ski, дайвинг), автопрокат/автосервис, девелоперский/инвест-проект, коммерческое помещение/офис/склад, или другой формат';
}

/** Детерминированный вопрос про сферу — все направления, без навязывания одной. */
function buildBusinessSectorAskReply(lang = 'ru') {
  const code = normalizeLang(lang);
  const options = formatSectorOptionsForClient(code);
  if (code === 'en') {
    return `Great — ready-made business. Which sector fits you best: ${options}?`;
  }
  if (code === 'es') {
    return `Perfecto — negocio en venta. ¿Qué sector le encaja más: ${options}?`;
  }
  return `Отлично, готовый бизнес. Какая сфера Вам ближе: ${options}?`;
}

function getBusinessSectorOptionsReference(lang = 'ru') {
  const code = normalizeLang(lang);
  const labels = SECTORS.map((s) => s.label[code] || s.label.ru);
  if (code === 'en') {
    return `All sectors (MUST name them all to the client in the question):\n${labels.map((l) => `- ${l}`).join('\n')}`;
  }
  if (code === 'es') {
    return `Todos los sectores (DEBES nombrarlos todos al cliente en la pregunta):\n${labels.map((l) => `- ${l}`).join('\n')}`;
  }
  return `Все сферы (ОБЯЗАТЕЛЬНО назови клиенту ВСЕ в вопросе):\n${labels.map((l) => `- ${l}`).join('\n')}`;
}

function getBusinessSectorStageInstruction(lang = 'ru') {
  const code = normalizeLang(lang);
  const optionsRef = getBusinessSectorOptionsReference(code);
  const clientOptions = formatSectorOptionsForClient(code);

  if (code === 'ru') {
    return `Клиент выбрал *готовый бизнес* или *инвест-проект* — тип уже известен.

АЛГОРИТМ (строго):
1) Спроси сферу бизнеса.
2) В вопросе назови *ВСЕ* направления: ${clientOptions}.
3) Регион, локации и подборку в ЭТОМ ответе НЕ спрашивай и НЕ предлагай.
4) НЕ выбирай сферу за клиента (запрещено: «могу предложить отельный / морской…»).

${optionsRef}

Образец:
«Отлично, готовый бизнес. Какая сфера Вам ближе: ${clientOptions}?»

ЗАПРЕЩЕНО: навязывать одну сферу, спрашивать регион, показывать объекты/ссылки, переспрашивать бюджет/срок/тип.
Если клиент уже назвал сферу — коротко подтверди и только тогда спрашивай регион.
Тон WhatsApp, на «Вы».`;
  }
  if (code === 'es') {
    return `El cliente eligió *negocio en venta* o *proyecto de inversión*.

ALGORITMO:
1) Pregunta el sector.
2) Nombra TODOS: ${clientOptions}.
3) NO preguntes región ni ofrezcas fichas en ESTA respuesta.
4) NO asumas un sector (prohibido: «puedo ofrecer hotelero / náutico…»).

${optionsRef}

Ejemplo: «Perfecto — negocio en venta. ¿Qué sector le encaja más: ${clientOptions}?»`;
  }
  return `Client chose *business for sale* or *investment project*.

ALGORITHM:
1) Ask the business sector.
2) Name ALL options: ${clientOptions}.
3) Do NOT ask region or show listings in THIS reply.
4) Do NOT assume one sector (forbidden: “I can offer hotel / marine…”).

${optionsRef}

Example: “Great — ready-made business. Which sector fits you best: ${clientOptions}?”`;
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

/** Ответ модели «убежал» со сферы — подменяем на корректный вопрос. */
function replySkipsBusinessSectorAsk(reply) {
  const t = String(reply || '');
  if (!t.trim()) return true;
  const assumesSector =
    /могу предложить.{0,40}(?:отель|гостинич|морск|яхт|ресторан|автопрокат)|варианты в сфере (?:отель|морск|ресторан)|по инвестициям.{0,60}(?:отельн|гостинич|морск)/i.test(
      t
    );
  const asksRegionTooEarly =
    /(?:в каком|какой)\s+регион|Тенерифе,\s*Дуба|в какой\s+(?:регион|город)|which\s+region|qué\s+regi[oó]n/i.test(
      t
    ) && !/(?:сфера|направлени|sector|restauran|отель|яхт|авто)/i.test(t);
  const namesTooFewSectors =
    assumesSector ||
    (asksRegionTooEarly && !/ресторан.{0,80}отель.{0,80}(?:мор|яхт|авто)/i.test(t));
  return namesTooFewSectors || assumesSector || asksRegionTooEarly;
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
  formatSectorOptionsForClient,
  buildBusinessSectorAskReply,
  getBusinessSectorOptionsReference,
  getBusinessSectorStageInstruction,
  itemMatchesBusinessSectors,
  scoreBusinessSectorFit,
  filterByBusinessSectors,
  replySkipsBusinessSectorAsk,
};
