'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const KNOWN_CHATS_PATH =
  process.env.TELEGRAM_KNOWN_CHATS_PATH ||
  path.join(__dirname, 'data', 'telegram-known-chats.json');

/** Чаты, куда удалось доставить алерт (env + сохранённые + из /start). */
const runtimeAlertChatIds = new Set();

function getEnvAlertChatIds() {
  return (process.env.TELEGRAM_ALERT_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const enabled = Boolean(TOKEN);

// Если TELEGRAM_CMD_CHAT_IDS не задан — команды из лички и групп (private/group/supergroup).
const ALLOWED_CMD_CHATS = process.env.TELEGRAM_CMD_CHAT_IDS
  ? process.env.TELEGRAM_CMD_CHAT_IDS.split(',').map((s) => s.trim()).filter(Boolean)
  : null;

const CMD_CHAT_TYPES = new Set(['private', 'group', 'supergroup']);

const ALERTS_PATH =
  process.env.TELEGRAM_ALERTS_PATH ||
  path.join(__dirname, 'data', 'telegram-alerts.json');

const QR_ALERT_COOLDOWN_MS = parseInt(process.env.TELEGRAM_QR_ALERT_COOLDOWN_MS, 10) || 300000;
const DISCONNECT_ALERT_COOLDOWN_MS =
  parseInt(process.env.TELEGRAM_DISCONNECT_COOLDOWN_MS, 10) || 15000;
const NOTIFY_EVERY_MESSAGE =
  process.env.TELEGRAM_NOTIFY_EVERY_MESSAGE !== '0' &&
  process.env.TELEGRAM_NOTIFY_EVERY_MESSAGE !== 'false';

/** Дедуп алертов: одно WA-сообщение → одно Telegram-уведомление (polling + events). */
const notifiedTelegramMsgIds = new Map();
const TELEGRAM_MSG_DEDUP_MS = parseInt(process.env.TELEGRAM_MSG_DEDUP_MS, 10) || 120000;

let lastReportedWaState = null;
let lastDisconnectAlertAt = 0;
let qrAlertSentAt = 0;
let updatesStarted = false;
let pollOffset = 0;
let pollRunning = false;
let telegramApiOk = false;
let authFailureLogged = false;
let updatesMode = null;
let botUsername = '';

function isConfigured() {
  return enabled;
}

function isActive() {
  return enabled && telegramApiOk;
}

function getPrimaryChatId() {
  const ids = getEffectiveAlertChatIds();
  return ids[0] || getEnvAlertChatIds()[0] || '';
}

function getAlertChatIds() {
  return getEffectiveAlertChatIds();
}

function loadKnownAlertChats() {
  ensureDataDir();
  if (!fs.existsSync(KNOWN_CHATS_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(KNOWN_CHATS_PATH, 'utf8'));
    const list = Array.isArray(raw.chats) ? raw.chats : [];
    return list.map((c) => String(c.id)).filter(Boolean);
  } catch {
    return [];
  }
}

function saveKnownAlertChats(entries) {
  ensureDataDir();
  fs.writeFileSync(
    KNOWN_CHATS_PATH,
    JSON.stringify({ chats: entries, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

function registerAlertChat(chatId, meta = {}) {
  const id = String(chatId || '').trim();
  if (!id) return;
  runtimeAlertChatIds.add(id);

  const entries = loadKnownAlertChatEntries();
  if (entries.some((e) => String(e.id) === id)) return;
  entries.push({
    id,
    type: meta.type || 'unknown',
    title: meta.title || '',
    registeredAt: new Date().toISOString()
  });
  saveKnownAlertChats(entries);
  console.log(`📱 Telegram: chat ${id} зарегистрирован для алертов (${meta.type || 'message'})`);
}

function loadKnownAlertChatEntries() {
  ensureDataDir();
  if (!fs.existsSync(KNOWN_CHATS_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(KNOWN_CHATS_PATH, 'utf8'));
    return Array.isArray(raw.chats) ? raw.chats : [];
  } catch {
    return [];
  }
}

function getEffectiveAlertChatIds() {
  return [...new Set([...loadKnownAlertChats(), ...runtimeAlertChatIds])].filter(Boolean);
}

async function discoverChatsFromUpdates() {
  try {
    const { data } = await axios.get(`https://api.telegram.org/bot${TOKEN}/getUpdates`, {
      params: { limit: 100, allowed_updates: ['message', 'my_chat_member'] },
      timeout: 15000,
      validateStatus: () => true
    });
    const found = [];
    for (const update of data.result || []) {
      const chat = update.message?.chat || update.my_chat_member?.chat;
      if (chat?.id) {
        const id = String(chat.id);
        registerAlertChat(id, { type: chat.type, title: chat.title || chat.first_name || '' });
        found.push(id);
      }
    }
    return [...new Set(found)];
  } catch (err) {
    console.warn('telegram-notify discover:', err.message);
    return [];
  }
}

async function canDeliverToChat(chatId) {
  try {
    const { data } = await axios.get(`https://api.telegram.org/bot${TOKEN}/getChat`, {
      params: { chat_id: chatId },
      timeout: 15000,
      validateStatus: () => true
    });
    return data.ok === true;
  } catch {
    return false;
  }
}

async function bootstrapAlertChats(botUsername) {
  for (const chatId of getEnvAlertChatIds()) {
    const ok = await canDeliverToChat(chatId);
    if (ok) {
      runtimeAlertChatIds.add(chatId);
    } else {
      console.error(`❌ Telegram: TELEGRAM_CHAT_ID=${chatId} — доставка невозможна (chat not found)`);
      console.error(
        `💡 Откройте ${botUsername || 'бота'} в Telegram → Start → /whoami → обновите TELEGRAM_CHAT_ID в .env`
      );
    }
  }

  for (const chatId of loadKnownAlertChats()) {
    if (await canDeliverToChat(chatId)) {
      runtimeAlertChatIds.add(chatId);
    }
  }

  if (getEffectiveAlertChatIds().length === 0) {
    console.log('📱 Telegram: ищем chat id в getUpdates…');
    await discoverChatsFromUpdates();
  }

  const finalIds = getEffectiveAlertChatIds();
  if (!finalIds.length) {
    console.error('❌ Telegram-алерты не настроены: нет рабочего chat id.');
    console.error('💡 Напишите боту /start или /whoami — chat сохранится автоматически.');
    return false;
  }

  console.log(`📱 Telegram алерты → ${finalIds.join(', ')}`);
  return true;
}

function disableTelegramApi(reason) {
  telegramApiOk = false;
  updatesStarted = false;
  pollRunning = false;
  if (!authFailureLogged) {
    authFailureLogged = true;
    console.error(`❌ Telegram отключён: ${reason}`);
    console.error('💡 @BotFather → ваш бот → API Token → Revoke → вставьте новый TELEGRAM_BOT_TOKEN в .env');
  }
}

function handleTelegramHttpError(err, context) {
  const status = err.response?.status;
  const detail = err.response?.data?.description || err.message;
  if (status === 401) {
    disableTelegramApi(`${context}: неверный TELEGRAM_BOT_TOKEN (401 Unauthorized)`);
    return true;
  }
  console.warn(`telegram-notify ${context}:`, detail);
  return false;
}

async function ensureTelegramApi() {
  if (!enabled) return false;
  if (telegramApiOk) return true;
  return validateTelegramToken();
}

async function validateTelegramChat(botUsername) {
  for (const chatId of getAlertChatIds()) {
    try {
      const { data } = await axios.get(`https://api.telegram.org/bot${TOKEN}/getChat`, {
        params: { chat_id: chatId },
        timeout: 15000,
        validateStatus: () => true
      });
      if (data.ok) continue;
      const hint = botUsername
        ? `Откройте ${botUsername} в Telegram и нажмите Start (или добавьте бота в группу).`
        : 'Откройте бота в Telegram и нажмите Start.';
      console.warn(`⚠️ Telegram: chat ${chatId} недоступен (${data.description || 'not found'})`);
      console.warn(`💡 ${hint} Узнать id: /whoami`);
    } catch (err) {
      console.warn(`⚠️ Telegram: не удалось проверить chat ${chatId}:`, err.message);
    }
  }
}

function isCommandChatAllowed(msg) {
  const chatId = String(msg.chat.id);
  if (ALLOWED_CMD_CHATS) {
    return ALLOWED_CMD_CHATS.includes(chatId);
  }
  return CMD_CHAT_TYPES.has(msg.chat.type);
}

function parseCommand(text) {
  const trimmed = String(text || '').trim();
  const [cmdRaw] = trimmed.split(/\s+/);
  return cmdRaw.split('@')[0].toLowerCase();
}

async function validateTelegramToken() {
  if (!enabled) return false;
  try {
    const { data } = await axios.get(`https://api.telegram.org/bot${TOKEN}/getMe`, {
      timeout: 15000,
      validateStatus: () => true
    });
    if (data.ok && data.result) {
      telegramApiOk = true;
      authFailureLogged = false;
      botUsername = data.result.username ? `@${data.result.username}` : 'bot';
      await bootstrapAlertChats(botUsername);
      console.log(
        `📱 Telegram OK: ${botUsername} → алерты в ${getEffectiveAlertChatIds().join(', ') || '(ожидание /start)'}`
      );
      await validateTelegramChat(botUsername);
      return true;
    }
    if (data.error_code === 401) {
      disableTelegramApi('getMe: неверный TELEGRAM_BOT_TOKEN (401 Unauthorized)');
      return false;
    }
    disableTelegramApi(`getMe: ${data.description || 'unknown error'}`);
    return false;
  } catch (err) {
    handleTelegramHttpError(err, 'getMe');
    disableTelegramApi('не удалось связаться с api.telegram.org');
    return false;
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function ensureDataDir() {
  const dir = path.dirname(ALERTS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(ALERTS_PATH)) {
    return { notifiedUsers: {}, connectionState: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(ALERTS_PATH, 'utf8'));
    return {
      notifiedUsers: raw.notifiedUsers && typeof raw.notifiedUsers === 'object' ? raw.notifiedUsers : {},
      connectionState: raw.connectionState || null
    };
  } catch {
    return { notifiedUsers: {}, connectionState: null };
  }
}

function saveStore(store) {
  ensureDataDir();
  fs.writeFileSync(
    ALERTS_PATH,
    JSON.stringify(
      {
        notifiedUsers: store.notifiedUsers,
        connectionState: store.connectionState,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  );
}

async function postTelegramMessage(chatId, text, options = {}) {
  const payload = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  };
  if (options.parseMode !== false) {
    payload.parse_mode = options.parseMode || 'HTML';
  }
  try {
    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, payload, {
      timeout: 15000
    });
  } catch (err) {
    if (options.parseMode !== false && err.response?.status === 400) {
      await axios.post(
        `https://api.telegram.org/bot${TOKEN}/sendMessage`,
        { chat_id: chatId, text, disable_web_page_preview: true },
        { timeout: 15000 }
      );
      return;
    }
    throw err;
  }
}

/** Ответ на команду в конкретный чат. */
async function sendTelegram(text, options = {}) {
  if (!(await ensureTelegramApi())) return false;
  const chatId = options.chatId || getPrimaryChatId();
  try {
    await postTelegramMessage(chatId, text, options);
    return true;
  } catch (err) {
    handleTelegramHttpError(err, 'send');
    return false;
  }
}

/** Мгновенные алерты во все рабочие chat id. */
async function sendAlert(text, options = {}) {
  if (!enabled) {
    console.warn('telegram-notify: TELEGRAM_BOT_TOKEN не задан');
    return false;
  }
  if (!(await ensureTelegramApi())) return false;

  let chatIds = options.chatId ? [String(options.chatId)] : getEffectiveAlertChatIds();
  if (!chatIds.length) {
    await discoverChatsFromUpdates();
    chatIds = getEffectiveAlertChatIds();
  }
  if (!chatIds.length) {
    console.error('telegram-notify alert: нет chat id для доставки (напишите боту /start)');
    return false;
  }

  let sent = 0;
  for (const chatId of chatIds) {
    try {
      await postTelegramMessage(chatId, text, options);
      sent++;
      runtimeAlertChatIds.add(chatId);
      console.log(`📱 Telegram alert → chat ${chatId}`);
    } catch (err) {
      const detail = err.response?.data?.description || err.message;
      console.error(`telegram-notify alert → ${chatId}: ${detail}`);
      if (String(detail).includes('chat not found') || String(detail).includes('bot was blocked')) {
        const hint = botUsername || 'бота';
        console.error(`💡 Chat ${chatId} недоступен. Напишите ${hint} → /start → /whoami`);
      }
      handleTelegramHttpError(err, 'alert');
    }
  }
  if (!sent) {
    console.error('telegram-notify: алерт НЕ доставлен ни в один chat');
  }
  return sent > 0;
}

function isEnabled() {
  return isActive();
}

function markTelegramMsgNotified(msgId) {
  if (!msgId) return;
  notifiedTelegramMsgIds.set(msgId, Date.now());
  if (notifiedTelegramMsgIds.size > 5000) {
    const cutoff = Date.now() - TELEGRAM_MSG_DEDUP_MS;
    for (const [id, at] of notifiedTelegramMsgIds) {
      if (at < cutoff) notifiedTelegramMsgIds.delete(id);
    }
  }
}

function wasTelegramMsgNotified(msgId) {
  if (!msgId) return false;
  const at = notifiedTelegramMsgIds.get(msgId);
  if (!at) return false;
  if (Date.now() - at > TELEGRAM_MSG_DEDUP_MS) {
    notifiedTelegramMsgIds.delete(msgId);
    return false;
  }
  return true;
}

/** Мгновенный алерт в Telegram на каждое входящее WhatsApp-сообщение. */
async function notifyIncomingWhatsAppMessage({
  msgId,
  chatId,
  preview,
  chatName,
  phone,
  language,
  isGroup,
  kind
}) {
  if (!NOTIFY_EVERY_MESSAGE || !chatId) return false;
  if (msgId && wasTelegramMsgNotified(msgId)) return false;

  const store = loadStore();
  const isNewUser = !store.notifiedUsers[chatId];
  if (isNewUser) {
    store.notifiedUsers[chatId] = {
      at: new Date().toISOString(),
      chatName: chatName || '',
      phone: phone || '',
      preview: String(preview || '').slice(0, 200),
      language: language || ''
    };
    saveStore(store);
  }

  if (msgId) markTelegramMsgNotified(msgId);

  const title = isNewUser ? '👤 <b>Новый диалог в WhatsApp</b>' : '📨 <b>WhatsApp: новое сообщение</b>';
  const lines = [title];
  if (isGroup && chatName) lines.push(`Группа: ${escapeHtml(chatName)}`);
  else if (chatName) lines.push(`Имя: ${escapeHtml(chatName)}`);
  if (phone) lines.push(`📞 ${escapeHtml(phone)}`);
  if (language) lines.push(`🌍 ${escapeHtml(language)}`);
  if (kind && kind !== 'text') lines.push(`Тип: ${escapeHtml(kind)}`);
  lines.push(`💬 «${escapeHtml(String(preview || '').slice(0, 300))}»`);

  return sendAlert(lines.join('\n'));
}

/** @deprecated — используйте notifyIncomingWhatsAppMessage */
function notifyFirstWhatsAppUser(payload) {
  return notifyIncomingWhatsAppMessage({ ...payload, kind: 'text' });
}

/**
 * Мгновенное уведомление о состоянии WhatsApp (события + watchdog, не polling).
 * @param {'connected'|'disconnected'|'logout'|'qr_needed'} state
 */
async function notifyWhatsAppConnection(state, detail = {}) {
  if (!isConfigured()) return false;

  const store = loadStore();
  const reason = String(detail.reason || '');
  const force = Boolean(detail.force);

  if (state === 'qr_needed') {
    const now = Date.now();
    if (!force && now - qrAlertSentAt < QR_ALERT_COOLDOWN_MS) return false;
    qrAlertSentAt = now;
    lastReportedWaState = 'qr_needed';
    store.connectionState = 'qr_needed';
    saveStore(store);
    return sendAlert(
      '📱 <b>WhatsApp: нужен QR</b>\nСессия не активна. Отсканируйте код в панели /admin или в логах сервера.'
    );
  }

  if (state === 'disconnected' || state === 'logout') {
    const now = Date.now();
    if (
      !force &&
      lastReportedWaState === state &&
      now - lastDisconnectAlertAt < DISCONNECT_ALERT_COOLDOWN_MS
    ) {
      return false;
    }
    lastDisconnectAlertAt = now;
    lastReportedWaState = state;
    store.connectionState = state;
    saveStore(store);

    const title = state === 'logout' ? '🚪 WhatsApp: сессия завершена' : '⚠️ WhatsApp отключён';
    const lines = [title, `Причина: ${escapeHtml(reason || 'неизвестно')}`];
    if (state === 'logout') {
      lines.push('Нужна повторная авторизация — отсканируйте QR в /admin.');
    } else {
      lines.push('Бот пытается переподключиться или проверьте сервер.');
    }
    return sendAlert(lines.join('\n'));
  }

  if (state === 'connected') {
    if (lastReportedWaState === 'connected' && !force) return false;
    const wasDown =
      lastReportedWaState === 'disconnected' ||
      lastReportedWaState === 'logout' ||
      lastReportedWaState === 'qr_needed' ||
      store.connectionState === 'disconnected' ||
      store.connectionState === 'logout' ||
      store.connectionState === 'qr_needed';

    lastReportedWaState = 'connected';
    store.connectionState = 'connected';
    saveStore(store);

    const lines = wasDown
      ? ['✅ <b>WhatsApp снова подключён</b>']
      : ['✅ <b>WhatsApp подключён</b>'];
    if (detail.phone) lines.push(`📞 +${escapeHtml(detail.phone)}`);
    if (detail.name) lines.push(`👤 ${escapeHtml(detail.name)}`);
    return sendAlert(lines.join('\n'));
  }

  return false;
}

function notifyHandoffLead(item) {
  if (!item) return;
  const lines = [
    '📋 <b>Заявка: связь с менеджером</b>',
    item.clientName ? `Клиент: ${escapeHtml(item.clientName)}` : null,
    item.phoneDisplay ? `📞 ${escapeHtml(item.phoneDisplay)}` : null,
    item.reasonLabel ? `Причина: ${escapeHtml(item.reasonLabel)}` : null,
    item.preview ? `💬 ${escapeHtml(item.preview.slice(0, 180))}` : null,
    item.waLink ? `🔗 ${item.waLink}` : null
  ].filter(Boolean);
  sendAlert(lines.join('\n')).catch((err) => {
    console.error('telegram-notify handoff:', err.message);
  });
}

function notifyBotStarted(meta = {}) {
  const lines = [
    '🚀 <b>House Tenerife бот запущен</b>',
    meta.port ? `HTTP :${meta.port}` : null,
    meta.railway ? '🚂 Railway' : '💻 локально',
    updatesMode ? `Telegram: ${updatesMode}` : null
  ].filter(Boolean);
  sendAlert(lines.join('\n')).catch((err) => {
    console.error('telegram-notify started:', err.message);
  });
}

async function runAiHealthCheck() {
  const { checkAIHealth } = require('./ai-service');
  return checkAIHealth();
}

async function handleCommand(text, replyChatId, getStatus) {
  const cmd = parseCommand(text);

  if (cmd === '/whoami') {
    registerAlertChat(replyChatId, { type: 'private', title: 'whoami' });
    const envId = getEnvAlertChatIds()[0] || '';
    const envOk = envId === replyChatId;
    await sendTelegram(
      [
        '<b>Ваш Telegram chat id</b>',
        `<code>${escapeHtml(replyChatId)}</code>`,
        envOk
          ? '✅ Совпадает с TELEGRAM_CHAT_ID в .env — алерты должны приходить сюда.'
          : envId
            ? `⚠️ В .env указан другой id: <code>${escapeHtml(envId)}</code>\nЗамените TELEGRAM_CHAT_ID и перезапустите бота.`
            : 'Скопируйте в .env как TELEGRAM_CHAT_ID и перезапустите бота.',
        'Этот chat уже сохранён для алертов (даже до правки .env).'
      ].join('\n'),
      { chatId: replyChatId }
    );
    return;
  }

  if (cmd === '/help' || cmd === '/start') {
    registerAlertChat(replyChatId, { type: 'private', title: 'start' });
    await sendTelegram(
      [
        '<b>Команды мониторинга</b>',
        '/status — WhatsApp и сервис',
        '/ai — проверка ИИ (ключ, ответ API)',
        '/whoami — ваш chat id для .env',
        '/help — эта справка'
      ].join('\n'),
      { chatId: replyChatId }
    );
    return;
  }

  if (cmd === '/status') {
    const st = typeof getStatus === 'function' ? getStatus() : {};
    const lines = [
      '<b>Статус House Tenerife</b>',
      `WhatsApp: ${st.botReady ? '✅ online' : '❌ offline'}`,
      st.clientState ? `Состояние: ${escapeHtml(st.clientState)}` : null,
      st.accountPhone ? `Аккаунт: +${escapeHtml(st.accountPhone)}` : null,
      st.processedIds != null ? `Обработано msg ID: ${st.processedIds}` : null,
      st.uptime != null ? `Uptime: ${Math.floor(st.uptime / 60)} мин` : null
    ].filter(Boolean);
    await sendTelegram(lines.join('\n'), { chatId: replyChatId });
    return;
  }

  if (cmd === '/ai') {
    await sendTelegram('⏳ Проверяю ИИ…', { chatId: replyChatId });
    const result = await runAiHealthCheck();
    if (result.ok) {
      await sendTelegram(
        [
          '✅ <b>ИИ отвечает</b>',
          `Модель: ${escapeHtml(result.model)}`,
          `Задержка: ${result.latencyMs} мс`,
          result.sample ? `Ответ: «${escapeHtml(result.sample)}»` : null
        ]
          .filter(Boolean)
          .join('\n'),
        { chatId: replyChatId }
      );
      return;
    }

    const hints = [];
    if (result.code === 'AI_KEY_MISSING' || result.status === 401) {
      hints.push('Проверьте AI_API_KEY в .env / Railway.');
    }
    if (result.status === 402) {
      hints.push('Нет средств на счёте провайдера (402).');
    }
    if (result.status === 429 || result.code === 'AI_RATE_LIMIT') {
      hints.push('Лимит free-моделей OpenRouter (429). Подождите или задайте AI_FALLBACK_API_KEY (Groq).');
    }
    if (result.code === 'EMPTY_REPLY') {
      hints.push('Перезапустите бота: npm start');
    }
    if (result.status === 400) {
      hints.push('Неверная модель — проверьте AI_MODEL и AI_API_URL.');
    }

    await sendTelegram(
      [
        '❌ <b>ИИ не отвечает</b>',
        result.model ? `Модель: ${escapeHtml(result.model)}` : null,
        result.message ? `Ошибка: ${escapeHtml(result.message)}` : null,
        result.status ? `HTTP: ${result.status}` : null,
        ...hints
      ]
        .filter(Boolean)
        .join('\n'),
      { chatId: replyChatId }
    );
  }
}

async function processTelegramUpdate(update, getStatus) {
  if (update.my_chat_member?.chat?.id) {
    const chat = update.my_chat_member.chat;
    registerAlertChat(String(chat.id), { type: chat.type, title: chat.title || chat.first_name || '' });
  }

  if (!update?.message?.text) return;
  const msg = update.message;
  const chatId = String(msg.chat.id);
  registerAlertChat(chatId, {
    type: msg.chat.type,
    title: msg.chat.title || msg.chat.first_name || msg.from?.first_name || ''
  });
  if (!isCommandChatAllowed(msg)) {
    console.log(`📱 Telegram: команда из chat ${chatId} (${msg.chat.type}) проигнорирована`);
    return;
  }
  try {
    await handleCommand(msg.text, chatId, getStatus);
  } catch (cmdErr) {
    console.error('telegram-notify command:', cmdErr.message);
    await sendTelegram(`❌ Ошибка команды: ${escapeHtml(cmdErr.message)}`, { chatId }).catch(() => {});
  }
}

function resolveWebhookBaseUrl() {
  if (process.env.TELEGRAM_WEBHOOK_URL) {
    return String(process.env.TELEGRAM_WEBHOOK_URL).replace(/\/$/, '');
  }
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  if (process.env.PUBLIC_BASE_URL) {
    return String(process.env.PUBLIC_BASE_URL).replace(/\/$/, '');
  }
  return null;
}

function startTelegramLongPolling(getStatus) {
  if (pollRunning) return;
  pollRunning = true;

  const poll = async () => {
    if (!telegramApiOk) {
      pollRunning = false;
      return;
    }
    try {
      const { data } = await axios.get(`https://api.telegram.org/bot${TOKEN}/getUpdates`, {
        params: { offset: pollOffset, timeout: 25, allowed_updates: ['message', 'my_chat_member'] },
        timeout: 35000
      });
      for (const update of data.result || []) {
        pollOffset = update.update_id + 1;
        await processTelegramUpdate(update, getStatus);
      }
    } catch (err) {
      if (handleTelegramHttpError(err, 'poll')) {
        pollRunning = false;
        return;
      }
    }
    if (telegramApiOk) {
      setImmediate(poll);
    } else {
      pollRunning = false;
    }
  };

  poll();
}

async function setupTelegramWebhook(app, getStatus) {
  const baseUrl = resolveWebhookBaseUrl();
  if (!baseUrl || !app || process.env.TELEGRAM_USE_WEBHOOK === '0') {
    return false;
  }

  const webhookPath = '/api/telegram/webhook';
  const webhookUrl = `${baseUrl}${webhookPath}`;

  app.post(webhookPath, (req, res) => {
    res.sendStatus(200);
    processTelegramUpdate(req.body, getStatus).catch((err) => {
      console.error('telegram-notify webhook:', err.message);
    });
  });

  const { data } = await axios.post(
    `https://api.telegram.org/bot${TOKEN}/setWebhook`,
    {
      url: webhookUrl,
      allowed_updates: ['message', 'my_chat_member'],
      drop_pending_updates: false
    },
    { timeout: 15000, validateStatus: () => true }
  );

  if (!data.ok) {
    console.warn(`telegram-notify webhook: ${data.description || 'setup failed'}`);
    return false;
  }

  updatesMode = 'webhook';
  console.log(`📱 Telegram: webhook (мгновенные команды) → ${webhookUrl}`);
  return true;
}

/**
 * Алерты WhatsApp — push по событиям (не polling).
 * Команды /ai: webhook на Railway или long-polling локально.
 */
async function startTelegram(app, getStatus) {
  if (!enabled || updatesStarted) return { ok: false, mode: null };
  updatesStarted = true;

  const valid = await validateTelegramToken();
  if (!valid) {
    updatesStarted = false;
    return { ok: false, mode: null };
  }

  const webhookOk = await setupTelegramWebhook(app, getStatus);
  if (webhookOk) {
    return { ok: true, mode: 'webhook' };
  }

  try {
    await axios.post(
      `https://api.telegram.org/bot${TOKEN}/deleteWebhook`,
      { drop_pending_updates: false },
      { timeout: 15000, validateStatus: () => true }
    );
  } catch {
    /* ignore */
  }

  updatesMode = 'long-poll';
  console.log('📱 Telegram: long-polling команд (алерты WhatsApp — push по событиям)');
  startTelegramLongPolling(getStatus);
  return { ok: true, mode: 'long-poll' };
}

/** @deprecated используйте startTelegram */
async function startTelegramPolling(getStatus) {
  const result = await startTelegram(null, getStatus);
  return result.ok;
}

module.exports = {
  isConfigured,
  isEnabled,
  isActive,
  sendTelegram,
  sendAlert,
  notifyIncomingWhatsAppMessage,
  notifyFirstWhatsAppUser,
  notifyWhatsAppConnection,
  notifyHandoffLead,
  notifyBotStarted,
  startTelegram,
  startTelegramPolling,
  processTelegramUpdate
};
