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
const ORDINAL_RE = /(?:перв|1-?й|втор|2-?й|трет|3-?й|четв|4-?й|пят|5-?й|first|second|third|1st|2nd|3rd)/i;

const URL_PATTERNS = [
  /https?:\/\/(?:www\.)?housetenerife\.eu(?:\/(?:ru|es|en))?\/property\/([^\s<>\])"'}]+)/gi,
  /https?:\/\/[^\s]+\/p\/([A-Za-z0-9]+)/gi,
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
  item = findItemByUrl(`https://housetenerife.eu/property/${t}`);
  return item || null;
}

function extractPropertyIdsFromText(text) {
  const ids = new Set();
  const s = String(text || '');
  for (const re of URL_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      const item = resolvePropertyFromToken(m[1]);
      if (item?.id) ids.add(String(item.id).toUpperCase());
    }
  }
  return [...ids];
}

function hasInterestSignal(text) {
  const s = String(text || '');
  return INTEREST_RE.test(s) || INTEREST_EN_RE.test(s) || INTEREST_ES_RE.test(s);
}

function pickByOrdinal(text, recentList) {
  if (!recentList.length) return null;
  const s = String(text || '').toLowerCase();
  const ordinals = [
    [/перв|1-?й|first|1st/, 0],
    [/втор|2-?й|second|2nd/, 1],
    [/трет|3-?й|third|3rd/, 2],
    [/четв|4-?й|fourth|4th/, 3],
    [/пят|5-?й|fifth|5th/, 4],
  ];
  for (const [re, idx] of ordinals) {
    if (re.test(s) && recentList[idx]) return recentList[idx];
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
  STORE_PATH,
};
