'use strict';

const fs = require('fs');
const path = require('path');
const { detectPropertyTypePreference } = require('./property-types');
const { detectRegionPreference } = require('./catalog-regions');
const { detectMicroAreas } = require('./location-matching');
const { extractBudgetRange, wantsIgnoreBudget } = require('./dialog-context');

function resolveProfilesPath() {
  if (process.env.USER_PROFILES_PATH) return process.env.USER_PROFILES_PATH;
  const sessionPath = process.env.SESSION_PATH;
  if (sessionPath && path.isAbsolute(sessionPath)) {
    return path.join(path.dirname(sessionPath), 'user-profiles.json');
  }
  return path.join(__dirname, 'data', 'user-profiles.json');
}

const USER_PROFILES_PATH = resolveProfilesPath();

function emptyStore() {
  return { version: 1, profiles: {}, updatedAt: null };
}

function loadProfilesStore() {
  try {
    if (!fs.existsSync(USER_PROFILES_PATH)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(USER_PROFILES_PATH, 'utf8'));
    return {
      version: 1,
      profiles: raw.profiles && typeof raw.profiles === 'object' ? raw.profiles : {},
      updatedAt: raw.updatedAt || null,
    };
  } catch (e) {
    console.warn('⚠️ user-profiles.json:', e.message);
    return emptyStore();
  }
}

