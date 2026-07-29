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

module.exports = {
  classifyObservedState,
  isDefinitiveLogoutReason,
};
