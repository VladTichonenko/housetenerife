require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { getLanguageFromPhone, getTranslation, getCountryFromPhone } = require('./phone-utils');
const { askAI } = require('./ai-service');
const { enqueueForChat } = require('./chat-queue');
const {
  classifyObservedState,
  isDefinitiveLogoutReason,
} = require('./whatsapp-session-state');
const {
  scheduleReplyBatch,
  REPLY_WAIT_MS,
  REPLY_BATCH_WAIT_MS,
  isMessageQueuedInBatch,
} = require('./reply-batch');
const {
  detectLanguageFromText,
  getLanguageName,
  isAmbiguousShortReply,
  isStrongLanguageSignal,
  isMostlyPlaceName,
} = require('./language-detector');
const { getSearchingListingsMessage } = require('./sales-localization');
const { registerAdminRoutes } = require('./admin-api');
const { setupAdminPanel, getAdminPanelStatus } = require('./admin-panel');
const {
  resolveMessageText,
  isPermanentNonText,
  extractReactionEmoji,
  trackEmptyBodyRetry,
  clearEmptyBodyRetry,
  exceededEmptyBodyRetries,
  MAX_EMPTY_BODY_RETRIES,
} = require('./message-body');
const {
  isVoiceMessage,
  isImageWithDescription,
  containsLink,
  wantsManagerHandoff,
  buildVoiceReply,
  buildHandoffAskName,
  buildHandoffNameInvalid,
  buildHandoffReply,
  connectWithManager,
  setRecordHandoff,
  detectAffirmativeResponse,
  detectNegativeResponse,
  isBareCallAcceptance,
  shouldTrackCallOfferAfterReply,
  startHandoffFromCallAcceptance,
  formatCustomerPhone,
} = require('./manager-handoff');
const {
  getPendingHandoff,
  clearPendingHandoff,
  extractClientName,
  getPendingCallOffer,
  setPendingCallOffer,
  clearPendingCallOffer,
} = require('./handoff-pending');
const { analyzeConversation } = require('./dialog-context');
const { wantsEscalation } = require('./bot-core-rules');
const { recordHandoff, HANDOFF_PATH, touchHandoffActivity } = require('./handoff-leads');
const { recordClientMessage, CLIENTS_PATH } = require('./clients-store');
const {
  recordMessage: persistMessage,
  getMessages: getPersistedMessages,
} = require('./conversation-store');
const { hydrateConversationHistory } = require('./conversation-history');
const { getDb, DB_PATH } = require('./db');
const { migrateFromJsonIfNeeded } = require('./db-migrate');

try {
  getDb();
  migrateFromJsonIfNeeded();
  console.log(`🗄️ SQLite: ${DB_PATH}`);
} catch (dbErr) {
  console.error('❌ SQLite init:', dbErr.message);
}
const {
  isAiDisabled,
  getChatSettings,
  setAiDisabled,
  getStickyDialogLanguage,
  setStickyDialogLanguage,
} = require('./chat-settings');
const { offerSoftCallViaAi } = require('./index-handoff');
const { localizeUrlsInText } = require('./property-share');
const propertyPreviewRouter = require('./property-preview');
const telegramNotify = require('./telegram-notify');
const {
  getPuppeteerLaunchOptions,
  logPuppeteerDiagnostics,
  isPuppeteerProtocolTimeout,
} = require('./puppeteer-env');

const REPLY_IN_GROUPS =
  process.env.WHATSAPP_REPLY_IN_GROUPS !== '0' &&
  process.env.WHATSAPP_REPLY_IN_GROUPS !== 'false';
const GROUP_ONLY_MENTION =
  process.env.WHATSAPP_GROUP_ONLY_MENTION === '1' ||
  process.env.WHATSAPP_GROUP_ONLY_MENTION === 'true';

const BOT_REPLY_DELAY_MS = Math.max(
  0,
  parseInt(process.env.BOT_REPLY_DELAY_MS, 10) || 0
);
/** Фиксированная пауза перед сообщением со ссылками (не рандом 90–180 с). Env: LINK_MESSAGE_DELAY_MS */
const LINK_MESSAGE_DELAY_MS = Math.max(
  0,
  parseInt(process.env.LINK_MESSAGE_DELAY_MS, 10) || 3000
);

setRecordHandoff(recordHandoff);
console.log(`📋 Лиды handoff (панель «Связь с менеджером»): ${HANDOFF_PATH}`);
console.log(`👤 Пользователи и чаты: SQLite (${DB_PATH}), legacy JSON: ${CLIENTS_PATH}`);
if (telegramNotify.isConfigured()) {
  console.log('📱 Telegram: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID заданы (проверка при старте HTTP)');
} else {
  console.log('💡 Telegram: задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в .env');
}
if (REPLY_IN_GROUPS) {
  console.log(
    `💬 WhatsApp группы: ответы включены${GROUP_ONLY_MENTION ? ' (только @упоминание или reply)' : ''}`
  );
} else {
  console.log('💬 WhatsApp группы: ответы выключены (только личные сообщения)');
}
console.log(
  `⏱️ Ответ: пауза ${REPLY_WAIT_MS / 1000} с (1 сообщение) / ${REPLY_BATCH_WAIT_MS / 1000} с (пачка в окне); ссылки +${LINK_MESSAGE_DELAY_MS / 1000} с`
);


// Создаем Express сервер для API
const app = express();
// Как в bot_rassylka: на Railway только process.env.PORT (иначе прокси → 502)
const onRailway = Boolean(
  process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_PROJECT_ID ||
    process.env.RAILWAY_PUBLIC_DOMAIN
);
const BOT_PORT = parseInt(
  onRailway ? process.env.PORT || '8080' : process.env.BOT_PORT || process.env.PORT || '3001',
  10
);
if (onRailway && process.env.BOT_PORT) {
  console.warn('⚠️ Railway: удалите BOT_PORT из Variables — прокси ходит только на PORT.');
}

app.use(cors());
app.use(express.json());
app.use(propertyPreviewRouter);

app.use((req, res, next) => {
  if (onRailway && req.path !== '/health') {
    res.on('finish', () => {
      console.log(`[HTTP] ${req.method} ${req.url} → ${res.statusCode}`);
    });
  }
  next();
});

// Флаг готовности бота
let botReady = false;
let currentQr = null;
let accountInfo = null;
let waWatchState = null;

function getConversationChatId(msg, chat) {
  return chat?.id?._serialized || msg.from;
}

function getMessageSenderId(msg, chat) {
  if (chat?.isGroup && msg.author) return msg.author;
  return msg.from;
}

/**
 * Когда Store не отдаёт чат (@lid / «r: r» / No LID) — минимальный объект, чтобы не зациклить retry.
 */
function buildFallbackChatFromMessage(msg) {
  const from = String(msg?.from || '');
  const isGroup = from.endsWith('@g.us');
  const [user, server] = from.split('@');
  return {
    id: {
      _serialized: from,
      user: user || from,
      server: server || 'c.us',
    },
    isGroup,
    isChannel: false,
    name: '',
    _fallback: true,
  };
}

/** CDP/Chromium временно «тупит» — не долбим getChats/getState параллельно. */
let chromiumSlowUntil = 0;
/** С какого момента CDP реально зависает (hard protocol timeout), не soft race. */
let cdpHangSince = 0;
let cdpHangCount = 0;
let cdpRecoveryInFlight = false;
/** Последняя живая активность WA (входящее/исходящее/ack) — getState может тупить при живой сессии. */
let lastWhatsAppActivityAt = 0;
/** Последнее входящее через события message/message_create (не polling). */
let lastIncomingEventAt = 0;
/** Глобальный mutex CDP: зависший getChats/getState блокирует новые evaluate до завершения. */
let cdpActiveOps = 0;
let cdpActiveLabel = '';
let cdpCooldownUntil = 0;
/** Soft-timeout подряд (не считаем hard hang — сессия обычно жива). */
let cdpSoftTimeoutStreak = 0;
let lastCdpSoftTimeoutAt = 0;
/** Polling getChats сломан/висит — до рестарта процесса не долбим CDP. */
let pollingDisabledForProcess = false;

function touchWhatsAppActivity() {
  lastWhatsAppActivityAt = Date.now();
  if (cdpHangSince) clearCdpHang();
  cdpSoftTimeoutStreak = 0;
}

function touchIncomingEvent() {
  lastIncomingEventAt = Date.now();
  touchWhatsAppActivity();
}

function hasRecentWhatsAppActivity(withinMs = 120000) {
  return lastWhatsAppActivityAt > 0 && Date.now() - lastWhatsAppActivityAt < withinMs;
}

function isCdpCooldown() {
  return Date.now() < cdpCooldownUntil;
}

function isCdpBusy() {
  return cdpActiveOps > 0;
}

function armCdpCooldown(ms = 300000, label = '') {
  const pauseMs = Math.max(60000, Number(ms) || 300000);
  cdpCooldownUntil = Math.max(cdpCooldownUntil, Date.now() + pauseMs);
  markChromiumSlow(pauseMs);
  if (label) cdpActiveLabel = label;
}

