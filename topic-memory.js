'use strict';

const fs = require('fs');
const path = require('path');
const { analyzeConversation, formatBudgetLabel } = require('./dialog-context');
const { detectPurposePreference } = require('./user-profile');

const MAX_TOPIC_MESSAGES = parseInt(process.env.TOPIC_MESSAGES_LIMIT, 10) || 40;
const TOPIC_SUMMARY_TRIGGER = parseInt(process.env.TOPIC_SUMMARY_TRIGGER, 10) || 12;
const TOPIC_RECENT_MESSAGES = parseInt(process.env.TOPIC_RECENT_MESSAGES, 10) || 8;

function resolveTopicMemoryPath() {
  if (process.env.TOPIC_MEMORY_PATH) return process.env.TOPIC_MEMORY_PATH;
  const sessionPath = process.env.SESSION_PATH;
  if (sessionPath && path.isAbsolute(sessionPath)) {
    return path.join(path.dirname(sessionPath), 'topic-memory.json');
  }
  return path.join(__dirname, 'data', 'topic-memory.json');
}

const TOPIC_MEMORY_PATH = resolveTopicMemoryPath();

function emptyStore() {
  return { version: 1, chats: {}, updatedAt: null };
}

function loadTopicMemoryStore() {
  try {
    if (!fs.existsSync(TOPIC_MEMORY_PATH)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(TOPIC_MEMORY_PATH, 'utf8'));
    return {
      version: 1,
      chats: raw.chats && typeof raw.chats === 'object' ? raw.chats : {},
      updatedAt: raw.updatedAt || null,
    };
  } catch (e) {
    console.warn('⚠️ topic-memory.json:', e.message);
    return emptyStore();
  }
}

function saveTopicMemoryStore(store) {
  const dir = path.dirname(TOPIC_MEMORY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const next = {
    version: 1,
    chats: store.chats || {},
    updatedAt: new Date().toISOString(),
  };
  const tempPath = `${TOPIC_MEMORY_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tempPath, TOPIC_MEMORY_PATH);
  return next;
}

function normalizeRuntimeMessage(message = {}) {
  const text = String(message.text || '').trim();
  if (!text) return null;
  return {
    sender: message.sender === 'user' ? 'user' : 'assistant',
    text,
    timestamp: Number(message.timestamp) || Date.now(),
  };
}

function mergeMessages(existing, incoming, limit = MAX_TOPIC_MESSAGES) {
  const merged = [];
  const seen = new Set();
  for (const raw of [...(existing || []), ...(incoming || [])]) {
    const message = normalizeRuntimeMessage(raw);
    if (!message) continue;
    const key = `${message.sender}|${message.timestamp}|${message.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(message);
  }
  merged.sort((a, b) => a.timestamp - b.timestamp);
  return merged.slice(-Math.max(1, limit));
}

function getCurrentUserTurn(history) {
  const messages = Array.isArray(history) ? history : [];
  const out = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.sender !== 'user') break;
    out.unshift(messages[i]);
  }
  if (out.length) return out;
  const lastUser = [...messages].reverse().find((message) => message?.sender === 'user');
  return lastUser ? [lastUser] : [];
}

