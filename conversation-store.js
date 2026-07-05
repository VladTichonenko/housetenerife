'use strict';

const fs = require('fs');
const path = require('path');

const MAX_MESSAGES_PER_CHAT = parseInt(process.env.CONVERSATION_MESSAGES_LIMIT, 10) || 500;

function resolveConversationPath() {
  if (process.env.CONVERSATIONS_PATH) return process.env.CONVERSATIONS_PATH;
  const sessionPath = process.env.SESSION_PATH;
  if (sessionPath && path.isAbsolute(sessionPath)) {
    return path.join(path.dirname(sessionPath), 'conversations.json');
  }
  return path.join(__dirname, 'data', 'conversations.json');
}

const CONVERSATIONS_PATH = resolveConversationPath();

function ensureDataDir() {
  const dir = path.dirname(CONVERSATIONS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(CONVERSATIONS_PATH)) {
    return { chats: {}, updatedAt: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONVERSATIONS_PATH, 'utf8'));
    return {
      chats: raw.chats && typeof raw.chats === 'object' ? raw.chats : {},
      updatedAt: raw.updatedAt || null,
    };
  } catch (e) {
    console.warn('⚠️ conversations.json:', e.message);
    return { chats: {}, updatedAt: null };
  }
}

function saveStore(store) {
  ensureDataDir();
  const next = {
    chats: store.chats,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CONVERSATIONS_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/**
 * @param {string} chatId
 * @param {{ role: 'user'|'assistant'|'manager', text: string, managerId?: string, managerName?: string, kind?: string }} payload
 */
function recordMessage(chatId, payload = {}) {
  if (!chatId) return null;

  const id = String(chatId);
  const store = loadStore();
  const chat = store.chats[id] || { messages: [], lastActivityAt: null };
  const now = new Date().toISOString();
  const message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: payload.role || 'user',
    text: String(payload.text || '').slice(0, 4000),
    kind: payload.kind || 'text',
    managerId: payload.managerId || '',
    managerName: payload.managerName || '',
    at: now,
  };

  chat.messages = [...(chat.messages || []), message].slice(-MAX_MESSAGES_PER_CHAT);
  chat.lastActivityAt = now;
  store.chats[id] = chat;
  saveStore(store);
  return message;
}

function getMessages(chatId, { excludeAssistant = false } = {}) {
  const store = loadStore();
  const chat = store.chats[String(chatId)];
  if (!chat) return [];
  let messages = chat.messages || [];
  if (excludeAssistant) {
    messages = messages.filter((m) => m.role !== 'assistant');
  }
  return messages;
}

function getLastActivityAt(chatId) {
  const store = loadStore();
  const chat = store.chats[String(chatId)];
  return chat?.lastActivityAt || null;
}

function listConversationChats({ page = 1, limit = 24, q = '' } = {}) {
  const store = loadStore();
  const query = String(q || '').trim().toLowerCase();

  let items = Object.entries(store.chats).map(([chatId, chat]) => {
    const messages = chat.messages || [];
    const userMessages = messages.filter((m) => m.role === 'user');
    const lastUser = userMessages[userMessages.length - 1];
    const lastVisible = [...messages].reverse().find((m) => m.role !== 'assistant');

    return {
      id: chatId,
      chatId,
      lastActivityAt: chat.lastActivityAt || null,
      messageCount: messages.length,
      userMessageCount: userMessages.length,
      lastMessage: lastVisible?.text || lastUser?.text || '',
      lastMessageAt: lastVisible?.at || lastUser?.at || chat.lastActivityAt,
    };
  });

  if (query) {
    items = items.filter((item) =>
      [item.chatId, item.lastMessage].filter(Boolean).join(' ').toLowerCase().includes(query)
    );
  }

  items.sort((a, b) => new Date(b.lastActivityAt || 0) - new Date(a.lastActivityAt || 0));

  const p = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 24));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / lim));
  const start = (p - 1) * lim;

  return {
    items: items.slice(start, start + lim),
    total,
    page: p,
    totalPages,
    limit: lim,
    updatedAt: store.updatedAt,
  };
}

module.exports = {
  CONVERSATIONS_PATH,
  recordMessage,
  getMessages,
  getLastActivityAt,
  listConversationChats,
};
