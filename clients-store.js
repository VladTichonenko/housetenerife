'use strict';

const fs = require('fs');
const path = require('path');
const { getLanguageName } = require('./language-detector');
const { formatCustomerPhone } = require('./manager-handoff');

function resolveClientsPath() {
  if (process.env.CLIENTS_PATH) return process.env.CLIENTS_PATH;
  const sessionPath = process.env.SESSION_PATH;
  if (sessionPath && path.isAbsolute(sessionPath)) {
    return path.join(path.dirname(sessionPath), 'whatsapp-clients.json');
  }
  return path.join(__dirname, 'data', 'whatsapp-clients.json');
}

const CLIENTS_PATH = resolveClientsPath();
const MAX_LAST_MESSAGES = parseInt(process.env.CLIENT_LAST_MESSAGES_LIMIT, 10) || 12;

function ensureDataDir() {
  const dir = path.dirname(CLIENTS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(CLIENTS_PATH)) {
    return { clients: {}, updatedAt: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CLIENTS_PATH, 'utf8'));
    return {
      clients: raw.clients && typeof raw.clients === 'object' ? raw.clients : {},
      updatedAt: raw.updatedAt || null,
    };
  } catch (e) {
    console.warn('⚠️ whatsapp-clients.json:', e.message);
    return { clients: {}, updatedAt: null };
  }
}

function saveStore(store) {
  ensureDataDir();
  const next = {
    clients: store.clients,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CLIENTS_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function buildWaLink(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d ? `https://wa.me/${d}` : null;
}

function recordClientMessage(payload = {}) {
  const {
    chatId,
    senderId,
    chatName = '',
    messageText = '',
    language = 'ru',
    languageLabel = '',
    country = '',
    isGroup = false,
    kind = 'text',
  } = payload;

  if (!chatId) return null;

  const store = loadStore();
  const id = String(chatId);
  const now = new Date().toISOString();
  const phone = formatCustomerPhone(senderId || chatId);
  const existing = store.clients[id] || {};
  const lastMessages = Array.isArray(existing.lastMessages) ? existing.lastMessages : [];

  const client = {
    id,
    chatId: id,
    senderId: senderId || chatId,
    phone,
    phoneDisplay: phone ? `+${String(phone).replace(/\D/g, '')}` : '—',
    waLink: buildWaLink(phone),
    chatName: chatName || existing.chatName || '',
    language,
    languageLabel: languageLabel || getLanguageName(language),
    country: country || existing.country || '',
    isGroup: Boolean(isGroup),
    firstSeenAt: existing.firstSeenAt || now,
    lastSeenAt: now,
    messageCount: (existing.messageCount || 0) + 1,
    lastMessage: String(messageText || '').slice(0, 500),
    lastKind: kind,
    lastMessages: [
      ...lastMessages,
      {
        at: now,
        direction: 'in',
        kind,
        text: String(messageText || '').slice(0, 500),
      },
    ].slice(-MAX_LAST_MESSAGES),
  };

  store.clients[id] = client;
  saveStore(store);
  return client;
}

function listClients({ page = 1, limit = 50, q = '' } = {}) {
  const store = loadStore();
  const query = String(q || '').trim().toLowerCase();
  let items = Object.values(store.clients);
  if (query) {
    items = items.filter((item) =>
      [
        item.chatName,
        item.phone,
        item.phoneDisplay,
        item.lastMessage,
        item.languageLabel,
        item.country,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }

  items.sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0));
  const p = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / lim));
  const start = (p - 1) * lim;

  return {
    items: items.slice(start, start + lim),
    total,
    page: p,
    totalPages,
    limit: lim,
    updatedAt: store.updatedAt,
  };
}

function getClient(id) {
  const store = loadStore();
  return store.clients[String(id)] || null;
}

module.exports = {
  CLIENTS_PATH,
  recordClientMessage,
  listClients,
  getClient,
  resolveClientsPath,
};
