'use strict';

const fs = require('fs');
const path = require('path');
const { findItemByUrl, findItemByPropertyId } = require('./property-share');
const { getLocalizedItem, normalizeLang } = require('./property-catalog');

function resolveStorePath() {
  if (process.env.PROPERTY_INTEREST_PATH) return process.env.PROPERTY_INTEREST_PATH;
  const sessionPath = process.env.SESSION_PATH;
  if (sessionPath && path.isAbsolute(sessionPath)) {
    return path.join(path.dirname(sessionPath), 'property-interests.json');
  }
  return path.join(__dirname, 'data', 'property-interests.json');
}

const STORE_PATH = resolveStorePath();

const INTEREST_RE =
  /(?:нрав|понрав|интересует|интересно|подходит|выбира|этот вариант|ближе|классн|отличн|беру|берём|хочу этот|смотрим этот|про этот)/i;
const INTEREST_EN_RE =
  /(?:like this|interested|i prefer|this one|closer|looks good|want this)/i;
const INTEREST_ES_RE = /(?:me gusta|interesa|prefiero|este)/i;
const INTEREST_PL_RE = /(?:podoba|interesuje|wybieram|ten wariant|bliższ|świetn|chcę t[eę]n)/i;
const INTEREST_NL_RE = /(?:leuk|interesse|deze|past beter|mooi|wil deze)/i;
const ORDINAL_RE =
  /(?:перв|1-?й|втор|2-?й|трет|3-?й|четв|4-?й|пят|5-?й|first|second|third|1st|2nd|3rd|pierwsz|drugi|derde|eerste|tweede|(?:^|[^\d])[1-5](?:\s*(?:-?й)?\s*(?:вариант|объект|option))?)/i;

const URL_PATTERNS = [
  /https?:\/\/(?:www\.)?housetenerife\.eu(?:\/(?:ru|es|en|de|fr|pl|nl))?\/property\/[^\s<>\])"'}]+/gi,
  /https?:\/\/[^\s]+\/p\/(HZ?[A-Za-z0-9]+)/gi
];

function ensureDataDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(STORE_PATH)) return { chats: {}, updatedAt: null };
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return {
      chats: raw.chats && typeof raw.chats === 'object' ? raw.chats : {},
      updatedAt: raw.updatedAt || null,
    };
  } catch (e) {
    console.warn('⚠️ property-interests.json:', e.message);
    return { chats: {}, updatedAt: null };
  }
}

