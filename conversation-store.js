'use strict';

const path = require('path');
const { getDb } = require('./db');
const { ensureUserStub } = require('./clients-store');

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

/**
 * @param {string} chatId
 * @param {{ role: 'user'|'assistant'|'manager', text: string, managerId?: string, managerName?: string, kind?: string, language?: string, waMessageId?: string }} payload
 */
function recordMessage(chatId, payload = {}) {
  if (!chatId) return null;

  const database = getDb();
  const id = String(chatId);
  const now = new Date().toISOString();
  ensureUserStub(id, now);

  const message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: payload.role || 'user',
    text: String(payload.text || '').slice(0, 4000),
    kind: payload.kind || 'text',
    language: payload.language || null,
    managerId: payload.managerId || '',
    managerName: payload.managerName || '',
    at: now,
  };

  database
    .prepare(
      `INSERT INTO messages (
        id, user_id, role, body, kind, language, manager_id, manager_name, wa_message_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      message.id,
      id,
      message.role,
      message.text,
      message.kind,
      message.language,
      message.managerId,
      message.managerName,
      payload.waMessageId || null,
      message.at
    );

  database
    .prepare(
      `UPDATE users SET last_seen_at = ?, last_message = CASE WHEN ? = 'user' THEN ? ELSE last_message END
       WHERE id = ?`
    )
    .run(now, message.role, message.text.slice(0, 500), id);

  // trim old messages per chat
  database
    .prepare(
      `DELETE FROM messages
       WHERE user_id = ?
         AND id NOT IN (
           SELECT id FROM messages
           WHERE user_id = ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT ?
         )`
    )
    .run(id, id, MAX_MESSAGES_PER_CHAT);

  return message;
}

function getMessages(chatId, { excludeAssistant = false } = {}) {
  const id = String(chatId);
  let rows;
  if (excludeAssistant) {
    rows = getDb()
      .prepare(
        `SELECT * FROM messages
         WHERE user_id = ? AND role != 'assistant'
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(id);
  } else {
    rows = getDb()
      .prepare(
        `SELECT * FROM messages
         WHERE user_id = ?
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(id);
  }

  return rows.map((m) => ({
    id: m.id,
    role: m.role,
    text: m.body,
    kind: m.kind || 'text',
    language: m.language || null,
    managerId: m.manager_id || '',
    managerName: m.manager_name || '',
    at: m.created_at,
  }));
}

function getLastActivityAt(chatId) {
  const row = getDb()
    .prepare(
      `SELECT MAX(created_at) AS last_activity_at FROM messages WHERE user_id = ?`
    )
    .get(String(chatId));
  return row?.last_activity_at || null;
}

function listConversationChats({ page = 1, limit = 24, q = '' } = {}) {
  const database = getDb();
  const query = String(q || '').trim().toLowerCase();

  let rows = database
    .prepare(
      `SELECT
         m.user_id AS chatId,
         MAX(m.created_at) AS lastActivityAt,
         COUNT(*) AS messageCount,
         SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END) AS userMessageCount
       FROM messages m
       GROUP BY m.user_id
       ORDER BY MAX(m.created_at) DESC`
    )
    .all();

  const getLastVisible = database.prepare(
    `SELECT body, created_at, role FROM messages
     WHERE user_id = ? AND role != 'assistant'
     ORDER BY created_at DESC, rowid DESC
     LIMIT 1`
  );
  const getLastUser = database.prepare(
    `SELECT body, created_at FROM messages
     WHERE user_id = ? AND role = 'user'
     ORDER BY created_at DESC, rowid DESC
     LIMIT 1`
  );

  let items = rows.map((row) => {
    const lastVisible = getLastVisible.get(row.chatId);
    const lastUser = getLastUser.get(row.chatId);
    return {
      id: row.chatId,
      chatId: row.chatId,
      lastActivityAt: row.lastActivityAt || null,
      messageCount: row.messageCount || 0,
      userMessageCount: row.userMessageCount || 0,
      lastMessage: lastVisible?.body || lastUser?.body || '',
      lastMessageAt: lastVisible?.created_at || lastUser?.created_at || row.lastActivityAt,
    };
  });

  if (query) {
    items = items.filter((item) =>
      [item.chatId, item.lastMessage].filter(Boolean).join(' ').toLowerCase().includes(query)
    );
  }

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
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  CONVERSATIONS_PATH,
  recordMessage,
  getMessages,
  getLastActivityAt,
  listConversationChats,
  resolveConversationPath,
};
