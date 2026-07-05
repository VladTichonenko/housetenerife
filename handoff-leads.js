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
const MAX_LEADS = parseInt(process.env.HANDOFF_MAX_LEADS, 10) || 10000;

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
    closedAt: null,
    closedByManagerId: '',
    closedByManagerName: '',
    interestedProperties: [],
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

function updateHandoffProperties(chatId, properties) {
  const store = loadStore();
  let updated = false;
  store.items = store.items.map((item) => {
    if (item.chatId !== chatId) return item;
    updated = true;
    return { ...item, interestedProperties: properties || [] };
  });
  if (updated) saveStore(store);
}

function closeHandoff(id, manager) {
  const store = loadStore();
  const idx = store.items.findIndex((x) => x.id === id);
  if (idx === -1) return null;

  const existing = store.items[idx];
  const now = new Date().toISOString();

  if (existing.status === 'closed') {
    store.items[idx] = {
      ...existing,
      status: existing.assignedManagerId ? 'in_progress' : 'new',
      closedAt: null,
      closedByManagerId: '',
      closedByManagerName: '',
    };
  } else {
    store.items[idx] = {
      ...existing,
      status: 'closed',
      closedAt: now,
      closedByManagerId: manager.id,
      closedByManagerName: manager.name,
    };
  }

  saveStore(store);
  return publicLead(store.items[idx]);
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
        status: existing.status === 'closed' ? 'closed' : 'new',
      }
    : {
        ...existing,
        assignedManagerId: manager.id,
        assignedManagerName: manager.name,
        assignedAt: now,
        status: existing.status === 'closed' ? 'closed' : 'in_progress',
        closedAt: existing.status === 'closed' ? existing.closedAt : null,
        closedByManagerId: existing.status === 'closed' ? existing.closedByManagerId : '',
        closedByManagerName: existing.status === 'closed' ? existing.closedByManagerName : '',
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

  if (filter === 'mine') {
    items = items.filter(
      (item) => item.assignedManagerId === managerId && item.status !== 'closed'
    );
  } else if (filter === 'new') {
    items = items.filter((item) => item.status !== 'closed' && (!item.assignedManagerId || item.status === 'new'));
  } else if (filter === 'in_progress') {
    items = items.filter((item) => item.status === 'in_progress');
  } else if (filter === 'closed') {
    items = items.filter((item) => item.status === 'closed');
  } else if (filter === 'open') {
    items = items.filter((item) => item.status !== 'closed');
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
  const pageItems = items.slice(start, start + lim).map((item) => {
    const lead = publicLead(item);
    if (!lead.interestedProperties?.length) {
      try {
        const { getInterestedProperties } = require('./property-interest');
        const props = getInterestedProperties(item.chatId, item.language);
        if (props.length) lead.interestedProperties = props;
      } catch {
        /* ignore */
      }
    }
    return lead;
  });

  return { items: pageItems, total, page: p, totalPages, limit: lim, updatedAt: store.updatedAt };
}

function getHandoff(id) {
  const store = loadStore();
  const item = store.items.find((x) => x.id === id);
  if (!item) return null;
  const lead = publicLead(item);
  if (!lead.interestedProperties?.length) {
    try {
      const { getInterestedProperties } = require('./property-interest');
      const props = getInterestedProperties(item.chatId, item.language);
      if (props.length) lead.interestedProperties = props;
    } catch {
      /* ignore */
    }
  }
  return lead;
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
    closedAt: item.closedAt || null,
    closedByManagerName: item.closedByManagerName || '',
    interestedProperties: Array.isArray(item.interestedProperties) ? item.interestedProperties : [],
  };
}

module.exports = {
  recordHandoff,
  listHandoffs,
  getHandoff,
  assignHandoff,
  closeHandoff,
  updateHandoffProperties,
  touchHandoffActivity,
  HANDOFF_PATH,
  resolveHandoffPath,
};
