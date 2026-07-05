'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { formatCustomerPhone, REASON_LABELS } = require('./manager-handoff');
const { generateHandoffSummary } = require('./handoff-summary');
const { getLanguageName } = require('./language-detector');

function resolveHandoffPath() {
  if (process.env.HANDOFF_LEADS_PATH) {
    return process.env.HANDOFF_LEADS_PATH;
  }
  const sessionPath = process.env.SESSION_PATH;
  if (sessionPath && path.isAbsolute(sessionPath)) {
    return path.join(path.dirname(sessionPath), 'handoff-leads.json');
  }
  return path.join(__dirname, 'data', 'handoff-leads.json');
}

const HANDOFF_PATH = resolveHandoffPath();
const MAX_LEADS = 500;

function ensureDataDir() {
  const dir = path.dirname(HANDOFF_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(HANDOFF_PATH)) {
    return { items: [], updatedAt: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(HANDOFF_PATH, 'utf8'));
    return {
      items: Array.isArray(raw.items) ? raw.items : [],
      updatedAt: raw.updatedAt || null,
    };
  } catch (e) {
    console.warn('⚠️ handoff-leads.json:', e.message);
    return { items: [], updatedAt: null };
  }
}

function saveStore(store) {
  ensureDataDir();
  const next = {
    items: store.items,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(HANDOFF_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function formatPhoneDisplay(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  if (!d) return '—';
  return `+${d}`;
}

function waMeLink(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  return d ? `https://wa.me/${d}` : null;
}

/**
 * @param {{ chatId: string, language?: string, reasonKey: string, preview?: string, conversationHistory?: Array }} payload
 */
async function recordHandoff(payload) {
  const {
    chatId,
    language = 'ru',
    languageLabel = '',
    clientName = '',
    reasonKey = 'handoff',
    preview = '',
    conversationHistory = [],
  } = payload;

  if (!chatId) return null;

  const id = crypto.randomUUID();
  const phone = formatCustomerPhone(chatId);
  const now = new Date().toISOString();
  const item = {
    id,
    chatId,
    phone,
    phoneDisplay: formatPhoneDisplay(phone),
    waLink: waMeLink(phone),
    language,
    languageLabel: languageLabel || getLanguageName(language),
    clientName: String(clientName || '').trim(),
    reasonKey,
    reasonLabel: REASON_LABELS[reasonKey] || reasonKey,
    preview: String(preview || '').slice(0, 500),
    summary: '',
    summaryStatus: 'pending',
    createdAt: now,
    lastActivityAt: now,
    assignedManagerId: '',
    assignedManagerName: '',
    assignedAt: null,
    status: 'new',
  };

  const store = loadStore();
  store.items.unshift(item);
  if (store.items.length > MAX_LEADS) {
    store.items = store.items.slice(0, MAX_LEADS);
  }
  saveStore(store);
  console.log(`📋 Лид handoff сохранён: ${phone} (${reasonKey}) → ${HANDOFF_PATH}`);

  try {
    const { notifyHandoffLead } = require('./telegram-notify');
    notifyHandoffLead(item);
  } catch {
    /* ignore */
  }

  setImmediate(() => {
    finishHandoffSummary(id, conversationHistory, {
      reasonKey,
      preview,
      language,
      clientName: item.clientName,
    }).catch((e) => {
      console.warn('⚠️ finishHandoffSummary:', e.message);
    });
  });

  return item;
}

async function finishHandoffSummary(id, conversationHistory, meta) {
  let summary;
  try {
    summary = await generateHandoffSummary(conversationHistory, meta);
  } catch (e) {
    summary = `Не удалось сформировать выжимку: ${e.message}`;
  }

  const store = loadStore();
  const idx = store.items.findIndex((x) => x.id === id);
  if (idx === -1) return;

  store.items[idx] = {
    ...store.items[idx],
    summary,
    summaryStatus: 'ready',
    summaryReadyAt: new Date().toISOString(),
  };
  saveStore(store);
  console.log(`✅ Выжимка готова для лида ${id}`);
}

function touchHandoffActivity(chatId) {
  const store = loadStore();
  const now = new Date().toISOString();
  let touched = false;
  store.items = store.items.map((item) => {
    if (item.chatId !== chatId) return item;
    touched = true;
    return { ...item, lastActivityAt: now };
  });
  if (touched) saveStore(store);
}

function assignHandoff(id, manager) {
  const store = loadStore();
  const idx = store.items.findIndex((x) => x.id === id);
  if (idx === -1) return null;

  const existing = store.items[idx];
  const now = new Date().toISOString();
  const unassign = existing.assignedManagerId === manager.id;

  store.items[idx] = unassign
    ? {
        ...existing,
        assignedManagerId: '',
        assignedManagerName: '',
        assignedAt: null,
        status: 'new',
      }
    : {
        ...existing,
        assignedManagerId: manager.id,
        assignedManagerName: manager.name,
        assignedAt: now,
        status: 'in_progress',
      };

  saveStore(store);
  return publicLead(store.items[idx]);
}

function listHandoffs({
  page = 1,
  limit = 24,
  q = '',
  filter = 'all',
  managerId = '',
} = {}) {
  const store = loadStore();
  const query = String(q || '').trim().toLowerCase();
  let items = [...store.items];

  if (query) {
    items = items.filter((item) =>
      [
        item.clientName,
        item.phone,
        item.phoneDisplay,
        item.preview,
        item.summary,
        item.reasonLabel,
        item.assignedManagerName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }

  if (managerId) {
    items = items.filter((item) => item.assignedManagerId === managerId);
  }

  if (filter === 'new') {
    items = items.filter((item) => !item.assignedManagerId || item.status === 'new');
  }

  if (filter === 'active') {
    items.sort(
      (a, b) => new Date(b.lastActivityAt || b.createdAt) - new Date(a.lastActivityAt || a.createdAt)
    );
  } else {
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  const total = items.length;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 24));
  const totalPages = Math.max(1, Math.ceil(total / lim));
  const start = (p - 1) * lim;
  const pageItems = items.slice(start, start + lim).map(publicLead);

  return { items: pageItems, total, page: p, totalPages, limit: lim, updatedAt: store.updatedAt };
}

function getHandoff(id) {
  const store = loadStore();
  const item = store.items.find((x) => x.id === id);
  return item ? publicLead(item) : null;
}

function publicLead(item) {
  return {
    id: item.id,
    chatId: item.chatId,
    phone: item.phone,
    phoneDisplay: item.phoneDisplay || formatPhoneDisplay(item.phone),
    waLink: item.waLink || waMeLink(item.phone),
    language: item.language,
    languageLabel: item.languageLabel || item.language,
    clientName: item.clientName || '',
    reasonKey: item.reasonKey,
    reasonLabel: item.reasonLabel,
    preview: item.preview,
    summary: item.summary,
    summaryStatus: item.summaryStatus,
    createdAt: item.createdAt,
    summaryReadyAt: item.summaryReadyAt || null,
    lastActivityAt: item.lastActivityAt || item.createdAt,
    assignedManagerId: item.assignedManagerId || '',
    assignedManagerName: item.assignedManagerName || '',
    assignedAt: item.assignedAt || null,
    status: item.status || (item.assignedManagerId ? 'in_progress' : 'new'),
  };
}

module.exports = {
  recordHandoff,
  listHandoffs,
  getHandoff,
  assignHandoff,
  touchHandoffActivity,
  HANDOFF_PATH,
  resolveHandoffPath,
};
