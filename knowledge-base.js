const fs = require('fs');
const path = require('path');

const KNOWLEDGE_PATH =
  process.env.KNOWLEDGE_PATH || path.join(__dirname, 'consultant-knowledge.json');

function loadFromDisk() {
  const raw = fs.readFileSync(KNOWLEDGE_PATH, 'utf8');
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('База знаний должна быть JSON-объектом');
  }
  if (!Array.isArray(data.custom_articles)) {
    data.custom_articles = [];
  }
  return data;
}

function getKnowledgeBase() {
  try {
    return loadFromDisk();
  } catch (e) {
    console.warn('⚠️ База знаний:', e.message);
    return { custom_articles: [] };
  }
}

function saveKnowledgeBase(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Некорректный формат базы знаний');
  }
  const next = { ...data };
  if (!Array.isArray(next.custom_articles)) {
    next.custom_articles = [];
  }
  next._admin_meta = {
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(KNOWLEDGE_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function getKnowledgeBaseForPrompt() {
  const kb = getKnowledgeBase();
  const { _admin_meta, ...rest } = kb;
  return rest;
}

module.exports = {
  getKnowledgeBase,
  saveKnowledgeBase,
  getKnowledgeBaseForPrompt,
  KNOWLEDGE_PATH
};
