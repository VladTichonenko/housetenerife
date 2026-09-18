'use strict';

const fs = require('fs');
const path = require('path');
const { formatContactDisplay } = require('./manager-handoff');
const { analyzeConversation } = require('./dialog-context');
const { extractPurchaseTimelineLabel } = require('./bot-core-rules');
const { getLanguageName } = require('./language-detector');
const { buildRuntimeHistory } = require('./conversation-history');

/** WhatsApp, куда уходят все отчёты по диалогу (можно переопределить MANAGER_REPORT_WHATSAPP). */
const DEFAULT_REPORT_WHATSAPP = '+375336867911';

function resolveReportStatePath() {
  if (process.env.MANAGER_REPORT_STATE_PATH) {
    return process.env.MANAGER_REPORT_STATE_PATH;
  }
  const sessionPath = process.env.SESSION_PATH;
  if (sessionPath && path.isAbsolute(sessionPath)) {
    return path.join(path.dirname(sessionPath), 'manager-dialog-reports.json');
  }
  return path.join(__dirname, 'data', 'manager-dialog-reports.json');
}

const STATE_PATH = resolveReportStatePath();
const COOLDOWN_MS = Math.max(
  5 * 60 * 1000,
  parseInt(process.env.MANAGER_REPORT_COOLDOWN_MS, 10) || 2 * 60 * 60 * 1000
);
const FORCE_TRIGGERS = new Set(['handoff', 'purchase', 'call_requested', 'escalation']);

/** @type {null | ((text: string) => Promise<void>)} */
let sendWhatsAppFn = null;

function setManagerWhatsAppSender(fn) {
  sendWhatsAppFn = typeof fn === 'function' ? fn : null;
}

function reportsEnabled() {
  const flag = String(process.env.MANAGER_DIALOG_REPORTS || '1').toLowerCase();
  return flag !== '0' && flag !== 'false' && flag !== 'off';
}

function managerWhatsAppChatId() {
  // Отдельный номер для отчётов (не путать с контактом, который показываем клиенту)
  const reportPhone = process.env.MANAGER_REPORT_WHATSAPP || DEFAULT_REPORT_WHATSAPP;
  const digits = String(reportPhone || '').replace(/\D/g, '');
  return digits ? `${digits}@c.us` : null;
}

function ensureDataDir() {
  const dir = path.dirname(STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_PATH)) return { chats: {}, updatedAt: null };
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return {
      chats: raw.chats && typeof raw.chats === 'object' ? raw.chats : {},
      updatedAt: raw.updatedAt || null,
    };
  } catch (e) {
    console.warn('⚠️ manager-dialog-reports.json:', e.message);
    return { chats: {}, updatedAt: null };
  }
}

