'use strict';

const crypto = require('crypto');

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function loadManagers() {
  const managers = [
    {
      id: 'manager-1',
      name: process.env.MANAGER_1_NAME || 'Менеджер 1',
      code: process.env.MANAGER_1_CODE || '1001',
    },
    {
      id: 'manager-2',
      name: process.env.MANAGER_2_NAME || 'Менеджер 2',
      code: process.env.MANAGER_2_CODE || '1002',
    },
    {
      id: 'manager-3',
      name: process.env.MANAGER_3_NAME || 'Менеджер 3',
      code: process.env.MANAGER_3_CODE || '1003',
    },
  ];

  const adminCode = process.env.ADMIN_CODE;
  if (adminCode && !managers.some((m) => m.code === adminCode)) {
    managers.push({
      id: 'admin',
      name: process.env.ADMIN_NAME || 'Администратор',
      code: adminCode,
    });
  }

  return managers;
}

const MANAGERS = loadManagers();
const sessions = new Map();

function findManagerByCode(code) {
  const trimmed = String(code || '').trim();
  if (!trimmed) return null;
  return MANAGERS.find((m) => m.code === trimmed) || null;
}

function createToken(manager) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    managerId: manager.id,
    managerName: manager.name,
    createdAt: Date.now(),
  });
  return token;
}

function getSession(token) {
  if (!token || !sessions.has(token)) return null;
  const session = sessions.get(token);
  if (Date.now() - session.createdAt > TOKEN_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function isValidToken(token) {
  return Boolean(getSession(token));
}

function listManagersPublic() {
  return MANAGERS.map(({ id, name }) => ({ id, name }));
}

module.exports = {
  MANAGERS,
  TOKEN_TTL_MS,
  findManagerByCode,
  createToken,
  getSession,
  isValidToken,
  listManagersPublic,
};
