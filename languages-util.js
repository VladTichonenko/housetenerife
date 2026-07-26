'use strict';

function parseLanguages(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean))];
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parseLanguages(parsed);
    } catch {
      return [
        ...new Set(
          value
            .split(/[,;\s]+/)
            .map((v) => v.trim().toLowerCase())
            .filter(Boolean)
        ),
      ];
    }
  }
  return [];
}

module.exports = { parseLanguages };
