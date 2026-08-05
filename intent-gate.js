'use strict';

const { detectPropertyTypePreference } = require('./property-types');
const { detectRegionPreference } = require('./catalog-regions');
const { detectMicroAreas } = require('./location-matching');
const { detectMortgageStepsQuestion } = require('./purchase-finance');
const { wantsManagerHandoff } = require('./manager-handoff');
const {
  isCasualSearchResume,
  wantsInvestmentEducation,
  shouldResumePropertyFunnel,
  formatResumeSearchInstruction,
} = require('./conversational-flow');
const {
  isOffTopicChatter,
  isGreetingOrSmallTalk,
  formatOffTopicInstruction,
} = require('./keyword-relevance');

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

  if (isGreetingOrSmallTalk(value) || isOffTopicChatter(value)) {
    return {
      scenario: SCENARIOS.GENERAL,
      confidence: 0.8,
      strongSignal: true,
      offTopic: true,
      smallTalk: true,
    };
  }

  return { scenario: SCENARIOS.GENERAL, confidence: 0.35, strongSignal: false, offTopic: false };
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
  const offTopicChatter = Boolean(classification.offTopic || classification.smallTalk);
  let inheritedScenario =
    !classification.strongSignal && previous?.scenario
      ? previous.scenario
      : classification.scenario;
  // Small talk mid-funnel: не сбрасываем поиск — продолжаем воронку без объектов
  if (offTopicChatter && previous?.scenario === SCENARIOS.PROPERTY_SEARCH) {
    inheritedScenario = SCENARIOS.PROPERTY_SEARCH;
  }
  const regions = region.hasRegion ? region.regions : [];
  const propertyTypes = type.hasType ? type.types : [];
  const microAreas = micro.hasSpecific ? micro.groupIds || [] : [];
  const languageChanged = Boolean(
    previous?.language && language && previous.language !== String(language).slice(0, 2)
  );

  let action = previous ? 'continue' : 'start_topic';
  let reason = previous ? 'same_or_ambiguous_topic' : 'first_observation';

  if (languageChanged) {
    action = 'language_switch';
    reason = `${previous.language}_to_${String(language).slice(0, 2)}`;
  } else if (offTopicChatter && previous?.scenario === SCENARIOS.PROPERTY_SEARCH) {
    action = 'continue';
    reason = 'small_talk_continue_funnel';
  } else if (
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
    // Уточнение типа в той же сделке (вилла → бизнес) — не новая ветка, память бюджета/срока/финансов
    action = 'continue';
    reason = 'property_type_refined';
  }

  const effectiveRegions = regions.length ? regions : previous?.regions || [];
  const effectiveTypes = propertyTypes.length ? propertyTypes : previous?.propertyTypes || [];
  const effectiveMicroAreas = microAreas.length ? microAreas : previous?.microAreas || [];

  const resumeSearch = shouldResumePropertyFunnel(
    {
      scenario: inheritedScenario,
      reason,
      lastUserText: lastUser,
    },
    previous?.scenario
  );
  const educationAsk = wantsInvestmentEducation(lastUser);

  return {
    mode: 'observe',
    action,
    reason,
    scenario: inheritedScenario,
    confidence: classification.confidence,
    strongSignal: classification.strongSignal,
    offTopic: offTopicChatter,
    smallTalk: Boolean(classification.smallTalk || isGreetingOrSmallTalk(lastUser)),
    resumeSearch,
    educationAsk,
    casualResume: isCasualSearchResume(lastUser),
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
  if (gate.offTopic || gate.smallTalk) {
    return `${formatOffTopicInstruction(gate.language || 'ru', {
      hasBudget: false,
      hasPurpose: gate.scenario === SCENARIOS.PROPERTY_SEARCH,
      isInvestment: false,
      hasTimeline: false,
    })}`;
  }
  if (gate.scenario === SCENARIOS.SUPPORT_OTHER) {
    return `**ACTIVE SCENARIO: SUPPORT**
Answer the client's support question directly. Do not run the property qualification funnel, ask for a property budget, or show catalog listings unless the client explicitly returns to property search.`;
  }
  if (gate.scenario === SCENARIOS.MORTGAGE_DOCS) {
    return `**ACTIVE SCENARIO: MORTGAGE / DOCUMENTS**
Answer using mortgage_process + mortgage_assistance + mortgage_lending_official + mortgage_rates_official (Banco de España / Ley 5/2019). Pitch that House Tenerife helps arrange the mortgage (package) — do not send the client to handle it alone elsewhere. NEVER cite lawyers, law-firm ads, or lawyer blogs for loan terms. Keep property context; do not re-ask known budget/region/type. After answering, be ready to resume property selection if they casually return to villas/apartments — without a sales lecture.`;
  }
  if (gate.scenario === SCENARIOS.MANAGER_HANDOFF) {
    return `**ACTIVE SCENARIO: MANAGER HANDOFF / ESCALATION**
Follow soft-call and handoff rules. Complaints or complex specialist topics — warm 10–15 min call offer. Do not replace human contact with a new property qualification question.`;
  }
  if (gate.scenario === SCENARIOS.PROPERTY_SEARCH) {
    const resumeBlock =
      gate.resumeSearch || gate.casualResume
        ? `\n${formatResumeSearchInstruction(gate.language || 'en')}`
        : '';
    const educationBlock = gate.educationAsk
      ? `\n**INVESTMENT EDUCATION REQUEST:** Client explicitly asked about investing — you may briefly explain pros of the property type for investment, then return to the next funnel question. Keep WhatsApp tone (short, warm, not a brochure).`
      : `\n**NO EDUCATION PITCH (global):** Unless the client clearly asks to explain investing («tell me about…», «why villas for investment»), do NOT lecture why villas/apartments are good investments — continue the selection algorithm. Casual «What about villas?» = next funnel step, not a sales pitch.`;
    const memoryBlock =
      gate.reason === 'property_type_refined'
        ? `\n**TYPE REFINED (same deal):** Client clarified property type — keep budget, timeline, finances and purpose from earlier messages. Do NOT greet again or re-ask budget.`
        : '';
    return gate.action === 'new_topic'
      ? `**ACTIVE TOPIC: NEW PROPERTY SEARCH**
Use criteria from active topic + inherited summary (budget/timeline if present). Older profile facts are background. Filter by relevant keywords — stay in property search.${resumeBlock}${educationBlock}`
      : `**ACTIVE SCENARIO: PROPERTY SEARCH**
Stay in the property funnel. Filter the message by relevant keywords (goal, type, region, area, budget). Do not switch to mortgage/support unless the client clearly asks.${memoryBlock}${resumeBlock}${educationBlock}`;
  }
  return '';
}

module.exports = {
  SCENARIOS,
  classifyScenario,
  evaluateIntentGate,
  formatIntentGateForPrompt,
};
