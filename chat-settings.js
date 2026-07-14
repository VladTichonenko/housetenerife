'use strict';

const fs = require('fs');
const path = require('path');

function resolveSettingsPath() {
  if (process.env.CHAT_SETTINGS_PATH) return process.env.CHAT_SETTINGS_PATH;
  const sessionPath = process.env.SESSION_PATH;
  if (sessionPath && path.isAbsolute(sessionPath)) {
    return path.join(path.dirname(sessionPath), 'chat-settings.json');
  }
  return path.join(__dirname, 'data', 'chat-settings.json');
}

const SETTINGS_PATH = resolveSettingsPath();

function ensureDataDir() {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_PATH)) {
    return { chats: {}, updatedAt: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return {
      chats: raw.chats && typeof raw.chats === 'object' ? raw.chats : {},
      updatedAt: raw.updatedAt || null,
    };
  } catch (e) {
    console.warn('⚠️ chat-settings.json:', e.message);
    return { chats: {}, updatedAt: null };
  }
}

function saveStore(store) {
  ensureDataDir();
  const next = {
    chats: store.chats,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function getChatSettings(chatId) {
  const store = loadStore();
  const id = String(chatId);
  const existing = store.chats[id] || {};
  return {
    chatId: id,
    aiDisabled: Boolean(existing.aiDisabled),
    managerTakeover: Boolean(existing.managerTakeover),
    dialogLanguage: existing.dialogLanguage || null,
    updatedAt: existing.updatedAt || null,
  };
}

function setAiDisabled(chatId, disabled) {
  const store = loadStore();
  const id = String(chatId);
  const existing = store.chats[id] || {};
  store.chats[id] = {
    ...existing,
    aiDisabled: Boolean(disabled),
    managerTakeover: Boolean(disabled) || Boolean(existing.managerTakeover),
    updatedAt: new Date().toISOString(),
  };
  saveStore(store);
  return getChatSettings(id);
}

function getStickyDialogLanguage(chatId) {
  const lang = getChatSettings(chatId).dialogLanguage;
  return lang ? String(lang).toLowerCase().slice(0, 2) : null;
}

function setStickyDialogLanguage(chatId, language) {
  const lang = String(language || '').toLowerCase().slice(0, 2);
  if (!lang) return getChatSettings(chatId);
  const store = loadStore();
  const id = String(chatId);
  const existing = store.chats[id] || {};
  store.chats[id] = {
    ...existing,
    dialogLanguage: lang,
    updatedAt: new Date().toISOString(),
  };
  saveStore(store);
  return getChatSettings(id);
}

function isAiDisabled(chatId) {
  return getChatSettings(chatId).aiDisabled;
}

module.exports = {
  SETTINGS_PATH,
  getChatSettings,
  setAiDisabled,
  isAiDisabled,
  getStickyDialogLanguage,
  setStickyDialogLanguage,
};