function saveState(state) {
  ensureDataDir();
  fs.writeFileSync(
    STATE_PATH,
    JSON.stringify({ chats: state.chats, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

function propertyIdsOf(properties) {
  return (properties || [])
    .map((p) => String(p.id || p.title || '').toUpperCase())
    .filter(Boolean)
    .sort();
}

function idsChanged(prevIds, nextIds) {
  if (!prevIds?.length && nextIds.length) return true;
  if (nextIds.some((id) => !prevIds.includes(id))) return true;
  return false;
}

/**
 * Нужно ли слать отчёт (антиспам + новые объекты / handoff).
 */
function shouldSendDialogReport(chatId, trigger, properties = []) {
  if (!reportsEnabled() || !chatId) return false;
  const state = loadState();
  const prev = state.chats[String(chatId)];
  const nextIds = propertyIdsOf(properties);

  if (!prev) return true;
  if (idsChanged(prev.propertyIds || [], nextIds)) return true;
  if (FORCE_TRIGGERS.has(trigger) && prev.lastTrigger !== trigger) return true;

  const lastAt = Date.parse(prev.lastSentAt || '');
  if (!Number.isFinite(lastAt)) return true;
  if (Date.now() - lastAt < COOLDOWN_MS) return false;

  // Повтор после cooldown — только если есть осмысленный триггер
  return FORCE_TRIGGERS.has(trigger) || nextIds.length > 0;
}

function markReportSent(chatId, trigger, properties, meta = {}) {
  const state = loadState();
  state.chats[String(chatId)] = {
    lastSentAt: new Date().toISOString(),
    lastTrigger: trigger,
    propertyIds: propertyIdsOf(properties),
    summaryPreview: String(meta.summaryPreview || '').slice(0, 200),
  };
  saveState(state);
}

function loadFullHistory(chatId) {
  try {
    const { getMessages } = require('./conversation-store');
    const msgs = getMessages(chatId);
    if (msgs?.length) {
      return buildRuntimeHistory(msgs, 200);
    }
  } catch (e) {
    console.warn('⚠️ loadFullHistory:', e.message);
  }
  return [];
}

function propertyUrlOf(p) {
  return String(p?.siteUrl || p?.url || p?.link || '').trim();
}

function formatPropertyBullet(p) {
  if (!p) return '';
  const title = String(p.title || p.id || 'объект').trim();
  const price = p.price ? ` — ${p.price}` : '';
  const url = propertyUrlOf(p);
  return url ? `• ${title}${price}\n  ${url}` : `• ${title}${price}`;
}

function formatObjectLine(properties, dialog) {
  const list = (properties || []).filter(Boolean);
  if (list.length) {
    const main = list[0];
    const title = String(main.title || main.id || 'объект').trim();
    const price = main.price ? ` — ${main.price}` : '';
    const extra = list.length > 1 ? ` (+ ещё ${list.length - 1})` : '';
    return `${title}${price}${extra}`;
  }
  const type = dialog?.propertyTypeLabel ? String(dialog.propertyTypeLabel).trim() : '';
  const region = dialog?.regionLabel || dialog?.microAreaLabel || '';
  const hint = [type, region].filter(Boolean).join(', ');
  return hint || 'ещё не выбран';
}

function formatPropertyLinkLines(properties = [], discussedProperties = []) {
  const selected = (properties || []).filter(Boolean);
  const selectedIds = new Set(selected.map((p) => String(p.id || p.siteUrl || p.title || '').toUpperCase()));
  const discussed = (discussedProperties || []).filter((p) => {
    const key = String(p.id || p.siteUrl || p.title || '').toUpperCase();
    return key && !selectedIds.has(key);
  });
  const lines = [];
  const mainUrl = selected[0] ? propertyUrlOf(selected[0]) : '';
  if (mainUrl) lines.push(mainUrl);
  if (selected.length) {
    lines.push('Выбрали:');
    for (const p of selected.slice(0, 6)) {
      const bullet = formatPropertyBullet(p);
      if (bullet) lines.push(bullet);
    }
  }
  if (discussed.length) {
    lines.push('Обсуждали:');
    for (const p of discussed.slice(0, 6)) {
      const bullet = formatPropertyBullet(p);
      if (bullet) lines.push(bullet);
    }
  }
  return lines;
}

function resolveReportClientName(clientName, waName) {
  const spoken = String(clientName || '').trim();
  if (spoken && spoken !== 'не назвал') return spoken;
  const wa = String(waName || '').trim();
  if (wa && wa !== 'не назвал') return wa;
  return spoken || wa || 'не назвал';
}

function formatMortgageLine(dialog) {
  if (dialog?.hasMortgageAnswered) {
    if (dialog.needsMortgage === true) return 'нужна';
    if (dialog.needsMortgage === false) return 'не нужна';
  }
  return 'не уточнено';
}

function collectDialogReportFacts({
  history = [],
  properties = [],
  discussedProperties = [],
  language = 'ru',
  clientName = '',
  waName = '',
  contact = null,
} = {}) {
  const dialog = analyzeConversation(history || [], language || 'ru');
  const userText = (history || [])
    .filter((m) => m.sender === 'user')
    .map((m) => m.text || '')
    .join('\n');

  const timeline =
    extractPurchaseTimelineLabel(userText) ||
    (dialog.hasTimeline ? 'указан в диалоге' : 'не указан');

  const budget =
    dialog.ignoreBudget
      ? 'без ограничения'
      : String(dialog.budgetLabel || '').trim() || 'не указан';

  let waFromStore = String(waName || '').trim();
  if (!waFromStore && contact?.chatId) {
    try {
      const { getClient } = require('./clients-store');
      waFromStore = String(getClient(contact.chatId)?.name || '').trim();
    } catch {
      /* ignore */
    }
  }

  const name = resolveReportClientName(clientName, waFromStore);
  const languageLabel = getLanguageName(language) || language || 'не определён';
  const objectLinks = formatPropertyLinkLines(properties, discussedProperties);

  return {
    name,
    languageLabel,
    objectLine: formatObjectLine(properties, dialog),
    objectLinks,
    budget,
    timeline,
    mortgage: formatMortgageLine(dialog),
    phone: contact?.display || '',
    waLink: contact?.waLink || '',
  };
}

function buildWhatsAppReportText(facts = {}) {
  const lines = [
    `Имя: ${facts.name || 'не назвал'}`,
    `Язык: ${facts.languageLabel || 'не определён'}`,
    `Объект: ${facts.objectLine || 'ещё не выбран'}`,
    ...(Array.isArray(facts.objectLinks) ? facts.objectLinks : []),
    `Бюджет: ${facts.budget || 'не указан'}`,
    `Срок: ${facts.timeline || 'не указан'}`,
    `Ипотека: ${facts.mortgage || 'не уточнено'}`,
    facts.phone ? `Тел: ${facts.phone}` : null,
  ].filter((x) => x != null);

  const text = lines.join('\n');
  return text.length > 2500 ? `${text.slice(0, 2480)}…` : text;
}

/**
 * Сформировать отчёт по полной истории и отправить главному менеджеру (WhatsApp + Telegram).
 * @param {{
 *   chatId: string,
 *   trigger?: string,
 *   language?: string,
 *   preview?: string,
 *   clientName?: string,
 *   properties?: Array,
 *   conversationHistory?: Array,
 *   force?: boolean,
 * }} payload
 */
async function queueManagerDialogReport(payload = {}) {
  const {
    chatId,
    trigger = 'property_interest',
    language = 'ru',
    preview = '',
    clientName = '',
    properties = [],
    discussedProperties = [],
    conversationHistory = null,
    force = false,
  } = payload;

  if (!chatId) return null;
  if (!force && !shouldSendDialogReport(chatId, trigger, properties)) {
    console.log(`📋 Отчёт менеджеру пропущен (cooldown/без изменений): ${chatId}`);
    return null;
  }

  const contact = formatContactDisplay(chatId);
  contact.chatId = chatId;
  let waName = '';
  try {
    const { getClient } = require('./clients-store');
    waName = String(getClient(chatId)?.name || '').trim();
  } catch {
    waName = '';
  }
  const history =
    Array.isArray(conversationHistory) && conversationHistory.length
      ? conversationHistory.slice(-200)
      : loadFullHistory(chatId);

  const discussed =
    Array.isArray(discussedProperties) && discussedProperties.length
      ? discussedProperties
      : (() => {
          try {
            const { getDiscussedProperties } = require('./property-interest');
            return getDiscussedProperties(chatId, language);
          } catch {
            return [];
          }
        })();

  const facts = collectDialogReportFacts({
    history,
    properties,
    discussedProperties: discussed,
    language,
    clientName,
    waName,
    contact,
  });
  const waText = buildWhatsAppReportText(facts);
  const summary = waText;

  let waSent = false;
  const target = managerWhatsAppChatId();
  if (sendWhatsAppFn && target) {
    try {
      await sendWhatsAppFn(target, waText);
      waSent = true;
      console.log(`📋 Отчёт отправлен менеджеру в WhatsApp → ${target}`);
    } catch (e) {
      console.warn('⚠️ Не удалось отправить отчёт в WhatsApp менеджеру:', e.message);
    }
  } else if (!target) {
    console.warn('⚠️ Не задан номер для отчёта менеджеру');
  } else if (!sendWhatsAppFn) {
    console.warn('⚠️ WhatsApp sender для отчёта ещё не готов');
  }

  try {
    const { notifyDialogReport } = require('./telegram-notify');
    notifyDialogReport({
      phoneDisplay: contact.display,
      waLink: contact.waLink,
      languageLabel: facts.languageLabel,
      trigger,
      clientName: facts.name,
      properties,
      summary: waText,
      waSent,
    });
  } catch (e) {
    console.warn('⚠️ telegram dialog report:', e.message);
  }

  // Панель админки: заявка на покупку + открытый handoff
  try {
    const { attachDialogSummaryToPurchaseRequest } = require('./purchase-requests');
    attachDialogSummaryToPurchaseRequest(chatId, summary, {
      language,
      preview,
      properties,
      trigger,
      clientName,
    });
  } catch (e) {
    console.warn('⚠️ attachDialogSummaryToPurchaseRequest:', e.message);
  }

  try {
    const { updateOpenHandoffSummary } = require('./handoff-leads');
    // Не затираем уже готовую выжимку handoff длинным/коротким дублем,
    // если отчёт пришёл после generateHandoffSummary.
    if (typeof updateOpenHandoffSummary === 'function' && !payload.summary) {
      updateOpenHandoffSummary(chatId, summary, { trigger, preview });
    }
  } catch {
    /* optional */
  }

  markReportSent(chatId, trigger, properties, { summaryPreview: summary });
  return { summary, waSent, waText };
}

module.exports = {
  STATE_PATH,
  DEFAULT_REPORT_WHATSAPP,
  setManagerWhatsAppSender,
  managerWhatsAppChatId,
  shouldSendDialogReport,
  queueManagerDialogReport,
  collectDialogReportFacts,
  buildWhatsAppReportText,
  resolveReportClientName,
  loadFullHistory,
  reportsEnabled,
};
