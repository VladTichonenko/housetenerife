'use strict';

const fs = require('fs');
const path = require('path');

const FILE_DOC_PATH =
  process.env.FILE_DOC_KNOWLEDGE_PATH ||
  path.join(__dirname, 'data', 'file-doc-knowledge.json');

let cache = null;
let cacheMtime = 0;

function loadFileDocKnowledge() {
  try {
    const stat = fs.statSync(FILE_DOC_PATH);
    if (cache && stat.mtimeMs === cacheMtime) return cache;
    const raw = fs.readFileSync(FILE_DOC_PATH, 'utf8');
    cache = JSON.parse(raw);
    cacheMtime = stat.mtimeMs;
    return cache;
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn('⚠️ file-doc-knowledge:', e.message);
    }
    return { documents: [], usage_note: '' };
  }
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Релевантные документы file_doc для промпта (по запросу клиента).
 * @param {string} query
 * @param {number} [maxChars]
 */
function getFileDocKnowledgeForPrompt(query = '', maxChars = 22000) {
  const data = loadFileDocKnowledge();
  const docs = Array.isArray(data.documents) ? data.documents : [];
  if (!docs.length) return '';

  const qTokens = new Set(tokenize(query));
  const scored = docs.map((doc) => {
    const hay = `${doc.title || ''} ${doc.text || ''}`.toLowerCase();
    let score = 0;
    for (const t of qTokens) {
      if (hay.includes(t)) score += 1;
    }
    if (/system prompt|ветк|branch/i.test(doc.source_file || doc.title || '')) {
      score += 5;
    }
    return { doc, score };
  });

  scored.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title));

  const parts = [];
  if (data.usage_note) {
    parts.push(data.usage_note);
  }

  let used = parts.join('\n').length;
  const picked = [];
  for (const { doc, score } of scored) {
    if (used >= maxChars) break;
    if (score === 0 && picked.length >= 4) continue;
    const block = `### ${doc.title}\n(файл: ${doc.source_file})\n${doc.text}`;
    if (used + block.length > maxChars && picked.length >= 2) continue;
    picked.push(block);
    used += block.length;
  }

  if (!picked.length && docs[0]) {
    picked.push(`### ${docs[0].title}\n${docs[0].text}`);
  }

  return `**МАТЕРИАЛЫ ИЗ file_doc (инвестпроекты, услуги, предложения House Tenerife):**\n${parts.join('\n')}\n\n${picked.join('\n\n')}`;
}

module.exports = {
  loadFileDocKnowledge,
  getFileDocKnowledgeForPrompt,
  FILE_DOC_PATH,
};
