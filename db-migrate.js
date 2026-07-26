'use strict';

const fs = require('fs');
const path = require('path');
const { getDb, getMeta, setMeta, markMigratedFromJson } = require('./db');
const { getCountryName } = require('./country-names');
const { parseLanguages } = require('./languages-util');

function resolveClientsPath() {
  const path = require('path');
  if (process.env.CLIENTS_PATH) return process.env.CLIENTS_PATH;
  const sessionPath = process.env.SESSION_PATH;
  if (sessionPath && path.isAbsolute(sessionPath)) {
    return path.join(path.dirname(sessionPath), 'whatsapp-clients.json');
  }
  return path.join(__dirname, 'data', 'whatsapp-clients.json');
}

function resolveConversationPath() {
  const path = require('path');
  if (process.env.CONVERSATIONS_PATH) return process.env.CONVERSATIONS_PATH;
  const sessionPath = process.env.SESSION_PATH;
  if (sessionPath && path.isAbsolute(sessionPath)) {
    return path.join(path.dirname(sessionPath), 'conversations.json');
  }
  return path.join(__dirname, 'data', 'conversations.json');
}

function migrateFromJsonIfNeeded() {
  if (getMeta('json_migrated_at')) {
    return { skipped: true, reason: 'already_migrated' };
  }

  const database = getDb();
  const userCount = database.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const messageCount = database.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
  if (userCount > 0 || messageCount > 0) {
    setMeta('json_migrated_at', new Date().toISOString());
    return { skipped: true, reason: 'db_not_empty' };
  }

  let clients = {};
  let chats = {};

  const clientsPath = resolveClientsPath();
  const conversationsPath = resolveConversationPath();

  if (fs.existsSync(clientsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
      clients = raw.clients && typeof raw.clients === 'object' ? raw.clients : {};
    } catch (e) {
      console.warn('⚠️ migrate clients JSON:', e.message);
    }
  }

  if (fs.existsSync(conversationsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(conversationsPath, 'utf8'));
      chats = raw.chats && typeof raw.chats === 'object' ? raw.chats : {};
    } catch (e) {
      console.warn('⚠️ migrate conversations JSON:', e.message);
    }
  }

  const clientIds = Object.keys(clients);
  const chatIds = Object.keys(chats);
  if (!clientIds.length && !chatIds.length) {
    setMeta('json_migrated_at', new Date().toISOString());
    return { skipped: true, reason: 'no_json_data' };
  }

  const upsertUser = database.prepare(`
    INSERT INTO users (
      id, sender_id, phone, phone_display, wa_link, name, country, country_name,
      last_language, languages, is_group, message_count, last_message, last_kind,
      first_seen_at, last_seen_at, wa_meta
    ) VALUES (
      @id, @sender_id, @phone, @phone_display, @wa_link, @name, @country, @country_name,
      @last_language, @languages, @is_group, @message_count, @last_message, @last_kind,
      @first_seen_at, @last_seen_at, @wa_meta
    )
    ON CONFLICT(id) DO UPDATE SET
      sender_id = excluded.sender_id,
      phone = excluded.phone,
      phone_display = excluded.phone_display,
      wa_link = excluded.wa_link,
      name = COALESCE(NULLIF(excluded.name, ''), users.name),
      country = COALESCE(NULLIF(excluded.country, ''), users.country),
      country_name = COALESCE(NULLIF(excluded.country_name, ''), users.country_name),
      last_language = COALESCE(excluded.last_language, users.last_language),
      languages = excluded.languages,
      is_group = excluded.is_group,
      message_count = excluded.message_count,
      last_message = excluded.last_message,
      last_kind = excluded.last_kind,
      first_seen_at = COALESCE(users.first_seen_at, excluded.first_seen_at),
      last_seen_at = excluded.last_seen_at,
      wa_meta = excluded.wa_meta
  `);

  const ensureUser = database.prepare(`
    INSERT OR IGNORE INTO users (id, first_seen_at, last_seen_at, languages, wa_meta)
    VALUES (?, ?, ?, '[]', '{}')
  `);

  const insertMessage = database.prepare(`
    INSERT OR IGNORE INTO messages (
      id, user_id, role, body, kind, language, manager_id, manager_name, wa_message_id, created_at
    ) VALUES (
      @id, @user_id, @role, @body, @kind, @language, @manager_id, @manager_name, @wa_message_id, @created_at
    )
  `);

  const migrate = database.transaction(() => {
    let usersInserted = 0;
    let messagesInserted = 0;

    for (const [id, client] of Object.entries(clients)) {
      const lang = client.language || '';
      const languages = parseLanguages(client.languages);
      if (lang && !languages.includes(lang)) languages.push(lang);

      upsertUser.run({
        id: String(id),
        sender_id: client.senderId || id,
        phone: client.phone || '',
        phone_display: client.phoneDisplay || '',
        wa_link: client.waLink || '',
        name: client.chatName || '',
        country: client.country || '',
        country_name: client.countryName || getCountryName(client.country || ''),
        last_language: lang || languages[languages.length - 1] || '',
        languages: JSON.stringify(languages),
        is_group: client.isGroup ? 1 : 0,
        message_count: client.messageCount || 0,
        last_message: client.lastMessage || '',
        last_kind: client.lastKind || 'text',
        first_seen_at: client.firstSeenAt || null,
        last_seen_at: client.lastSeenAt || null,
        wa_meta: JSON.stringify({
          migratedFrom: 'whatsapp-clients.json',
          lastMessages: Array.isArray(client.lastMessages) ? client.lastMessages.slice(-12) : [],
        }),
      });
      usersInserted += 1;
    }

    for (const [chatId, chat] of Object.entries(chats)) {
      const id = String(chatId);
      ensureUser.run(id, chat.lastActivityAt || null, chat.lastActivityAt || null);
      const messages = Array.isArray(chat.messages) ? chat.messages : [];
      for (const m of messages) {
        const msgId = m.id || `${id}-${m.at || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        insertMessage.run({
          id: String(msgId),
          user_id: id,
          role: m.role || 'user',
          body: String(m.text || '').slice(0, 4000),
          kind: m.kind || 'text',
          language: m.language || null,
          manager_id: m.managerId || '',
          manager_name: m.managerName || '',
          wa_message_id: m.waMessageId || null,
          created_at: m.at || new Date().toISOString(),
        });
        messagesInserted += 1;
      }
    }

    setMeta('json_migrated_at', new Date().toISOString());
    setMeta('json_clients_path', clientsPath);
    setMeta('json_conversations_path', conversationsPath);
    return { usersInserted, messagesInserted };
  });

  const result = migrate();
  markMigratedFromJson(true);
  console.log(
    `🗄️ SQLite: импорт из JSON — пользователей ${result.usersInserted}, сообщений ${result.messagesInserted}`
  );
  console.log(
    `   clients: ${path.basename(clientsPath)}, conversations: ${path.basename(conversationsPath)}`
  );
  return { skipped: false, ...result };
}

module.exports = {
  migrateFromJsonIfNeeded,
};
