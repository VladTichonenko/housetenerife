'use strict';

const { getKnowledgeBase } = require('./knowledge-base');
const { getTranslation } = require('./phone-utils');
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

  if (
    /(?:просмотр|посмотреть|запиш|записать|организуй.*просмотр|созвон|созвониться|перезвон|позвоните|позвони)/i.test(
      lower
    )
  ) {
    return true;
  }

  if (/(?:viewing|schedule\s+a\s+call|call\s+me|book\s+a\s+view|arrange\s+a\s+visit)/i.test(lower)) {
    return true;
  }

  if (/(?:visita|agendar\s+(?:una\s+)?visita|llamar|llamada|crear\s+una\s+llamada)/i.test(lower)) {
    return true;
  }

  return false;
}

function detectAffirmativeResponse(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t || t.length > 120) return false;
  if (detectNegativeResponse(text)) return false;

  if (
    /^(?:да|ага|угу|ок|okay|ok|yes|yeah|yep|yup|sure|please|pls|go\s+ahead|of\s+course|why\s+not|давай|конечно|хочу|please\s+do|sounds\s+good|perfect|great|si|sí|claro|vale|por\s+favor|de\s+acuerdo|perfecto|genial|👍|✅)$/i.test(
      t
    )
  ) {
    return true;
  }

  return (
    /(?:^|\s)(?:да|yes|yeah|yep|sure|ok|okay|please|давай|конечно|хочу|sí|si|claro|vale)(?:[\s,.!?]|$)/i.test(
      t
    ) &&
    !/(?:не\s+да|not\s+yes|no\s+thanks)/i.test(t)
  );
}

function detectNegativeResponse(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return false;
  return (
    /^(?:нет|no|nope|nah|не\s+надо|не\s+нужно|not\s+now|later|maybe\s+later|позже|потом|спасибо\s+нет|no\s+gracias|not\s+yet|ещё\s+нет|пока\s+нет)$/i.test(
      t
    ) ||
    /(?:не\s+(?:хочу|надо|нужен|сейчас)|don't\s+want|not\s+interested|sin\s+interés|ahora\s+no)/i.test(
      t
    )
  );
}

/** Ответ ассистента похож на предложение созвона / связи с менеджером */
function detectCallOfferInAssistantText(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  const hasOffer =
    /(?:созвон|созвониться|перезвон|позвон|звонок|связаться|свяжется|обсудить\s+(?:это|всё|все)|на\s+связи)/i.test(
      t
    ) ||
    /(?:schedule\s+a\s+call|call\s+you|get\s+on\s+a\s+call|speak\s+(?:with|to)|connect\s+you|reach\s+out)/i.test(
      t
    ) ||
    /(?:llamada|llamar|crear\s+una\s+llamada|hablar\s+contigo|ponerse\s+en\s+contacto)/i.test(t);
  const hasQuestion = /\?/.test(t);
  return hasOffer && hasQuestion;
}

/**
 * Краткий контекст для предложения созвона (текущий шаг диалога).
 */
function buildCallOfferContext(dialog, lang = 'ru') {
  const l = ['ru', 'en', 'es'].includes(lang) ? lang : 'en';
  const type = dialog?.propertyTypeLabel;
  const region = dialog?.regionLabel;
  const area = dialog?.microAreaLabel;
  const stage = dialog?.stage;

  if (dialog?.hasPropertyInterest) {
    if (l === 'en') return 'the property you liked and next steps';
    if (l === 'es') return 'la propiedad que te interesa y los siguientes pasos';
    return 'понравившийся объект и следующие шаги';
  }

  const parts = [];
  if (type && !/уточняется|TBC|por aclarar/i.test(type)) parts.push(type);
  if (region && !/уточняется|TBC|por aclarar/i.test(region)) parts.push(region);
  if (area && area !== '—' && !/уточняется|TBC|por aclarar/i.test(area)) parts.push(area);

  if (parts.length) {
    const joined = parts.join(l === 'ru' ? ', ' : ', ');
    if (l === 'en') return `your search (${joined})`;
    if (l === 'es') return `tu búsqueda (${joined})`;
    return `ваш запрос (${joined})`;
  }

  const byStage = {
    NEED_PROPERTY_TYPE: {
      ru: 'подбор недвижимости — с чего начать',
      en: 'finding the right property',
      es: 'encontrar la propiedad adecuada',
    },
    NEED_REGION: {
      ru: 'выбор региона и возможностей',
      en: 'choosing the right region',
      es: 'elegir la región adecuada',
    },
    NEED_PURPOSE: {
      ru: 'цель покупки и стратегию',
      en: 'your goals and strategy',
      es: 'tus objetivos y estrategia',
    },
    NEED_BUDGET: {
      ru: 'бюджет и реальные варианты',
      en: 'budget and realistic options',
      es: 'presupuesto y opciones realistas',
    },
    NEED_LOCATION: {
      ru: 'район и локацию',
      en: 'area and location',
      es: 'zona y ubicación',
    },
    SHOW_LISTINGS: {
      ru: 'подборку объектов',
      en: 'the shortlist and your options',
      es: 'la selección de propiedades',
    },
    REFINE: {
      ru: 'ваши пожелания и подборку',
      en: 'your criteria and options',
      es: 'tus criterios y opciones',
    },
  };

  const fallback = byStage[stage] || byStage.REFINE;
  return fallback[l] || fallback.en;
}

function shouldTrackCallOfferAfterReply(dialog, assistantText) {
  if (dialog?.stage === 'OFFER_MANAGER_CALL') return true;
  return detectCallOfferInAssistantText(assistantText);
}

async function startHandoffFromCallAcceptance(
  msg,
  client,
  userLanguage,
  sendMessageSafely,
  { reasonKey = 'handoff', preview = '', conversationHistory = [], clientName = '' } = {}
) {
  const name = clientName || extractClientNameFromHistory(conversationHistory);
  if (name) {
    await connectWithManager(msg, client, userLanguage, sendMessageSafely, {
      reasonKey,
      preview,
      conversationHistory,
      clientName: name,
    });
    return { action: 'connected', clientName: name };
  }
  await beginManagerHandoff(msg, client, userLanguage, sendMessageSafely, {
    reasonKey,
    preview,
  });
  return { action: 'ask_name' };
}

function extractClientNameFromHistory(history) {
  const { extractClientName } = require('./handoff-pending');
  for (const m of [...(history || [])].reverse()) {
    if (m.sender !== 'user') continue;
    const name = extractClientName(m.text);
    if (name && name.length >= 2) return name;
  }
  return '';
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
  return applyManagerPlaceholders(getTranslation(userLanguage, 'handoff_ask_name'));
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

/**
 * Ответ клиенту + запись лида в панель на сайте (без WhatsApp-уведомления менеджеру).
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
  detectAffirmativeResponse,
  detectNegativeResponse,
  detectCallOfferInAssistantText,
  buildCallOfferContext,
  shouldTrackCallOfferAfterReply,
  startHandoffFromCallAcceptance,
  buildVoiceReply,
  buildHandoffAskName,
  buildHandoffNameInvalid,
  buildHandoffReply,
  beginManagerHandoff,
  connectWithManager,
  setRecordHandoff,
};
