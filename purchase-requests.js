'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { formatCustomerPhone } = require('./manager-handoff');
const { getLanguageName } = require('./language-detector');

function resolvePurchaseRequestsPath() {
  if (process.env.PURCHASE_REQUESTS_PATH) {
    return process.env.PURCHASE_REQUESTS_PATH;
  }
  const sessionPath = process.env.SESSION_PATH;
  if (sessionPath && path.isAbsolute(sessionPath)) {
    return path.join(path.dirname(sessionPath), 'purchase-requests.json');
  }
  return path.join(__dirname, 'data', 'purchase-requests.json');
}

const STORE_PATH = resolvePurchaseRequestsPath();
const MAX_ITEMS = parseInt(process.env.PURCHASE_REQUESTS_MAX, 10) || 10000;

const STATUS_LABELS = {
  draft: 'Черновик',
  ready: 'Готова к созвону',
  call_requested: 'Созвон запрошен',
  handed_off: 'Передана менеджеру',
  closed: 'Завершена',
};

function ensureDataDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(STORE_PATH)) {
    return { items: [], updatedAt: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return {
      items: Array.isArray(raw.items) ? raw.items : [],
      updatedAt: raw.updatedAt || null,
    };
  } catch (e) {
    console.warn('⚠️ purchase-requests.json:', e.message);
    return { items: [], updatedAt: null };
  }
}

