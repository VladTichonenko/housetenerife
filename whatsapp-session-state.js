'use strict';

const TRANSIENT_STATES = new Set([
  'OPENING',
  'PAIRING',
  'UNLAUNCHED',
  'UNPAIRED',
  'TIMEOUT',
]);

function classifyObservedState(state) {
  const normalized = String(state || '').toUpperCase();
  if (normalized === 'CONNECTED') return 'connected';
  if (normalized === 'DISCONNECTED') return 'disconnected';
  if (TRANSIENT_STATES.has(normalized)) return 'transient';
  return 'unknown';
}

function isDefinitiveLogoutReason(reason) {
  return String(reason || '').toUpperCase() === 'LOGOUT';
}

function deriveAdminSessionStatus({ state, cached = true, ready = false } = {}) {
  const connected = String(state || '').toUpperCase() === 'CONNECTED';
  if (!cached && connected && ready) return 'connected';
  if (cached && connected) return 'checking';
  return 'disconnected';
}

module.exports = {
  classifyObservedState,
  isDefinitiveLogoutReason,
  deriveAdminSessionStatus,
};
