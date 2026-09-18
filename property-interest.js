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

  const fieldLabels = {
    ru: { price: 'Цена', type: 'Тип', region: 'Регион', area: 'Район', overview: 'Обзор', desc: 'Описание' },
    es: { price: 'Precio', type: 'Tipo', region: 'Región', area: 'Zona', overview: 'Resumen', desc: 'Descripción' },
    en: { price: 'Price', type: 'Type', region: 'Region', area: 'Area', overview: 'Overview', desc: 'Description' },
    de: { price: 'Preis', type: 'Typ', region: 'Region', area: 'Zone', overview: 'Überblick', desc: 'Beschreibung' },
    fr: { price: 'Prix', type: 'Type', region: 'Région', area: 'Zone', overview: 'Aperçu', desc: 'Description' },
    pl: { price: 'Cena', type: 'Typ', region: 'Region', area: 'Strefa', overview: 'Przegląd', desc: 'Opis' },
    nl: { price: 'Prijs', type: 'Type', region: 'Regio', area: 'Zone', overview: 'Overzicht', desc: 'Beschrijving' },
  };
  const F = fieldLabels[l] || fieldLabels.en;

  const lines = items.slice(0, 3).map((item, i) => {
    const loc = getLocalizedItem(item, l);
    const share = getShareUrl(item, l) || loc.url || item.url || '';
    const cats = getItemPropertyCategories(item);
    const typeNote = cats.length ? formatDetectedTypes(cats, l) : '';
    const regionId = getPrimaryMacroRegion(item);
    const regionNote = regionId ? formatRegionLabel([regionId], l) : '';
    const micro = detectMicroAreas(
      [loc.title, loc.overview, loc.factsLine, share, item.url].filter(Boolean).join(' '),
      l
    );
    const areaNote = micro.hasSpecific ? micro.label : '';
    const facts = String(loc.factsLine || '').replace(/\s+/g, ' ').trim();
    const descRaw = String(loc.description || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 520);
    const desc = l === 'ru' ? descRaw : facts || descRaw;
    const overview = String(loc.overview || loc.factsLine || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
    return [
      `${i + 1}. ${loc.title || item.title || item.id || 'Object'}`,
      `   ID: ${item.id || '—'}`,
      `   ${F.price}: ${loc.price || item.price || '—'}`,
      typeNote ? `   ${F.type}: ${typeNote}` : null,
      regionNote ? `   ${F.region}: ${regionNote}` : null,
      areaNote ? `   ${F.area}: ${areaNote}` : null,
      overview ? `   ${F.overview}: ${overview}` : null,
      desc && desc !== overview ? `   ${F.desc}: ${desc}${desc.length >= 520 ? '…' : ''}` : null,
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
    return `El cliente envió un enlace / ID de un inmueble. El bloque «OBJETO POR ENLACE» tiene los datos del catálogo.
OBLIGATORIO: quédate EN ESTE objeto. No envíes otra selección ni llames parking «apartamento» (respeta el tipo del bloque).
Si el cliente YA preguntó (parking, mascotas, visita, fotos, precio, comparación, pago a plazos) — responde ESO primero. No sustituyas por «¿efectivo o hipoteca?».
Cifras (mesas, community, rentabilidad, m² extra) SOLO si están en el bloque. Si no están: «no figura en la ficha, lo consulto» — no inventes.
Fotos: di que se envían ahora las de ESTE objeto; no mandes otros listings.
Si no hay pregunta concreta: 3–6 líneas (título, precio, tipo, zona) + UNA pregunta útil sobre ESTE inmueble.
Idioma del diálogo, estilo WhatsApp.`;
  }
  if (code === 'en') {
    return `The client sent a property link / ID. The «PROPERTY FROM CLIENT LINK» block has catalog data.
MUST: stay on THIS property. Do not dump other listings. Do not call a parking a flat (use the type in the block).
If they ALREADY asked (parking, pets, viewing, photos, price, compare, instalments) — answer THAT first. Do not replace it with cash vs mortgage.
Numbers (tables, community fees, yield, extra m²) ONLY if they are in the block. If missing: “not in the listing, I’ll check” — never invent.
Photos: say THIS object’s photos are being sent now; no other listings.
If no specific question: 3–6 lines (title, price, type, area) + ONE useful question about THIS object.
Dialog language, WhatsApp style.`;
  }
  if (code === 'de') {
    return `Der Kunde hat einen Objekt-Link / eine ID gesendet. Im Block «OBJEKT AUS KUNDEN-LINK» stehen Katalogdaten.
PFLICHT: bei DIESEM Objekt bleiben. Keine andere Auswahl. Parking nicht als Wohnung bezeichnen (Typ aus dem Block).
Wenn der Kunde SCHON gefragt hat (Parkplatz, Haustiere, Besichtigung, Fotos, Preis, Vergleich, Ratenzahlung) — ZUERST das beantworten. Nicht durch Eigenkapital/Hypothek ersetzen.
Zahlen (Tische, Community, Rendite, Extra-m²) NUR aus dem Block. Fehlt es: «steht nicht in der Anzeige, ich prüfe» — nichts erfinden.
Fotos: sag, dass die Fotos DIESES Objekts jetzt kommen; keine anderen Listings.
Ohne konkrete Frage: 3–6 Zeilen + EINE sinnvolle Frage zu DIESEM Objekt.
Dialogsprache, WhatsApp-Stil.`;
  }
  if (code === 'fr') {
    return `Le client a envoyé un lien / un ID. Le bloc « BIEN VIA LIEN CLIENT » contient le catalogue.
OBLIGATOIRE: rester sur CE bien. Pas d’autre sélection. Ne pas appeler un parking un appartement (type du bloc).
S’il a DÉJÀ posé une question (parking, animaux, visite, photos, prix, comparaison, paiement) — répondre À CELA d’abord. Ne pas remplacer par cash/hypothèque.
Chiffres (tables, charges, rendement, m² extra) UNIQUEMENT s’ils sont dans le bloc. Sinon: « pas dans l’annonce, je vérifie » — n’invente pas.
Photos: dis que les photos de CE bien partent maintenant; pas d’autres listings.
Sans question précise: 3–6 lignes + UNE question utile sur CE bien.
Langue du dialogue, style WhatsApp.`;
  }
  if (code === 'pl') {
    return `Klient wysłał link / ID oferty. Blok «OFERTA Z LINKA KLIENTA» ma dane z katalogu.
OBOWIĄZKOWO: zostań przy TYM obiekcie. Bez innej selekcji. Parkingu nie nazywaj mieszkaniem (typ z bloku).
Jeśli JUŻ zadał pytanie (parking, pies, oględziny, zdjęcia, cena, porównanie, raty) — odpowiedz NA TO najpierw. Nie zastępuj pytaniem o gotówkę/hipotekę.
Liczby (stoliki, czynsz, rentowność, extra m²) TYLKO z bloku. Brak: «nie ma w ofercie, sprawdzę» — nie wymyślaj.
Zdjęcia: powiedz, że wysyłasz zdjęcia TEGO obiektu; bez innych ofert.
Bez konkretnego pytania: 3–6 linii + JEDNO pytanie o TEN obiekt.
Język dialogu, styl WhatsApp.`;
  }
  if (code === 'nl') {
    return `De klant stuurde een objectlink / ID. Het blok «OBJECT VIA KLANTLINK» heeft catalogusdata.
VERPLICHT: blijf bij DIT object. Geen andere selectie. Noem parking geen appartement (type uit het blok).
Als hij AL een vraag stelde (parkeren, huisdier, bezichtiging, foto’s, prijs, vergelijking, termijn) — beantwoord DÁT eerst. Niet vervangen door cash/hypotheek.
Cijfers (tafels, servicekosten, yield, extra m²) ALLEEN uit het blok. Ontbreekt: «staat niet in de listing, ik check het» — niets verzinnen.
Foto’s: zeg dat de foto’s van DIT object nu komen; geen andere listings.
Zonder specifieke vraag: 3–6 regels + ÉÉN nuttige vraag over DIT object.
Dialoogtaal, WhatsApp-stijl.`;
  }
  return `Клиент прислал ссылку / ID объекта. В блоке «ОБЪЕКТ ПО ССЫЛКЕ КЛИЕНТА» — данные каталога.
ОБЯЗАТЕЛЬНО: оставайся на ЭТОМ объекте. Не скидывай другую подборку. Не называй паркинг квартирой (тип бери из блока).
Если клиент УЖЕ задал вопрос (парковка, собака, просмотр, фото, цена, сравнение, рассрочка) — сначала ответь НА НЕГО. Не подменяй вопросом «нал или ипотека».
Цифры (столики, коммуналка, доходность, лишние м²) ТОЛЬКО если они есть в блоке. Если нет: «в карточке этого нет, уточню» — не выдумывай.
Фото: напиши, что сейчас уходят фото ИМЕННО этого объекта; другие объявления не предлагай.
Если отдельного вопроса нет: 3–6 строк (название, цена, тип, район) + ОДИН полезный вопрос про ЭТОТ объект.
Язык диалога, стиль WhatsApp.`;
}

function clientTalksAboutLinkedProperty(text) {
  const raw = String(text || '');
  if (!userMessageHasPropertyLink(raw)) return false;
  const withoutUrls = raw
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bHZ\d{2,6}\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutUrls.length < 8) return false;
  return /[?¿]|как|есть|можно|сколько|парков|собак|коммунал|аренд|ипотек|смотр|фото|сравн|лучш|торг|рассроч|цена|что\s+лучше|what|how|can|parking|pet|fee|rent|visit|photo|compar|mejor|cu[aá]nt|hay|puedo|wann|gibt|appel|visite/i.test(
    withoutUrls
  );
}

function resolveMentionedPropertyItems(text, history = []) {
  const fromText = extractPropertyItemsFromText(text);
  if (fromText.length) return fromText.slice(0, 3);

  const hist = Array.isArray(history) ? history : [];
  const blob = String(text || '');
  for (let i = hist.length - 1; i >= 0 && i >= hist.length - 12; i--) {
    const items = extractPropertyItemsFromText(hist[i]?.text || '');
    if (!items.length) continue;
    const picked = pickByOrdinal(blob, items);
    if (picked) return [picked];
    if (
      /(?:этот|этого|данного|этой|this\s+(?:one|property|listing|object)|este(?:\s+objeto)?|dieses|ce bien|dit object)/i.test(
        blob
      )
    ) {
      return items.slice(0, 1);
    }
    return items.slice(0, 1);
  }
  return [];
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
async function onConversationMessage(chatId, role, text, lang = 'ru') {
  if (!chatId || !text) return;

  let ids = extractPropertyIdsFromText(text);

  if (role === 'assistant' || role === 'manager') {
    for (const pid of ids) {
      const item = findItemByPropertyId(pid);
      const prop = propertyToPublic(item, lang, 'bot_sent');
      if (prop) addRecentSent(chatId, prop);
    }
    return;
  }

  if (role !== 'user') return;

  // Ссылка на объект, которого нет в каталоге — подтянуть с сайта
  if (userMessageHasPropertyLink(text) && !extractPropertyItemsFromText(text).length) {
    try {
      const { resolvePropertyItemsFromText } = require('./property-live-fetch');
      await resolvePropertyItemsFromText(text);
      ids = extractPropertyIdsFromText(text);
    } catch (e) {
      console.warn('⚠️ property live-fetch в onConversationMessage:', e.message);
    }
  }

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
  clientTalksAboutLinkedProperty,
  resolveMentionedPropertyItems,
  pickByOrdinal,
  STORE_PATH
};