function saveStore(store) {
  ensureDataDir();
  const next = { chats: store.chats, updatedAt: new Date().toISOString() };
  fs.writeFileSync(STORE_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function propertyToPublic(item, lang = 'ru', source = 'mentioned') {
  if (!item) return null;
  const l = normalizeLang(lang);
  const loc = getLocalizedItem(item, l);
  return {
    id: item.id,
    title: loc.title || item.title || item.id,
    price: loc.price || item.price || null,
    siteUrl: loc.url || item.url || '',
    overview: loc.overview || null,
    source,
    interestedAt: new Date().toISOString(),
  };
}

function resolvePropertyFromToken(token) {
  if (!token) return null;
  const t = String(token).replace(/[.,;:!?)]+$/, '');
  let item = findItemByPropertyId(t);
  if (item) return item;
  if (/^https?:\/\//i.test(t)) {
    item = findItemByUrl(t);
    if (item) return item;
  }
  item = findItemByUrl(`https://housetenerife.eu/property/${t}`);
  if (item) return item;
  item = findItemByUrl(`https://housetenerife.eu/ru/property/${t}`);
  return item || null;
}

function extractPropertyItemsFromText(text) {
  const items = [];
  const seen = new Set();
  const s = String(text || '');

  const propRe =
    /https?:\/\/(?:www\.)?housetenerife\.eu(?:\/(?:ru|es|en|de|fr|pl|nl))?\/property\/[^\s<>\])"'}]+/gi;
  let m;
  while ((m = propRe.exec(s))) {
    const item = findItemByUrl(m[0].replace(/[.,;:!?)]+$/, ''));
    if (!item) continue;
    const key = String(item.id || item.url || m[0]).toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  const proxyRe = /https?:\/\/[^\s]+\/p\/(HZ?[A-Za-z0-9]+)/gi;
  while ((m = proxyRe.exec(s))) {
    const item = findItemByPropertyId(m[1]);
    if (!item) continue;
    const key = String(item.id || item.url).toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  // Голый HZ123 в тексте
  const hzRe = /\b(HZ\d{2,6})\b/gi;
  while ((m = hzRe.exec(s))) {
    const item = findItemByPropertyId(m[1]);
    if (!item) continue;
    const key = String(item.id).toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  return items;
}

function extractPropertyIdsFromText(text) {
  return extractPropertyItemsFromText(text)
    .map((item) => item.id)
    .filter(Boolean)
    .map((id) => String(id).toUpperCase());
}

/**
 * Блок для промпта ИИ: карточка объекта, который клиент прислал ссылкой.
 */
function formatLinkedPropertiesForPrompt(items, lang = 'ru') {
  if (!items?.length) return '';
  const l = normalizeLang(lang);
  const { getShareUrl } = require('./property-share');
  const { getItemPropertyCategories, formatDetectedTypes } = require('./property-types');
  const { getPrimaryMacroRegion, formatRegionLabel } = require('./catalog-regions');
  const { detectMicroAreas } = require('./location-matching');

  const header =
    l === 'es'
      ? '**OBJETO POR ENLACE DEL CLIENTE (datos del catálogo — descríbelo, no inventes):**'
      : l === 'en'
        ? '**PROPERTY FROM CLIENT LINK (catalog data — describe it, do not invent):**'
        : l === 'de'
          ? '**OBJEKT AUS KUNDEN-LINK (Katalogdaten — beschreiben, nicht erfinden):**'
          : l === 'fr'
            ? '**BIEN VIA LIEN CLIENT (données catalogue — décrire, ne pas inventer):**'
            : l === 'pl'
              ? '**OFERTA Z LINKA KLIENTA (dane z katalogu — opisz, nie wymyślaj):**'
              : l === 'nl'
                ? '**OBJECT VIA KLANTLINK (catalogusgegevens — beschrijf, niet verzinnen):**'
                : '**ОБЪЕКТ ПО ССЫЛКЕ КЛИЕНТА (данные из каталога — расскажи по ним, не выдумывай):**';

  const lines = items.slice(0, 3).map((item, i) => {
    const loc = getLocalizedItem(item, l);
    const share = getShareUrl(item, l) || loc.url || item.url || '';
    const cats = getItemPropertyCategories(item);
    const typeNote = cats.length ? formatDetectedTypes(cats, l) : '';
    const regionId = getPrimaryMacroRegion(item);
    const regionNote = regionId ? formatRegionLabel([regionId], l) : '';
    const micro = detectMicroAreas(
      [loc.title, loc.overview, share, item.url].filter(Boolean).join(' '),
      l
    );
    const areaNote = micro.hasSpecific ? micro.label : '';
    const desc = String(loc.description || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 520);
    const overview = String(loc.overview || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
    return [
      `${i + 1}. ${loc.title || item.title || item.id || 'Object'}`,
      `   ID: ${item.id || '—'}`,
      `   Цена / Price: ${loc.price || item.price || '—'}`,
      typeNote ? `   Тип / Type: ${typeNote}` : null,
      regionNote ? `   Регион / Region: ${regionNote}` : null,
      areaNote ? `   Район / Area: ${areaNote}` : null,
      overview ? `   Overview: ${overview}` : null,
      desc ? `   Описание: ${desc}${desc.length >= 520 ? '…' : ''}` : null,
      `   URL: ${share}`
    ]
      .filter(Boolean)
      .join('\n');
  });

  return `\n\n${header}\n${lines.join('\n\n')}\n`;
}

function userMessageHasPropertyLink(text) {
  return /housetenerife\.eu(?:\/(?:ru|es|en|de|fr|pl|nl))?\/property\//i.test(String(text || '')) ||
    /\/p\/HZ?\d+/i.test(String(text || '')) ||
    /\bHZ\d{2,6}\b/i.test(String(text || ''));
}

function getLinkedPropertyStageInstruction(lang = 'ru') {
  const code = String(lang || 'ru').slice(0, 2).toLowerCase();
  if (code === 'es') {
    return `El cliente envió un enlace a un inmueble. En el bloque «OBJETO POR ENLACE» están los datos del catálogo.
OBLIGATORIO: describe el inmueble en 3–6 líneas (título, precio, tipo, zona, 2–3 puntos fuertes del texto). No digas que no lo ves si el bloque no está vacío. No inventes datos.
Luego UNA pregunta: si aún no sabes el objetivo — ¿vivir o invertir?; si ya está claro — ¿cuánto tiene disponible ahora o quiere una llamada/visita?
Estilo WhatsApp, idioma del diálogo.`;
  }
  if (code === 'en') {
    return `The client sent a property link. The «PROPERTY FROM CLIENT LINK» block has catalog data.
MUST: briefly describe the property in 3–6 lines (title, price, type, area, 2–3 strengths from the text). Never say you cannot see it if the block is present. Do not invent facts.
Then ONE question: if goal unknown — live or invest?; if goal known — cash available now, or a call/viewing?
WhatsApp style, dialog language.`;
  }
  if (code === 'de') {
    return `Der Kunde hat einen Objekt-Link gesendet. Im Block «OBJEKT AUS KUNDEN-LINK» stehen Katalogdaten.
PFLICHT: Objekt in 3–6 Zeilen beschreiben (Titel, Preis, Typ, Lage, 2–3 Stärken). Nicht sagen, du siehst es nicht, wenn der Block da ist. Nichts erfinden.
Dann EINE Frage: Ziel unklar — Wohnen oder Investition?; sonst — verfügbares Eigenkapital jetzt oder Anruf/Besichtigung?
WhatsApp-Stil, Dialogsprache.`;
  }
  if (code === 'fr') {
    return `Le client a envoyé un lien vers un bien. Le bloc « BIEN VIA LIEN CLIENT » contient les données catalogue.
OBLIGATOIRE: décrire le bien en 3–6 lignes (titre, prix, type, zone, 2–3 atouts). Ne dis pas que tu ne le vois pas si le bloc est présent. N’invente pas.
Puis UNE question: objectif inconnu — habiter ou investir ?; sinon — liquidités disponibles maintenant, ou appel/visite ?
Style WhatsApp, langue du dialogue.`;
  }
  if (code === 'pl') {
    return `Klient wysłał link do oferty. W bloku «OFERTA Z LINKA KLIENTA» są dane z katalogu.
OBOWIĄZKOWO: opisz obiekt w 3–6 liniach (tytuł, cena, typ, strefa, 2–3 mocne strony). Nie mów, że nie widzisz, jeśli blok jest. Nie wymyślaj.
Potem JEDNO pytanie: cel niejasny — życie czy inwestycja?; inaczej — gotówka dostępna teraz lub rozmowa/oględziny?
Styl WhatsApp, język dialogu.`;
  }
  if (code === 'nl') {
    return `De klant stuurde een objectlink. Het blok «OBJECT VIA KLANTLINK» bevat catalogusgegevens.
VERPLICHT: beschrijf het object in 3–6 regels (titel, prijs, type, zone, 2–3 sterke punten). Zeg niet dat je het niet ziet als het blok er is. Niets verzinnen.
Dan ÉÉN vraag: doel onbekend — wonen of investeren?; anders — contant nu beschikbaar, of belletje/bezichtiging?
WhatsApp-stijl, dialoogtaal.`;
  }
  return `Клиент прислал ссылку на объект. В блоке «ОБЪЕКТ ПО ССЫЛКЕ КЛИЕНТА» — данные из каталога.
ОБЯЗАТЕЛЬНО: коротко расскажи про объект (3–6 строк): название, цена, тип, район/локация, 2–3 сильные стороны из описания. Не говори «не вижу объект», если блок не пустой. Не выдумывай факты вне блока.
Затем ОДИН вопрос: если цель ещё не ясна — для жизни или инвестиция?; если цель ясна — сколько денег сейчас на руках, или созвон/просмотр?
WhatsApp-стиль, язык диалога.`;
}

function hasInterestSignal(text) {
  const s = String(text || '');
  return INTEREST_RE.test(s) || INTEREST_EN_RE.test(s) || INTEREST_ES_RE.test(s) || INTEREST_PL_RE.test(s) || INTEREST_NL_RE.test(s);
}

function pickByOrdinal(text, recentList) {
  if (!recentList.length) return null;
  const s = String(text || '').toLowerCase();
  const ordinals = [
    [/перв|1-?й|(?:^|[^\d])1(?:\s*(?:вариант|option)|(?!\d))|first|1st/, 0],
    [/втор|2-?й|(?:^|[^\d])2(?:\s*(?:вариант|option)|(?!\d))|second|2nd/, 1],
    [/трет|3-?й|(?:^|[^\d])3(?:\s*(?:вариант|option)|(?!\d))|third|3rd/, 2],
    [/четв|4-?й|(?:^|[^\d])4(?:\s*(?:вариант|option)|(?!\d))|fourth|4th/, 3],
    [/пят|5-?й|(?:^|[^\d])5(?:\s*(?:вариант|option)|(?!\d))|fifth|5th/, 4],
  ];
  for (const [re, idx] of ordinals) {
    if (re.test(s) && recentList[idx]) return recentList[idx];
  }
  const numbered = s.match(/(?:вариант|объект|option|listing)\s*(?:№\s*|number\s*|no\.?\s*)?([1-5])/i);
  if (numbered) {
    const idx = parseInt(numbered[1], 10) - 1;
    if (recentList[idx]) return recentList[idx];
  }
  const bare = s.match(/(?:^|[^\d])([1-5])\s*(?:-?й)?\s*(?:вариант|объект|option)?/i);
  if (bare) {
    const idx = parseInt(bare[1], 10) - 1;
    if (recentList[idx]) return recentList[idx];
  }
  return null;
}

function matchTitleInText(text, recentList) {
  const s = String(text || '').toLowerCase();
  for (const p of [...recentList].reverse()) {
    const title = String(p.title || '').toLowerCase();
    if (title.length >= 6 && s.includes(title.slice(0, Math.min(24, title.length)))) {
      return p;
    }
  }
  return null;
}

function getChatState(chatId) {
  const store = loadStore();
  return store.chats[String(chatId)] || { recentSent: [], interested: [] };
}

function upsertInterested(chatId, prop, source) {
  const store = loadStore();
  const id = String(chatId);
  const chat = store.chats[id] || { recentSent: [], interested: [] };
  const key = String(prop.id).toUpperCase();
  const existing = chat.interested.find((x) => String(x.id).toUpperCase() === key);
  if (existing) {
    existing.interestedAt = new Date().toISOString();
    existing.source = source;
  } else {
    chat.interested.push({ ...prop, source, interestedAt: new Date().toISOString() });
  }
  chat.interested = chat.interested.slice(-20);
  store.chats[id] = chat;
  saveStore(store);
  syncHandoffProperties(chatId);
  return prop;
}

function addRecentSent(chatId, prop) {
  const store = loadStore();
  const id = String(chatId);
  const chat = store.chats[id] || { recentSent: [], interested: [] };
  const key = String(prop.id).toUpperCase();
  chat.recentSent = [{ ...prop, sentAt: new Date().toISOString() }, ...chat.recentSent.filter(
    (x) => String(x.id).toUpperCase() !== key
  )].slice(0, 8);
  store.chats[id] = chat;
  saveStore(store);
}

/**
 * @param {string} chatId
 * @param {'user'|'assistant'|'manager'} role
 * @param {string} text
 * @param {string} [lang]
 */
function onConversationMessage(chatId, role, text, lang = 'ru') {
  if (!chatId || !text) return;

  const ids = extractPropertyIdsFromText(text);

  if (role === 'assistant' || role === 'manager') {
    for (const pid of ids) {
      const item = findItemByPropertyId(pid);
      const prop = propertyToPublic(item, lang, 'bot_sent');
      if (prop) addRecentSent(chatId, prop);
    }
    return;
  }

  if (role !== 'user') return;

  const state = getChatState(chatId);

  for (const pid of ids) {
    const item = findItemByPropertyId(pid);
    const prop = propertyToPublic(item, lang, 'user_link');
    if (prop) upsertInterested(chatId, prop, 'user_link');
  }

  // Также по полным URL (если id не извлекся)
  for (const item of extractPropertyItemsFromText(text)) {
    const prop = propertyToPublic(item, lang, 'user_link');
    if (prop) upsertInterested(chatId, prop, 'user_link');
  }

  if (!hasInterestSignal(text) && !ORDINAL_RE.test(text)) return;

  if (ids.length) return;

  const recent = state.recentSent || [];
  let picked =
    pickByOrdinal(text, recent) ||
    matchTitleInText(text, recent) ||
    (recent.length === 1 ? recent[0] : null);

  if (picked) {
    upsertInterested(chatId, picked, 'user_liked');
  }
}

function getInterestedProperties(chatId, lang = 'ru') {
  const state = getChatState(chatId);
  return (state.interested || []).map((p) => {
    const item = findItemByPropertyId(p.id);
    if (item) return propertyToPublic(item, lang, p.source) || p;
    return p;
  });
}

function syncHandoffProperties(chatId) {
  try {
    const { updateHandoffProperties } = require('./handoff-leads');
    updateHandoffProperties(chatId, getInterestedProperties(chatId));
  } catch {
    /* handoff module may load later */
  }
}

module.exports = {
  onConversationMessage,
  getInterestedProperties,
  extractPropertyIdsFromText,
  extractPropertyItemsFromText,
  formatLinkedPropertiesForPrompt,
  getLinkedPropertyStageInstruction,
  userMessageHasPropertyLink,
  STORE_PATH
};
