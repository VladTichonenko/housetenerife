'use strict';

const fs = require('fs');
const path = require('path');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const { extractClientName } = require('./handoff-pending');
const {
  sendManagerReportWhatsApp,
  reportsEnabled,
} = require('./manager-dialog-report');

function resolveLeadStatePath() {
  if (process.env.WEBCHAT_LEAD_STATE_PATH) {
    return process.env.WEBCHAT_LEAD_STATE_PATH;
  }
  const sessionPath = process.env.SESSION_PATH;
  if (sessionPath && path.isAbsolute(sessionPath)) {
    return path.join(path.dirname(sessionPath), 'webchat-leads.json');
  }
  return path.join(__dirname, 'data', 'webchat-leads.json');
}

const STATE_PATH = resolveLeadStatePath();

function ensureDataDir() {
  const dir = path.dirname(STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_PATH)) return { chats: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return { chats: raw.chats && typeof raw.chats === 'object' ? raw.chats : {} };
  } catch {
    return { chats: {} };
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

function alreadyNotified(chatId) {
  const prev = loadState().chats[String(chatId)];
  return Boolean(prev?.sentAt);
}

function markNotified(chatId, meta = {}) {
  const state = loadState();
  state.chats[String(chatId)] = {
    sentAt: new Date().toISOString(),
    name: String(meta.name || '').slice(0, 80),
    phone: String(meta.phone || '').slice(0, 40),
    channel: String(meta.channel || '').slice(0, 40),
    pageTitle: String(meta.pageTitle || '').slice(0, 120),
  };
  saveState(state);
}

function detectContactChannel(text) {
  const t = String(text || '').toLowerCase();
  if (/whats?\s*app|ват[сc]ап|вацап|\bwa\b|\bw\.?a\.?\b/i.test(t)) return 'WhatsApp';
  if (/telegram|телеграм|\bтг\b|\btg\b/i.test(t)) return 'Telegram';
  if (/звонк|позвон|созвон|\bcall\b|llamad|anruf|appel/i.test(t)) return 'звонок';
  return '';
}

function extractPhoneFromText(text) {
  const raw = String(text || '');
  if (!raw.trim()) return null;

  const candidates = raw.match(/(?:\+|00)?\d[\d\s().\-]{6,22}\d/g) || [];
  for (const chunk of candidates) {
    const compact = chunk.replace(/[^\d+]/g, '').replace(/^00/, '+');
    const tries = [];
    if (compact.startsWith('+')) tries.push(compact);
    else {
      tries.push(`+${compact}`);
      for (const country of ['RU', 'BY', 'UA', 'KZ', 'ES', 'PL', 'DE', 'FR', 'GB', 'US']) {
        tries.push({ text: chunk, country });
      }
    }

    for (const tryItem of tries) {
      let parsed = null;
      try {
        if (typeof tryItem === 'string') {
          parsed = parsePhoneNumberFromString(tryItem);
        } else {
          parsed = parsePhoneNumberFromString(tryItem.text, tryItem.country);
        }
      } catch {
        parsed = null;
      }
      if (parsed && parsed.isValid()) {
        const e164 = parsed.format('E.164');
        const digits = e164.replace(/\D/g, '');
        if (digits.length >= 8 && digits.length <= 15) {
          return { e164, digits, display: e164 };
        }
      }
    }
  }
  return null;
}

function stripPhoneForName(text, phone) {
  let cleaned = String(text || '');
  if (phone?.e164) {
    cleaned = cleaned.replace(phone.e164, ' ');
    cleaned = cleaned.replace(phone.digits, ' ');
  }
  cleaned = cleaned.replace(/(?:\+|00)?\d[\d\s().\-]{6,22}\d/g, ' ');
  cleaned = cleaned
    .replace(
      /whats?\s*app|ват[сc]ап|вацап|telegram|телеграм|\bтг\b|\btg\b|звонк\w*|позвон\w*|созвон\w*|\bcall\b|llamad\w*/gi,
      ' '
    )
    .replace(/[,;|/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

/**
 * Собрать лид из текущего сообщения и недавней истории webchat.
 */
function extractWebchatLead(text, history = []) {
  const userLines = [
    ...(Array.isArray(history)
      ? history.filter((m) => m.sender === 'user').map((m) => m.text || '')
      : []),
    String(text || ''),
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  const blob = userLines.join('\n');
  const phone = extractPhoneFromText(blob);
  if (!phone) return null;

  let name = '';
  for (const line of [...userLines].reverse()) {
    const candidate = extractClientName(stripPhoneForName(line, phone));
    if (candidate) {
      name = candidate;
      break;
    }
  }
  if (!name) {
    const fromBlob = extractClientName(stripPhoneForName(blob, phone));
    if (fromBlob) name = fromBlob;
  }

  const channel = detectContactChannel(blob);
  return { name, phone, channel };
}

function buildWebchatLeadMessage({ name, phone, channel, pageTitle, pageUrl, language, brief }) {
  const lines = [
    '🌐 Заявка с сайта (webchat)',
    `Имя: ${name || 'не назвал'}`,
    `Тел: ${phone?.display || phone?.e164 || '—'}`,
    channel ? `Связь: ${channel}` : null,
    `Объект: ${String(pageTitle || '').trim() || 'не указан'}`,
    pageUrl ? String(pageUrl).trim() : null,
    language ? `Язык: ${language}` : null,
    brief ? `\nО разговоре:\n${String(brief).trim()}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

/**
 * Если в webchat появились телефон (+ опционально имя/канал) — один раз
 * переслать на MANAGER_REPORT_WHATSAPP через ту же WhatsApp-сессию бота.
 * WP-чат и WhatsApp-чат остаются отдельными; общая только сессия для исходящих.
 */
async function maybeNotifyWebchatLead({
  chatId,
  text,
  pageUrl = '',
  pageTitle = '',
  language = 'ru',
  history = [],
} = {}) {
  if (!chatId || !String(chatId).startsWith('web:')) return null;
  if (!reportsEnabled()) return null;
  if (alreadyNotified(chatId)) return null;

  const lead = extractWebchatLead(text, history);
  if (!lead?.phone) return null;

  let brief = '';
  try {
    const { generateDialogBrief } = require('./handoff-summary');
    brief = await generateDialogBrief(history, {
      clientName: lead.name || '',
      language,
      pageTitle,
      source: 'webchat',
    });
  } catch (e) {
    console.warn('⚠️ webchat dialog brief:', e.message);
  }

  const waText = buildWebchatLeadMessage({
    name: lead.name,
    phone: lead.phone,
    channel: lead.channel,
    pageTitle,
    pageUrl,
    language,
    brief,
  });

  try {
    const result = await sendManagerReportWhatsApp(waText);
    if (!result?.ok) return null;

    markNotified(chatId, {
      name: lead.name,
      phone: lead.phone.display,
      channel: lead.channel,
      pageTitle,
    });
    console.log(`📋 Webchat lead → WhatsApp ${result.target}: ${lead.phone.display}`);

    try {
      const { notifyDialogReport } = require('./telegram-notify');
      notifyDialogReport({
        phoneDisplay: lead.phone.display,
        waLink: `https://wa.me/${lead.phone.digits}`,
        languageLabel: language,
        trigger: 'webchat_lead',
        clientName: lead.name || '',
        properties: pageTitle || pageUrl ? [{ title: pageTitle, siteUrl: pageUrl }] : [],
        summary: waText,
        waSent: true,
      });
    } catch {
      /* optional */
    }

    return { waText, phone: lead.phone.display, name: lead.name };
  } catch (e) {
    console.warn('⚠️ Webchat lead WhatsApp send failed:', e.message);
    return null;
  }
}

module.exports = {
  extractPhoneFromText,
  extractWebchatLead,
  detectContactChannel,
  buildWebchatLeadMessage,
  maybeNotifyWebchatLead,
  STATE_PATH,
};