function createTopic(gate, messages, now = new Date().toISOString()) {
  const id = `topic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const topic = {
    id,
    scenario: gate.scenario,
    topicKey: gate.topicKey,
    status: 'active',
    criteria: {
      regions: gate.regions || [],
      propertyTypes: gate.propertyTypes || [],
      microAreas: gate.microAreas || [],
      language: gate.language || 'ru',
    },
    summary: '',
    messages: mergeMessages([], messages),
    createdAt: now,
    lastActivityAt: now,
  };
  return refreshTopicSummary(topic, now);
}

function buildStructuredTopicSummary(messages, language = 'ru', now = new Date().toISOString()) {
  const history = mergeMessages([], messages);
  const userTexts = history
    .filter((message) => message.sender === 'user')
    .map((message) => message.text);
  if (!userTexts.length) return null;

  const dialog = analyzeConversation(history, language);
  let purpose = null;
  for (let i = userTexts.length - 1; i >= 0; i -= 1) {
    purpose = detectPurposePreference(userTexts[i]);
    if (purpose) break;
  }

  const budget =
    dialog.hasBudget && !dialog.ignoreBudget
      ? {
          minPrice: dialog.budget?.minPrice ?? null,
          maxPrice: dialog.budget?.maxPrice ?? null,
          label: dialog.budgetLabel || formatBudgetLabel(dialog.budget, language),
        }
      : dialog.ignoreBudget
        ? { minPrice: null, maxPrice: null, label: 'no_limit' }
        : null;

  return {
    version: 1,
    source: 'deterministic_entities',
    sourceMessageCount: history.length,
    scenario: null,
    stage: dialog.stage,
    purpose,
    propertyTypes: dialog.propertyTypes || [],
    regions: dialog.macroRegions || [],
    microAreas: dialog.microAreaGroupIds || [],
    microAreaLabel: dialog.microAreaLabel || '',
    budget,
    finance: {
      hasPropertyInterest: Boolean(dialog.hasPropertyInterest),
      hasFundsNow: Boolean(dialog.hasFundsNow),
      fundsNow: typeof dialog.fundsNow === 'number' ? dialog.fundsNow : null,
      mortgageAnswered: Boolean(dialog.hasMortgageAnswered),
      needsMortgage:
        typeof dialog.needsMortgage === 'boolean' ? dialog.needsMortgage : null,
      documentsDiscussed: Boolean(dialog.documentsDiscussed),
    },
    updatedAt: now,
  };
}

function refreshTopicSummary(topic, now = new Date().toISOString()) {
  if (!topic || (topic.messages || []).length <= TOPIC_SUMMARY_TRIGGER) return topic;
  const language = topic.criteria?.language || 'ru';
  const summary = buildStructuredTopicSummary(topic.messages, language, now);
  if (summary) {
    summary.scenario = topic.scenario;
    topic.summary = summary;
  }
  return topic;
}

function getTopicContextHistory(topic) {
  const messages = mergeMessages([], topic?.messages || []);
  if (!topic?.summary) return messages;
  return messages.slice(-Math.max(2, TOPIC_RECENT_MESSAGES));
}

function formatTopicSummaryForPrompt(summary) {
  if (!summary) return '';
  const facts = [
    `scenario=${summary.scenario || 'unknown'}`,
    `stage=${summary.stage || 'unknown'}`,
  ];
  if (summary.purpose) facts.push(`purpose=${summary.purpose}`);
  if (summary.propertyTypes?.length) {
    facts.push(`propertyTypes=${summary.propertyTypes.join(',')}`);
  }
  if (summary.regions?.length) facts.push(`regions=${summary.regions.join(',')}`);
  if (summary.microAreaLabel) facts.push(`area=${summary.microAreaLabel}`);
  if (summary.budget?.label) facts.push(`budget=${summary.budget.label}`);
  if (summary.finance?.fundsNow != null) {
    facts.push(`fundsNow=${summary.finance.fundsNow}`);
  }
  if (summary.finance?.mortgageAnswered) {
    facts.push(`needsMortgage=${summary.finance.needsMortgage}`);
  }

  return `**ACTIVE TOPIC SUMMARY (deterministic, older messages):**
${facts.map((fact) => `- ${fact}`).join('\n')}
This summary contains code-extracted facts, not a free-form AI retelling. Recent messages override it when they explicitly change a value. Never invent missing values or URLs.`;
}

function buildTopicSummarySeedMessage(summary) {
  if (!summary) return null;
  const parts = [];
  if (summary.purpose === 'investment') parts.push('purpose: investment');
  else if (summary.purpose === 'living') parts.push('purpose: live in');
  else if (summary.purpose === 'mixed') parts.push('purpose: live in and investment');

  const typeTokens = (summary.propertyTypes || []).map((type) => {
    if (type === 'houses') return 'townhouse';
    if (type === 'commercial') return 'commercial property';
    if (type === 'business') return 'business for sale';
    if (type === 'investment') return 'investment project';
    return type;
  });
  if (typeTokens.length) parts.push(`property type: ${typeTokens.join(', ')}`);
  if (summary.regions?.length) parts.push(`region: ${summary.regions.join(', ')}`);
  if (summary.microAreaLabel) parts.push(`area: ${summary.microAreaLabel}`);

  const minPrice = summary.budget?.minPrice;
  const maxPrice = summary.budget?.maxPrice;
  if (summary.budget?.label === 'no_limit') parts.push('any budget');
  else if (minPrice != null && maxPrice != null) {
    parts.push(`budget from ${minPrice} to ${maxPrice} EUR`);
  } else if (maxPrice != null) parts.push(`budget up to ${maxPrice} EUR`);
  else if (minPrice != null) parts.push(`budget from ${minPrice} EUR`);

  if (!parts.length) return null;
  return {
    sender: 'user',
    text: `[STRUCTURED TOPIC MEMORY] ${parts.join('; ')}`,
    timestamp: 0,
    kind: 'topic_summary',
  };
}

function getTopicAnalysisHistory(topic, contextHistory = getTopicContextHistory(topic)) {
  const seed = buildTopicSummarySeedMessage(topic?.summary);
  return seed ? [seed, ...contextHistory] : contextHistory;
}

function updateTopicFromGate(topic, gate, incomingMessages, now) {
  topic.messages = mergeMessages(topic.messages, incomingMessages);
  topic.scenario = gate.scenario || topic.scenario;
  topic.topicKey = gate.topicKey || topic.topicKey;
  topic.criteria = {
    regions: gate.regions?.length ? gate.regions : topic.criteria?.regions || [],
    propertyTypes: gate.propertyTypes?.length
      ? gate.propertyTypes
      : topic.criteria?.propertyTypes || [],
    microAreas: gate.microAreas?.length ? gate.microAreas : topic.criteria?.microAreas || [],
    language: gate.language || topic.criteria?.language || 'ru',
  };
  topic.status = 'active';
  topic.lastActivityAt = now;
  return refreshTopicSummary(topic, now);
}

function findLatestPausedDealTopic(chat, gate) {
  const candidates = Object.values(chat.topics || {})
    .filter(
      (topic) =>
        topic.status === 'paused' &&
        ['property_search', 'mortgage_docs', 'manager_handoff'].includes(topic.scenario)
    )
    .filter((topic) => {
      const regions = gate.regions || [];
      const types = gate.propertyTypes || [];
      const topicRegions = topic.criteria?.regions || [];
      const topicTypes = topic.criteria?.propertyTypes || [];
      const regionFits =
        !regions.length || !topicRegions.length || regions.some((region) => topicRegions.includes(region));
      const typeFits =
        !types.length || !topicTypes.length || types.some((type) => topicTypes.includes(type));
      return regionFits && typeFits;
    })
    .sort(
      (a, b) =>
        new Date(b.lastActivityAt || b.createdAt || 0) -
        new Date(a.lastActivityAt || a.createdAt || 0)
    );
  return candidates[0] || null;
}

/**
 * Создаёт/переключает активную ветку и возвращает историю только этой темы.
 * Ипотека и handoff считаются продолжением сделки и наследуют текущий контекст.
 */
function prepareTopicContext(store, chatId, fullHistory, gate) {
  const id = String(chatId);
  const now = new Date().toISOString();
  const chat = store.chats[id] || {
    activeTopicId: null,
    topics: {},
    createdAt: now,
    updatedAt: now,
  };
  const active = chat.activeTopicId ? chat.topics[chat.activeTopicId] : null;
  const currentTurn = getCurrentUserTurn(fullHistory);
  const shouldSplitProperty = gate.action === 'new_topic';
  const shouldSplitSupport =
    gate.action === 'scenario_change' && gate.scenario === 'support_other';
  const returningFromSupport =
    active?.scenario === 'support_other' &&
    gate.action === 'scenario_change' &&
    ['property_search', 'mortgage_docs', 'manager_handoff'].includes(gate.scenario);
  const resumedTopic = returningFromSupport ? findLatestPausedDealTopic(chat, gate) : null;
  const shouldCreate = !active || ((!resumedTopic && shouldSplitProperty) || shouldSplitSupport);

  let topic = active;
  if (resumedTopic) {
    active.status = 'paused';
    active.lastActivityAt = now;
    topic = updateTopicFromGate(resumedTopic, gate, currentTurn, now);
    chat.activeTopicId = topic.id;
  } else if (shouldCreate) {
    if (active) {
      active.status = 'paused';
      active.lastActivityAt = now;
    }
    const seedMessages = active ? currentTurn : fullHistory;
    topic = createTopic(gate, seedMessages, now);
    chat.topics[topic.id] = topic;
    chat.activeTopicId = topic.id;
  } else {
    topic = updateTopicFromGate(topic, gate, currentTurn, now);
  }

  chat.updatedAt = now;
  store.chats[id] = chat;
  const contextHistory = getTopicContextHistory(topic);
  return {
    store,
    topic,
    history: contextHistory,
    analysisHistory: getTopicAnalysisHistory(topic, contextHistory),
    summary: topic.summary || null,
    switched: Boolean(active && (shouldCreate || resumedTopic)),
    created: shouldCreate,
    resumed: Boolean(resumedTopic),
  };
}

function prepareAndSaveTopicContext(chatId, fullHistory, gate) {
  if (!chatId || String(chatId).endsWith('@g.us')) {
    return {
      history: fullHistory || [],
      analysisHistory: fullHistory || [],
      topic: null,
      switched: false,
      created: false,
      resumed: false,
    };
  }
  const store = loadTopicMemoryStore();
  const result = prepareTopicContext(store, chatId, fullHistory, gate);
  saveTopicMemoryStore(result.store);
  return result;
}

function recordTopicAssistantReply(chatId, text) {
  if (!chatId || !text || String(chatId).endsWith('@g.us')) return null;
  const store = loadTopicMemoryStore();
  const chat = store.chats[String(chatId)];
  const topic = chat?.activeTopicId ? chat.topics?.[chat.activeTopicId] : null;
  if (!topic) return null;

  topic.messages = mergeMessages(topic.messages, [
    { sender: 'assistant', text, timestamp: Date.now() },
  ]);
  topic.lastActivityAt = new Date().toISOString();
  refreshTopicSummary(topic, topic.lastActivityAt);
  chat.updatedAt = topic.lastActivityAt;
  saveTopicMemoryStore(store);
  return topic;
}

module.exports = {
  MAX_TOPIC_MESSAGES,
  TOPIC_SUMMARY_TRIGGER,
  TOPIC_RECENT_MESSAGES,
  TOPIC_MEMORY_PATH,
  resolveTopicMemoryPath,
  loadTopicMemoryStore,
  mergeMessages,
  getCurrentUserTurn,
  buildStructuredTopicSummary,
  refreshTopicSummary,
  getTopicContextHistory,
  buildTopicSummarySeedMessage,
  getTopicAnalysisHistory,
  formatTopicSummaryForPrompt,
  prepareTopicContext,
  prepareAndSaveTopicContext,
  recordTopicAssistantReply,
};
