'use strict';

const fs = require('fs');
const path = require('path');

function resolvePath() {
  if (process.env.MISSED_CATCHUP_PATH) return process.env.MISSED_CATCHUP_PATH;
  const sessionPath = process.env.SESSION_PATH;
  if (sessionPath && path.isAbsolute(sessionPath)) {
    return path.join(path.dirname(sessionPath), 'missed-catchup.json');
  }
  return path.join(__dirname, 'data', 'missed-catchup.json');
}

const STORE_PATH = resolvePath();

function ensureDataDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(STORE_PATH)) {
    return { chats: {}, lastSyncAt: null, lastSyncStats: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return {
      chats: raw.chats && typeof raw.chats === 'object' ? raw.chats : {},
      lastSyncAt: raw.lastSyncAt || null,
      lastSyncStats: raw.lastSyncStats || null,
    };
  } catch (e) {
    console.warn('⚠️ missed-catchup.json:', e.message);
    return { chats: {}, lastSyncAt: null, lastSyncStats: null };
  }
}

function saveStore(store) {
  ensureDataDir();
  const next = {
    chats: store.chats,
    lastSyncAt: store.lastSyncAt || null,
    lastSyncStats: store.lastSyncStats || null,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STORE_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function markNeedsCatchUp(chatId, meta = {}) {
  if (!chatId) return null;
  const store = loadStore();
  const id = String(chatId);
  const existing = store.chats[id] || {};
  store.chats[id] = {
    ...existing,
    needsCatchUp: true,
    lastUserMessage: String(meta.lastUserMessage || existing.lastUserMessage || '').slice(0, 500),
    lastUserAt: meta.lastUserAt || existing.lastUserAt || new Date().toISOString(),
    importedCount: Number(existing.importedCount || 0) + Number(meta.importedDelta || 0),
    chatName: meta.chatName || existing.chatName || '',
    updatedAt: new Date().toISOString(),
  };
  saveStore(store);
  return store.chats[id];
}

function clearNeedsCatchUp(chatId) {
  if (!chatId) return null;
  const store = loadStore();
  const id = String(chatId);
  if (!store.chats[id]) return null;
  store.chats[id] = {
    ...store.chats[id],
    needsCatchUp: false,
    caughtUpAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveStore(store);
  return store.chats[id];
}

function setLastSync(stats = {}) {
  const store = loadStore();
  store.lastSyncAt = new Date().toISOString();
  store.lastSyncStats = {
    scanned: Number(stats.scanned || 0),
    imported: Number(stats.imported || 0),
    chatsTouched: Number(stats.chatsTouched || 0),
    maxAgeHours: stats.maxAgeHours || null,
    error: stats.error || null,
  };
  saveStore(store);
  return store.lastSyncStats;
}

function listMarkedCatchUp() {
  const store = loadStore();
  return Object.entries(store.chats)
    .filter(([, v]) => v && v.needsCatchUp)
    .map(([chatId, v]) => ({
      chatId,
      needsCatchUp: true,
      lastMessage: v.lastUserMessage || '',
      lastMessageAt: v.lastUserAt || v.updatedAt || null,
      chatName: v.chatName || '',
      importedCount: v.importedCount || 0,
    }))
    .sort((a, b) => String(b.lastMessageAt || '').localeCompare(String(a.lastMessageAt || '')));
}

function getSyncMeta() {
  const store = loadStore();
  return {
    lastSyncAt: store.lastSyncAt,
    lastSyncStats: store.lastSyncStats,
    pendingCount: listMarkedCatchUp().length,
  };
}

module.exports = {
  STORE_PATH,
  markNeedsCatchUp,
  clearNeedsCatchUp,
  setLastSync,
  listMarkedCatchUp,
  getSyncMeta,
};