function saveProfilesStore(store) {
  const dir = path.dirname(USER_PROFILES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const next = {
    version: 1,
    profiles: store.profiles || {},
    updatedAt: new Date().toISOString(),
  };
  const tempPath = `${USER_PROFILES_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tempPath, USER_PROFILES_PATH);
  return next;
}

function detectPurposePreference(text) {
  const value = String(text || '').toLowerCase();
  const investment =
    /инвест|доход|сдава(?:ть|л|ем)|арендн(?:ый|ого)\s+доход|перепродаж|бизнес|investment|investir|investissement|anlage|rendite|rental\s+income|rent\s+out|alquiler|inversi[oó]n|inwestyc|belegging/i.test(
      value
    );
  const living =
    /для\s+(?:жизни|себя|семьи|проживания)|переезд|жить\s+(?:сам|семь)|live\s+(?:in|there)|for\s+(?:my|our)\s+family|relocat|para\s+vivir|vivir\s+all[ií]|zum\s+wohnen|selbst\s+wohnen|pour\s+vivre|habiter|dla\s+siebie|do\s+zamieszkania|om\s+te\s+wonen/i.test(
      value
    );

  if (investment && living) return 'mixed';
  if (investment) return 'investment';
  if (living) return 'living';
  return null;
}

function latestDetected(userTexts, detector) {
  for (let i = userTexts.length - 1; i >= 0; i -= 1) {
    const detected = detector(userTexts[i]);
    if (detected) return detected;
  }
  return null;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function buildUpdatedProfile(
  existing,
  conversationHistory,
  dialog,
  language,
  now = new Date().toISOString(),
  options = {}
) {
  const previous = existing && typeof existing === 'object' ? existing : {};
  const userTexts = (conversationHistory || [])
    .filter((message) => message?.sender === 'user' && message.text)
    .map((message) => String(message.text));

  const latestPurpose = latestDetected(userTexts, detectPurposePreference);
  const latestTypes = latestDetected(userTexts, (text) => {
    const result = detectPropertyTypePreference(text, language);
    return result.hasType ? result.types : null;
  });
  const latestRegions = latestDetected(userTexts, (text) => {
    const result = detectRegionPreference(text, language);
    return result.hasRegion ? result.regions : null;
  });
  const latestMicro = latestDetected(userTexts, (text) => {
    const result = detectMicroAreas(text, language);
    return result.hasSpecific
      ? { ids: result.groupIds || [], label: result.label || '' }
      : null;
  });
  const latestBudget = latestDetected(userTexts, (text) => {
    const budget = extractBudgetRange(text);
    const ignoreBudget = wantsIgnoreBudget(text);
    return budget.minPrice != null || budget.maxPrice != null || ignoreBudget
      ? { ...budget, ignoreBudget }
      : null;
  });

  const previousCriteria = previous.lastCriteria || {};
  const fallbackBudget =
    dialog?.hasBudget && (dialog.budget?.minPrice != null || dialog.budget?.maxPrice != null || dialog.ignoreBudget)
      ? { ...(dialog.budget || {}), ignoreBudget: Boolean(dialog.ignoreBudget) }
      : null;

  const regions =
    latestRegions ||
    previousCriteria.regions ||
    (dialog?.hasRegion ? dialog.macroRegions || [] : []);
  const propertyTypes =
    latestTypes ||
    previousCriteria.propertyTypes ||
    (dialog?.hasType ? dialog.propertyTypes || [] : []);
  const microAreas =
    latestMicro?.ids ||
    previousCriteria.microAreas ||
    (dialog?.hasLocation ? dialog.microAreaGroupIds || dialog.microAreas?.groupIds || [] : []);
  const microAreaLabel =
    latestMicro?.label ||
    previousCriteria.microAreaLabel ||
    (dialog?.hasLocation ? dialog.microAreaLabel || '' : '');
  const budget = latestBudget || fallbackBudget || previousCriteria.budget || null;
  const purpose = latestPurpose || previousCriteria.purpose || null;

  return {
    id: previous.id || null,
    preferredLanguage: String(language || previous.preferredLanguage || 'ru')
      .toLowerCase()
      .slice(0, 2),
    interestedRegions: unique([
      ...(previous.interestedRegions || []),
      ...(dialog?.macroRegions || []),
      ...(latestRegions || []),
    ]),
    lastCriteria: {
      purpose,
      propertyTypes: unique(propertyTypes),
      regions: unique(regions),
      microAreas: unique(microAreas),
      microAreaLabel,
      budget,
      source: 'conversation',
      updatedAt: now,
    },
    topicObservation: options.topicObservation || previous.topicObservation || null,
    createdAt: previous.createdAt || now,
    updatedAt: now,
  };
}

function getUserProfile(chatId) {
  if (!chatId) return null;
  return loadProfilesStore().profiles[String(chatId)] || null;
}

function updateUserProfileFromConversation(
  chatId,
  conversationHistory,
  dialog,
  language,
  options = {}
) {
  if (!chatId || String(chatId).endsWith('@g.us')) return null;
  const id = String(chatId);
  const store = loadProfilesStore();
  const profile = buildUpdatedProfile(
    store.profiles[id],
    conversationHistory,
    dialog,
    language,
    undefined,
    options
  );
  profile.id = id;
  store.profiles[id] = profile;
  saveProfilesStore(store);
  return profile;
}

function formatUserProfileForPrompt(profile) {
  if (!profile?.lastCriteria) return '';
  const criteria = profile.lastCriteria;
  const facts = [];

  if (profile.preferredLanguage) facts.push(`preferredLanguage=${profile.preferredLanguage}`);
  if (criteria.purpose) facts.push(`purpose=${criteria.purpose}`);
  if (criteria.propertyTypes?.length) {
    facts.push(`propertyTypes=${criteria.propertyTypes.join(',')}`);
  }
  if (criteria.regions?.length) facts.push(`regions=${criteria.regions.join(',')}`);
  if (criteria.microAreaLabel) facts.push(`area=${criteria.microAreaLabel}`);
  if (criteria.budget) {
    const { minPrice, maxPrice, ignoreBudget } = criteria.budget;
    if (ignoreBudget) facts.push('budget=no_limit');
    else if (minPrice != null || maxPrice != null) {
      facts.push(`budgetMin=${minPrice ?? 'unknown'}, budgetMax=${maxPrice ?? 'unknown'}`);
    }
  }
  if (!facts.length) return '';

  return `**LONG-TERM USER PROFILE (background context):**
${facts.map((fact) => `- ${fact}`).join('\n')}
Priority rule: the client's latest explicit message and CURRENT DIALOG MEMORY always override this profile. Do not mix this profile into a clearly different property search or support topic. Use it to avoid unnecessary repetition only when the client continues the same request or refers to previous conversations.`;
}

module.exports = {
  USER_PROFILES_PATH,
  resolveProfilesPath,
  loadProfilesStore,
  getUserProfile,
  detectPurposePreference,
  buildUpdatedProfile,
  updateUserProfileFromConversation,
  formatUserProfileForPrompt,
};
