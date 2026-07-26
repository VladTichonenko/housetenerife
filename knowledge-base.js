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

const EXCLUDED_RETRIEVAL_KEYS = new Set([
  '_admin_meta',
  'brand',
  'disclaimer',
  'custom_articles',
  'concierge_playbook',
  'featured_properties',
  'mortgage_process_en',
  'mortgage_process_es',
]);

const STOP_WORDS = new Set([
  'для',
  'как',
  'что',
  'это',
  'или',
  'мне',
  'нужен',
  'нужна',
  'хочу',
  'the',
  'and',
  'for',
  'with',
  'what',
  'how',
  'property',
  'please',
  'que',
  'para',
  'con',
  'una',
  'der',
  'die',
  'das',
  'und',
  'pour',
  'avec',
]);

function tokenizeKnowledge(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function scoreKnowledgeValue(key, value, queryTokens) {
  const normalizedKey = String(key).replace(/_/g, ' ').toLowerCase();
  const haystack = `${normalizedKey} ${JSON.stringify(value)}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  let score = 0;
  for (const token of queryTokens) {
    if (normalizedKey.includes(token)) score += 5;
    else if (haystack.includes(token)) score += 1;
  }
  return score;
}

function getScenarioPriorities(scenario, query) {
  const priorities = new Map();
  const add = (key, score) => priorities.set(key, (priorities.get(key) || 0) + score);

  if (scenario === 'mortgage_docs') {
    add('mortgage_process', 30);
    add('purchase_documents', 24);
    add('topics', 8);
    add('official_sources', 5);
  } else if (scenario === 'support_other') {
    add('contacts', 18);
    add('company_services', 12);
  } else if (scenario === 'manager_handoff') {
    add('contacts', 20);
    add('company_services', 10);
  } else if (scenario === 'property_search') {
    add('portfolio_quick_reference', 6);
    add('spain_property_pros_cons', 3);
  }

  const text = String(query || '').toLowerCase();
  if (/ипотек|кредит|mortgage|hipoteca|hypothek|hypotheek/i.test(text)) {
    add('mortgage_process', 35);
    add('purchase_documents', 25);
  }
  if (/документ|паспорт|\bnie\b|document|papeles|unterlagen/i.test(text)) {
    add('purchase_documents', 28);
    add('topics', 12);
    add('official_sources', 6);
  }
  if (/налог|виз|внж|golden|tax|impuest|steuer|fiscal/i.test(text)) {
    add('topics', 25);
    add('official_sources', 20);
    add('glossary', 8);
  }
  if (/аукцион|кредитн.*инвест|auction|subasta|versteiger/i.test(text)) {
    add('credit_and_auction_investing', 35);
  }
  if (/\bnda\b|конфиденциаль|confidential/i.test(text)) {
    add('nda_working_terms_summary', 35);
  }
  if (/услуг|пакет|сопровожд|service|package|servicio|dienstleistung/i.test(text)) {
    add('company_services', 30);
  }
  if (/контакт|телефон|адрес|email|contact|phone|whatsapp/i.test(text)) {
    add('contacts', 35);
  }
  return priorities;
}

function localizeMortgageSection(kb, language) {
  const lang = String(language || '').toLowerCase().slice(0, 2);
  if (lang === 'en' && kb.mortgage_process_en) return kb.mortgage_process_en;
  if (lang === 'es' && kb.mortgage_process_es) return kb.mortgage_process_es;
  return kb.mortgage_process;
}

function selectRelevantKnowledge(kb, options = {}) {
  if (!kb || typeof kb !== 'object') return {};
  const query = String(options.query || '');
  const scenario = options.scenario || 'general';
  const maxSections = Math.max(1, parseInt(options.maxSections, 10) || 4);
  const queryTokens = tokenizeKnowledge(query);
  const priorities = getScenarioPriorities(scenario, query);

  const ranked = Object.entries(kb)
    .filter(([key]) => !EXCLUDED_RETRIEVAL_KEYS.has(key))
    .map(([key, value]) => ({
      key,
      value,
      score: scoreKnowledgeValue(key, value, queryTokens) + (priorities.get(key) || 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, maxSections);

  const selected = {
    brand: kb.brand,
    disclaimer: kb.disclaimer,
  };
  for (const entry of ranked) {
    selected[entry.key] =
      entry.key === 'mortgage_process'
        ? localizeMortgageSection(kb, options.language)
        : entry.value;
  }

  const articleMatches = (kb.custom_articles || [])
    .map((article) => ({
      article,
      score: scoreKnowledgeValue(
        `${article.title || ''} ${article.category || ''}`,
        article.content || '',
        queryTokens
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((entry) => entry.article);
  if (articleMatches.length) selected.custom_articles = articleMatches;

  return selected;
}

function getKnowledgeBaseForPrompt(options = null) {
  const kb = getKnowledgeBase();
  if (options && typeof options === 'object') {
    return selectRelevantKnowledge(kb, options);
  }
  const { _admin_meta, ...rest } = kb;
  return rest;
}

module.exports = {
  getKnowledgeBase,
  saveKnowledgeBase,
  getKnowledgeBaseForPrompt,
  tokenizeKnowledge,
  selectRelevantKnowledge,
  KNOWLEDGE_PATH
};
