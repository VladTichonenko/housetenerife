'use strict';

const { getKnowledgeBase } = require('./knowledge-base');
const { formatPhoneNumber, getTranslation } = require('./phone-utils');
const { setPendingHandoff } = require('./handoff-pending');
const { getLanguageName } = require('./language-detector');

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/i;
const DOMAIN_RE =
  /\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|eu|ru|es|org|net|io|co|me|info|uk|de|fr|it|pt|biz|xyz|app|dev|link|site|online|shop|store|pro|cc|ly|gg|tv|fm|ai|nl|pl|cz|sk|be|at|ch|se|no|dk|fi|gr|tr|ua|kz|by)(?:\/[^\s]*)?/i;

const REASON_LABELS = {
  image: 'фото с описанием',
  link: 'ссылка в сообщении',
  handoff: 'запрос связи с менеджером',
};

let recordHandoffFn = null;

function setRecordHandoff(fn) {
  recordHandoffFn = typeof fn === 'function' ? fn : null;
}

function getManagerContact() {
  const kb = getKnowledgeBase();
  const contacts = kb.contacts || {};
  const rep = kb.brand?.representative || kb.company?.representative || 'Максим Куликов';
  const name = String(rep).split('(')[0].trim() || 'Максим Куликов';
  const phone =
    process.env.MANAGER_WHATSAPP || contacts.mobile_whatsapp || '+34 631 252 060';
  return { name, phone };
}

function applyManagerPlaceholders(text, clientName = '') {
  const { name, phone } = getManagerContact();
  const namePart = clientName ? `, ${clientName}` : '';
  return text
    .replace(/\{client_name\}/g, clientName || '')
    .replace(/\{client_name_part\}/g, namePart)
    .replace(/\{manager_name\}/g, name)
    .replace(/\{manager_phone\}/g, phone);
}

function isVoiceMessage(msg) {
  const type = msg?.type;
  return type === 'ptt' || type === 'audio';
}

function isImageMessage(msg) {
  return msg?.type === 'image';
}

function isImageWithDescription(msg, messageText) {
  if (!isImageMessage(msg)) return false;
  return (messageText || '').trim().length >= 3;
}

function containsLink(text) {
  if (!text || typeof text !== 'string') return false;
  if (isCatalogSiteText(text)) return false;
  if (URL_RE.test(text)) return true;
  const match = text.match(DOMAIN_RE);
  if (!match || match.index == null) return false;
  if (match.index > 0 && text[match.index - 1] === '@') return false;
  return true;
}

/** Ссылки на наш каталог — не считаем «передачей менеджеру» */
function isCatalogSiteText(text) {
  return /housetenerife\.eu/i.test(String(text || ''));
}

/**
 * Запрос связи с живым менеджером (не только одно слово «менеджер»).
 */
function wantsManagerHandoff(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const lower = t.toLowerCase().replace(/\s+/g, ' ');

  if (/^(менеджер|manager|mánager|менеджера|hablar con (el )?manager|contact manager)$/i.test(lower)) {
    return true;
  }

  const managerWord = /(?:менеджер|manager|mánager|максим|maxim|kulikov|куликов)/i;
  const intent =
    /(?:хочу|хотел|нужен|нужна|можно|связ|соедин|подключ|переда|передай|позов|напиш|напишите|поговор|говор|позвон|звон|живой|человек|человека|свяжите|свяжитесь|call|speak|talk|contact|connect|human|agent|realtor|asesor|gestor)/i;

  if (managerWord.test(lower) && intent.test(lower)) return true;

  if (
    /(?:связь|contacto|contact)\s+(?:с\s+)?(?:менеджер|manager|максим|maxim)/i.test(lower)
  ) {
    return true;
  }

  if (/(?:передай|передайте|forward).{0,40}(?:менеджер|manager|максим)/i.test(lower)) {
    return true;
  }

  if (/(?:want|need|get).{0,25}(?:manager|human|agent)/i.test(lower)) {
    return true;
  }

  return false;
}

function formatCustomerPhone(chatId) {
  if (!chatId) return '?';
  return String(chatId).replace(/@c\.us$/, '').replace(/@lid$/, '');
}

