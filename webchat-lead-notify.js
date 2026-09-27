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

function alreadySentBrief(chatId) {
  const prev = loadState().chats[String(chatId)];
  return Boolean(prev?.briefSentAt);
}

function markNotified(chatId, meta = {}) {
  const state = loadState();
  const prev = state.chats[String(chatId)] || {};
  state.chats[String(chatId)] = {
    ...prev,
    sentAt: prev.sentAt || new Date().toISOString(),
    name: String(meta.name || prev.name || '').slice(0, 80),
    phone: String(meta.phone || prev.phone || '').slice(0, 40),
    channel: String(meta.channel || prev.channel || '').slice(0, 40),
    pageTitle: String(meta.pageTitle || prev.pageTitle || '').slice(0, 120),
  };
  saveState(state);
}

function markBriefSent(chatId, meta = {}) {
  const state = loadState();
  const prev = state.chats[String(chatId)] || {};
  state.chats[String(chatId)] = {
    ...prev,
    briefSentAt: new Date().toISOString(),
    briefPreview: String(meta.briefPreview || '').slice(0, 200),
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

/**
 * Есть ли уже о чём писать выжимку (не только имя+телефон с первого сообщения).
 * Имя/телефон спрашиваем сразу → первый отчёт без выжимки; brief — после реального диалога.
 */
function hasSubstanceForBrief(history = [], leadPhone = null) {
  const msgs = Array.isArray(history) ? history : [];
  const userMsgs = msgs.filter((m) => m.sender === 'user');
  const botMsgs = msgs.filter((m) => m.sender === 'assistant' || m.sender === 'bot');

  // Нужен хотя бы один ответ бота после контактов и ещё одно содержательное сообщение клиента.
  if (botMsgs.length < 1) return false;
  if (userMsgs.length < 2) return false;

  const phoneDigits = String(leadPhone?.digits || leadPhone?.e164 || '').replace(/\D/g, '');
  let substantive = 0;
  for (const m of userMsgs) {
    let t = String(m.text || '').trim();
    if (!t) continue;
    if (phoneDigits) {
      t = t.replace(new RegExp(phoneDigits.replace(/(\d)/g, '$1\\D*'), 'g'), ' ');
    }
    t = t
      .replace(/(?:\+|00)?\d[\d\s().\-]{6,22}\d/g, ' ')
      .replace(
        /whats?\s*app|ват[сc]ап|вацап|telegram|телеграм|\bтг\b|\btg\b|звонк\w*|позвон\w*|созвон\w*|\bcall\b/gi,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim();

    // Короткое «Андрей» / «ок» — не тема для выжимки.
    if (t.length < 18 && !/[?]/.test(t)) continue;
    if (/^(привет|здравствуй|добрый|hi|hello|hola|ok|ок|да|нет|yes|no)\b/i.test(t) && t.length < 25) {
      continue;
    }
    substantive += 1;
  }

  // Минимум одно содержательное сообщение клиента сверх контактов.
  return substantive >= 1 && msgs.length >= 3;
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

function buildWebchatBriefMessage({ name, phone, channel, pageTitle, pageUrl, language, brief }) {
  const lines = [
    '🌐 Выжимка по webchat',
    `Имя: ${name || 'не назвал'}`,
    `Тел: ${phone?.display || phone?.e164 || phone || '—'}`,
    channel ? `Связь: ${channel}` : null,
    `Объект: ${String(pageTitle || '').trim() || 'не указан'}`,
    pageUrl ? String(pageUrl).trim() : null,
    language ? `Язык: ${language}` : null,
    brief ? `\nО разговоре:\n${String(brief).trim()}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

async function sendWebchatTelegramMirror({ phone, name, pageTitle, pageUrl, language, trigger, summary }) {
  try {
    const { notifyDialogReport } = require('./telegram-notify');
    const digits = String(phone?.digits || String(phone || '').replace(/\D/g, ''));
    notifyDialogReport({
      phoneDisplay: phone?.display || phone || '',
      waLink: digits ? `https://wa.me/${digits}` : '',
      languageLabel: language,
      trigger,
      clientName: name || '',
      properties: pageTitle || pageUrl ? [{ title: pageTitle, siteUrl: pageUrl }] : [],
      summary,
      waSent: true,
    });
  } catch {
    /* optional */
  }
}

/**
 * Два шага:
 * 1) Как только в webchat появился телефон — сразу лид (имя/тел/объект), БЕЗ AI-выжимки
 *    (имя и телефон просим в первом сообщении, говорить ещё не о чем).
 * 2) Когда диалог уже содержательный — один раз досылаем «О разговоре» с AI-brief.
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

  const lead = extractWebchatLead(text, history);
  const state = loadState().chats[String(chatId)] || {};

  // --- Step 1: contact lead (once) ---
  if (!alreadyNotified(chatId)) {
    if (!lead?.phone) return null;

    const waText = buildWebchatLeadMessage({
      name: lead.name,
      phone: lead.phone,
      channel: lead.channel,
      pageTitle,
      pageUrl,
      language,
      brief: '', // специально пусто: диалог ещё не начался
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
      await sendWebchatTelegramMirror({
        phone: lead.phone,
        name: lead.name,
        pageTitle,
        pageUrl,
        language,
        trigger: 'webchat_lead',
        summary: waText,
      });
      return { kind: 'lead', waText, phone: lead.phone.display, name: lead.name };
    } catch (e) {
      console.warn('⚠️ Webchat lead WhatsApp send failed:', e.message);
      return null;
    }
  }

  // --- Step 2: AI brief after real conversation (once) ---
  if (alreadySentBrief(chatId)) return null;

  const phoneMeta =
    lead?.phone ||
    (state.phone
      ? {
          display: state.phone,
          e164: state.phone,
          digits: String(state.phone).replace(/\D/g, ''),
        }
      : null);

  if (!hasSubstanceForBrief(history, phoneMeta)) return null;

  let brief = '';
  try {
    const { generateDialogBrief } = require('./handoff-summary');
    brief = await generateDialogBrief(history, {
      clientName: lead?.name || state.name || '',
      language,
      pageTitle: pageTitle || state.pageTitle || '',
      source: 'webchat',
    });
  } catch (e) {
    console.warn('⚠️ webchat dialog brief:', e.message);
  }

  if (!String(brief || '').trim()) return null;

  const waText = buildWebchatBriefMessage({
    name: lead?.name || state.name || '',
    phone: phoneMeta,
    channel: lead?.channel || state.channel || '',
    pageTitle: pageTitle || state.pageTitle || '',
    pageUrl,
    language,
    brief,
  });

  try {
    const result = await sendManagerReportWhatsApp(waText);
    if (!result?.ok) return null;

    markBriefSent(chatId, { briefPreview: brief });
    console.log(`📋 Webchat brief → WhatsApp ${result.target}`);
    await sendWebchatTelegramMirror({
      phone: phoneMeta,
      name: lead?.name || state.name || '',
      pageTitle: pageTitle || state.pageTitle || '',
      pageUrl,
      language,
      trigger: 'webchat_brief',
      summary: waText,
    });
    return { kind: 'brief', waText, brief };
  } catch (e) {
    console.warn('⚠️ Webchat brief WhatsApp send failed:', e.message);
    return null;
  }
}

module.exports = {
  extractPhoneFromText,
  extractWebchatLead,
  detectContactChannel,
  buildWebchatLeadMessage,
  buildWebchatBriefMessage,
  hasSubstanceForBrief,
  maybeNotifyWebchatLead,
  STATE_PATH,
};
