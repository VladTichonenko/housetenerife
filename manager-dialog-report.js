'use strict';

const fs = require('fs');
const path = require('path');
const { formatContactDisplay, getManagerContact, REASON_LABELS } = require('./manager-handoff');
const { generateHandoffSummary } = require('./handoff-summary');
const { getLanguageName } = require('./language-detector');
const { buildRuntimeHistory } = require('./conversation-history');

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
  const { phone } = getManagerContact();
  const digits = String(phone || '').replace(/\D/g, '');
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

function formatPropertiesBlock(properties) {
  const list = (properties || []).slice(0, 5);
  if (!list.length) return 'Объект: ещё не зафиксирован явно';
  return list
    .map((p, i) => {
      const title = p.title || p.id || 'объект';
      const price = p.price ? ` — ${p.price}` : '';
      const url = p.siteUrl || p.url || '';
      return `${i + 1}. ${title}${price}${url ? `\n   ${url}` : ''}`;
    })
    .join('\n');
}

function buildWhatsAppReportText({
  contact,
  language,
  trigger,
  properties,
  summary,
  clientName,
}) {
  const { name: managerName } = getManagerContact();
  const reason =
    REASON_LABELS[trigger] ||
    (trigger === 'property_interest'
      ? 'клиент указал интерес к объекту'
      : trigger === 'call_requested'
        ? 'клиент согласился на созвон'
        : trigger);

  const lines = [
    '📋 Отчёт по диалогу с клиентом',
    '',
    managerName ? `Для: ${managerName}` : null,
    clientName ? `Клиент: ${clientName}` : null,
    contact?.display ? `📞 ${contact.display}` : null,
    language ? `🌍 ${getLanguageName(language) || language}` : null,
    `Причина отчёта: ${reason}`,
    '',
    '🏠 Интерес к объекту(ам):',
    formatPropertiesBlock(properties),
    '',
    '📝 Что обсуждали и к чему пришли:',
    String(summary || 'Выжимка недоступна').trim(),
  ].filter((x) => x != null);

  if (contact?.waLink) {
    lines.push('', `Открыть чат: ${contact.waLink}`);
  }

  const text = lines.join('\n');
  // WhatsApp комфортный лимит
  return text.length > 3800 ? `${text.slice(0, 3780)}…` : text;
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
    conversationHistory = null,
    force = false,
  } = payload;

  if (!chatId) return null;
  if (!force && !shouldSendDialogReport(chatId, trigger, properties)) {
    console.log(`📋 Отчёт менеджеру пропущен (cooldown/без изменений): ${chatId}`);
    return null;
  }

  const contact = formatContactDisplay(chatId);
  const history =
    Array.isArray(conversationHistory) && conversationHistory.length
      ? conversationHistory.slice(-200)
      : loadFullHistory(chatId);

  let summary = payload.summary;
  if (!summary) {
    try {
      summary = await generateHandoffSummary(history, {
        reasonKey: trigger === 'property_interest' ? 'purchase' : trigger,
        preview,
        language,
        clientName,
        mode: 'manager_report',
      });
    } catch (e) {
      summary = `Не удалось сформировать выжимку: ${e.message}`;
    }
  }

  const waText = buildWhatsAppReportText({
    contact,
    language,
    trigger,
    properties,
    summary,
    clientName,
  });

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
    console.warn('⚠️ MANAGER_WHATSAPP не задан — отчёт только в Telegram/панель');
  } else if (!sendWhatsAppFn) {
    console.warn('⚠️ WhatsApp sender для отчёта ещё не готов');
  }

  try {
    const { notifyDialogReport } = require('./telegram-notify');
    notifyDialogReport({
      phoneDisplay: contact.display,
      waLink: contact.waLink,
      languageLabel: getLanguageName(language),
      trigger,
      clientName,
      properties,
      summary,
      waSent,
    });
  } catch (e) {
    console.warn('⚠️ telegram dialog report:', e.message);
  }

  markReportSent(chatId, trigger, properties, { summaryPreview: summary });
  return { summary, waSent, waText };
}

module.exports = {
  STATE_PATH,
  setManagerWhatsAppSender,
  managerWhatsAppChatId,
  shouldSendDialogReport,
  queueManagerDialogReport,
  loadFullHistory,
  reportsEnabled,
};
