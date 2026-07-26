'use strict';

const path = require('path');
const { getLanguageName } = require('./language-detector');
const { formatCustomerPhone } = require('./manager-handoff');
const { getCountryName } = require('./country-names');
const { getDb } = require('./db');
const { parseLanguages } = require('./languages-util');

const MAX_LAST_MESSAGES = parseInt(process.env.CLIENT_LAST_MESSAGES_LIMIT, 10) || 12;

function resolveClientsPath() {
  if (process.env.CLIENTS_PATH) return process.env.CLIENTS_PATH;
  const sessionPath = process.env.SESSION_PATH;
  if (sessionPath && path.isAbsolute(sessionPath)) {
    return path.join(path.dirname(sessionPath), 'whatsapp-clients.json');
  }
  return path.join(__dirname, 'data', 'whatsapp-clients.json');
}

const CLIENTS_PATH = resolveClientsPath();

function buildWaLink(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d ? `https://wa.me/${d}` : null;
}

function mapUserRow(row) {
  if (!row) return null;
  const languages = parseLanguages(row.languages);
  const lastLanguage = row.last_language || languages[languages.length - 1] || '';
  let waMeta = {};
  try {
    waMeta = row.wa_meta ? JSON.parse(row.wa_meta) : {};
  } catch {
    waMeta = {};
  }

  return {
    id: row.id,
    chatId: row.id,
    senderId: row.sender_id || row.id,
    phone: row.phone || '',
    phoneDisplay: row.phone_display || (row.phone ? `+${String(row.phone).replace(/\D/g, '')}` : '—'),
    waLink: row.wa_link || buildWaLink(row.phone),
    chatName: row.name || '',
    name: row.name || '',
    language: lastLanguage,
    languageLabel: getLanguageName(lastLanguage),
    languages,
    languagesLabel: languages.map((l) => getLanguageName(l)).join(', '),
    country: row.country || '',
    countryName: row.country_name || getCountryName(row.country || ''),
    isGroup: Boolean(row.is_group),
    firstSeenAt: row.first_seen_at || null,
    lastSeenAt: row.last_seen_at || null,
    messageCount: row.message_count || 0,
    lastMessage: row.last_message || '',
    lastKind: row.last_kind || 'text',
    lastMessages: Array.isArray(waMeta.lastMessages) ? waMeta.lastMessages : [],
    waMeta,
  };
}

function ensureUserStub(userId, now) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO users (id, first_seen_at, last_seen_at, languages, wa_meta)
       VALUES (?, ?, ?, '[]', '{}')`
    )
    .run(String(userId), now, now);
}

function recordClientMessage(payload = {}) {
  const {
    chatId,
    senderId,
    chatName = '',
    messageText = '',
    language = 'ru',
    languageLabel = '',
    country = '',
    isGroup = false,
    kind = 'text',
  } = payload;

  if (!chatId) return null;

  const database = getDb();
  const id = String(chatId);
  const now = new Date().toISOString();
  const phone = formatCustomerPhone(senderId || chatId);
  const existing = database.prepare('SELECT * FROM users WHERE id = ?').get(id);

  const languages = parseLanguages(existing?.languages);
  const lang = String(language || '').trim().toLowerCase();
  if (lang && !languages.includes(lang)) languages.push(lang);

  let waMeta = {};
  try {
    waMeta = existing?.wa_meta ? JSON.parse(existing.wa_meta) : {};
  } catch {
    waMeta = {};
  }
  const lastMessages = Array.isArray(waMeta.lastMessages) ? waMeta.lastMessages : [];
  waMeta.lastMessages = [
    ...lastMessages,
    {
      at: now,
      direction: 'in',
      kind,
      text: String(messageText || '').slice(0, 500),
    },
  ].slice(-MAX_LAST_MESSAGES);

  const countryCode = country || existing?.country || '';
  const row = {
    id,
    sender_id: senderId || chatId,
    phone,
    phone_display: phone ? `+${String(phone).replace(/\D/g, '')}` : '—',
    wa_link: buildWaLink(phone),
    name: chatName || existing?.name || '',
    country: countryCode,
    country_name: getCountryName(countryCode) || existing?.country_name || '',
    last_language: lang || existing?.last_language || '',
    languages: JSON.stringify(languages),
    is_group: isGroup ? 1 : 0,
    message_count: (existing?.message_count || 0) + 1,
    last_message: String(messageText || '').slice(0, 500),
    last_kind: kind,
    first_seen_at: existing?.first_seen_at || now,
    last_seen_at: now,
    wa_meta: JSON.stringify(waMeta),
  };

  database
    .prepare(
      `INSERT INTO users (
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
        last_language = excluded.last_language,
        languages = excluded.languages,
        is_group = excluded.is_group,
        message_count = excluded.message_count,
        last_message = excluded.last_message,
        last_kind = excluded.last_kind,
        last_seen_at = excluded.last_seen_at,
        wa_meta = excluded.wa_meta`
    )
    .run(row);

  // languageLabel kept for API compatibility (computed in mapUserRow)
  void languageLabel;

  return mapUserRow(database.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

function listClients({ page = 1, limit = 50, q = '' } = {}) {
  const database = getDb();
  const query = String(q || '').trim().toLowerCase();
  let rows;

  if (query) {
    const like = `%${query}%`;
    rows = database
      .prepare(
        `SELECT * FROM users
         WHERE lower(COALESCE(name, '')) LIKE ?
            OR lower(COALESCE(phone, '')) LIKE ?
            OR lower(COALESCE(phone_display, '')) LIKE ?
            OR lower(COALESCE(last_message, '')) LIKE ?
            OR lower(COALESCE(country, '')) LIKE ?
            OR lower(COALESCE(country_name, '')) LIKE ?
            OR lower(COALESCE(last_language, '')) LIKE ?
            OR lower(COALESCE(languages, '')) LIKE ?
         ORDER BY COALESCE(last_seen_at, '') DESC`
      )
      .all(like, like, like, like, like, like, like, like);
  } else {
    rows = database
      .prepare(
        `SELECT * FROM users
         ORDER BY COALESCE(last_seen_at, '') DESC`
      )
      .all();
  }

  const items = rows.map(mapUserRow);
  const p = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
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

function getClient(id) {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(String(id));
  return mapUserRow(row);
}

module.exports = {
  CLIENTS_PATH,
  recordClientMessage,
  listClients,
  getClient,
  resolveClientsPath,
  ensureUserStub,
  mapUserRow,
};
