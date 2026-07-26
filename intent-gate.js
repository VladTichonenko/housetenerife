'use strict';

const { detectPropertyTypePreference } = require('./property-types');
const { detectRegionPreference } = require('./catalog-regions');
const { detectMicroAreas } = require('./location-matching');
const { detectMortgageStepsQuestion } = require('./purchase-finance');
const { wantsManagerHandoff } = require('./manager-handoff');

const SCENARIOS = {
  PROPERTY_SEARCH: 'property_search',
  MORTGAGE_DOCS: 'mortgage_docs',
  MANAGER_HANDOFF: 'manager_handoff',
  SUPPORT_OTHER: 'support_other',
  GENERAL: 'general',
};

function classifyScenario(text, language = 'ru') {
  const value = String(text || '').trim();
  const lower = value.toLowerCase();
  if (!value) {
    return { scenario: SCENARIOS.GENERAL, confidence: 0, strongSignal: false };
  }

  if (wantsManagerHandoff(value)) {
    return {
      scenario: SCENARIOS.MANAGER_HANDOFF,
      confidence: 1,
      strongSignal: true,
    };
  }

  if (
    /(?:подписк|subscription|suscripci[oó]n|abonnement|abonn|subskrypc|website\s+error|site\s+error|ошибк[а-яё]*\s+(?:сайт|бот|кабинет)|не\s+работает\s+(?:сайт|бот|кабинет|ссылка)|тех(?:ническ)?\s*поддерж|technical\s+support|soporte\s+t[eé]cnico|technischer\s+support|support\s+technique)/i.test(
      lower
    )
  ) {
    return {
      scenario: SCENARIOS.SUPPORT_OTHER,
      confidence: 0.95,
      strongSignal: true,
    };
  }

  if (
    detectMortgageStepsQuestion(value) ||
    /(?:ипотек|кредит\s+на\s+недвиж|mortgage|home\s+loan|hipoteca|pr[eé]stamo\s+hipotec|hypothek|cr[eé]dit\s+immobilier|kredyt\s+hipotec|hypotheek|nie\b|документ[а-яё]*\s+для\s+покупк)/i.test(
      lower
    )
  ) {
    return {
      scenario: SCENARIOS.MORTGAGE_DOCS,
      confidence: 0.9,
      strongSignal: true,
    };
  }

  const type = detectPropertyTypePreference(value, language);
  const region = detectRegionPreference(value, language);
  const propertySignal =
    type.hasType ||
    region.hasRegion ||
    /(?:недвижимост|объект|подборк|вариант|купить|продаж|апартамент|квартир|вилл|дом\b|property|real\s+estate|listing|apartment|villa|house\b|inmueble|propiedad|wohnung|immobil|appartement|maison|nieruchomo|woning|vastgoed)/i.test(
      lower
    );

  if (propertySignal) {
    return {
      scenario: SCENARIOS.PROPERTY_SEARCH,
      confidence: type.hasType || region.hasRegion ? 0.95 : 0.75,
      strongSignal: true,
    };
  }

  return { scenario: SCENARIOS.GENERAL, confidence: 0.35, strongSignal: false };
}

function arraysDifferWhenExplicit(current, previous) {
  if (!current?.length || !previous?.length) return false;
  return !current.some((value) => previous.includes(value));
}

function evaluateIntentGate(conversationHistory, language = 'ru', previousTopic = null) {
  const lastUser =
    [...(conversationHistory || [])].reverse().find((message) => message?.sender === 'user')
      ?.text || '';
  const classification = classifyScenario(lastUser, language);
  const type = detectPropertyTypePreference(lastUser, language);
  const region = detectRegionPreference(lastUser, language);
  const micro = detectMicroAreas(lastUser, language);

  const previous = previousTopic && typeof previousTopic === 'object' ? previousTopic : null;
  const inheritedScenario =
    !classification.strongSignal && previous?.scenario
      ? previous.scenario
      : classification.scenario;
  const regions = region.hasRegion ? region.regions : [];
  const propertyTypes = type.hasType ? type.types : [];
  const microAreas = micro.hasSpecific ? micro.groupIds || [] : [];
  const languageChanged = Boolean(
    previous?.language && language && previous.language !== String(language).slice(0, 2)
  );

  let action = previous ? 'continue' : 'start_topic';
  let reason = previous ? 'same_or_ambiguous_topic' : 'first_observation';

  if (
    previous &&
    classification.strongSignal &&
    previous.scenario &&
    inheritedScenario !== previous.scenario
  ) {
    action = 'scenario_change';
    reason = `${previous.scenario}_to_${inheritedScenario}`;
  } else if (
    previous &&
    inheritedScenario === SCENARIOS.PROPERTY_SEARCH &&
    arraysDifferWhenExplicit(regions, previous.regions)
  ) {
    action = 'new_topic';
    reason = 'region_changed';
  } else if (
    previous &&
    inheritedScenario === SCENARIOS.PROPERTY_SEARCH &&
    arraysDifferWhenExplicit(propertyTypes, previous.propertyTypes)
  ) {
    action = 'new_topic';
    reason = 'property_type_changed';
  } else if (languageChanged) {
    action = 'language_switch';
    reason = `${previous.language}_to_${String(language).slice(0, 2)}`;
  }

  const effectiveRegions = regions.length ? regions : previous?.regions || [];
  const effectiveTypes = propertyTypes.length ? propertyTypes : previous?.propertyTypes || [];
  const effectiveMicroAreas = microAreas.length ? microAreas : previous?.microAreas || [];

  return {
    mode: 'observe',
    action,
    reason,
    scenario: inheritedScenario,
    confidence: classification.confidence,
    strongSignal: classification.strongSignal,
    topicKey: [
      inheritedScenario,
      effectiveRegions.join('+') || '*',
      effectiveTypes.join('+') || '*',
    ].join(':'),
    regions: effectiveRegions,
    propertyTypes: effectiveTypes,
    microAreas: effectiveMicroAreas,
    language: String(language || 'ru').toLowerCase().slice(0, 2),
    lastUserText: String(lastUser).slice(0, 500),
    observedAt: new Date().toISOString(),
  };
}

function formatIntentGateForPrompt(gate) {
  if (!gate) return '';
  if (gate.scenario === SCENARIOS.SUPPORT_OTHER) {
    return `**ACTIVE SCENARIO: SUPPORT**
Answer the client's support question directly. Do not run the property qualification funnel, ask for a property budget, or show catalog listings unless the client explicitly returns to property search.`;
  }
  if (gate.scenario === SCENARIOS.MORTGAGE_DOCS) {
    return `**ACTIVE SCENARIO: MORTGAGE / DOCUMENTS**
Answer the finance or document question directly using the knowledge base. Keep relevant property context, but do not restart qualification or re-ask known budget, region, or property type.`;
  }
  if (gate.scenario === SCENARIOS.MANAGER_HANDOFF) {
    return `**ACTIVE SCENARIO: MANAGER HANDOFF**
Follow the existing soft-call and handoff rules. Do not replace the requested human contact with a new property qualification question.`;
  }
  if (gate.action === 'new_topic' && gate.scenario === SCENARIOS.PROPERTY_SEARCH) {
    return `**ACTIVE TOPIC: NEW PROPERTY SEARCH**
Use only the criteria from the active topic history. Older profile facts are background and must not override this new region or property type.`;
  }
  return '';
}

module.exports = {
  SCENARIOS,
  classifyScenario,
  evaluateIntentGate,
  formatIntentGateForPrompt,
};
