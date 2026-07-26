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

function isRuntimeKnowledgeDocument(doc) {
  const label = `${doc?.source_file || ''} ${doc?.title || ''}`;
  return !/(?:system\s*prompt|промпт|prompt|ветк|branch|менеджерск.*стил)/i.test(label);
}

function selectRelevantDocuments(data, query = '', options = {}) {
  const docs = Array.isArray(data?.documents) ? data.documents : [];
  const scenario = options.scenario || 'general';
  const maxDocs = Math.max(1, parseInt(options.maxDocs, 10) || 3);
  const qTokens = [...new Set(tokenize(query))];
  if (!qTokens.length || ['support_other', 'manager_handoff'].includes(scenario)) return [];
  const projectIntent =
    /инвест|проект|доходност|roi|отел|апартотел|бизнес|коммер|аукцион|invest|project|yield|hotel|business|commercial|auction|proyecto|inversi[oó]n|rendimiento/i.test(
      query
    );
  const genericTitleTokens = new Set([
    'tenerife',
    'property',
    'apartments',
    'apartment',
    'villa',
    'villas',
    'house',
    'houses',
    'недвижимость',
    'апартамент',
    'квартира',
    'вилла',
    'дом',
    'ищу',
    'хочу',
  ]);

  return docs
    .filter(isRuntimeKnowledgeDocument)
    .map((doc) => {
      const title = `${doc.title || ''} ${doc.source_file || ''}`.toLowerCase();
      const body = String(doc.text || '').toLowerCase();
      const rareTitleMatch = qTokens.some(
        (token) => !genericTitleTokens.has(token) && title.includes(token)
      );
      let score = 0;
      for (const token of qTokens) {
        if (title.includes(token)) score += 5;
        else if (body.includes(token)) score += 1;
      }
      if (
        scenario === 'property_search' &&
        /invest|инвест|project|проект|hotel|отел|business|бизнес/i.test(`${query} ${title}`)
      ) {
        score += 3;
      }
      if (!projectIntent && !rareTitleMatch) score = 0;
      return { doc, score };
    })
    .filter((entry) => entry.score >= 2)
    .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title))
    .slice(0, maxDocs)
    .map((entry) => entry.doc);
}

/**
 * Релевантные документы file_doc для промпта (по запросу клиента).
 * @param {string} query
 * @param {number} [maxChars]
 */
function getFileDocKnowledgeForPrompt(query = '', maxChars = 12000, options = {}) {
  const data = loadFileDocKnowledge();
  const docs = selectRelevantDocuments(data, query, options);
  if (!docs.length) return '';

  const parts = [];
  if (data.usage_note) {
    parts.push(data.usage_note);
  }

  let used = parts.join('\n').length;
  const picked = [];
  for (const doc of docs) {
    if (used >= maxChars) break;
    const block = `### ${doc.title}\n(файл: ${doc.source_file})\n${doc.text}`;
    const remaining = maxChars - used;
    if (remaining <= 300) break;
    const boundedBlock =
      block.length > remaining ? `${block.slice(0, remaining - 20)}\n…(truncated)` : block;
    picked.push(boundedBlock);
    used += boundedBlock.length;
  }

  if (!picked.length) return '';

  return `**МАТЕРИАЛЫ ИЗ file_doc (инвестпроекты, услуги, предложения House Tenerife):**\n${parts.join('\n')}\n\n${picked.join('\n\n')}`;
}

module.exports = {
  loadFileDocKnowledge,
  isRuntimeKnowledgeDocument,
  selectRelevantDocuments,
  getFileDocKnowledgeForPrompt,
  FILE_DOC_PATH,
};