function saveStore(store) {
  ensureDataDir();
  const next = {
    items: store.items,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STORE_PATH, JSON.stringify(next, null, 2), 'utf8');
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

function deriveStatus(financeStage, handoffId) {
  if (handoffId) return 'handed_off';
  if (
    financeStage === 'PROPERTY_CLOSING' ||
    financeStage === 'FINANCE_DOCUMENTS' ||
    financeStage === 'FINANCE_DOCUMENTS_CASH'
  ) {
    return 'ready';
  }
  return 'draft';
}

function publicItem(item) {
  return {
    ...item,
    statusLabel: STATUS_LABELS[item.status] || item.status,
  };
}

function findOpenByChatId(chatId) {
  const store = loadStore();
  const id = String(chatId);
  return store.items.find(
    (x) => x.chatId === id && x.status !== 'closed'
  );
}

/**
 * Создать или обновить заявку на покупку после выбора объекта.
 * @param {{ chatId: string, dialog?: object, properties?: Array, language?: string, preview?: string }} payload
 */
function upsertPurchaseRequestFromDialog(payload) {
  const {
    chatId,
    dialog = {},
    properties = [],
    language = 'ru',
    preview = '',
  } = payload;

  if (!chatId || !dialog.hasPropertyInterest) return null;

  const store = loadStore();
  const now = new Date().toISOString();
  const phone = formatCustomerPhone(chatId);
  const financeStage = dialog.financeStage || null;

  let item = store.items.find(
    (x) => x.chatId === String(chatId) && x.status !== 'closed'
  );

  const props = (properties || []).slice(0, 5).map((p) => ({
    id: p.id,
    title: p.title || p.id,
    price: p.price || null,
    siteUrl: p.siteUrl || p.url || '',
  }));

  const nextFields = {
    language,
    languageLabel: getLanguageName(language),
    properties: props.length ? props : item?.properties || [],
    fundsNowLabel: dialog.fundsNowLabel || item?.fundsNowLabel || '',
    needsMortgage:
      dialog.needsMortgage === true
        ? true
        : dialog.needsMortgage === false
          ? false
          : item?.needsMortgage ?? null,
    financeStage,
    budget: dialog.budgetLabel || dialog.budget || item?.budget || null,
    region: dialog.regionLabel || item?.region || '',
    propertyType: dialog.propertyTypeLabel || item?.propertyType || '',
    businessSector: dialog.businessSectorLabel || item?.businessSector || '',
    preview: String(preview || item?.preview || '').slice(0, 500),
    lastActivityAt: now,
    updatedAt: now,
  };

  if (item) {
    const idx = store.items.findIndex((x) => x.id === item.id);
    const status =
      item.status === 'handed_off' || item.status === 'call_requested'
        ? item.status
        : deriveStatus(financeStage, item.handoffId);
    store.items[idx] = { ...item, ...nextFields, status };
    saveStore(store);
    console.log(`📝 Заявка на покупку обновлена: ${phone} (${status})`);
    return publicItem(store.items[idx]);
  }

  item = {
    id: crypto.randomUUID(),
    chatId: String(chatId),
    phone,
    phoneDisplay: formatPhoneDisplay(phone),
    waLink: waMeLink(phone),
    status: deriveStatus(financeStage, ''),
    handoffId: '',
    clientName: '',
    createdAt: now,
    ...nextFields,
  };

  store.items.unshift(item);
  if (store.items.length > MAX_ITEMS) {
    store.items = store.items.slice(0, MAX_ITEMS);
  }
  saveStore(store);
  console.log(`📝 Заявка на покупку создана: ${phone} → ${STORE_PATH}`);
  return publicItem(item);
}

function markPurchaseRequestCallRequested(chatId) {
  const store = loadStore();
  let updated = false;
  store.items = store.items.map((item) => {
    if (item.chatId !== String(chatId) || item.status === 'closed') return item;
    updated = true;
    const now = new Date().toISOString();
    return {
      ...item,
      status: 'call_requested',
      lastActivityAt: now,
      updatedAt: now,
    };
  });
  if (updated) saveStore(store);
}

function linkHandoffToPurchaseRequest(chatId, handoffId) {
  if (!chatId || !handoffId) return null;
  const store = loadStore();
  const idx = store.items.findIndex(
    (x) => x.chatId === String(chatId) && x.status !== 'closed'
  );
  if (idx === -1) return null;

  const now = new Date().toISOString();
  store.items[idx] = {
    ...store.items[idx],
    handoffId,
    status: 'handed_off',
    lastActivityAt: now,
    updatedAt: now,
  };
  saveStore(store);
  return publicItem(store.items[idx]);
}

function closePurchaseRequest(id, manager = {}) {
  const store = loadStore();
  const idx = store.items.findIndex((x) => x.id === id);
  if (idx === -1) return null;

  const existing = store.items[idx];
  const now = new Date().toISOString();

  if (existing.status === 'closed') {
    store.items[idx] = {
      ...existing,
      status: deriveStatus(existing.financeStage, existing.handoffId),
      closedAt: null,
      closedByManagerId: '',
      closedByManagerName: '',
    };
  } else {
    store.items[idx] = {
      ...existing,
      status: 'closed',
      closedAt: now,
      closedByManagerId: manager.id || '',
      closedByManagerName: manager.name || '',
    };
  }

  saveStore(store);
  return publicItem(store.items[idx]);
}

function getPurchaseRequest(id) {
  const store = loadStore();
  const item = store.items.find((x) => x.id === id);
  return item ? publicItem(item) : null;
}

function listPurchaseRequests({ page = 1, limit = 24, q = '', filter = 'open' } = {}) {
  const store = loadStore();
  const query = String(q || '').trim().toLowerCase();
  let items = [...store.items];

  if (query) {
    items = items.filter((item) =>
      [
        item.phone,
        item.phoneDisplay,
        item.preview,
        item.region,
        item.propertyType,
        item.businessSector,
        item.fundsNowLabel,
        ...(item.properties || []).map((p) => [p.id, p.title, p.price].join(' ')),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }

  if (filter === 'draft') {
    items = items.filter((x) => x.status === 'draft');
  } else if (filter === 'ready') {
    items = items.filter((x) => x.status === 'ready' || x.status === 'call_requested');
  } else if (filter === 'handed_off') {
    items = items.filter((x) => x.status === 'handed_off');
  } else if (filter === 'closed') {
    items = items.filter((x) => x.status === 'closed');
  } else if (filter === 'open') {
    items = items.filter((x) => x.status !== 'closed');
  }

  const total = items.length;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 24));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (pageNum - 1) * pageSize;

  return {
    items: items.slice(offset, offset + pageSize).map(publicItem),
    total,
    page: pageNum,
    totalPages,
    limit: pageSize,
  };
}

module.exports = {
  STORE_PATH,
  STATUS_LABELS,
  upsertPurchaseRequestFromDialog,
  markPurchaseRequestCallRequested,
  linkHandoffToPurchaseRequest,
  closePurchaseRequest,
  getPurchaseRequest,
  listPurchaseRequests,
  findOpenByChatId,
};
