'use strict';

const fs = require('fs');
const path = require('path');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const { extractClientName } = require('./handoff-pending');
const { getCountryName } = require('./country-names');
const { getLanguageName } = require('./language-detector');
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
          return presentPhone(e164);
        }
      }
    }
  }
  return null;
}

/**
 * Международный вид: код страны отдельно (+49 7564 319156), плюс страна.
 * Номер без «+» не угадываем — иначе код страны приклеивается наугад или пропадает.
 */
function presentPhone(raw) {
  const source = typeof raw === 'string' ? raw : raw?.e164 || raw?.display || '';
  const text = String(source || '').trim();
  if (!text || text === '—' || /whatsapp id/i.test(text)) return null;
  let parsed = null;
  try {
    parsed = parsePhoneNumberFromString(text);
  } catch {
    parsed = null;
  }
  if (!parsed || !parsed.isValid()) return null;
  const e164 = parsed.format('E.164');
  const country = parsed.country || '';
  return {
    e164,
    digits: e164.replace(/\D/g, ''),
    display: parsed.formatInternational(),
    country,
    countryName: getCountryName(country),
  };
}

function isPlaceholderName(name) {
  const n = String(name || '').trim();
  if (!n) return true;
  if (/^(website chat|whatsapp|guest|гость|—|-)$/i.test(n)) return true;
  if (/^whatsapp id\b/i.test(n)) return true;
  if (/^гость сайта\b/i.test(n)) return true;
  return false;
}

function isGenericClientName(name) {
  const n = String(name || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!n || isPlaceholderName(n)) return true;
  const low = n.toLowerCase();
  if (/house\s+tenerife|housetenerife/i.test(low)) return true;
  if (
    /^(a|the|an|un|una|el|la|le|das|der|die)\s+(home|house|villa|apartment|flat|property|piso|casa|vivienda|maison|wohnung|haus|дом|квартир\w*|вилл\w*|апартамент\w*|объект)$/i.test(
      low
    )
  ) {
    return true;
  }
  if (
    /^(home|house|villa|apartment|flat|property|piso|casa|vivienda|maison|wohnung|haus|дом|квартира|вилла|апартаменты|объект)$/i.test(
      low
    )
  ) {
    return true;
  }
  return false;
}

function cleanPersonName(raw) {
  let name = String(raw || '')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
  const candidate = extractClientName(name);
  if (!candidate || isGenericClientName(candidate)) return '';
  return candidate;
}

const NAME_INTRO_RE =
  /(?:my name is|i am|i'm|меня зовут|зовут меня|me llamo|soy|ich hei(?:ß|ss)e|mein name ist|je m['’]appelle|nazywam si[eę]|mi chiamo)\s+([^\n]{2,60})/i;

function extractIntroName(text) {
  const match = String(text || '').match(NAME_INTRO_RE);
  if (!match) return '';
  return cleanPersonName(match[1].split(/[.\n]/)[0]);
}

function isContextLine(text) {
  const t = String(text || '');
  return /\[Website page property/i.test(t) || /I'm looking at this property:/i.test(t);
}

function pickClientName(userLines, savedName = '') {
  const lines = (userLines || []).map((s) => String(s || '').trim()).filter(Boolean);
  for (const line of lines) {
    if (isContextLine(line)) continue;
    const intro = extractIntroName(line);
    if (intro) return intro;
  }
  const saved = cleanPersonName(savedName);
  if (saved) return saved;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (isContextLine(lines[i])) continue;
    const candidate = cleanPersonName(stripPhoneForName(lines[i], null));
    if (candidate) return candidate;
  }
  return '';
}

function extractLabeledPhone(text) {
  const match = String(text || '').match(
    /(?:phone|tel[eé]fono|t[eé]l[eé]phone|telefon|телефон)\s*[:：]?\s*(\+\s?\d[\d\s().-]{6,22}\d)/i
  );
  if (!match) return null;
  return presentPhone(match[1]);
}

function isListingUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return false;
  s = s.replace(/housetenerife\.com/gi, 'housetenerife.eu');
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, '');
    if (!/housetenerife\.eu$/i.test(host)) return false;
    return /\/property\//i.test(u.pathname);
  } catch {
    return /housetenerife\.eu\/(?:[a-z]{2}\/)?property\//i.test(s);
  }
}

function cleanListingUrl(raw) {
  let s = String(raw || '')
    .trim()
    .replace(/[),.;]+$/g, '')
    .replace(/housetenerife\.com/gi, 'housetenerife.eu');
  if (!isListingUrl(s)) return '';
  try {
    const u = new URL(s);
    u.hash = '';
    u.search = '';
    u.hostname = u.hostname.replace(/^www\./, '');
    let path = u.pathname.replace(/\/+$/, '');
    if (path.startsWith('/en/property/')) {
      path = path.replace(/^\/en\/property\//, '/property/');
    }
    return `https://housetenerife.eu${path}`;
  } catch {
    return s.replace(/\/+$/, '');
  }
}

function titleFromListingUrl(url) {
  try {
    const u = new URL(url);
    const slug = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    const words = slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!words || /^\d+$/.test(words)) return 'Объект';
    return words.charAt(0).toUpperCase() + words.slice(1);
  } catch {
    return 'Объект';
  }
}

function isSiteTitle(title) {
  const t = String(title || '')
    .trim()
    .toLowerCase();
  return !t || t === 'house tenerife' || t === 'housetenerife' || t === 'housetenerife.eu';
}

const LISTING_URL_RE =
  /https?:\/\/(?:www\.)?housetenerife\.(?:eu|com)(?:\/(?:ru|es|en|de|fr|pl|nl))?\/property\/[^\s<>\])"'}]+/gi;

function collectListingLinks(history = [], pageUrl = '', pageTitle = '', seeded = []) {
  const byUrl = new Map();
  const add = (title, url, extra = {}) => {
    const siteUrl = cleanListingUrl(url);
    if (!siteUrl) return;
    const prev = byUrl.get(siteUrl) || {
      title: '',
      siteUrl,
      price: '',
      rank: 0,
    };
    const nextTitle = String(title || '').trim();
    if (nextTitle && !isSiteTitle(nextTitle) && !isGenericClientName(nextTitle)) {
      prev.title = nextTitle;
    }
    if (extra.price && !prev.price) prev.price = String(extra.price);
    prev.rank = Math.max(prev.rank, extra.rank || 0);
    byUrl.set(siteUrl, prev);
  };

  for (const prop of seeded || []) {
    add(prop.title, prop.siteUrl || prop.url, { price: prop.price, rank: 3 });
  }

  const texts = (history || []).map((m) => String(m.text || m.body || ''));
  for (const text of texts) {
    const titleLine = text.match(/^Title:\s*(.+)$/im);
    const urlLine = text.match(/^URL:\s*(https?:\/\/\S+)/im);
    if (urlLine) {
      add(titleLine ? titleLine[1] : '', urlLine[1], { rank: 4 });
    }
    const looking = text.match(
      /I'm looking at this property:\s*(?:\[([^\]]+)\]\s*)?(https?:\/\/\S+)/i
    );
    if (looking) add(looking[1] || '', looking[2], { rank: 4 });

    LISTING_URL_RE.lastIndex = 0;
    let match;
    const fromUser = /^(клиент|user)\b/i.test(text) ? 2 : 1;
    while ((match = LISTING_URL_RE.exec(text))) {
      add('', match[0], { rank: fromUser });
    }
  }

  if (isListingUrl(pageUrl)) {
    add(isSiteTitle(pageTitle) ? '' : pageTitle, pageUrl, { rank: 2 });
  }

  return [...byUrl.values()]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 4)
    .map((item) => ({
      title: item.title || titleFromListingUrl(item.siteUrl),
      siteUrl: item.siteUrl,
      price: item.price || '',
    }));
}

