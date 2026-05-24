'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { formatCustomerPhone, REASON_LABELS } = require('./manager-handoff');
const { generateHandoffSummary } = require('./handoff-summary');
const { getLanguageName } = require('./language-detector');

const HANDOFF_PATH =
  process.env.HANDOFF_LEADS_PATH || path.join(__dirname, 'data', 'handoff-leads.json');
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
    createdAt: new Date().toISOString(),
  };

  const store = loadStore();
  store.items.unshift(item);
  if (store.items.length > MAX_LEADS) {
    store.items = store.items.slice(0, MAX_LEADS);
  }
  saveStore(store);
  console.log(`📋 Лид handoff сохранён: ${phone} (${reasonKey})`);

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

function listHandoffs({ page = 1, limit = 24 } = {}) {
  const store = loadStore();
  const sorted = [...store.items].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  const total = sorted.length;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 24));
  const totalPages = Math.max(1, Math.ceil(total / lim));
  const start = (p - 1) * lim;
  const items = sorted.slice(start, start + lim).map(publicLead);

  return { items, total, page: p, totalPages, limit: lim, updatedAt: store.updatedAt };
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
  };
}

module.exports = {
  recordHandoff,
  listHandoffs,
  getHandoff,
  HANDOFF_PATH,
};