function isPollingGetChatsBrokenError(err) {
  const msg = String(err?.message || err || '');
  return (
    /reading ['"]getChats['"]/i.test(msg) ||
    /WWebJS is not defined/i.test(msg) ||
    /Cannot read properties of undefined \(reading ['"]getChats['"]\)/i.test(msg)
  );
}

function disablePollingForProcess(reason) {
  if (pollingDisabledForProcess) return;
  pollingDisabledForProcess = true;
  console.warn(
    `🛑 Polling отключён до рестарта (${reason}). Входящие только через события message/message_create.`
  );
  console.warn('   Включить снова: ENABLE_POLLING=1 и рестарт (на Railway обычно не нужно).');
}

function shouldUseMessagePolling() {
  if (pollingDisabledForProcess) return false;
  // По умолчанию ВЫКЛ: getChats на idle вешает CDP. События message — основной канал.
  // Включить резерв: ENABLE_POLLING=1
  const enabled =
    process.env.ENABLE_POLLING === '1' || process.env.ENABLE_POLLING === 'true';
  if (!enabled) return false;
  if (process.env.DISABLE_POLLING === '1' || process.env.DISABLE_POLLING === 'true') {
    return false;
  }
  // События message работают — polling только долбит getChats и вешает CDP.
  const autoOff = process.env.POLLING_AUTO_OFF !== '0' && process.env.POLLING_AUTO_OFF !== 'false';
  if (autoOff && lastIncomingEventAt > 0) {
    // 30 мин: после живых events не будим getChats — иначе idle soft-timeout → ложный reconnect.
    const quietMs = parseInt(process.env.POLLING_AUTO_OFF_QUIET_MS, 10) || 30 * 60 * 1000;
    if (Date.now() - lastIncomingEventAt < quietMs) return false;
  }
  return true;
}

function markChromiumSlow(ms = 60000) {
  const pauseMs = Math.max(15000, Number(ms) || 60000);
  chromiumSlowUntil = Math.max(chromiumSlowUntil, Date.now() + pauseMs);
}

function isChromiumSlow() {
  return Date.now() < chromiumSlowUntil || isCdpCooldown();
}

function clearCdpHang() {
  cdpHangSince = 0;
  cdpHangCount = 0;
}

function isBrowserConnected() {
  try {
    if (typeof client?.pupBrowser?.isConnected === 'function') {
      return client.pupBrowser.isConnected();
    }
  } catch {
    return false;
  }
  return true;
}

/**
 * Не ждём protocolTimeout (минуты): локальный race.
 * Пока исходный CDP promise не завершился — cdpActiveOps > 0, новые evaluate не стартуют.
 */
async function withCdpSoftTimeout(promise, timeoutMs, code = 'WA_CDP_SOFT_TIMEOUT') {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`${code} after ${timeoutMs}ms`);
          err.code = code;
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isCdpSoftTimeout(err) {
  const code = String(err?.code || '');
  return (
    code === 'WA_CDP_SOFT_TIMEOUT' ||
    code === 'WA_GETCHATS_SOFT_TIMEOUT' ||
    code === 'WA_FETCH_MSGS_SOFT_TIMEOUT' ||
    code === 'WA_GETSTATE_SOFT_TIMEOUT' ||
    code === 'WA_WATCH_PROBE_TIMEOUT' ||
    code === 'WA_SEND_SOFT_TIMEOUT' ||
    code === 'WA_CDP_COOLDOWN' ||
    code === 'WA_CDP_BUSY'
  );
}

async function runExclusiveCdp(label, fn, softTimeoutMs = 25000) {
  if (isCdpCooldown()) {
    const err = new Error(`CDP cooldown (${label})`);
    err.code = 'WA_CDP_COOLDOWN';
    throw err;
  }
  if (cdpActiveOps > 0) {
    const err = new Error(`CDP busy: ${cdpActiveLabel || 'unknown'} (${label})`);
    err.code = 'WA_CDP_BUSY';
    throw err;
  }

  cdpActiveOps += 1;
  cdpActiveLabel = label;
  const work = Promise.resolve().then(fn);
  try {
    const result = await withCdpSoftTimeout(work, softTimeoutMs, 'WA_CDP_SOFT_TIMEOUT');
    cdpSoftTimeoutStreak = 0;
    return result;
  } catch (err) {
    if (isCdpSoftTimeout(err)) {
      // Soft race: Chromium часто просто медленный. Не считаем hard hang и не рвём сессию.
      cdpSoftTimeoutStreak += 1;
      lastCdpSoftTimeoutAt = Date.now();
      const softCooldownMs = Math.min(
        120000 * Math.pow(2, Math.min(cdpSoftTimeoutStreak - 1, 3)),
        600000
      );
      armCdpCooldown(softCooldownMs, label);
      markChromiumSlow(Math.min(softCooldownMs, 180000));
      console.warn(
        `⏳ CDP soft-timeout (${label}, streak ${cdpSoftTimeoutStreak}): пауза ${Math.round(softCooldownMs / 1000)}с, сессию не рвём`
      );
    } else if (isPuppeteerProtocolTimeout(err)) {
      // Реальный protocolTimeout Puppeteer — браузер может быть мёртв.
      armCdpCooldown(300000, label);
      noteCdpHang(300000, { hard: true });
    }
    throw err;
  } finally {
    work
      .finally(() => {
        cdpActiveOps = Math.max(0, cdpActiveOps - 1);
        if (cdpActiveOps === 0) cdpActiveLabel = '';
      })
      .catch(() => {});
  }
}

/**
 * Таймаут CDP. Soft — только backoff; hard (protocolTimeout / мёртвый browser) — копим для recovery.
 */
function noteCdpHang(pauseMs = 60000, { hard = false } = {}) {
  if (!hard) {
    // Soft: не копим hang-счётчик — иначе idle getChats каждые ~20 мин рвёт сессию.
    if (hasRecentWhatsAppActivity(15 * 60 * 1000)) {
      markChromiumSlow(Math.min(pauseMs, 45000));
    } else {
      markChromiumSlow(Math.min(Math.max(pauseMs, 60000), 180000));
    }
    return;
  }
  if (hasRecentWhatsAppActivity(15 * 60 * 1000)) {
    markChromiumSlow(Math.min(pauseMs, 45000));
    return;
  }
  markChromiumSlow(Math.max(pauseMs, 180000));
  if (!cdpHangSince) cdpHangSince = Date.now();
  cdpHangCount += 1;
}

function isCdpRecoveryEnabled() {
  const v = process.env.WA_CDP_RECOVERY;
  if (v === '0' || v === 'false') return false;
  // По умолчанию auto: рестарт только если долго нет активности И CDP молчит.
  return true;
}

function getCdpRecoveryThresholdMs() {
  const configured = parseInt(process.env.WA_CDP_RECOVERY_MS, 10);
  // Минимум 15 мин hard-hang без ответа CDP.
  return Number.isFinite(configured) && configured >= 900000 ? configured : 900000;
}

function getCdpRecoveryIdleMs() {
  const configured = parseInt(process.env.WA_CDP_RECOVERY_IDLE_MS, 10);
  // Не рестартим, если за последние 20 мин были сообщения/ack.
  return Number.isFinite(configured) && configured >= 600000 ? configured : 20 * 60 * 1000;
}

function shouldRecoverFromCdpHang() {
  if (!isCdpRecoveryEnabled()) return false;
  if (!cdpHangSince || cdpRecoveryInFlight || isReconnecting || isManualLogoutInProgress) {
    return false;
  }
  if (hasRecentWhatsAppActivity(getCdpRecoveryIdleMs())) return false;

  const browserConnected = isBrowserConnected();
  // Браузер уже мёртв — reconnect имеет смысл сразу.
  if (!browserConnected) return true;

  // Soft-timeout сам по себе НЕ повод рвать сессию.
  const minHangs = Math.max(3, parseInt(process.env.WA_CDP_RECOVERY_MIN_HANGS, 10) || 3);
  return (
    cdpHangCount >= minHangs &&
    Date.now() - cdpHangSince >= getCdpRecoveryThresholdMs()
  );
}

/** Если destroy зависает на мёртвом CDP — убиваем процесс Chromium. */
async function forceCloseWhatsAppBrowser(timeoutMs = 15000) {
  try {
    await Promise.race([
      client.destroy(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`destroy timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
    return;
  } catch (err) {
    console.warn(`⚠️ client.destroy(): ${err.message}`);
  }

  try {
    const browser = client.pupBrowser;
    const proc = typeof browser?.process === 'function' ? browser.process() : null;
    if (proc && !proc.killed) {
      console.warn('⚠️ Принудительно завершаем процесс Chromium (CDP не отвечает)');
      proc.kill('SIGKILL');
    } else if (browser && typeof browser.close === 'function') {
      await Promise.race([
        browser.close(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
  } catch (killErr) {
    console.warn('⚠️ kill Chromium:', killErr.message);
  }
}

async function recoverFromCdpHang(reason) {
  if (cdpRecoveryInFlight || isReconnecting || isManualLogoutInProgress) return;
  // Soft-timeout — никогда не эскалируем в destroy/reconnect.
  if (/WA_CDP_SOFT_TIMEOUT|WA_GETCHATS_SOFT_TIMEOUT|WA_FETCH_MSGS_SOFT_TIMEOUT|WA_GETSTATE_SOFT_TIMEOUT|WA_WATCH_PROBE_TIMEOUT/i.test(
    String(reason || '')
  )) {
    console.warn(
      `⏳ CDP soft-timeout (${reason}) — recovery пропущен, сессию сохраняем`
    );
    markChromiumSlow(180000);
    armCdpCooldown(180000, 'soft-recovery-skip');
    return;
  }
  if (!shouldRecoverFromCdpHang() && isBrowserConnected()) {
    console.warn(`⏳ CDP recovery отложен (${reason}): критерии hard-hang не выполнены`);
    return;
  }
  cdpRecoveryInFlight = true;
  clearCdpHang();
  markChromiumSlow(30000);
  console.warn(
    `🔄 CDP/Chromium завис (${reason}) — перезапуск браузера, сессию LocalAuth сохраняем`
  );
  try {
    await telegramNotify.notifyWhatsAppConnection('disconnected', {
      reason: `cdp recovery: ${reason}`,
      force: true,
    });
  } catch (_) {
    /* ignore */
  }
  botReady = false;
  try {
    await reconnectClient();
  } finally {
    cdpRecoveryInFlight = false;
  }
}

function isTransientChatLookupError(err) {
  const msg = String(err?.message || err || '');
  return (
    msg === 'r' ||
    msg.includes('No LID') ||
    msg.includes('Lid is missing') ||
    msg.includes('getChat') ||
    msg.includes('Evaluation failed') ||
    isPuppeteerProtocolTimeout(err) ||
    isChatLoadError(err)
  );
}

async function resolveIncomingChat(msg) {
  if (!msg || typeof msg.getChat !== 'function') {
    return buildFallbackChatFromMessage(msg);
  }
  try {
    const chat = await Promise.race([
      msg.getChat(),
      new Promise((_, reject) =>
        setTimeout(() => {
          const err = new Error('getChat soft timeout');
          err.code = 'WA_SEND_SOFT_TIMEOUT';
          reject(err);
        }, 8000)
      ),
    ]);
    if (chat) return chat;
  } catch (err) {
    console.warn(
      `⚠️ getChat недоступен (${err.message || err}) — fallback для ${msg?.from || '?'}`
    );
  }
  return buildFallbackChatFromMessage(msg);
}

function isBotMentioned(msg) {
  const mentions = msg.mentionedIds;
  if (!mentions?.length) return false;
  const botPhone = accountInfo?.phone;
  if (!botPhone) return true;
  return mentions.some((id) => String(id).includes(botPhone));
}

async function shouldRespondInGroup(msg) {
  if (isBotMentioned(msg)) return true;
  if (msg.hasQuotedMsg) {
    try {
      const quoted = await msg.getQuotedMessage();
      if (quoted?.fromMe) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function isPollingChat(chat) {
  if (!chat?.id) return false;
  if (chat.isChannel) return false;
  if (chat.isGroup) {
    if (process.env.POLLING_INCLUDE_GROUPS !== '1') return false;
    return REPLY_IN_GROUPS;
  }
  return true;
}

/** @type {Map<string, number>} chatId → skip until timestamp */
const pollingSkipUntil = new Map();

function getChatPollingKey(chat) {
  if (!chat?.id) return '';
  return chat.id._serialized || String(chat.id.user || chat.id || '');
}

function isSafePollingChat(chat) {
  const key = getChatPollingKey(chat);
  if (!key || key === '0' || key.includes('status@broadcast')) return false;
  if (!isPollingChat(chat)) return false;
  const skipUntil = pollingSkipUntil.get(key);
  if (skipUntil && Date.now() < skipUntil) return false;
  if (skipUntil) pollingSkipUntil.delete(key);
  return true;
}

function isChatLoadError(err) {
  const msg = String(err?.message || err);
  return (
    msg === 'r' ||
    msg.includes('waitForChatLoading') ||
    msg.includes("reading 'waitForChatLoading'") ||
    msg.includes('Cannot read properties of undefined') ||
    msg.includes('No LID') ||
    msg.includes('Lid is missing') ||
    msg.includes('Evaluation failed') ||
    isPuppeteerProtocolTimeout(err)
  );
}

async function fetchChatMessagesSafe(chat) {
  const key = getChatPollingKey(chat);
  if (!key) return [];

  let target = chat;
  try {
    if (typeof client.getChatById === 'function') {
      target = await client.getChatById(key);
    }
  } catch {
    pollingSkipUntil.set(key, Date.now() + 30 * 60 * 1000);
    return [];
  }

  try {
    return await target.fetchMessages({ limit: 15 });
  } catch (err) {
    if (isChatLoadError(err)) {
      pollingSkipUntil.set(key, Date.now() + 20 * 60 * 1000);
      return [];
    }
    throw err;
  }
}

function isMarkedUnreadError(error) {
  const errorStr = error.message || error.toString() || '';
  return (
    errorStr.includes('markedUnread') ||
    errorStr.includes('sendSeen') ||
    errorStr.includes('Cannot read properties of undefined')
  );
}

// Безопасная отправка сообщений с обработкой ошибок markedUnread
function outboundContainsLink(text) {
  return /(?:https?:\/\/|www\.|housetenerife\.eu)/i.test(String(text || ''));
}

function getOutboundDelayMs(text) {
  let delayMs = BOT_REPLY_DELAY_MS;
  if (outboundContainsLink(text) && LINK_MESSAGE_DELAY_MS > 0) {
    delayMs = Math.max(delayMs, LINK_MESSAGE_DELAY_MS);
  }
  return delayMs;
}

const SEND_SOFT_TIMEOUT_MS = Math.max(
  8000,
  parseInt(process.env.WA_SEND_SOFT_TIMEOUT_MS, 10) || 25000
);
const SEND_SOFT_TIMEOUT_LID_MS = Math.max(
  5000,
  parseInt(process.env.WA_SEND_SOFT_TIMEOUT_LID_MS, 10) || 12000
);
const OUTBOUND_RETRY_MAX = Math.max(1, parseInt(process.env.WA_OUTBOUND_RETRY_MAX, 10) || 8);
/** @type {Map<string, { chatId: string, text: string, attempts: number, nextAt: number, enqueuedAt: number }>} */
const pendingOutbound = new Map();
/** Последнее входящее Message по чату — для reply-retry на @lid */
const lastInboundMsgByChat = new Map();

function isLidChatId(chatId) {
  return /@lid$/i.test(String(chatId || ''));
}

function rememberInboundMessage(msg) {
  const chatId = msg?.from;
  if (!chatId || !msg) return;
  lastInboundMsgByChat.set(String(chatId), msg);
  if (lastInboundMsgByChat.size > 200) {
    const oldest = lastInboundMsgByChat.keys().next().value;
    if (oldest) lastInboundMsgByChat.delete(oldest);
  }
}

function outboundKey(chatId, text) {
  return `${chatId}::${String(text || '').slice(0, 200)}`;
}

function isSendCdpFailure(err) {
  return (
    isPuppeteerProtocolTimeout(err) ||
    isCdpSoftTimeout(err) ||
    /WA_SEND_SOFT_TIMEOUT/i.test(String(err?.code || err?.message || ''))
  );
}

async function withSendSoftTimeout(promise, timeoutMs = SEND_SOFT_TIMEOUT_MS) {
  return withCdpSoftTimeout(promise, timeoutMs, 'WA_SEND_SOFT_TIMEOUT');
}

function scheduleOutboundFlushSoon(delayMs = 2000) {
  const wait = Math.max(500, Number(delayMs) || 2000);
  if (typeof trackedSetTimeout === 'function') {
    trackedSetTimeout(() => {
      flushPendingOutbound().catch((err) =>
        console.warn('⚠️ flushPendingOutbound (soon):', err.message)
      );
    }, wait);
  } else {
    setTimeout(() => {
      flushPendingOutbound().catch((err) =>
        console.warn('⚠️ flushPendingOutbound (soon):', err.message)
      );
    }, wait);
  }
}

function enqueueOutboundRetry(chatId, text, { delayMs = 3000 } = {}) {
  if (!chatId || !text) return;
  const key = outboundKey(chatId, text);
  const existing = pendingOutbound.get(key);
  if (existing) {
    existing.nextAt = Math.min(existing.nextAt, Date.now() + delayMs);
    scheduleOutboundFlushSoon(Math.min(delayMs, 2000));
    return;
  }
  if (pendingOutbound.size >= 50) {
    const oldest = [...pendingOutbound.entries()].sort(
      (a, b) => a[1].enqueuedAt - b[1].enqueuedAt
    )[0];
    if (oldest) pendingOutbound.delete(oldest[0]);
  }
  pendingOutbound.set(key, {
    chatId: String(chatId),
    text: String(text),
    attempts: 0,
    nextAt: Date.now() + delayMs,
    enqueuedAt: Date.now(),
  });
  console.warn(
    `📬 Исходящее в очередь retry (${chatId}), повтор через ~${Math.round(delayMs / 1000)}с; в очереди: ${pendingOutbound.size}`
  );
  // Не ждать интервал 5–10 с — пробуем сразу после короткой паузы
  scheduleOutboundFlushSoon(Math.min(delayMs, 2000));
}

async function sendViaBestEffort(chatId, text, msg = null, timeoutMs = SEND_SOFT_TIMEOUT_MS, clientRef = null) {
  const lid = isLidChatId(chatId);
  const inbound = msg || lastInboundMsgByChat.get(String(chatId)) || null;
  const wa = clientRef || client;
  const lidMs = Math.min(timeoutMs, SEND_SOFT_TIMEOUT_LID_MS);

  // @lid: только reply — sendMessage(lid) часто висит минутами
  if (lid) {
    if (inbound && typeof inbound.reply === 'function') {
      await withSendSoftTimeout(inbound.reply(text), lidMs);
      return 'reply';
    }
    // Нет сохранённого msg — короткая попытка sendMessage, без долгого зависания
    await withSendSoftTimeout(wa.sendMessage(chatId, text, { sendSeen: false }), lidMs);
    return 'sendMessage';
  }

  await withSendSoftTimeout(
    wa.sendMessage(chatId, text, { sendSeen: false }),
    timeoutMs
  );
  return 'sendMessage';
}

async function flushPendingOutbound() {
  if (!botReady || isReconnecting || cdpRecoveryInFlight) return;
  if (isCdpBusy()) return;
  if (!pendingOutbound.size) return;

  const now = Date.now();
  const due = [...pendingOutbound.entries()].filter(([, item]) => item.nextAt <= now);
  for (const [key, item] of due.slice(0, 3)) {
    if (isCdpBusy()) break;
    // @lid не блокируем cooldown'ом — иначе 5 минут в очереди
    if (isChromiumSlow() && !isLidChatId(item.chatId)) {
      item.nextAt = Date.now() + 8000;
      pendingOutbound.set(key, item);
      continue;
    }
    pendingOutbound.delete(key);
    try {
      const via = await sendViaBestEffort(
        item.chatId,
        item.text,
        null,
        isLidChatId(item.chatId) ? SEND_SOFT_TIMEOUT_LID_MS : SEND_SOFT_TIMEOUT_MS
      );
      touchWhatsAppActivity();
      console.log(`✅ Исходящее из очереди доставлено (${via}): ${item.chatId}`);
    } catch (err) {
      if (isMarkedUnreadError(err)) {
        touchWhatsAppActivity();
        console.log(`⚠️ markedUnread на retry — считаем доставленным (${item.chatId})`);
        continue;
      }
      item.attempts += 1;
      if (item.attempts >= OUTBOUND_RETRY_MAX) {
        console.error(
          `❌ Исходящее сдано после ${item.attempts} попыток (${item.chatId}):`,
          err.message
        );
        continue;
      }
      // Быстрые повторы сначала (3с, 6с, 12с…), не 15→30→60→180
      const delayMs = Math.min(3000 * Math.pow(2, item.attempts - 1), 60000);
      item.nextAt = Date.now() + delayMs;
      pendingOutbound.set(key, item);
      if (isSendCdpFailure(err)) {
        markChromiumSlow(isLidChatId(item.chatId) ? 8000 : 20000);
      }
      console.warn(
        `⏳ Retry исходящего не удался (${item.chatId}, попытка ${item.attempts}): ${err.message}; ещё через ${Math.round(delayMs / 1000)}с`
      );
      scheduleOutboundFlushSoon(delayMs);
    }
  }
}

function startOutboundRetryLoop() {
  if (global.outboundRetryInterval) return;
  global.outboundRetryInterval = trackedSetInterval(() => {
    flushPendingOutbound().catch((err) =>
      console.warn('⚠️ flushPendingOutbound:', err.message)
    );
  }, 5000);
  console.log('📬 Очередь исходящих: flush каждые 5 с + сразу после enqueue');
}

/**
 * Отправка без минутных зависаний.
 * @lid: только быстрый reply (sendMessage(lid) = типичный soft-timeout на 45–180с).
 */
async function sendMessageSafely(msg, text, clientRef = client) {
  const chatId = msg.from;
  const lid = isLidChatId(chatId);
  rememberInboundMessage(msg);

  const delayMs = getOutboundDelayMs(text);
  if (delayMs > 0) {
    const hasLink = outboundContainsLink(text);
    console.log(
      `⏳ Пауза ${Math.round(delayMs / 1000)}с перед отправкой${hasLink ? ' (со ссылками)' : ''} (${chatId})`
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if ((isCdpBusy() || isChromiumSlow()) && !lid) {
    console.warn(`⏳ CDP занят/медленный — ответ ${chatId} в очередь`);
    enqueueOutboundRetry(chatId, text, { delayMs: 3000 });
    return { queued: true };
  }

  const softMs = lid ? SEND_SOFT_TIMEOUT_LID_MS : SEND_SOFT_TIMEOUT_MS;

  // @lid: один быстрый reply. Второй sendMessage(lid) почти всегда висит — сразу очередь.
  if (lid) {
    try {
      if (typeof msg.reply === 'function') {
        await withSendSoftTimeout(msg.reply(text), softMs);
        touchWhatsAppActivity();
        return { queued: false };
      }
    } catch (err) {
      if (isMarkedUnreadError(err)) {
        touchWhatsAppActivity();
        return { queued: false };
      }
      console.error(`❌ Ошибка отправки через reply (@lid):`, err.message || err);
    }
    markChromiumSlow(8000);
    enqueueOutboundRetry(chatId, text, { delayMs: 2500 });
    return { queued: true };
  }

  const attempts = [
    [
      'sendMessage',
      async () => clientRef.sendMessage(chatId, text, { sendSeen: false }),
    ],
    ['reply', async () => msg.reply(text)],
  ];

  let lastError = null;
  for (const [label, fn] of attempts) {
    if (isCdpBusy() && label !== 'reply') break;
    try {
      await withSendSoftTimeout(fn(), softMs);
      touchWhatsAppActivity();
      return { queued: false };
    } catch (err) {
      lastError = err;
      if (isMarkedUnreadError(err)) {
        console.log(`⚠️ markedUnread при ${label} — сообщение могло уйти`);
        touchWhatsAppActivity();
        return { queued: false };
      }
      console.error(`❌ Ошибка отправки через ${label}:`, err.message || err);
      if (isSendCdpFailure(err)) {
        markChromiumSlow(15000);
        continue;
      }
    }
  }

  markChromiumSlow(15000);
  enqueueOutboundRetry(chatId, text, { delayMs: 3000 });
  if (lastError && !isSendCdpFailure(lastError)) {
    console.error('❌ Все методы отправки не сработали:', lastError.message);
  }
  return { queued: true };
}

// Создание клиента WhatsApp
// Используем персистентное хранилище для сессии
// На Railway с Volume: SESSION_PATH=/data/.wwebjs_auth_ht
function resolveSessionPath() {
  if (process.env.SESSION_PATH) return process.env.SESSION_PATH;
  if (fs.existsSync('/data')) return '/data/.wwebjs_auth_ht';
  return './.wwebjs_auth_ht';
}

const sessionPath = resolveSessionPath();
console.log(`📁 Путь к сессии: ${sessionPath}`);
const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
if (isRailway && !path.isAbsolute(sessionPath)) {
  console.warn(
    '⚠️ Railway: SESSION_PATH не на постоянном диске (нужен абсолютный путь на Volume). Сессия WhatsApp сотрётся после деплоя.'
  );
  console.warn('   Volume → mount /data; Variables → SESSION_PATH=/data/.wwebjs_auth_ht; затем один раз QR в панели.');
} else if (isRailway && sessionPath.startsWith('/data')) {
  console.log('💾 Railway Volume: сессия WhatsApp сохраняется на /data');
}

logPuppeteerDiagnostics();
console.log(
  '🔧 WA runtime: cdp-mutex-v5 | polling off by default | send soft-timeout+outbound-queue'
);

/**
 * whatsapp-web.js вешает framenavigated → inject() без .catch().
 * При Runtime.evaluate timed out получаем unhandledRejection и «мёртвый» ready.
 * Патч: после успешного ready глотаем CDP/auth timeout и планируем мягкий reconnect.
 */
let injectRecoveryTimer = null;
let lastInjectFailAt = 0;

function scheduleInjectRecovery(reason) {
  const now = Date.now();
  if (injectRecoveryTimer) return;
  if (typeof isReconnecting === 'boolean' && isReconnecting) return;
  if (cdpRecoveryInFlight) return;
  if (typeof isManualLogoutInProgress === 'boolean' && isManualLogoutInProgress) return;

  lastInjectFailAt = now;
  botReady = false;
  markChromiumSlow(60000);
  armCdpCooldown(60000, 'inject-fail');
  console.warn(
    `⚠️ WA inject failed (${String(reason).slice(0, 120)}) — мягкий reconnect через 45с`
  );
  injectRecoveryTimer = setTimeout(() => {
    injectRecoveryTimer = null;
    if (typeof isManualLogoutInProgress === 'boolean' && isManualLogoutInProgress) return;
    reconnectClient().catch((err) =>
      console.error('❌ reconnect после inject fail:', err.message)
    );
  }, 45000);
}

const originalClientInject = Client.prototype.inject;
Client.prototype.inject = async function housetenerifeSafeInject(...args) {
  try {
    return await originalClientInject.apply(this, args);
  } catch (err) {
    const authTimeout = err === 'auth timeout' || String(err) === 'auth timeout';
    const cdpTimeout = isPuppeteerProtocolTimeout(err);
    if (!authTimeout && !cdpTimeout) throw err;

    const alreadyLive = Boolean(this.info?.wid) || botReady;
    console.warn(
      `⚠️ Client.inject: ${cdpTimeout ? 'CDP/protocol timeout' : 'auth timeout'}${
        alreadyLive ? ' (navigation после ready)' : ' (старт)'
      }`
    );

    if (alreadyLive) {
      // Не пробрасываем — иначе unhandledRejection из framenavigated.
      noteCdpHang(180000, { hard: true });
      scheduleInjectRecovery(err?.message || err);
      return;
    }
    throw err;
  }
};

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: sessionPath,
    clientId: 'housetenerife-wa',
    rmMaxRetries: 10
  }),
  puppeteer: getPuppeteerLaunchOptions(),
  authTimeoutMs: Math.max(
    60000,
    parseInt(process.env.WA_AUTH_TIMEOUT_MS, 10) || 90000
  ),
  // Дополнительные настройки для стабильности
  restartOnAuthFail: true,
  takeoverOnConflict: false,
  takeoverTimeoutMs: 0
});

// Хранилище истории сообщений для каждого пользователя
// Формат: { chatId: [{ sender: 'user'|'assistant', text: string, timestamp: number }] }
const conversationHistory = new Map();

// Хранилище для отслеживания первого сообщения от каждого пользователя
const firstMessageUsers = new Set();

// Дедупликация входящих сообщений (события message / message_create)
// Формат: Map<msgId, timestamp> - для возможности очистки старых записей
const processedMessageIds = new Map();
const processingMessageIds = new Set(); // уже в обработке (защита от дублей)
const deferredRetryIds = new Set(); // отложенный retry после пустого body
const MAX_PROCESSED_IDS = 10000; // Максимум ID в памяти
const PROCESSED_ID_TTL = 3600000; // 1 час - время хранения ID

// Функция очистки старых ID из processedMessageIds
function cleanupProcessedIds() {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [msgId, timestamp] of processedMessageIds.entries()) {
    if (now - timestamp > PROCESSED_ID_TTL) {
      processedMessageIds.delete(msgId);
      cleaned++;
    }
  }
  
  // Если все еще слишком много записей, удаляем самые старые
  if (processedMessageIds.size > MAX_PROCESSED_IDS) {
    const sorted = Array.from(processedMessageIds.entries())
      .sort((a, b) => a[1] - b[1]);
    const toRemove = sorted.slice(0, processedMessageIds.size - MAX_PROCESSED_IDS);
    for (const [msgId] of toRemove) {
      processedMessageIds.delete(msgId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Очищено ${cleaned} старых ID из processedMessageIds. Осталось: ${processedMessageIds.size}`);
  }
}

function getMessageId(msg) {
  return msg.id._serialized || msg.id.id || JSON.stringify(msg.id);
}

function isMessageAlreadyHandled(msgId) {
  return (
    processedMessageIds.has(msgId) ||
    processingMessageIds.has(msgId) ||
    deferredRetryIds.has(msgId) ||
    isMessageQueuedInBatch(msgId)
  );
}

// Хранилище для всех активных интервалов и таймеров (для graceful shutdown)
const activeIntervals = new Set();
const activeTimeouts = new Set();

// Обертка для setInterval с отслеживанием
function trackedSetInterval(callback, delay) {
  const id = setInterval(async () => {
    try {
      const result = callback();
      // Если callback возвращает Promise, обрабатываем его
      if (result && typeof result.then === 'function') {
        await result;
      }
    } catch (error) {
      console.error('❌ Ошибка в интервале:', error);
    }
  }, delay);
  activeIntervals.add(id);
  return id;
}

// Обертка для setTimeout с отслеживанием
function trackedSetTimeout(callback, delay) {
  const id = setTimeout(async () => {
    activeTimeouts.delete(id);
    try {
      const result = callback();
      // Если callback возвращает Promise, обрабатываем его
      if (result && typeof result.then === 'function') {
        await result;
      }
    } catch (error) {
      console.error('❌ Ошибка в таймере:', error);
    }
  }, delay);
  activeTimeouts.add(id);
  return id;
}

function scheduleMessageRetry(msg, delayMs = 3000) {
  const msgId = getMessageId(msg);
  if (processedMessageIds.has(msgId) || deferredRetryIds.has(msgId)) return;
  deferredRetryIds.add(msgId);
  console.log(`⏳ [RETRY] Повторная обработка через ${delayMs} мс: ${msgId.substring(0, 24)}...`);
  const chatId = msg.from || msg.id?.remote || '?';
  trackedSetTimeout(() => {
    deferredRetryIds.delete(msgId);
    enqueueForChat(chatId, () => processIncomingMessage(msg, 'retry')).catch((err) => {
      console.error('❌ Ошибка повторной обработки:', err);
    });
  }, delayMs);
}

function startMessageMaintenance() {
  if (global.messageMaintenanceInterval) return;
  global.messageMaintenanceInterval = trackedSetInterval(() => {
    cleanupProcessedIds();
  }, 300000);
  console.log('🧹 Очистка кэша ID сообщений — каждые 5 мин');
  startOutboundRetryLoop();
}

function normalizeMsgTimestamp(ts) {
  if (!ts) return 0;
  return ts < 1000000000000 ? ts * 1000 : ts;
}

/** Резервный опрос чатов — только при ENABLE_POLLING=1 (иначе getChats вешает CDP). */
function startMessagePolling() {
  if (global.pollingInterval) return;

  const pollingEnabled =
    process.env.ENABLE_POLLING === '1' || process.env.ENABLE_POLLING === 'true';
  if (!pollingEnabled) {
    console.log(
      '🔄 Polling выкл (по умолчанию). Входящие: события message/message_create. Включить резерв: ENABLE_POLLING=1'
    );
    return;
  }

  // Реже = меньше нагрузка на CDP. События message — основной канал.
  const pollMs = parseInt(process.env.POLLING_INTERVAL_MS, 10) || 15000;
  const maxAgeMs = parseInt(process.env.POLLING_MAX_AGE_MS, 10) || 600000;
  const getChatsSoftMs = Math.max(
    8000,
    parseInt(process.env.POLLING_GETCHATS_TIMEOUT_MS, 10) || 25000
  );
  const reconnectThreshold = 3;
  let pollingCounter = 0;
  let consecutivePollingErrors = 0;
  let lastPollingError = null;
  let pollingInFlight = false;
  let nextPollAt = 0;
  let softErrorStreak = 0;
  let lastSoftErrorLogAt = 0;

  console.log(
    `🔄 Polling входящих каждые ${pollMs / 1000} с (резерв ENABLE_POLLING=1; getChats soft ${getChatsSoftMs / 1000}с; только ЛС${process.env.POLLING_INCLUDE_GROUPS === '1' ? ', группы включены' : ''})`
  );

  global.pollingInterval = trackedSetInterval(async () => {
    if (!botReady) return;
    if (!shouldUseMessagePolling()) return;
    if (pollingInFlight || Date.now() < nextPollAt) return;
    if (isChromiumSlow() || isCdpBusy()) return;
    pollingInFlight = true;

    pollingCounter++;
    if (pollingCounter % 20 === 0) {
      console.log(`🔄 [POLLING] цикл ${pollingCounter}, ID в кэше: ${processedMessageIds.size}`);
      if (lastPollingError) {
        console.warn(`⚠️ [POLLING] последняя ошибка: ${lastPollingError.message}`);
      }
    }

    try {
      const chats = await runExclusiveCdp(
        'polling.getChats',
        () => client.getChats(),
        getChatsSoftMs
      );
      const activeChats = chats.filter(isSafePollingChat);
      let dispatched = 0;

      for (const chat of activeChats) {
        try {
          const messages = await runExclusiveCdp(
            `polling.fetchMessages:${getChatPollingKey(chat)}`,
            () => fetchChatMessagesSafe(chat),
            Math.min(getChatsSoftMs, 10000)
          );
          const sorted = [...messages].sort(
            (a, b) => normalizeMsgTimestamp(b.timestamp) - normalizeMsgTimestamp(a.timestamp)
          );

          for (const msg of sorted) {
            if (msg.fromMe) continue;
            const msgId = getMessageId(msg);
            if (
              processedMessageIds.has(msgId) ||
              processingMessageIds.has(msgId) ||
              isMessageQueuedInBatch(msgId)
            ) {
              continue;
            }

            const age = Date.now() - normalizeMsgTimestamp(msg.timestamp);
            if (age >= maxAgeMs) {
              processedMessageIds.set(msgId, Date.now());
              continue;
            }
            if (isMessageAlreadyHandled(msgId)) continue;

            dispatched++;
            console.log('📨 [POLLING] новое сообщение:', {
              from: msg.from,
              body: msg.body ? msg.body.slice(0, 50) : '(нет текста)',
              ageSec: Math.round(age / 1000)
            });
            dispatchIncomingMessage(msg, 'polling');
          }
        } catch (chatErr) {
          if (isPuppeteerProtocolTimeout(chatErr)) {
            noteCdpHang(180000, { hard: true });
            break;
          }
          if (isCdpSoftTimeout(chatErr)) {
            break;
          }
          if (!isChatLoadError(chatErr) && pollingCounter % 20 === 0) {
            console.warn(`⚠️ [POLLING] чат ${getChatPollingKey(chat)}:`, chatErr.message);
          }
        }
      }

      consecutivePollingErrors = 0;
      softErrorStreak = 0;
      nextPollAt = 0;
      lastPollingError = null;
      clearCdpHang();
      if (pollingCounter % 20 === 0 && dispatched > 0) {
        console.log(`📊 [POLLING] отправлено на обработку: ${dispatched}`);
      }
    } catch (pollError) {
      lastPollingError = pollError;
      consecutivePollingErrors++;
      if (isPollingGetChatsBrokenError(pollError)) {
        disablePollingForProcess(pollError.message);
        nextPollAt = Date.now() + 600000;
        consecutivePollingErrors = 0;
        return;
      }
      const soft =
        isChatLoadError(pollError) ||
        isTransientChatLookupError(pollError) ||
        isPuppeteerProtocolTimeout(pollError) ||
        isCdpSoftTimeout(pollError);
      if (soft) {
        softErrorStreak++;
        const cdpSlow =
          isPuppeteerProtocolTimeout(pollError) ||
          isCdpSoftTimeout(pollError) ||
          pollError?.code === 'WA_CDP_COOLDOWN' ||
          pollError?.code === 'WA_CDP_BUSY';
        if (cdpSlow) {
          const isSoft =
            isCdpSoftTimeout(pollError) && !isPuppeteerProtocolTimeout(pollError);
          const isBusyOrCooldown =
            pollError?.code === 'WA_CDP_BUSY' || pollError?.code === 'WA_CDP_COOLDOWN';
          if (isPuppeteerProtocolTimeout(pollError)) {
            noteCdpHang(300000, { hard: true });
          } else if (!isBusyOrCooldown && !isSoft) {
            noteCdpHang(180000);
          }
          if (!isSoft && !isBusyOrCooldown && shouldRecoverFromCdpHang()) {
            recoverFromCdpHang(pollError.message).catch((err) =>
              console.error('❌ CDP recovery после polling:', err.message)
            );
          }
        }
        if (softErrorStreak >= 3) {
          disablePollingForProcess(
            `getChats soft-timeout ${softErrorStreak}× подряд`
          );
        }
        const backoffMs = Math.min(
          Math.max(pollMs, cdpSlow ? 120000 : 5000) * Math.pow(2, Math.min(softErrorStreak - 1, 3)),
          cdpSlow ? 600000 : 60000
        );
        nextPollAt = Date.now() + backoffMs;
        const now = Date.now();
        const quietLog =
          pollError?.code === 'WA_CDP_BUSY' || pollError?.code === 'WA_CDP_COOLDOWN';
        if (!quietLog && (softErrorStreak === 1 || now - lastSoftErrorLogAt >= 5 * 60 * 1000)) {
          console.warn(
            `⚠️ [POLLING] ${cdpSlow ? 'Chromium/CDP медленный' : 'Store недоступен'} (${pollError.message}); повтор через ${Math.round(backoffMs / 1000)} с`
          );
          lastSoftErrorLogAt = now;
        }
        consecutivePollingErrors = 0;
      } else {
        console.error('❌ [POLLING]:', pollError.message);
      }

      if (!soft && consecutivePollingErrors >= reconnectThreshold) {
        let stillConnected = false;
        try {
          if (!isChromiumSlow()) {
            stillConnected = (await client.getState()) === 'CONNECTED';
          }
        } catch (stateErr) {
          if (isPuppeteerProtocolTimeout(stateErr)) {
            noteCdpHang(180000, { hard: true });
            stillConnected = true;
          }
        }
        if (stillConnected) {
          console.warn(
            `⚠️ [POLLING] ${consecutivePollingErrors} ошибок подряд, но сессия CONNECTED — reconnect пропускаем`
          );
          consecutivePollingErrors = 0;
        } else {
          console.warn(`⚠️ [POLLING] ${consecutivePollingErrors} ошибок подряд → переподключение`);
          consecutivePollingErrors = 0;
          botReady = false;
          reconnectClient().catch((err) =>
            console.error('❌ переподключение после polling:', err.message)
          );
        }
      }
    } finally {
      pollingInFlight = false;
    }

    if (pollingCounter % 100 === 0) {
      cleanupProcessedIds();
    }
  }, pollMs);
}

async function withChatTyping(msg, work) {
  // Не трогаем CDP для typing, если Chromium уже медленный — иначе AI ждёт зависший getChat.
  if (isChromiumSlow() || isCdpBusy()) {
    return work();
  }
  let chat;
  try {
    chat = await Promise.race([
      msg.getChat(),
      new Promise((_, reject) =>
        setTimeout(() => {
          const err = new Error('typing getChat soft timeout');
          err.code = 'WA_SEND_SOFT_TIMEOUT';
          reject(err);
        }, 8000)
      ),
    ]);
    if (typeof chat.sendStateTyping === 'function') {
      await Promise.race([
        chat.sendStateTyping(),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
  } catch {
    chat = null;
  }
  try {
    return await work();
  } finally {
    try {
      if (chat && typeof chat.clearState === 'function' && !isChromiumSlow()) {
        await Promise.race([
          chat.clearState(),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      }
    } catch {
      /* ignore */
    }
  }
}

function dispatchIncomingMessage(msg, source) {
  if (msg.fromMe) return;
  if (source === 'message' || source === 'message_create') {
    touchIncomingEvent();
  } else {
    touchWhatsAppActivity();
  }
  const chatId = msg.from || msg.id?.remote || '?';
  enqueueForChat(chatId, () => processIncomingMessage(msg, source)).catch((error) => {
    console.error(`❌ Ошибка обработки сообщения (${source}):`, error.message);
  });
}

/** @returns {Promise<'processed'|'retry'|'skip'|'debounced'|null>} */
async function processIncomingMessage(msg, source = 'unknown', opts = {}) {
  const msgId = getMessageId(msg);
  if (processedMessageIds.has(msgId)) return null;
  if (isMessageQueuedInBatch(msgId)) {
    console.log(`⏭️ [DEDUP] Уже в пачке ожидания (${source}): ${msgId.substring(0, 24)}...`);
    return 'debounced';
  }
  if (processingMessageIds.has(msgId)) {
    console.log(`⏭️ [DEDUP] Сообщение уже обрабатывается (${source}): ${msgId.substring(0, 24)}...`);
    return null;
  }
  if (deferredRetryIds.has(msgId) && source !== 'retry') {
    console.log(`⏭️ [DEDUP] Ожидается отложенный retry (${source})`);
    return null;
  }

  if (!opts.skipReplyBatch) {
    const debounce = await shouldDebounceForReply(msg);
    if (debounce) {
      const queued = scheduleReplyBatch(
        debounce.chatId,
        debounce.msg,
        source,
        (chatId, messages, src) =>
          enqueueForChat(chatId, () => processReplyBatchFlush(chatId, messages, src)),
        trackedSetTimeout
      );
      if (queued === 'duplicate') {
        console.log(`⏭️ [DEDUP] Уже в пачке ожидания (${source}): ${msgId.substring(0, 24)}...`);
      }
      return 'debounced';
    }
  }

  processingMessageIds.add(msgId);
  try {
    const status = await handleIncomingMessage(msg, opts);
    if (status === 'retry') {
      scheduleMessageRetry(msg);
      return status;
    }
    if (status && status !== 'debounced') {
      processedMessageIds.set(msgId, Date.now());
    }
    return status;
  } finally {
    processingMessageIds.delete(msgId);
  }
}

async function processReplyBatchFlush(chatId, messages, source) {
  const pending = messages.filter((m) => !processedMessageIds.has(getMessageId(m)));
  if (!pending.length) return;

  for (const m of pending) {
    processingMessageIds.add(getMessageId(m));
  }
  try {
    await processBatchedIncomingMessages(pending, source);
    for (const m of pending) {
      processedMessageIds.set(getMessageId(m), Date.now());
    }
  } finally {
    for (const m of pending) {
      processingMessageIds.delete(getMessageId(m));
    }
  }
}

async function processBatchedIncomingMessages(messages, source) {
  if (!messages.length) return;

  // Уникальные сообщения по id (на случай гонки message / message_create)
  const byId = new Map();
  for (const m of messages) {
    const id = getMessageId(m);
    if (!id || byId.has(id)) continue;
    byId.set(id, m);
  }
  const uniqueMessages = Array.from(byId.values());

  const resolved = [];
  for (const m of uniqueMessages) {
    const r = await resolveMessageText(m);
    if (r.text) {
      resolved.push({ msg: r.msg, text: r.text, msgId: getMessageId(r.msg) });
    }
  }
  if (!resolved.length) return;

  if (resolved.length === 1) {
    await handleIncomingMessage(resolved[0].msg, { skipReplyBatch: true });
    return;
  }

  console.log(
    `📦 Пачка ${resolved.length} сообщ. → один ответ: ${resolved.map((r) => r.text.slice(0, 50)).join(' | ')}`
  );

  const last = resolved[resolved.length - 1];
  await handleIncomingMessage(last.msg, {
    skipReplyBatch: true,
    prependUserTexts: resolved.slice(0, -1).map((r) => r.text),
    batchMessages: resolved,
  });
}

// Максимальное количество сообщений в истории (чтобы не перегружать контекст)
const MAX_HISTORY_LENGTH = 20;

function ensureHistoryHydrated(chatId) {
  try {
    const result = hydrateConversationHistory(
      conversationHistory,
      chatId,
      getPersistedMessages,
      MAX_HISTORY_LENGTH
    );
    if (result.hydrated && result.count > 0) {
      console.log(`🧠 История ${chatId} восстановлена: ${result.count} сообщений`);
    }
    return result;
  } catch (e) {
    console.warn(`⚠️ Не удалось восстановить историю ${chatId}:`, e.message);
    if (!conversationHistory.has(String(chatId))) {
      conversationHistory.set(String(chatId), []);
    }
    return { hydrated: false, count: 0 };
  }
}

// Функция для добавления сообщения в историю
function persistChatMessage(chatId, role, text, extra = {}) {
  if (!chatId || !text) return;
  try {
    persistMessage(chatId, { role, text, ...extra });
    touchHandoffActivity(chatId);
    const { onConversationMessage } = require('./property-interest');
    onConversationMessage(chatId, role, text, extra.language || 'ru');
  } catch (e) {
    console.warn('⚠️ persistChatMessage:', e.message);
  }
}

function addToHistory(chatId, sender, text, { persist = true, language = null } = {}) {
  ensureHistoryHydrated(chatId);
  if (!conversationHistory.has(chatId)) {
    conversationHistory.set(chatId, []);
  }
  
  const history = conversationHistory.get(chatId);
  history.push({
    sender: sender,
    text: text,
    timestamp: Date.now()
  });
  
  // Ограничиваем размер истории
  if (history.length > MAX_HISTORY_LENGTH) {
    history.shift(); // Удаляем самое старое сообщение
  }

  if (!persist || !text) return;

  const extra = language ? { language } : {};
  if (sender === 'user') {
    persistChatMessage(chatId, 'user', text, extra);
  } else if (sender === 'assistant') {
    persistChatMessage(chatId, 'assistant', text, extra);
  }
}

// Функция для получения истории разговора
function getHistory(chatId) {
  return conversationHistory.get(chatId) || [];
}

async function sendManagerMessage(chatId, text, { managerId = '', managerName = '' } = {}) {
  if (!botReady || !client) {
    return { success: false, status: 503, message: 'WhatsApp бот не готов' };
  }
  try {
    await client.sendMessage(chatId, text, { sendSeen: false });
    addToHistory(chatId, 'assistant', text, { persist: false });
    const message = persistMessage(chatId, {
      role: 'manager',
      text,
      managerId,
      managerName,
    });
    touchHandoffActivity(chatId);
    setAiDisabled(chatId, true);
    console.log(`👤 Менеджер ${managerName || managerId} → ${chatId}`);
    return {
      success: true,
      message,
      settings: getChatSettings(chatId),
    };
  } catch (e) {
    console.error('❌ sendManagerMessage:', e.message);
    return { success: false, status: 500, message: e.message || 'Не удалось отправить сообщение' };
  }
}

/**
 * Язык ответа: sticky на чат + сильный сигнал из текста.
 * Короткие ok/yes/да не переключают язык; пачка сообщений склеивается.
 */
function resolveDialogLanguage(chatId, currentMessageText, phoneFallback = 'ru') {
  const sticky = getStickyDialogLanguage(chatId);
  const trimmed = String(currentMessageText || '').trim();

  const detectFromHistory = () => {
    const userMsgs = getHistory(chatId).filter((m) => m.sender === 'user');
    for (let i = userMsgs.length - 1; i >= 0; i--) {
      const t = String(userMsgs[i].text || '').trim();
      if (t.length >= 2 && !t.startsWith('[') && !isAmbiguousShortReply(t)) {
        return detectLanguageFromText(t);
      }
    }
    return null;
  };

  let resolved = sticky || phoneFallback || 'ru';

  if (trimmed.length >= 1) {
    const fromText = detectLanguageFromText(trimmed);
    if (sticky) {
      if (isStrongLanguageSignal(trimmed, fromText) && fromText !== sticky) {
        resolved = fromText;
        console.log(
          `🌐 Язык диалога переключён ${sticky} → ${fromText} (${chatId})`
        );
      } else {
        resolved = sticky;
      }
    } else if (isAmbiguousShortReply(trimmed) || isMostlyPlaceName(trimmed)) {
      // Топонимы / ok / 300k — не задают язык диалога
      resolved = detectFromHistory() || phoneFallback || fromText;
    } else {
      resolved = fromText;
    }
  } else if (!sticky) {
    resolved = detectFromHistory() || phoneFallback || 'ru';
  }

  setStickyDialogLanguage(chatId, resolved);
  return resolved;
}

// Хранилище для обработки команд (теперь с поддержкой языков)
const commandHandlers = {
  '/start': async (msg, language, client) => {
    const text = getTranslation(language, 'start');
    await sendMessageSafely(msg, text, client);
  },
  
  '/help': async (msg, language, client) => {
    const text = getTranslation(language, 'help');
    await sendMessageSafely(msg, text, client);
  },
  
  '/status': async (msg, language, client) => {
    try {
      const info = await msg.getChat();
      const statusText = getTranslation(language, 'status');
      const salesLang = String(language || '').toLowerCase().slice(0, 2);
      const label =
        salesLang === 'ru' || salesLang === 'uk' || salesLang === 'be' ? 'Чат' : 'Chat';
      await sendMessageSafely(
        msg,
        `${statusText}\n\n${label}: ${info.name || info.id.user || msg.from}`,
        client
      );
    } catch (error) {
      console.error('Ошибка проверки статуса:', error);
      const statusText = getTranslation(language, 'status');
      await sendMessageSafely(msg, statusText, client);
    }
  },
  
  '/time': async (msg, language, client) => {
    try {
      const now = new Date();
      // Определяем часовой пояс по стране
      const country = getCountryFromPhone(msg.from);
      const timeZone = getTimeZoneByCountry(country);
      
      const timeString = now.toLocaleString(
        language === 'ru'
          ? 'ru-RU'
          : language === 'es'
            ? 'es-ES'
            : language === 'de'
              ? 'de-DE'
              : language === 'fr'
                ? 'fr-FR'
                : 'en-US',
        {
        timeZone: timeZone,
        dateStyle: 'full',
        timeStyle: 'long'
      });
      
      const timeText = getTranslation(language, 'time');
      const response = `${timeText} ${timeString}`;
      
      // Используем безопасный метод отправки
      await sendMessageSafely(msg, response, client);
    } catch (error) {
      console.error('Ошибка в команде /time:', error);
      throw error;
    }
  },
  
  '/site': async (msg, language, client) => {
    const siteText = getTranslation(language, 'site');
    const { getCatalogSiteUrl } = require('./property-catalog');
    const siteUrl = getCatalogSiteUrl(language);
    const response = `${siteText}\n\n${siteUrl}`;
    await sendMessageSafely(msg, response, client);
  },
  '/ping': async (msg, language, client) => {
    const pong =
      language === 'ru'
        ? 'Понг! Бот вас видит.'
        : language === 'de'
          ? 'Pong! Der Bot sieht dich.'
          : language === 'fr'
            ? 'Pong! Le bot vous voit.'
            : language === 'es'
              ? '¡Pong! El bot te ve.'
              : 'Pong! Bot sees you.';
    await sendMessageSafely(msg, pong, client);
  },

};

async function shouldDebounceForReply(msg) {
  if (!botReady) return null;
  if (msg.fromMe) return null;
  if (msg.from === 'status@broadcast' || String(msg.from || '').includes('@broadcast')) return null;

  let chat;
  try {
    chat = await resolveIncomingChat(msg);
  } catch {
    chat = buildFallbackChatFromMessage(msg);
  }

  if (chat.isChannel) return null;
  if (chat.isGroup) {
    if (!REPLY_IN_GROUPS) return null;
    if (GROUP_ONLY_MENTION && !(await shouldRespondInGroup(msg))) return null;
  }

  const resolved = await resolveMessageText(msg);
  if (isVoiceMessage(resolved.msg)) return null;
  if (!resolved.text) return null;

  const chatId = getConversationChatId(resolved.msg, chat);
  const messageText = resolved.text;
  const trimmed = messageText.trim().toLowerCase();

  if (commandHandlers[trimmed]) return null;
  if (getPendingHandoff(chatId)) return null;

  const pendingCallOffer = getPendingCallOffer(chatId);
  if (pendingCallOffer && !commandHandlers[trimmed]) {
    if (
      isBareCallAcceptance(messageText) ||
      detectNegativeResponse(messageText) ||
      wantsManagerHandoff(messageText)
    ) {
      return null;
    }
  }

  if (wantsManagerHandoff(messageText)) return null;
  if (containsLink(messageText) && !commandHandlers[trimmed]) return null;
  if (isImageWithDescription(resolved.msg, messageText)) return null;

  return { chatId, msg: resolved.msg };
}

// Функция для определения часового пояса по стране
function getTimeZoneByCountry(countryCode) {
  const timeZones = {
    'RU': 'Europe/Moscow',
    'KZ': 'Asia/Almaty',
    'BY': 'Europe/Minsk',
    'UA': 'Europe/Kyiv',
    'ES': 'Europe/Madrid',
    'MX': 'America/Mexico_City',
    'AR': 'America/Argentina/Buenos_Aires',
    'US': 'America/New_York',
    'GB': 'Europe/London',
    'DE': 'Europe/Berlin',
    'FR': 'Europe/Paris',
    'IT': 'Europe/Rome',
    // Добавьте больше по необходимости
  };
  
  return timeZones[countryCode] || 'UTC';
}

// Обработка QR-кода для авторизации
client.on('qr', (qr) => {
  currentQr = qr;
  accountInfo = null;
  botReady = false;
  telegramNotify.notifyWhatsAppConnection('qr_needed', { force: isManualLogoutInProgress });
  console.log('📱 Отсканируйте QR-код ниже для авторизации (или в веб-панели на сайте):');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  currentQr = null;
});

// Обработка готовности клиента
client.on('ready', async () => {
  console.log('✅ Бот готов к работе!');
  console.log('📱 WhatsApp бот запущен и готов получать сообщения');
  botReady = true;
  waWatchState = 'CONNECTED';
  if (injectRecoveryTimer) {
    clearTimeout(injectRecoveryTimer);
    injectRecoveryTimer = null;
  }
  // Сбрасываем все счетчики при успешном подключении
  reconnectAttempts = 0;
  isReconnecting = false;
  disconnectCount = 0;
  lastReconnectTime = 0;
  lastDisconnectTime = 0;
  logoutHandled = false;
  if (logoutTimeout) {
    clearTimeout(logoutTimeout);
    logoutTimeout = null;
  }
  
  // Диагностика с мягкими таймаутами — не держим CDP на protocolTimeout (минуты).
  try {
    const snap = await getClientStateFast(10000);
    console.log(
      `📊 Состояние клиента подтверждено: ${snap.state}${snap.cached ? ' (cached)' : ''}`
    );

    const messageListeners = client.listenerCount('message');
    const messageCreateListeners = client.listenerCount('message_create');
    const totalListeners = messageListeners + messageCreateListeners;
    console.log(
      `📝 Зарегистрировано обработчиков: message=${messageListeners}, message_create=${messageCreateListeners}, всего=${totalListeners}`
    );

    if (messageListeners === 0) {
      console.warn('⚠️ ВНИМАНИЕ: Обработчик message не зарегистрирован!');
      client.on('message', (m) => dispatchIncomingMessage(m, 'message'));
      console.log('✅ Обработчик message зарегистрирован заново');
    }

    try {
      const info = await client.info;
      accountInfo = {
        phone: info.wid?.user || null,
        name: info.pushname || null,
        platform: info.platform || null,
      };
      currentQr = null;
      console.log(
        `👤 Информация о клиенте: ${accountInfo.phone || 'неизвестно'} (${accountInfo.name || '—'})`
      );
      telegramNotify.notifyWhatsAppConnection('connected', {
        phone: accountInfo.phone,
        name: accountInfo.name,
      });
    } catch (infoError) {
      console.warn('⚠️ Не удалось получить информацию о клиенте:', infoError.message);
    }

    // Не вызываем getChats() на старте: при WA Web 2.3000 без патча это даёт «r»
    // и может забить CDP. Polling сам подхватит чаты после warmup.

    console.log('🔍 Диагностика завершена. Бот готов получать сообщения.');

    console.log('📡 Входящие: события message + message_create + polling (резерв), очередь по чату');
    startMessageMaintenance();
    // Даём WA Web/Store чуть осесть после ready (warmup, не CDP hang).
    markChromiumSlow(20000);
    startMessagePolling();
  } catch (error) {
    console.warn('⚠️ Не удалось подтвердить состояние клиента:', error.message);
    startMessageMaintenance();
    markChromiumSlow(20000);
    startMessagePolling();
  }
});

// Обработка изменения состояния клиента
client.on('change_state', async (state) => {
  console.log(`🔄 Изменение состояния клиента: ${state}`);

  const observed = classifyObservedState(state);
  if (observed === 'connected' && !botReady) {
    console.log('✅ Бот готов к работе! (определено через change_state)');
    console.log('📱 WhatsApp бот запущен и готов получать сообщения');
    botReady = true;
    waWatchState = 'CONNECTED';
    // Сбрасываем все счетчики при успешном подключении
    reconnectAttempts = 0;
    isReconnecting = false;
    disconnectCount = 0;
    lastReconnectTime = 0;
    lastDisconnectTime = 0;
    logoutHandled = false;
    if (logoutTimeout) {
      clearTimeout(logoutTimeout);
      logoutTimeout = null;
    }
  } else if (observed === 'transient') {
    // WhatsApp Web кратковременно отдаёт UNLAUNCHED/UNPAIRED при reload/injection.
    // Настоящий logout подтверждают событие disconnected: LOGOUT или новый QR.
    console.log(`⏳ Промежуточное состояние WhatsApp: ${state}, сессию не завершаем`);
  } else if (observed === 'disconnected') {
    botReady = false;
    telegramNotify.notifyWhatsAppConnection('disconnected', { reason: state });
    console.log('⚠️ Бот не готов к работе (состояние: ' + state + ')');
  }
});

// Обработка авторизации
client.on('authenticated', async () => {
  console.log('✅ Авторизация успешна!');

  // Не ждём protocolTimeout: иначе один зависший getState блокирует CDP на минуты.
  try {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const snap = await getClientStateFast(12000);
    console.log(
      `📊 Текущее состояние клиента: ${snap.state}${snap.cached ? ' (cached/timeout)' : ''}`
    );

    if (snap.state === 'CONNECTED' || snap.ready) {
      console.log('✅ Бот готов к работе!');
      console.log('📱 WhatsApp бот запущен и готов получать сообщения');
      botReady = true;
      reconnectAttempts = 0;
      isReconnecting = false;
      disconnectCount = 0;
      lastReconnectTime = 0;
      lastDisconnectTime = 0;
      logoutHandled = false;
      if (logoutTimeout) {
        clearTimeout(logoutTimeout);
        logoutTimeout = null;
      }
    }
    if (snap.error && isPuppeteerProtocolTimeout({ message: snap.error })) {
      noteCdpHang(45000, { hard: true });
    }
  } catch (error) {
    console.warn('⚠️ Не удалось проверить состояние клиента:', error.message);
    if (isPuppeteerProtocolTimeout(error)) noteCdpHang(45000, { hard: true });
  }
});

// Обработка ошибок авторизации
client.on('auth_failure', (msg) => {
  console.error('❌ Ошибка авторизации:', msg);
  console.log('💡 Попробуйте:');
  console.log('   1. Удалить папку .wwebjs_auth');
  console.log('   2. Перезапустить бота');
  console.log('   3. Отсканировать QR-код заново');
});

// Флаги и счетчики для управления переподключениями
let isReconnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let lastReconnectTime = 0;
const MIN_RECONNECT_INTERVAL = 60000; // Минимум 60 секунд между переподключениями
// После длительного простоя (например неделя без пользователей) сбрасываем счётчик, чтобы снова пытаться переподключиться
const RECONNECT_ATTEMPTS_RESET_AFTER_MS = 2 * 60 * 60 * 1000; // 2 часа
let lastDisconnectTime = 0;
/** Когда в последний раз исчерпали лимит попыток переподключения (для сброса после долгого простоя) */
let lastMaxAttemptsReachedAt = 0;
let disconnectCount = 0;
const MAX_DISCONNECTS_PER_MINUTE = 3; // Максимум 3 отключения в минуту
let logoutHandled = false; // Флаг для предотвращения множественной обработки LOGOUT
let logoutTimeout = null; // Таймер для обработки LOGOUT

// Функция переподключения
async function reconnectClient() {
  if (isReconnecting) {
    console.log('⚠️ Переподключение уже выполняется, пропускаем...');
    return;
  }

  // Проверяем минимальный интервал
  const now = Date.now();
  const timeSinceLastReconnect = now - lastReconnectTime;
  if (timeSinceLastReconnect < MIN_RECONNECT_INTERVAL) {
    const waitTime = Math.ceil((MIN_RECONNECT_INTERVAL - timeSinceLastReconnect) / 1000);
    console.log(`⏳ Слишком рано для переподключения. Ждем ${waitTime} секунд...`);
    setTimeout(() => {
      reconnectClient();
    }, MIN_RECONNECT_INTERVAL - timeSinceLastReconnect);
    return;
  }

  isReconnecting = true;
  reconnectAttempts++;
  lastReconnectTime = Date.now();

  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    // После долгого простоя даём ещё один шанс — иначе бот навсегда останется "мёртвым" при простое неделю
    const nowForReset = Date.now();
    if (lastMaxAttemptsReachedAt === 0) lastMaxAttemptsReachedAt = nowForReset;
    const timeSinceGiveUp = nowForReset - lastMaxAttemptsReachedAt;
    if (timeSinceGiveUp < RECONNECT_ATTEMPTS_RESET_AFTER_MS) {
      console.error('❌ Превышено максимальное количество попыток переподключения');
      console.log(`💡 Следующая автоматическая попытка через ${Math.ceil((RECONNECT_ATTEMPTS_RESET_AFTER_MS - timeSinceGiveUp) / 60000)} мин (при долгом простое)`);
      console.log('💡 Или перезапустите бота вручную');
      isReconnecting = false;
      return;
    }
    console.log('🔄 Долгий простой: сбрасываем счётчик попыток и пробуем переподключиться снова');
    reconnectAttempts = 0;
    lastMaxAttemptsReachedAt = 0;
  }

  // Экспоненциальная задержка: 10, 20, 40, 80, 160 секунд
  const delay = Math.min(10000 * Math.pow(2, reconnectAttempts - 1), 160000);
  console.log(`🔄 Попытка переподключения ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);
  console.log(`⏳ Задержка перед переподключением: ${delay / 1000} секунд`);
  
  await new Promise(resolve => setTimeout(resolve, delay));
  
  try {
    // Проверяем, не инициализирован ли уже клиент (с таймаутом — если браузер мёртв, не висим 3 мин)
    try {
      const state = await Promise.race([
        client.getState(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('getState timeout')), 15000))
      ]);
      if (state === 'CONNECTED' || state === 'OPENING') {
        console.log('✅ Клиент уже подключен или подключается, отменяем переподключение');
        isReconnecting = false;
        reconnectAttempts = 0;
        lastMaxAttemptsReachedAt = 0;
        return;
      }
    } catch (stateError) {
      // Игнорируем ошибки проверки состояния (в т.ч. таймаут — значит браузер не отвечает)
    }
    
    // Пытаемся безопасно закрыть клиент (с kill Chromium, если CDP мёртв)
    try {
      await forceCloseWhatsAppBrowser(20000);
      console.log('✅ Клиент успешно закрыт');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (destroyError) {
      console.log('⚠️ Предупреждение при закрытии клиента (можно игнорировать):', destroyError.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    
    console.log('🔄 Инициализация клиента заново...');
    await client.initialize();
    
    isReconnecting = false;
    reconnectAttempts = 0; // Сбрасываем счетчик при успешном подключении
    lastMaxAttemptsReachedAt = 0;
    disconnectCount = 0; // Сбрасываем счетчик отключений
  } catch (error) {
    console.error('❌ Ошибка переподключения:', error.message);
    isReconnecting = false;
    
    // Экспоненциальная задержка перед следующей попыткой
    const retryDelay = Math.min(15000 * Math.pow(2, reconnectAttempts - 1), 300000);
    console.log(`⏳ Повторная попытка через ${retryDelay / 1000} секунд...`);
    setTimeout(() => {
      reconnectClient();
    }, retryDelay);
  }
}

// Обработка отключения
client.on('disconnected', (reason) => {
  const now = Date.now();
  console.log('⚠️ Бот отключен:', reason);
  botReady = false;
  telegramNotify.notifyWhatsAppConnection(isDefinitiveLogoutReason(reason) ? 'logout' : 'disconnected', {
    reason: String(reason),
    force: isDefinitiveLogoutReason(reason)
  });
  
  // Проверяем частоту отключений
  if (now - lastDisconnectTime < 60000) {
    disconnectCount++;
  } else {
    disconnectCount = 1;
  }
  lastDisconnectTime = now;
  
  // Если слишком много отключений за короткое время - не переподключаемся автоматически
  if (disconnectCount > MAX_DISCONNECTS_PER_MINUTE) {
    console.error('❌ Слишком много отключений за короткое время!');
    console.log('💡 Автоматическое переподключение отключено для предотвращения LOGOUT');
    console.log('💡 Рекомендуется:');
    console.log('   1. Подождать несколько минут');
    console.log('   2. Проверить интернет-соединение');
    console.log('   3. Перезапустить бота вручную');
    return;
  }
  
  // Проверяем минимальный интервал между переподключениями
  const timeSinceLastReconnect = now - lastReconnectTime;
  if (timeSinceLastReconnect < MIN_RECONNECT_INTERVAL) {
    const waitTime = Math.ceil((MIN_RECONNECT_INTERVAL - timeSinceLastReconnect) / 1000);
    console.log(`⏳ Слишком рано для переподключения. Ждем ${waitTime} секунд...`);
    setTimeout(() => {
      handleDisconnect(reason);
    }, MIN_RECONNECT_INTERVAL - timeSinceLastReconnect);
    return;
  }
  
  handleDisconnect(reason);
});

// Функция обработки отключения
function handleDisconnect(reason) {
  if (reason === 'LOGOUT') {
    // Предотвращаем множественную обработку LOGOUT
    if (logoutHandled) {
      console.log('⚠️ LOGOUT уже обрабатывается, пропускаем...');
      return;
    }
    
    logoutHandled = true;
    console.log('⚠️ Обнаружен LOGOUT - требуется повторная авторизация');
    console.log('💡 Если это происходит часто, возможно:');
    console.log('   - WhatsApp разлогинивает из-за подозрительной активности');
    console.log('   - Проблемы с сохранением сессии');
    console.log('   - Нужно удалить папку .wwebjs_auth и авторизоваться заново');
    
    // При LOGOUT не пытаемся автоматически переподключаться
    console.log('⏳ При LOGOUT автоматическое переподключение отключено');
    console.log('💡 Рекомендуется:');
    console.log('   1. Подождать 1-2 минуты');
    console.log('   2. Перезапустить бота вручную (Ctrl+C, затем npm start)');
    console.log('   3. Или удалить папку .wwebjs_auth и авторизоваться заново');
    
    // Очищаем таймеры переподключения
    if (logoutTimeout) {
      clearTimeout(logoutTimeout);
    }
    
    // Пробуем переинициализировать через 2 минуты (только один раз)
    logoutTimeout = setTimeout(() => {
      console.log('🔄 Попытка переинициализации после LOGOUT...');
      reconnectClientAfterLogout();
    }, 120000); // Ждем 2 минуты
  } else {
    // Для других причин отключения пытаемся переподключиться с задержкой
    console.log('🔄 Пытаемся переподключиться через 15 секунд...');
    setTimeout(() => {
      reconnectClient();
    }, 15000);
  }
}

// Специальная функция для переподключения после LOGOUT
async function reconnectClientAfterLogout() {
  if (isReconnecting) {
    console.log('⚠️ Переподключение уже выполняется, пропускаем...');
    return;
  }

  isReconnecting = true;
  reconnectAttempts++;
  lastReconnectTime = Date.now();

  if (reconnectAttempts > 2) {
    // После LOGOUT делаем максимум 2 попытки
    console.error('❌ Превышено максимальное количество попыток переподключения после LOGOUT');
    console.log('💡 Рекомендуется:');
    console.log('   1. Остановить бота (Ctrl+C)');
    console.log('   2. Подождать 5-10 минут');
    console.log('   3. Удалить папку .wwebjs_auth');
    console.log('   4. Запустить бота заново: npm start');
    isReconnecting = false;
    logoutHandled = false; // Разблокируем для следующего LOGOUT
    return;
  }

  console.log(`🔄 Попытка переподключения после LOGOUT ${reconnectAttempts}/2...`);
  console.log('⏳ Ожидание освобождения ресурсов (30 секунд)...');
  
  // Ждем достаточно долго, чтобы файлы освободились
  await new Promise(resolve => setTimeout(resolve, 30000));
  
  try {
    // Проверяем состояние клиента
    try {
      const state = await client.getState();
      if (state === 'CONNECTED' || state === 'OPENING') {
        console.log('✅ Клиент уже подключен или подключается');
        isReconnecting = false;
        reconnectAttempts = 0;
        logoutHandled = false;
        return;
      }
    } catch (stateError) {
      // Игнорируем ошибки проверки состояния
    }
    
    // Пытаемся безопасно закрыть клиент, но игнорируем ошибки
    try {
      await client.destroy();
      console.log('✅ Клиент закрыт');
      await new Promise(resolve => setTimeout(resolve, 10000)); // Ждем еще 10 секунд
    } catch (destroyError) {
      // Игнорируем ошибки при destroy
      console.log('⚠️ Предупреждение при закрытии (можно игнорировать)');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    console.log('🔄 Переинициализация клиента...');
    // При LOGOUT просто переинициализируем - библиотека сама обработает сессию
    await client.initialize();
    
    isReconnecting = false;
    reconnectAttempts = 0;
    disconnectCount = 0;
    logoutHandled = false; // Разблокируем для следующего LOGOUT
  } catch (error) {
    console.error('❌ Ошибка переподключения:', error.message);
    
    // Если ошибка связана с заблокированными файлами - прекращаем попытки
    if (error.message.includes('EBUSY') || error.message.includes('locked') || 
        error.message.includes('ENOENT') || error.stack?.includes('LocalAuth')) {
      console.log('💡 Обнаружена проблема с файлами сессии');
      console.log('💡 Рекомендуется:');
      console.log('   1. Остановить бота (Ctrl+C)');
      console.log('   2. Подождать 1-2 минуты');
      console.log('   3. Удалить папку .wwebjs_auth');
      console.log('   4. Запустить бота заново: npm start');
      isReconnecting = false;
      logoutHandled = false;
      return;
    }
    
    isReconnecting = false;
    logoutHandled = false;
    
    // Больше не пытаемся автоматически - просим пользователя перезапустить
    console.log('💡 Автоматическое переподключение после LOGOUT не удалось');
    console.log('💡 Пожалуйста, перезапустите бота вручную');
  }
}

let isManualLogoutInProgress = false;

async function removeSessionDirWithRetries(dirPath, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.promises.rm(dirPath, { recursive: true, force: true, maxRetries: 8 });
      return;
    } catch (err) {
      if (i >= attempts - 1) throw err;
      const waitMs = 2000 * (i + 1);
      console.log(`⏳ Папка сессии занята, повтор через ${waitMs / 1000} с…`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

/** Выход из WhatsApp через админ-панель: закрыть браузер, удалить сессию, показать QR. */
async function logoutWhatsAppSession() {
  if (isManualLogoutInProgress) {
    return { success: false, message: 'Выход из сессии уже выполняется' };
  }
  if (isReconnecting) {
    return { success: false, message: 'Подождите завершения переподключения WhatsApp' };
  }

  isManualLogoutInProgress = true;
  botReady = false;
  accountInfo = null;
  currentQr = null;
  logoutHandled = true;

  telegramNotify
    .notifyWhatsAppConnection('logout', {
      reason: 'Выход из сессии (админ-панель)',
      force: true
    })
    .catch((err) => console.error('telegram-notify logout:', err.message));

  if (logoutTimeout) {
    clearTimeout(logoutTimeout);
    logoutTimeout = null;
  }

  const sessionDir = path.join(sessionPath, 'session-housetenerife-wa');
  console.log('🚪 Запрос выхода из WhatsApp-сессии (админ-панель)…');

  try {
    try {
      await client.logout();
      console.log('✅ WhatsApp logout выполнен');
    } catch (logoutErr) {
      console.warn('⚠️ client.logout():', logoutErr.message);
      try {
        await client.destroy();
        console.log('✅ Клиент закрыт через destroy');
      } catch (destroyErr) {
        console.warn('⚠️ client.destroy():', destroyErr.message);
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (fs.existsSync(sessionDir)) {
        await removeSessionDirWithRetries(sessionDir);
        console.log('✅ Папка сессии удалена вручную');
      }
    }

    reconnectAttempts = 0;
    disconnectCount = 0;
    lastMaxAttemptsReachedAt = 0;
    isReconnecting = false;

    console.log('🔄 Переинициализация после выхода из сессии…');
    await client.initialize();

    logoutHandled = false;
    return {
      success: true,
      message: 'Сессия WhatsApp завершена. Отсканируйте новый QR-код.'
    };
  } catch (error) {
    console.error('❌ Ошибка выхода из сессии:', error.message);
    logoutHandled = false;
    return {
      success: false,
      message: error.message || 'Не удалось выйти из сессии WhatsApp'
    };
  } finally {
    isManualLogoutInProgress = false;
  }
}

/** Актуальный статус для /status и Telegram — не только флаг botReady. */
async function getServiceStatus() {
  const snap = await getClientStateFast(2500);
  let liveState = snap.state;
  let liveReady = Boolean(snap.ready);

  if (liveState === 'CONNECTED') {
    if (!botReady) {
      console.log('📊 Статус: WhatsApp CONNECTED (синхронизация botReady)');
      botReady = true;
    }
    liveReady = true;
  } else if (liveState === 'OPENING' || liveState === 'PAIRING') {
    liveReady = false;
  } else if (!snap.cached) {
    liveReady = false;
  } else {
    liveReady = botReady;
  }

  return {
    botReady: liveReady,
    clientState: liveState,
    accountPhone: accountInfo?.phone || null,
    processedIds: processedMessageIds.size,
    uptime: process.uptime(),
    stateCached: Boolean(snap.cached),
  };
}

/** Один общий getState — админка/watchdog/входящие не плодят параллельные CDP. */
let getStateInFlight = null;

function requestClientState(softTimeoutMs = 8000) {
  if (isCdpCooldown() || isCdpBusy()) {
    return Promise.reject(
      Object.assign(new Error('CDP busy/cooldown (getState skipped)'), { code: 'WA_CDP_BUSY' })
    );
  }
  if (!getStateInFlight) {
    getStateInFlight = runExclusiveCdp('getState', () => client.getState(), softTimeoutMs).finally(
      () => {
        getStateInFlight = null;
      }
    );
  }
  return getStateInFlight;
}

/**
 * Быстрый снимок сессии для админки / входящих.
 * Никогда не ждёт CDP дольше timeoutMs — иначе UI «Проверка…» и очередь сообщений зависают.
 */
async function getClientStateFast(timeoutMs = 2500) {
  const cachedState = waWatchState || (botReady ? 'CONNECTED' : 'unknown');
  if (isChromiumSlow() || isManualLogoutInProgress || isReconnecting || isCdpBusy()) {
    return {
      state: cachedState,
      ready: botReady || cachedState === 'CONNECTED',
      cached: true,
    };
  }

  try {
    const state = await Promise.race([
      requestClientState(Math.max(timeoutMs, 5000)),
      new Promise((_, reject) => {
        setTimeout(() => {
          const err = new Error(`getState soft timeout after ${timeoutMs}ms`);
          err.code = 'WA_GETSTATE_SOFT_TIMEOUT';
          reject(err);
        }, timeoutMs);
      }),
    ]);
    if (state) waWatchState = state;
    if (state === 'CONNECTED' && !botReady) botReady = true;
    return {
      state: state || cachedState,
      ready: state === 'CONNECTED' || botReady,
      cached: false,
    };
  } catch (err) {
    if (err?.code === 'WA_CDP_BUSY' || err?.code === 'WA_CDP_COOLDOWN') {
      return {
        state: cachedState,
        ready: botReady || cachedState === 'CONNECTED',
        cached: true,
      };
    }
    if (err?.code === 'WA_GETSTATE_SOFT_TIMEOUT') {
      noteCdpHang(45000); // soft: только backoff
    } else if (isPuppeteerProtocolTimeout(err)) {
      noteCdpHang(45000, { hard: true });
    }
    return {
      state: cachedState,
      ready: botReady || cachedState === 'CONNECTED',
      cached: true,
      error: String(err?.message || err),
    };
  }
}

async function getAdminSessionSnapshot() {
  const snap = await getClientStateFast(2500);
  return {
    ready: Boolean(snap.ready),
    clientState: snap.state || 'unknown',
    stateCached: Boolean(snap.cached),
    hasQr: Boolean(currentQr),
    account: accountInfo,
  };
}

// Следим за сессией WhatsApp — если событие disconnected не пришло, алерт всё равно уйдёт
function startWhatsAppSessionWatchdog() {
  const intervalMs = parseInt(process.env.WA_SESSION_WATCH_MS, 10);
  // По умолчанию ВЫКЛ: getState только грузит CDP; disconnected/ready достаточно.
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    console.log('👁️ WhatsApp session watch: выкл (WA_SESSION_WATCH_MS=0, только события disconnected)');
    return;
  }
  const probeTimeoutMs = parseInt(process.env.WA_SESSION_PROBE_TIMEOUT_MS, 10) || 15000;
  let watchErrors = 0;
  const maxWatchErrors = parseInt(process.env.WA_SESSION_MAX_ERRORS, 10) || 3;
  let probeInFlight = null;
  let lastTransientLogAt = 0;

  trackedSetInterval(async () => {
    if (!botReady || isManualLogoutInProgress || isReconnecting || cdpRecoveryInFlight) return;
    // Не долбим getState, пока CDP уже медленный или недавно были сообщения.
    if (isChromiumSlow() || isCdpBusy()) {
      if (shouldRecoverFromCdpHang()) {
        recoverFromCdpHang('chromium slow too long').catch((reconnectError) =>
          console.error('❌ CDP recovery (slow):', reconnectError.message)
        );
      }
      return;
    }
    if (hasRecentWhatsAppActivity(300000)) {
      return;
    }
    if (probeInFlight) {
      return;
    }

    const stateProbe = requestClientState(probeTimeoutMs);
    probeInFlight = stateProbe;
    try {
      const state = await Promise.race([
        stateProbe,
        new Promise((_, reject) =>
          setTimeout(() => {
            const timeoutError = new Error(`watchdog probe timed out after ${probeTimeoutMs}ms`);
            timeoutError.code = 'WA_WATCH_PROBE_TIMEOUT';
            reject(timeoutError);
          }, probeTimeoutMs)
        ),
      ]);
      watchErrors = 0;
      clearCdpHang();

      if (state === 'CONNECTED' && !botReady) {
        botReady = true;
        console.log('👁️ WhatsApp session: CONNECTED, botReady синхронизирован');
      }

      if (waWatchState === null) {
        waWatchState = state;
        return;
      }
      if (state === waWatchState) return;

      const prev = waWatchState;
      waWatchState = state;
      console.log(`👁️ WhatsApp session: ${prev} → ${state}`);

      const wasOnline = botReady || prev === 'CONNECTED';
      const observed = classifyObservedState(state);
      if (observed === 'transient') {
        console.log(`👁️ Промежуточное состояние ${state}: ждём событие QR/disconnected`);
        return;
      }
      if (wasOnline && observed === 'disconnected') {
        await telegramNotify.notifyWhatsAppConnection('disconnected', { reason: state });
        botReady = false;
      }
    } catch (err) {
      const browserConnected =
        typeof client.pupBrowser?.isConnected === 'function'
          ? client.pupBrowser.isConnected()
          : true;
      const transientTimeout =
        err?.code === 'WA_WATCH_PROBE_TIMEOUT' || isPuppeteerProtocolTimeout(err);

      // Таймаут evaluate при живом Chromium — признак нагрузки/залипшего CDP,
      // но не доказательство отключения WhatsApp. Не отправляем ложный алерт.
      if (transientTimeout && browserConnected) {
        watchErrors = 0;
        if (hasRecentWhatsAppActivity(getCdpRecoveryIdleMs())) {
          markChromiumSlow(30000);
          const now = Date.now();
          if (now - lastTransientLogAt >= 10 * 60 * 1000) {
            console.log(
              `👁️ WhatsApp session watch: getState медленный, но сессия живая (activity ${Math.round((now - lastWhatsAppActivityAt) / 1000)}с назад)`
            );
            lastTransientLogAt = now;
          }
          return;
        }
        const hard = isPuppeteerProtocolTimeout(err);
        noteCdpHang(Math.max(probeTimeoutMs, 180000), { hard });
        const now = Date.now();
        if (now - lastTransientLogAt >= 5 * 60 * 1000) {
          console.warn(
            `👁️ WhatsApp session watch: медленный ответ Chromium (${err.message}), сессию не отключаем`
          );
          lastTransientLogAt = now;
        }
        // Soft probe timeout — не destroy. Hard protocolTimeout — только при накопленных hang.
        if (hard && shouldRecoverFromCdpHang()) {
          recoverFromCdpHang(err.message).catch((reconnectError) =>
            console.error('❌ CDP recovery (watchdog):', reconnectError.message)
          );
        }
        return;
      }

      watchErrors++;
      if (watchErrors >= maxWatchErrors && botReady) {
        console.warn(`👁️ WhatsApp session watch (${watchErrors}x):`, err.message);
        await telegramNotify.notifyWhatsAppConnection('disconnected', {
          reason: `watchdog: ${err.message}`,
          force: true
        });
        botReady = false;
        waWatchState = 'ERROR';
        watchErrors = 0;
        reconnectClient().catch((reconnectError) =>
          console.error('❌ Watchdog reconnect:', reconnectError.message)
        );
      } else if (watchErrors === 1) {
        console.warn('👁️ WhatsApp session watch (разовая ошибка, игнорируем):', err.message);
      }
    } finally {
      // После локального 30-секундного таймаута исходный CDP promise может ещё
      // выполняться. Снимаем блокировку только когда завершится именно он.
      stateProbe
        .finally(() => {
          if (probeInFlight === stateProbe) probeInFlight = null;
        })
        .catch(() => {});
    }
  }, intervalMs);
  console.log(
    `👁️ WhatsApp session watch каждые ${intervalMs / 1000} с, probe timeout ${probeTimeoutMs / 1000} с`
  );
}

// Функция обработки сообщения (вынесена для переиспользования)
async function handleIncomingMessage(msg, options = {}) {
  const { prependUserTexts = [], batchMessages = null } = options;
  const from = msg.from || '?';
  const body = msg.body ? (msg.body.length > 80 ? msg.body.substring(0, 80) + '...' : msg.body) : '(нет текста)';
  const fromMe = !!msg.fromMe;
  rememberInboundMessage(msg);
  console.log('📩 handleIncomingMessage вызван:', { from, fromMe, bodyPreview: body });
  
  // Логируем ВСЕ входящие сообщения для отладки
  console.log('📨 [DEBUG] Получено событие message:', {
    from: msg.from,
    fromMe: msg.fromMe,
    body: msg.body ? (msg.body.length > 50 ? msg.body.substring(0, 50) + '...' : msg.body) : '(нет текста)',
    type: msg.type,
    hasMedia: !!msg.hasMedia,
    timestamp: new Date().toISOString()
  });
  
  try {
    // Проверяем, готов ли бот к работе
    if (!botReady) {
      console.log('⚠️ [DEBUG] botReady = false, проверяем состояние клиента...');
      const snap = await getClientStateFast(2000);
      console.log(
        `📊 [DEBUG] Состояние клиента: ${snap.state}${snap.cached ? ' (кэш/soft)' : ''}`
      );
      if (snap.state === 'CONNECTED') {
        console.log('✅ Бот готов к работе! (определено при получении сообщения)');
        botReady = true;
      } else if (snap.cached && (accountInfo?.phone || waWatchState === 'CONNECTED')) {
        // CDP завис — не блокируем ответ клиенту, опираемся на ready/account
        botReady = true;
        console.warn('⚠️ botReady восстановлен из кэша при медленном Chromium');
      } else if (!snap.cached) {
        console.warn(`⚠️ Бот не готов к работе (состояние: ${snap.state}), отложим сообщение`);
        return 'retry';
      } else {
        console.warn('⚠️ Не удалось подтвердить CONNECTED, продолжаем обработку');
      }
    }
    
    // Пропускаем сообщения от самого бота
    if (msg.fromMe) {
      console.log('⏭️ [DEBUG] Пропущено сообщение от самого бота');
      return 'skip';
    }

    // Пропускаем статусы и broadcast сообщения
    if (msg.from === 'status@broadcast' || msg.from.includes('@broadcast')) {
      console.log('⏭️ [DEBUG] Пропущено broadcast сообщение');
      return 'skip';
    }

    // Получаем информацию о чате (для @lid getChatById часто падает — работаем с fallback)
    let chat;
    try {
      chat = await resolveIncomingChat(msg);
      console.log('💬 [DEBUG] Информация о чате:', {
        id: chat.id?._serialized || chat.id,
        isGroup: chat.isGroup,
        isChannel: chat.isChannel,
        name: chat.name || '(без имени)',
        fallback: Boolean(chat._fallback),
      });
    } catch (chatError) {
      console.error('❌ Ошибка получения информации о чате:', chatError);
      chat = buildFallbackChatFromMessage(msg);
    }

    const senderId = getMessageSenderId(msg, chat);

    // Группы: по умолчанию отвечаем; WHATSAPP_REPLY_IN_GROUPS=0 — только ЛС
    if (chat.isGroup) {
      if (!REPLY_IN_GROUPS) {
        console.log(`⚠️ Пропущено сообщение из группы: ${chat.name || chat.id.user}`);
        return 'skip';
      }
      if (GROUP_ONLY_MENTION && !(await shouldRespondInGroup(msg))) {
        console.log(`⏭️ Группа «${chat.name || chat.id.user}»: без @упоминания бота`);
        return 'skip';
      }
      console.log(`👥 Сообщение из группы «${chat.name || chat.id.user}»`);
    }

    // Пропускаем сообщения из каналов
    if (chat.isChannel) {
      console.log(`⚠️ Пропущено сообщение из канала: ${chat.name || chat.id.user}`);
      return 'skip';
    }

    const msgId = getMessageId(msg);
    const resolved = await resolveMessageText(msg);
    msg = resolved.msg;
    const messageText = resolved.text;

    const earlyLang = getLanguageFromPhone(senderId) || 'ru';

    if (isVoiceMessage(msg)) {
      const voiceReply = buildVoiceReply(earlyLang);
      try {
        recordClientMessage({
          chatId: getConversationChatId(msg, chat),
          senderId,
          chatName: chat.isGroup
            ? `${chat.name || 'группа'} (${formatCustomerPhone(senderId)})`
            : chat.name,
          messageText: '[голосовое сообщение]',
          language: earlyLang,
          languageLabel: getLanguageName(earlyLang),
          country: getCountryFromPhone(senderId) || '',
          isGroup: chat.isGroup,
          kind: 'voice',
        });
      } catch (clientStoreErr) {
        console.warn('⚠️ Не удалось сохранить клиента:', clientStoreErr.message);
      }
      persistChatMessage(getConversationChatId(msg, chat), 'user', '[голосовое сообщение]', {
        kind: 'voice',
        language: earlyLang,
      });
      telegramNotify
        .notifyIncomingWhatsAppMessage({
          msgId,
          chatId: getConversationChatId(msg, chat),
          preview: '[голосовое сообщение]',
          chatName: chat.isGroup
            ? `${chat.name || 'группа'} (${formatCustomerPhone(senderId)})`
            : chat.name,
          phone: formatCustomerPhone(senderId),
          language: getLanguageName(earlyLang),
          isGroup: chat.isGroup,
          kind: 'voice'
        })
        .catch((err) => console.error('telegram-notify message:', err.message));
      await sendMessageSafely(msg, voiceReply, client);
      console.log('🎤 Голосовое сообщение — отправлена подсказка текст/менеджер');
      return 'processed';
    }

    if (!messageText) {
      if (msg.type === 'reaction') {
        const reactionEmoji = extractReactionEmoji(msg);
        if (reactionEmoji) {
          clearEmptyBodyRetry(msgId);
          const chatId = getConversationChatId(msg, chat);
          if (!isAiDisabled(chatId)) {
            await sendMessageSafely(msg, reactionEmoji, client);
            addToHistory(chatId, 'user', reactionEmoji);
            addToHistory(chatId, 'assistant', reactionEmoji);
            console.log(`😊 Реакция-сообщение — дублируем смайлик: ${reactionEmoji}`);
          }
          return 'processed';
        }
      }
      if (isPermanentNonText(msg)) {
        clearEmptyBodyRetry(msgId);
        try {
          const lang = getLanguageFromPhone(senderId) || 'ru';
          const replyText = getTranslation(lang, 'ciphertext_reply');
          await sendMessageSafely(msg, replyText, client);
          console.log(`📩 [DEBUG] Сообщение без текста (медиа/одноразовое), type=${msg.type}`);
        } catch (replyErr) {
          console.warn('⚠️ Не удалось отправить подсказку:', replyErr.message);
        }
        return 'processed';
      }
      const attempts = trackEmptyBodyRetry(msgId);
      if (exceededEmptyBodyRetries(msgId)) {
        clearEmptyBodyRetry(msgId);
        console.warn(`⚠️ [DEBUG] Не удалось прочитать текст после ${attempts} попыток (type=${msg.type})`);
        return 'skip';
      }
      console.log(`⏳ [DEBUG] Текст пока недоступен (type=${msg.type}), попытка ${attempts}/${MAX_EMPTY_BODY_RETRIES}`);
      return 'retry';
    }
    clearEmptyBodyRetry(msgId);
    
    console.log('✅ [DEBUG] Сообщение прошло все проверки, начинаем обработку...');
    const chatId = getConversationChatId(msg, chat);
    ensureHistoryHydrated(chatId);
    
    // Проверяем, это первое сообщение от пользователя?
    const isFirstMessage = !firstMessageUsers.has(chatId);
    
    const phoneLanguage = getLanguageFromPhone(senderId) || 'ru';
    const batchLangText = [
      ...prependUserTexts,
      messageText,
    ]
      .map((t) => String(t || '').trim())
      .filter(Boolean)
      .join('\n');
    const dialogLanguage = resolveDialogLanguage(chatId, batchLangText, phoneLanguage);
    const userCountry = getCountryFromPhone(senderId);

    if (isFirstMessage) {
      firstMessageUsers.add(chatId);
    }
    const languageName = getLanguageName(dialogLanguage);
    const recordItems =
      batchMessages && batchMessages.length > 1
        ? batchMessages
        : [{ msg, text: messageText, msgId }];

    console.log(
      `📨 Получено сообщение от ${chatId} (${userCountry || 'неизвестно'}, язык: ${languageName} [${dialogLanguage}]): ${messageText}${prependUserTexts.length ? ` (+${prependUserTexts.length} в пачке)` : ''}`
    );

    for (const item of recordItems) {
      const preview = item.text;
      const itemMsgId = item.msgId || getMessageId(item.msg || msg);
      try {
        recordClientMessage({
          chatId,
          senderId,
          chatName: chat.isGroup
            ? `${chat.name || 'группа'} (${formatCustomerPhone(senderId)})`
            : chat.name,
          messageText: preview,
          language: dialogLanguage,
          languageLabel: languageName,
          country: userCountry || '',
          isGroup: chat.isGroup,
          kind: 'text',
        });
      } catch (clientStoreErr) {
        console.warn('⚠️ Не удалось сохранить клиента:', clientStoreErr.message);
      }

      telegramNotify
        .notifyIncomingWhatsAppMessage({
          msgId: itemMsgId,
          chatId,
          preview,
          chatName: chat.isGroup
            ? `${chat.name || 'группа'} (${formatCustomerPhone(senderId)})`
            : chat.name,
          phone: formatCustomerPhone(senderId),
          language: languageName,
          isGroup: chat.isGroup,
          kind: 'text',
        })
        .catch((err) => console.error('telegram-notify message:', err.message));
    }

    if (isAiDisabled(chatId)) {
      for (const t of prependUserTexts) {
        addToHistory(chatId, 'user', t, { language: dialogLanguage });
      }
      addToHistory(chatId, 'user', messageText, { language: dialogLanguage });
      console.log(`🔇 AI отключён для ${chatId} — сообщение сохранено, ответ не отправляется`);
      return 'processed';
    }

    // Проверяем, является ли сообщение командой
    const trimmedMessage = messageText.toLowerCase();

    const pendingHandoff = getPendingHandoff(chatId);
    if (pendingHandoff) {
      if (commandHandlers[trimmedMessage]) {
        clearPendingHandoff(chatId);
      } else {
        const clientName = extractClientName(messageText);
        if (!clientName) {
          await sendMessageSafely(
            msg,
            buildHandoffNameInvalid(pendingHandoff.language || dialogLanguage),
            client
          );
          return 'processed';
        }
        const handoffLang = pendingHandoff.language || dialogLanguage;
        addToHistory(chatId, 'user', messageText, { language: handoffLang });
        clearPendingHandoff(chatId);
        console.log(`👤 Имя получено (${clientName}), передача менеджеру: ${chatId}`);
        await connectWithManager(msg, client, handoffLang, sendMessageSafely, {
          reasonKey: pendingHandoff.reasonKey,
          preview: pendingHandoff.preview,
          translationKey: pendingHandoff.translationKey,
          conversationHistory: getHistory(chatId),
          clientName,
        });
        addToHistory(chatId, 'assistant', buildHandoffReply(handoffLang, 'manager_handoff', clientName));
        return 'processed';
      }
    }

    const pendingCallOffer = getPendingCallOffer(chatId);
    if (pendingCallOffer && !commandHandlers[trimmedMessage]) {
      const offerLang = pendingCallOffer.language || dialogLanguage;

      if (detectNegativeResponse(messageText)) {
        addToHistory(chatId, 'user', messageText, { language: offerLang });
        clearPendingCallOffer(chatId);
        console.log(`📞 Клиент отказался от созвона: ${chatId}`);
        try {
          const history = getHistory(chatId);
          const aiResponse = await withChatTyping(msg, () =>
            askAI(history, offerLang, { chatId })
          );
          const outgoing = localizeUrlsInText(aiResponse, offerLang);
          addToHistory(chatId, 'assistant', outgoing);
          await sendMessageSafely(msg, outgoing, client);
        } catch (e) {
          console.warn('⚠️ AI после отказа от созвона:', e.message);
        }
        return 'processed';
      }

      if (isBareCallAcceptance(messageText) || wantsManagerHandoff(messageText)) {
        addToHistory(chatId, 'user', messageText, { language: offerLang });
        clearPendingCallOffer(chatId);
        console.log(`📞 Клиент согласился на созвон: ${chatId}`);
        const result = await startHandoffFromCallAcceptance(
          msg,
          client,
          offerLang,
          sendMessageSafely,
          {
            reasonKey: pendingCallOffer.reasonKey || 'handoff',
            preview: pendingCallOffer.preview || messageText,
            conversationHistory: getHistory(chatId),
            clientName: '',
            useHistoryName: false,
          }
        );
        if (result.action === 'connected') {
          addToHistory(
            chatId,
            'assistant',
            buildHandoffReply(offerLang, 'manager_handoff', result.clientName)
          );
        } else {
          addToHistory(chatId, 'assistant', buildHandoffAskName(offerLang));
        }
        return 'processed';
      }

      clearPendingCallOffer(chatId);
      console.log(`📞 Неясный ответ на предложение созвона — продолжаем диалог: ${chatId}`);
    }

    if (isImageWithDescription(msg, messageText)) {
      console.log(`📷 Фото с описанием от ${chatId} — мягкое предложение созвона`);
      try {
        await offerSoftCallViaAi({
          msg,
          client,
          chatId,
          dialogLanguage,
          reasonKey: 'image',
          preview: messageText,
          messageText,
          userLine: `[фото] ${messageText}`,
          sendMessageSafely,
          withChatTyping,
          askAI,
          getHistory,
          addToHistory,
          localizeUrlsInText,
        });
      } catch (aiError) {
        console.error('❌ Ошибка AI при фото:', aiError);
        await sendMessageSafely(msg, getTranslation(dialogLanguage, 'error'), client);
      }
      return 'processed';
    }

    if (wantsManagerHandoff(messageText)) {
      const reasonKey = wantsEscalation(messageText) ? 'escalation' : 'handoff';
      console.log(
        reasonKey === 'escalation'
          ? `⚠️ Эскалация (жалоба/сложный запрос) от ${chatId} — предложение через AI`
          : `👤 Запрос менеджера/созвона от ${chatId} — предложение через AI`
      );
      try {
        await offerSoftCallViaAi({
          msg,
          client,
          chatId,
          dialogLanguage,
          reasonKey,
          preview: messageText,
          messageText,
          userLine: messageText,
          sendMessageSafely,
          withChatTyping,
          askAI,
          getHistory,
          addToHistory,
          localizeUrlsInText,
        });
      } catch (aiError) {
        console.error('❌ Ошибка AI при запросе менеджера:', aiError);
        await sendMessageSafely(msg, getTranslation(dialogLanguage, 'error'), client);
      }
      return 'processed';
    }

    if (containsLink(messageText) && !commandHandlers[trimmedMessage]) {
      console.log(`🔗 Внешняя ссылка от ${chatId} — мягкое предложение созвона`);
      try {
        await offerSoftCallViaAi({
          msg,
          client,
          chatId,
          dialogLanguage,
          reasonKey: 'link',
          preview: messageText,
          messageText,
          userLine: messageText,
          sendMessageSafely,
          withChatTyping,
          askAI,
          getHistory,
          addToHistory,
          localizeUrlsInText,
        });
      } catch (aiError) {
        console.error('❌ Ошибка AI при ссылке:', aiError);
        await sendMessageSafely(msg, getTranslation(dialogLanguage, 'error'), client);
      }
      return 'processed';
    }
    
    if (commandHandlers[trimmedMessage]) {
      console.log(`⚡ Выполнение команды: ${trimmedMessage} (язык: ${dialogLanguage})`);
      await commandHandlers[trimmedMessage](msg, dialogLanguage, client);
      console.log(`✅ Команда ${trimmedMessage} выполнена успешно`);
      return 'processed';
    } else {
      for (const t of prependUserTexts) {
        addToHistory(chatId, 'user', t, { language: dialogLanguage });
      }
      addToHistory(chatId, 'user', messageText, { language: dialogLanguage });
      
      // Получаем ответ от AI
      console.log(`🤖 Запрос к AI для ${chatId} (язык диалога: ${dialogLanguage})`);
      try {
        const history = getHistory(chatId).slice();
        const preDialog = analyzeConversation(history, dialogLanguage);
        const willShowListings =
          preDialog.stage === 'SHOW_LISTINGS' ||
          (preDialog.stage === 'REFINE' && Boolean(preDialog.readyForListings));

        if (willShowListings) {
          const bridge = getSearchingListingsMessage(dialogLanguage);
          console.log(`💬 Промежуточное сообщение перед подборкой: ${chatId}`);
          await sendMessageSafely(msg, bridge, client);
          addToHistory(chatId, 'assistant', bridge);
        }

        const aiResponse = await withChatTyping(msg, () =>
          askAI(history, dialogLanguage, { chatId })
        );
        const outgoing = localizeUrlsInText(aiResponse, dialogLanguage);

        // Отправляем ответ пользователю (история — только после успеха / постановки в очередь)
        console.log(`📤 Отправка ответа от AI на ${chatId}`);
        const sendResult = await sendMessageSafely(msg, outgoing, client);
        addToHistory(chatId, 'assistant', outgoing);
        if (sendResult?.queued) {
          console.log(`📬 Ответ AI для ${chatId} в очереди — доставим когда CDP оживёт`);
        } else {
          console.log(`✅ Ответ от AI отправлен успешно`);
        }

        const dialog = analyzeConversation(getHistory(chatId), dialogLanguage);
        if (shouldTrackCallOfferAfterReply(dialog, outgoing)) {
          setPendingCallOffer(chatId, {
            reasonKey: dialog.hasPropertyInterest ? 'handoff' : 'handoff',
            preview: messageText,
            language: dialogLanguage,
          });
          console.log(`📞 Ожидание ответа на предложение созвона: ${chatId}`);
        }
      } catch (aiError) {
        console.error('❌ Ошибка при запросе к AI:', aiError);
        // CDP hang при отправке уже ставит сообщение в очередь — не шлём ещё и «error» в тот же CDP.
        if (isSendCdpFailure(aiError) || isChromiumSlow()) {
          console.warn(`⏳ Пропуск error-reply для ${chatId}: CDP медленный`);
          return 'processed';
        }
        const errorText = getTranslation(dialogLanguage, 'error');
        try {
          await sendMessageSafely(msg, errorText, client);
        } catch (sendErr) {
          console.error('❌ Не удалось отправить error-reply:', sendErr.message);
        }
      }
    }
    return 'processed';
  } catch (error) {
    console.error('❌ Ошибка обработки сообщения:', error);
    console.error('Детали ошибки:', error.message);
    console.error('Стек ошибки:', error.stack);
    
    // Не пытаемся отправлять ответ об ошибке, чтобы избежать зацикливания
    return 'retry';
  }
}

console.log('📝 Регистрация обработчиков входящих сообщений...');
client.on('message', (msg) => dispatchIncomingMessage(msg, 'message'));
client.on('message_create', (msg) => dispatchIncomingMessage(msg, 'message_create'));
console.log('✅ События message + message_create (дедуп по ID, очередь по чату)');

/** Реакция WhatsApp (тап по смайлику на сообщении) — дублируем тот же эмодзи. */
client.on('message_reaction', (reaction) => {
  enqueueForChat(`reaction:${reaction?.senderId || 'unknown'}`, () =>
    handleMessageReaction(reaction)
  ).catch((err) => console.warn('⚠️ message_reaction queue:', err.message));
});

async function handleMessageReaction(reaction) {
  try {
    if (!botReady || !reaction) return;
    const emoji = String(reaction.reaction || '').trim();
    if (!emoji) return; // сняли реакцию

    const myId = client.info?.wid?._serialized || '';
    const senderId = String(reaction.senderId || '');
    if (myId && senderId && (senderId === myId || senderId.startsWith(myId.split('@')[0]))) {
      return;
    }

    const parent = reaction.msgId || {};
    const chatId =
      parent.remote ||
      parent._serialized?.split('_').find((p) => /@(c\.us|g\.us|lid)$/.test(p)) ||
      senderId;
    if (!chatId) return;
    if (isAiDisabled(chatId)) return;

    await client.sendMessage(chatId, emoji, { sendSeen: false });
    addToHistory(chatId, 'user', emoji);
    addToHistory(chatId, 'assistant', emoji);
    console.log(`😊 Реакция WhatsApp — дублируем: ${emoji} → ${chatId}`);
  } catch (err) {
    console.warn('⚠️ handleMessageReaction:', err.message || err);
  }
}

// Обработка ошибок
client.on('error', (error) => {
  console.error('❌ Ошибка клиента:', error);
});

// Диагностика: ключевые события (без message_ack — их слишком много на каждое сообщение)
const debugEvents = [
  'loading_screen',
  'qr',
  'authenticated',
  'auth_failure',
  'ready',
  'disconnected',
  'change_state',
  'message',
  'message_create',
  'message_revoke_everyone',
  'message_revoke_me',
];
if (process.env.WA_DEBUG_ACK === '1') {
  debugEvents.push('message_ack');
}
debugEvents.forEach((eventName) => {
  client.on(eventName, (...args) => {
    if (eventName === 'message' || eventName === 'message_create') return;
    if (eventName === 'message_ack') {
      touchWhatsAppActivity();
    }
    const preview =
      args.length > 0
        ? typeof args[0] === 'object'
          ? JSON.stringify(args[0]).substring(0, 100)
          : args[0]
        : '';
    console.log(`🔔 [EVENT DEBUG] Событие "${eventName}" вызвано`, preview);
  });
});
// Ack без спама в лог — только метка «сессия живая»
client.on('message_ack', () => {
  touchWhatsAppActivity();
});

// ========== API ENDPOINTS ==========

/**
 * GET /health — healthcheck Railway (синхронный, без Puppeteer)
 */
app.get('/health', (req, res) => {
  const memoryUsage = process.memoryUsage();
  const panel = getAdminPanelStatus();

  res.status(200).json({
    success: true,
    service: 'House Tenerife WhatsApp',
    adminUi: panel.adminUi,
    adminAssets: panel.adminAssets,
    ready: botReady,
    status: botReady ? 'ready' : 'initializing',
    port: BOT_PORT,
    uptime: Math.floor(process.uptime()),
    memory: {
      rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB',
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB'
    },
    messages: {
      processedIds: processedMessageIds.size,
      mode: 'events+polling',
      pollingActive: Boolean(global.pollingInterval)
    },
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/status - Проверка статуса бота
 */
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    ready: botReady,
    message: botReady 
      ? 'Бот готов к работе' 
      : 'Бот еще не готов. Дождитесь авторизации.'
  });
});

registerAdminRoutes(app, {
  get botReady() {
    return botReady;
  },
  get currentQr() {
    return currentQr;
  },
  get accountInfo() {
    return accountInfo;
  },
  get waWatchState() {
    return waWatchState;
  },
  client,
  getAdminSessionSnapshot,
  logoutWhatsAppSession,
  sendManagerMessage,
});

// Веб-панель /admin — после API, чтобы /api не перехватывался
setupAdminPanel(app);

app.use((err, req, res, next) => {
  console.error('HTTP error:', req.method, req.path, err.message);
  if (!res.headersSent) {
    res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
  }
});

// Keep-alive механизм для предотвращения idle timeout на Railway
// Railway может перезапускать контейнеры, если нет активности
let keepAliveInterval = null;
function startKeepAlive() {
  // Отправляем периодические запросы к healthcheck endpoint
  // Это помогает Railway видеть, что сервис активен
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  
  keepAliveInterval = trackedSetInterval(async () => {
    try {
      // Делаем внутренний запрос к healthcheck endpoint
      const response = await axios.get(`http://localhost:${BOT_PORT}/health`, {
        timeout: 2000,
        validateStatus: () => true // Принимаем любой статус
      });
      // Логируем только при ошибках или раз в 10 минут
      if (response.status !== 200 && Math.random() < 0.1) {
        console.log(`💓 Keep-alive: статус ${response.status}`);
      }
    } catch (error) {
      // Игнорируем ошибки keep-alive (сервер может быть еще не готов)
      if (Math.random() < 0.01) { // Логируем только 1% ошибок
        console.log('💓 Keep-alive: ошибка (можно игнорировать)');
      }
    }
  }, 60000); // Каждую минуту
  
  console.log('💓 Keep-alive механизм запущен (каждую минуту)');
}

// Запускаем HTTP сервер СНАЧАЛА (чтобы Railway не убил процесс)
const server = app.listen(BOT_PORT, '0.0.0.0', async () => {
  const panel = getAdminPanelStatus();
  console.log(`🌐 HTTP сервер: 0.0.0.0:${BOT_PORT}`);
  if (process.env.RAILWAY_ENVIRONMENT) {
    console.log('🚂 Railway: не задавайте PORT в Variables — только ADMIN_CODE и AI_API_KEY');
  }
  console.log(
    `📡 Панель: GET / ${panel.adminUi ? '(OK)' : '(не собрана)'} | API /api/admin/* | health /health`
  );
  console.log(`✅ HTTP сервер готов, Railway может проверить healthcheck`);

  const telegramReady = await telegramNotify.startTelegram(app, getServiceStatus);
  if (telegramReady.ok) {
    const delivered = await telegramNotify.sendAlert(
      '🚀 <b>House Tenerife</b>: Telegram-алерты активны.\nWhatsApp-сообщения и отключения сессии будут приходить сюда.'
    );
    if (!delivered) {
      console.error('❌ Тестовый Telegram-алерт не доставлен — см. инструкции выше (/start → /whoami)');
    }
    telegramNotify.notifyBotStarted({
      port: BOT_PORT,
      railway: Boolean(process.env.RAILWAY_ENVIRONMENT)
    });
  }

  startWhatsAppSessionWatchdog();
  
  // Запускаем keep-alive механизм
  startKeepAlive();
  
  // Инициализация клиента после запуска HTTP сервера
  // Для Railway используем небольшую задержку, для локального - сразу
  const initDelay = process.env.PORT ? 1000 : 0; // Если есть PORT (Railway), добавляем задержку
  
  trackedSetTimeout(() => {
    console.log('🔄 Инициализация WhatsApp бота...');
    console.log('⏳ Это может занять некоторое время...');
    console.log('💡 HTTP сервер уже работает, Railway не завершит процесс');
    
    client.initialize().catch(error => {
      console.error('❌ Ошибка инициализации клиента:', error);
      console.error('⚠️ HTTP сервер продолжает работать, но WhatsApp бот недоступен');
      console.error('💡 Проверьте логи выше для деталей ошибки');
      console.error('💡 Если это ошибка авторизации - отсканируйте QR-код через веб-интерфейс');
      // Не завершаем процесс, чтобы HTTP сервер продолжал работать
      // Railway сможет проверить healthcheck и увидит, что сервер работает
    });
  }, initDelay);
});

// Обработка ошибок сервера
server.on('error', (error) => {
  console.error('❌ Ошибка HTTP сервера:', error);
});

// Убеждаемся, что сервер слушает
server.on('listening', () => {
  const addr = server.address();
  console.log(`✅ Сервер успешно слушает на ${addr.address}:${addr.port}`);
});

// Функция graceful shutdown
let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    console.log('⚠️ Завершение уже выполняется, принудительный выход...');
    process.exit(1);
    return;
  }
  
  isShuttingDown = true;
  console.log(`\n👋 Получен сигнал ${signal}, начинаем graceful shutdown...`);
  
  try {
    // Останавливаем все интервалы
    console.log('🛑 Остановка всех интервалов...');
    activeIntervals.forEach(id => {
      clearInterval(id);
    });
    activeIntervals.clear();
    
    // Очищаем все таймеры
    console.log('🛑 Очистка всех таймеров...');
    activeTimeouts.forEach(id => {
      clearTimeout(id);
    });
    activeTimeouts.clear();
    
    if (global.messageMaintenanceInterval) {
      clearInterval(global.messageMaintenanceInterval);
      global.messageMaintenanceInterval = null;
    }

    if (global.pollingInterval) {
      clearInterval(global.pollingInterval);
      global.pollingInterval = null;
      console.log('✅ Polling остановлен');
    }
    
    // Очищаем logout timeout
    if (logoutTimeout) {
      clearTimeout(logoutTimeout);
      logoutTimeout = null;
      console.log('✅ Logout timeout очищен');
    }
    
    // Останавливаем keep-alive
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
      console.log('✅ Keep-alive остановлен');
    }
    
    // Закрываем HTTP сервер
    console.log('🛑 Закрытие HTTP сервера...');
    await new Promise((resolve) => {
      server.close(() => {
        console.log('✅ HTTP сервер закрыт');
        resolve();
      });
      
      // Таймаут на закрытие сервера (10 секунд)
      setTimeout(() => {
        console.log('⚠️ Таймаут закрытия сервера, продолжаем...');
        resolve();
      }, 10000);
    });
    
    // Закрываем WhatsApp клиент
    console.log('🛑 Закрытие WhatsApp клиента...');
    try {
      await Promise.race([
        client.destroy(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 15000)
        )
      ]);
      console.log('✅ WhatsApp клиент закрыт');
    } catch (destroyError) {
      console.warn('⚠️ Ошибка при закрытии клиента (можно игнорировать):', destroyError.message);
    }
    
    console.log('✅ Graceful shutdown завершен');
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка при graceful shutdown:', error);
    process.exit(1);
  }
}

// Обработка завершения процесса
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Обработка необработанных ошибок
process.on('uncaughtException', (error) => {
  console.error('❌ Необработанное исключение:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  if (isPuppeteerProtocolTimeout(reason)) {
    console.warn(
      `⏳ CDP protocol timeout (unhandledRejection): ${String(reason?.message || reason).slice(0, 160)} — процесс не роняем`
    );
    try {
      noteCdpHang(180000, { hard: true });
      armCdpCooldown(120000, 'unhandled-protocol');
      // inject после navigation часто приходит сюда, если патч не перехватил
      if (botReady || /inject|evaluate timed out/i.test(String(reason?.stack || reason?.message || ''))) {
        scheduleInjectRecovery(reason?.message || reason);
      }
    } catch (e) {
      console.warn('⚠️ handler unhandledRejection CDP:', e.message);
    }
    return;
  }
  console.error('❌ Необработанный rejection:', reason);
  // Не завершаем процесс при unhandledRejection, только логируем
});