function buildHandoffReply(userLanguage, translationKey = 'manager_handoff', clientName = '') {
  const key =
    translationKey === 'manager_handoff_image' ||
    translationKey === 'manager_handoff_link'
      ? 'manager_handoff'
      : translationKey;
  const text = getTranslation(userLanguage, key);
  return applyManagerPlaceholders(text, clientName);
}

function buildVoiceReply(userLanguage) {
  return applyManagerPlaceholders(getTranslation(userLanguage, 'voice_reply'));
}

function buildHandoffAskName(userLanguage) {
  return getTranslation(userLanguage, 'handoff_ask_name');
}

function buildHandoffNameInvalid(userLanguage) {
  return getTranslation(userLanguage, 'handoff_name_invalid');
}

/**
 * Запрашивает имя; полная передача — после ответа клиента (completeManagerHandoff).
 */
async function beginManagerHandoff(
  msg,
  client,
  userLanguage,
  sendMessageSafely,
  { reasonKey = 'handoff', preview = '', translationKey = 'manager_handoff' } = {}
) {
  setPendingHandoff(msg.from, {
    reasonKey,
    preview,
    translationKey,
    language: userLanguage,
  });
  const askText = buildHandoffAskName(userLanguage);
  await sendMessageSafely(msg, askText, client);
  console.log(`👤 Ожидание имени для handoff (${reasonKey}): ${msg.from}`);
}

async function notifyManager(client, customerChatId, reasonKey, preview, { clientName, language } = {}) {
  const { phone, name } = getManagerContact();
  const managerId = formatPhoneNumber(phone.replace(/\s/g, ''));
  const customer = formatCustomerPhone(customerChatId);
  const reasonLabel = REASON_LABELS[reasonKey] || reasonKey;
  const languageLabel = language ? getLanguageName(language) : '';
  const lines = [
    '🔔 *Запрос клиента (бот House Tenerife)*',
    `Менеджер: ${name}`,
    `Клиент: +${customer}`,
  ];
  if (clientName) lines.push(`Имя: ${clientName}`);
  if (languageLabel) lines.push(`Язык диалога: ${languageLabel}`);
  lines.push(`Причина: ${reasonLabel}`);
  if (preview) {
    const p = preview.length > 400 ? `${preview.slice(0, 400)}…` : preview;
    lines.push(`Сообщение: ${p}`);
  }
  try {
    await client.sendMessage(managerId, lines.join('\n'), { sendSeen: false });
    console.log(`📤 Уведомление менеджеру (${reasonLabel})`);
    return true;
  } catch (e) {
    console.warn('⚠️ Не удалось уведомить менеджера:', e.message);
    return false;
  }
}

/**
 * Ответ клиенту + уведомление менеджеру в WhatsApp.
 * @param {Function} sendMessageSafely - (msg, text, client) => Promise
 */
async function connectWithManager(
  msg,
  client,
  userLanguage,
  sendMessageSafely,
  {
    reasonKey = 'handoff',
    preview = '',
    translationKey = 'manager_handoff',
    conversationHistory = [],
    clientName = '',
  } = {}
) {
  const replyText = buildHandoffReply(userLanguage, 'manager_handoff', clientName);
  await sendMessageSafely(msg, replyText, client);
  await notifyManager(client, msg.from, reasonKey, preview, {
    clientName,
    language: userLanguage,
  });

  if (recordHandoffFn) {
    try {
      await recordHandoffFn({
        chatId: msg.from,
        language: userLanguage,
        languageLabel: getLanguageName(userLanguage),
        clientName: clientName || '',
        reasonKey,
        preview,
        conversationHistory: conversationHistory || [],
      });
    } catch (e) {
      console.error('⚠️ recordHandoff:', e.message);
    }
  }
}

module.exports = {
  REASON_LABELS,
  formatCustomerPhone,
  getManagerContact,
  isVoiceMessage,
  isImageMessage,
  isImageWithDescription,
  containsLink,
  isCatalogSiteText,
  wantsManagerHandoff,
  buildVoiceReply,
  buildHandoffAskName,
  buildHandoffNameInvalid,
  buildHandoffReply,
  beginManagerHandoff,
  connectWithManager,
  notifyManager,
  setRecordHandoff,
};