function loadInterestedProperties(chatId, language) {
  if (!chatId) return [];
  try {
    const { getInterestedProperties } = require('./property-interest');
    const list = getInterestedProperties(chatId, language || 'ru');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Имя, телефон с кодом страны и объекты — из тех же данных, что видны в модалке чата.
 */
function resolveDialogCardFacts({
  chatId = '',
  history = [],
  pageUrl = '',
  pageTitle = '',
  language = '',
  savedName = '',
  savedPhone = '',
  properties = null,
} = {}) {
  const userLines = (Array.isArray(history) ? history : [])
    .filter((m) => m.sender === 'user' || m.role === 'user')
    .map((m) => String(m.text || ''))
    .map((s) => s.trim())
    .filter(Boolean);

  const name = pickClientName(userLines, savedName);

  let phone = null;
  for (const line of userLines) {
    phone = extractLabeledPhone(line);
    if (phone) break;
  }
  if (!phone) {
    const saved = presentPhone(savedPhone);
    if (saved) phone = saved;
  }
  if (!phone) {
    const blob = userLines.filter((line) => !isContextLine(line)).join('\n');
    const labeled = extractLabeledPhone(blob);
    phone = labeled || extractPhoneFromText(blob);
  }

  const seeded = properties == null ? loadInterestedProperties(chatId, language) : properties;
  const listings = collectListingLinks(history, pageUrl, pageTitle, seeded);
  const langCode = String(language || '').trim().toLowerCase();

  return {
    name,
    phone,
    properties: listings,
    language: langCode,
    languageLabel: langCode ? getLanguageName(langCode) || langCode : '',
    channel: detectContactChannel(userLines.join('\n')),
  };
}

function propertyLines(properties, pageTitle, pageUrl) {
  const list = (properties || []).filter((p) => p && isListingUrl(p.siteUrl || p.url));
  const lines = [];
  if (!list.length) {
    if (isListingUrl(pageUrl)) {
      lines.push(`Объект: ${!isSiteTitle(pageTitle) && pageTitle ? pageTitle : 'объект'}`);
      lines.push(cleanListingUrl(pageUrl));
      return lines;
    }
    lines.push('Объект: не указан');
    return lines;
  }
  const main = list[0];
  const price = main.price ? ` — ${main.price}` : '';
  lines.push(`Объект: ${main.title || 'объект'}${price}`);
  lines.push(main.siteUrl);
  if (list.length > 1) {
    lines.push('Ещё смотрел:');
    for (const item of list.slice(1)) {
      lines.push(`• ${item.title || 'объект'}${item.price ? ` — ${item.price}` : ''}`);
      lines.push(item.siteUrl);
    }
  }
  return lines;
}

function renderLeadCard({
  heading,
  name,
  phone,
  channel,
  pageTitle,
  pageUrl,
  language,
  brief,
  properties,
}) {
  const shown = presentPhone(phone) || phone;
  const phoneText = shown?.display
    ? `Тел: ${shown.display}${shown.countryName ? ` (${shown.countryName})` : ''}`
    : 'Тел: —';
  const lang = language ? getLanguageName(String(language).toLowerCase()) || language : '';
  const lines = [
    heading,
    `Имя: ${name || 'не назвал'}`,
    phoneText,
    channel ? `Связь: ${channel}` : null,
    ...propertyLines(properties, pageTitle, pageUrl),
    lang ? `Язык: ${lang}` : null,
    brief ? `\nО разговоре:\n${String(brief).trim()}` : null,
  ].filter((line) => line != null && line !== '');
  return lines.join('\n');
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
 * Контактная форма webchat отправляет имя, телефон и канал одним сообщением.
 * Забираем только значение из первой строки, не отдавая весь блок общему
 * эвристическому парсеру имени.
 */
function extractContactFormName(text) {
  const match = String(text || '').match(
    /(?:(?:name|имя|nombre|nom|imi[eę])\s*:\s*|(?:my name is|i am|i'm|меня зовут|зовут меня|me llamo|soy|mein name ist|ich hei(?:ß|ss)e|je m['’]appelle|nazywam si[eę]|mi chiamo)\s+)([^\n.]{2,60})/i
  );
  if (!match) return '';
  return extractClientName(match[1].trim()) || '';
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
  let phone = null;
  for (const line of userLines) {
    phone = extractLabeledPhone(line);
    if (phone) break;
  }
  if (!phone) phone = extractPhoneFromText(blob);
  if (!phone) return null;

  let name = '';
  for (const line of userLines) {
    name = extractContactFormName(line);
    if (name) break;
  }
  if (!name) name = pickClientName(userLines, '');
  if (!name) {
    for (const line of [...userLines].reverse()) {
      const candidate = extractClientName(stripPhoneForName(line, phone));
      if (candidate) {
        name = candidate;
        break;
      }
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

function buildWebchatLeadMessage(fields = {}) {
  return renderLeadCard({
    heading: '🌐 Заявка с сайта (webchat)',
    ...fields,
  });
}

function buildWebchatBriefMessage(fields = {}) {
  return renderLeadCard({
    heading: '🌐 Выжимка по webchat',
    ...fields,
  });
}

async function sendWebchatTelegramMirror({ phone, name, properties, language, trigger, summary }) {
  try {
    const { notifyDialogReport } = require('./telegram-notify');
    const shown = presentPhone(phone) || phone;
    const digits = String(shown?.digits || '').replace(/\D/g, '');
    const listings = (properties || []).filter((p) => isListingUrl(p?.siteUrl || p?.url));
    notifyDialogReport({
      phoneDisplay: shown?.display || '',
      waLink: digits ? `https://wa.me/${digits}` : '',
      languageLabel: language ? getLanguageName(language) || language : '',
      trigger,
      clientName: name || '',
      properties: listings.map((p) => ({
        title: p.title || '',
        siteUrl: p.siteUrl || p.url || '',
        price: p.price || '',
      })),
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
  const facts = resolveDialogCardFacts({
    chatId,
    history,
    pageUrl,
    pageTitle,
    language,
    savedName: state.name,
    savedPhone: state.phone,
  });
  const name = facts.name || lead?.name || '';
  const phone = facts.phone || lead?.phone || null;
  const properties = facts.properties || [];
  const mainTitle = properties[0]?.title || '';

  // --- Step 1: contact lead (once) ---
  if (!alreadyNotified(chatId)) {
    if (!phone) return null;

    const waText = buildWebchatLeadMessage({
      name,
      phone,
      channel: facts.channel || lead?.channel || '',
      pageTitle: mainTitle,
      pageUrl: properties[0]?.siteUrl || '',
      properties,
      language,
      brief: '', // специально пусто: диалог ещё не начался
    });

    try {
      const result = await sendManagerReportWhatsApp(waText);
      if (!result?.ok) return null;

      markNotified(chatId, {
        name,
        phone: phone.display || phone.e164 || '',
        channel: facts.channel || lead?.channel || '',
        pageTitle: mainTitle,
      });
      console.log(`📋 Webchat lead → WhatsApp ${result.target}: ${phone.display || phone.e164}`);
      await sendWebchatTelegramMirror({
        phone,
        name,
        properties,
        language,
        trigger: 'webchat_lead',
        summary: waText,
      });
      return { kind: 'lead', waText, phone: phone.display || phone.e164, name };
    } catch (e) {
      console.warn('⚠️ Webchat lead WhatsApp send failed:', e.message);
      return null;
    }
  }

  // --- Step 2: AI brief after real conversation (once) ---
  if (alreadySentBrief(chatId)) return null;

  if (!hasSubstanceForBrief(history, phone)) return null;

  let brief = '';
  try {
    const { generateDialogBrief } = require('./handoff-summary');
    brief = await generateDialogBrief(history, {
      clientName: name,
      language,
      pageTitle: mainTitle,
      source: 'webchat',
    });
  } catch (e) {
    console.warn('⚠️ webchat dialog brief:', e.message);
  }

  if (!String(brief || '').trim()) return null;

  const waText = buildWebchatBriefMessage({
    name,
    phone,
    channel: facts.channel || state.channel || '',
    pageTitle: mainTitle,
    pageUrl: properties[0]?.siteUrl || '',
    properties,
    language,
    brief,
  });

  try {
    const result = await sendManagerReportWhatsApp(waText);
    if (!result?.ok) return null;

    markBriefSent(chatId, { briefPreview: brief });
    console.log(`📋 Webchat brief → WhatsApp ${result.target}`);
    await sendWebchatTelegramMirror({
      phone,
      name,
      properties,
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

function readCachedPanelBrief(chatId, msgCount) {
  const prev = loadState().chats[String(chatId)];
  if (!prev?.panelBrief || Number(prev.panelBriefCount) !== Number(msgCount)) return null;
  const age = Date.now() - Date.parse(prev.panelBriefAt || '');
  if (!Number.isFinite(age) || age > 30 * 60 * 1000) return null;
  return prev.panelBrief;
}

function rememberPanelBrief(chatId, msgCount, card) {
  const state = loadState();
  const prev = state.chats[String(chatId)] || {};
  state.chats[String(chatId)] = {
    ...prev,
    panelBriefAt: new Date().toISOString(),
    panelBriefCount: msgCount,
    panelBrief: card,
  };
  saveState(state);
}

/**
 * Выжимка по запросу из панели: имя, телефон с кодом страны, ссылка на объект, текст «о разговоре».
 */
async function buildDialogBriefCard(chatId, { force = false } = {}) {
  const id = String(chatId || '').trim();
  if (!id) {
    const err = new Error('Не указан чат.');
    err.status = 400;
    throw err;
  }

  const { getMessages } = require('./conversation-store');
  const { buildRuntimeHistory } = require('./conversation-history');
  const { getClient } = require('./clients-store');
  const { formatContactDisplay } = require('./manager-handoff');

  const messages = getMessages(id);
  const history = buildRuntimeHistory(messages, 200);
  const client = getClient(id);
  const state = loadState().chats[id] || {};
  const msgCount = messages.length;

  if (!force) {
    const cached = readCachedPanelBrief(id, msgCount);
    if (cached) return cached;
  }

  const contact = formatContactDisplay(client?.senderId || id);
  const savedPhone =
    state.phone ||
    (contact?.phone && !contact.isLid ? contact.display : '') ||
    (client?.phoneDisplay && client.phoneDisplay !== '—' && !/whatsapp id/i.test(client.phoneDisplay)
      ? client.phoneDisplay
      : '');
  const savedName = [state.name, client?.name, client?.chatName].find(
    (value) => value && !isPlaceholderName(value) && !isGenericClientName(value)
  );

  const facts = resolveDialogCardFacts({
    chatId: id,
    history,
    language: client?.language || '',
    savedName: savedName || '',
    savedPhone,
  });

  let brief = '';
  try {
    const { generateDialogBrief } = require('./handoff-summary');
    brief = await generateDialogBrief(history, {
      clientName: facts.name,
      language: facts.language || client?.language || 'ru',
      pageTitle: facts.properties[0]?.title || '',
      source: id.startsWith('web:') ? 'webchat' : 'whatsapp',
    });
  } catch (e) {
    console.warn('⚠️ panel dialog brief:', e.message);
  }

  const heading = id.startsWith('web:') ? '🌐 Выжимка по webchat' : '💬 Выжимка по диалогу';
  const text = renderLeadCard({
    heading,
    name: facts.name,
    phone: facts.phone,
    channel: facts.channel,
    properties: facts.properties,
    language: facts.language,
    brief,
  });

  const card = {
    chatId: id,
    source: id.startsWith('web:') ? 'web' : 'whatsapp',
    name: facts.name || '',
    phoneDisplay: facts.phone?.display || '',
    countryName: facts.phone?.countryName || '',
    channel: facts.channel || '',
    language: facts.language || client?.language || '',
    languageLabel: facts.languageLabel || client?.languageLabel || '',
    properties: facts.properties,
    brief: String(brief || '').trim(),
    text,
  };

  rememberPanelBrief(id, msgCount, card);
  return card;
}

module.exports = {
  extractPhoneFromText,
  extractWebchatLead,
  detectContactChannel,
  buildWebchatLeadMessage,
  buildWebchatBriefMessage,
  resolveDialogCardFacts,
  buildDialogBriefCard,
  hasSubstanceForBrief,
  maybeNotifyWebchatLead,
  presentPhone,
  isGenericClientName,
  STATE_PATH,
};
