'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function resolveDbPath() {
  if (process.env.SQLITE_PATH) return process.env.SQLITE_PATH;
  const sessionPath = process.env.SESSION_PATH;
  if (sessionPath && path.isAbsolute(sessionPath)) {
    return path.join(path.dirname(sessionPath), 'bot.db');
  }
  return path.join(__dirname, 'data', 'bot.db');
}

const DB_PATH = resolveDbPath();

let db = null;
let migratedFromJson = false;

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getDb() {
  if (db) return db;
  ensureDir(DB_PATH);
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      sender_id TEXT,
      phone TEXT,
      phone_display TEXT,
      wa_link TEXT,
      name TEXT,
      country TEXT,
      country_name TEXT,
      last_language TEXT,
      languages TEXT NOT NULL DEFAULT '[]',
      is_group INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      last_message TEXT,
      last_kind TEXT,
      first_seen_at TEXT,
      last_seen_at TEXT,
      wa_meta TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      kind TEXT DEFAULT 'text',
      language TEXT,
      manager_id TEXT,
      manager_name TEXT,
      wa_message_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
    CREATE INDEX IF NOT EXISTS idx_messages_user_created ON messages(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

function getMeta(key) {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setMeta(key, value) {
  getDb()
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, String(value));
}

function getDbStats() {
  const database = getDb();
  const users = database.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const messages = database.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
  const withPhone = database
    .prepare(`SELECT COUNT(*) AS c FROM users WHERE phone IS NOT NULL AND phone != ''`)
    .get().c;
  const countries = database
    .prepare(
      `SELECT COUNT(DISTINCT country) AS c FROM users WHERE country IS NOT NULL AND country != ''`
    )
    .get().c;
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recent = database
    .prepare(`SELECT COUNT(*) AS c FROM users WHERE last_seen_at IS NOT NULL AND last_seen_at >= ?`)
    .get(since7d).c;

  let dbSizeBytes = 0;
  try {
    if (fs.existsSync(DB_PATH)) dbSizeBytes = fs.statSync(DB_PATH).size;
  } catch {
    /* ignore */
  }

  return {
    path: DB_PATH,
    users,
    messages,
    withPhone,
    countries,
    activeLast7Days: recent,
    dbSizeBytes,
    migratedFromJson,
    updatedAt: new Date().toISOString(),
  };
}

function closeDb() {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
  }
}

function markMigratedFromJson(flag = true) {
  migratedFromJson = Boolean(flag);
}

module.exports = {
  DB_PATH,
  resolveDbPath,
  getDb,
  getMeta,
  setMeta,
  getDbStats,
  closeDb,
  markMigratedFromJson,
};
