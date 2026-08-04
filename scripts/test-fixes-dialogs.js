#!/usr/bin/env node
/**
 * Автопроверка правок из QA (9 пунктов) + сценарии для ручного WhatsApp-теста.
 *
 *   node scripts/test-fixes-dialogs.js           # только детерминированные проверки (без AI)
 *   node scripts/test-fixes-dialogs.js --manual  # вывести диалоги для ручной проверки
 *   node scripts/test-fixes-dialogs.js --live    # + один запрос к AI (нужен AI_API_KEY)
 */
'use strict';

require('dotenv').config();

const {
  detectLanguageFromText,
  isAmbiguousShortReply,
  isMostlyPlaceName,
  isStrongLanguageSignal,
} = require('../language-detector');
const {
  detectMicroAreas,
  itemMatchesMicroAreas,
  getItemLocationOverrideIds,
} = require('../location-matching');
const {
  analyzeConversation,
  derivePriceTarget,
  extractBudgetRange,
  buildDialogMemoryBlock,
  formatBudgetBandLabel,
} = require('../dialog-context');
const { searchForContext, load, parseItemPriceEur } = require('../property-catalog');
const {
  repairPropertyUrlsInText,
  hasDuplicatePropertyUrls,
  stripNonCatalogUrls,
} = require('../property-share');
const {
  detectRegionPreference,
  getPrimaryMacroRegion,
} = require('../catalog-regions');
const {
  classifyObservedState,
  isDefinitiveLogoutReason,
} = require('../whatsapp-session-state');
const {
  REPLY_WAIT_MS,
  REPLY_BATCH_WAIT_MS,
} = require('../reply-batch');
const {
  expandSoftPropertyTypes,
  itemMatchesPropertyTypes,
  getItemPropertyCategories,
} = require('../property-types');
const {
  buildRuntimeHistory,
  hydrateConversationHistory,
} = require('../conversation-history');
const {
  detectPurposePreference,
  buildUpdatedProfile,
  formatUserProfileForPrompt,
} = require('../user-profile');
const {
  SCENARIOS,
  classifyScenario,
  evaluateIntentGate,
  formatIntentGateForPrompt,
} = require('../intent-gate');
const {
  TOPIC_RECENT_MESSAGES,
  prepareTopicContext,
  buildStructuredTopicSummary,
  refreshTopicSummary,
  getTopicContextHistory,
  getTopicAnalysisHistory,
  formatTopicSummaryForPrompt,
} = require('../topic-memory');
const {
  getKnowledgeBase,
  selectRelevantKnowledge,
} = require('../knowledge-base');
const {
  loadFileDocKnowledge,
  selectRelevantDocuments,
  getFileDocKnowledgeForPrompt,
} = require('../file-doc-knowledge');

const args = new Set(process.argv.slice(2));
const SHOW_MANUAL = args.has('--manual') || args.has('-m');
const RUN_LIVE = args.has('--live');

function user(...texts) {
  return texts.map((text) => ({ sender: 'user', text }));
}

function assert(name, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

function itemBlob(item) {
  const parts = [item.title, item.description, item.overview, item.url, item.id];
  for (const lang of ['ru', 'en', 'es']) {
    parts.push(item.titles?.[lang], item.descriptions?.[lang], item.urls?.[lang]);
  }
  return parts.filter(Boolean).join(' ');
}

function runDeterministicTests() {
  let passed = 0;
  let failed = 0;
  const check = (name, cond, detail) => {
    if (assert(name, cond, detail)) passed += 1;
    else failed += 1;
  };

  console.log('\n=== 1. Язык: топонимы не = español ===\n');
  check(
    'Puerto de la Cruz → en (не es)',
    detectLanguageFromText('Puerto de la Cruz') === 'en',
    detectLanguageFromText('Puerto de la Cruz')
  );
  check(
    'Puerto de la Cruz — слабый сигнал (не переключает sticky)',
    isAmbiguousShortReply('Puerto de la Cruz') && isMostlyPlaceName('Puerto de la Cruz')
  );
  check(
    'Looking for property in Adeje → en',
    detectLanguageFromText('Looking for property in Adeje') === 'en'
  );
  check(
    'Bonjour je cherche un appartement → fr',
    detectLanguageFromText('Bonjour, je cherche un appartement à Adeje') === 'fr'
  );
  check(
    'Hallo ich suche eine Wohnung → de',
    detectLanguageFromText('Hallo, ich suche eine Wohnung in Adeje') === 'de'
  );
  check(
    'FR strong signal',
    isStrongLanguageSignal('Bonjour, je cherche un appartement', 'fr')
  );

  console.log('\n=== 2. Не переспрашивать зону ===\n');
  const dPuerto = analyzeConversation(
    user(
      'Хочу купить апартамент на Тенерифе для жизни',
      'Puerto de la Cruz'
    ),
    'ru'
  );
  check('Puerto de la Cruz → hasLocation', dPuerto.hasLocation);
  check('needsMicroArea = false', !dPuerto.needsMicroArea);
  check('microArea = Puerto de la Cruz (не Santa Cruz)', dPuerto.microAreaLabel === 'Puerto de la Cruz');
  check('stage ≠ NEED_LOCATION', dPuerto.stage !== 'NEED_LOCATION', dPuerto.stage);
  const mem = buildDialogMemoryBlock(
    {
      hasPurpose: dPuerto.hasPurpose,
      hasType: dPuerto.hasType,
      hasRegion: dPuerto.hasRegion,
      hasLocation: dPuerto.hasLocation,
      hasBudget: dPuerto.hasBudget,
      needsMicroArea: dPuerto.needsMicroArea,
      propertyTypeLabel: dPuerto.propertyTypeLabel,
      regionLabel: dPuerto.regionLabel,
      microAreaLabel: dPuerto.microAreaLabel,
      budget: dPuerto.budget,
      wantsMoreLikeThese: false,
    },
    'ru'
  );
  check('memory: запрет переспрашивать район', /не спрашивай другую зону|НЕ переспрашивай.*район/i.test(mem));

  console.log('\n=== 3. Категория объекта на сайте (override виллы 860k) ===\n');
  const catalog = load();
  const villa = catalog.items.find((x) =>
    String(x.url || '').includes('puerto-de-la-krus')
  );
  check('вилла €860k найдена в каталоге', Boolean(villa));
  if (villa) {
    check(
      'override → santa_cruz',
      JSON.stringify(getItemLocationOverrideIds(villa)) === JSON.stringify(['santa_cruz'])
    );
    check(
      'НЕ в фильтре Puerto de la Cruz',
      !itemMatchesMicroAreas(villa, ['puerto_de_la_cruz'], itemBlob)
    );
    check(
      'в фильтре Santa Cruz',
      itemMatchesMicroAreas(villa, ['santa_cruz'], itemBlob)
    );
  }

  console.log('\n=== 4. Дубли ссылок ===\n');
  const url1 =
    'https://housetenerife.eu/ru/property/1-komnatnaya-kvartira-v-kosta-adehe-1229/';
  const url2 = 'https://housetenerife.eu/ru/property/apartamenty-523/';
  const dupText = `Вариант 1\n${url1}\n${url1}\nСпасибо`;
  check('hasDuplicate до repair', hasDuplicatePropertyUrls(dupText));
  const fixed = repairPropertyUrlsInText(dupText, 'ru', [url1, url2]);
  check('hasDuplicate после repair', !hasDuplicatePropertyUrls(fixed));
  check('в ответе 2 разных URL', (fixed.match(/housetenerife\.eu/gi) || []).length >= 2);

  console.log('\n=== 5. Тип недвижимости (только апартаменты) ===\n');
  check('soft fallback apartments → []', expandSoftPropertyTypes(['apartments']).length === 0);
  const dApt = analyzeConversation(
    user('Ищу апартамент в Adeje до 350000 для жизни'),
    'ru'
  );
  check('detect apartments', dApt.propertyTypes.includes('apartments'));
  const ctxApt = searchForContext(dApt.allUserText, 8, {
    lang: 'ru',
    maxPrice: dApt.budget.maxPrice,
    priceTarget: derivePriceTarget(dApt.budget),
    propertyTypes: dApt.propertyTypes,
    macroRegions: dApt.macroRegions,
    microAreaGroupIds: dApt.microAreaGroupIds,
    contextText: dApt.allUserText,
    microDetection: dApt.microAreas,
  });
  const apartmentItems = (ctxApt.urls || []).map((url) =>
    catalog.items.find((item) =>
      [item.url, ...Object.values(item.urls || {})].filter(Boolean).includes(url)
    )
  );
  const onlyApartments =
    ctxApt.found &&
    ctxApt.urls?.length >= 3 &&
    apartmentItems.length === ctxApt.urls.length &&
    apartmentItems.every(
      (item) => item && itemMatchesPropertyTypes(item, ['apartments'])
    );
  check('каталог: ≥3 апартамента, без вилл/домов', onlyApartments, `urls=${ctxApt.urls?.length}`);

  console.log('\n=== 6. Бюджет (смена и потолок) ===\n');
  check(
    'budget 350000 → max 350k',
    extractBudgetRange('budget 350000 euros').maxPrice === 350000
  );
  check(
    'бюджет 350000 → max 350k',
    extractBudgetRange('бюджет 350000').maxPrice === 350000
  );
  const dBudget = analyzeConversation(
    user('вилла Adeje для жизни бюджет 800000', 'давайте до 350000'),
    'ru'
  );
  check('смена бюджета → 350k', dBudget.budget.maxPrice === 350000);
  const pt = derivePriceTarget(dBudget.budget);
  const ctxBudget = searchForContext(dBudget.allUserText, 5, {
    lang: 'ru',
    maxPrice: dBudget.budget.maxPrice,
    priceTarget: pt,
    propertyTypes: dBudget.propertyTypes,
    macroRegions: dBudget.macroRegions,
    microAreaGroupIds: dBudget.microAreaGroupIds,
    contextText: dBudget.allUserText,
    microDetection: dBudget.microAreas,
  });
  const overBudget = (ctxBudget.urls || [])
    .map((u) => catalog.items.find((it) => itemBlob(it).includes(u.split('/property/')[1]?.slice(0, 20))))
    .filter(Boolean);
  // Проверяем по тексту каталога цены
  const pricesOver = [...(ctxBudget.text || '').matchAll(/€([\d,]+)/g)]
    .map((m) => parseInt(m[1].replace(/,/g, ''), 10))
    .filter((p) => p > 350000 * 1.2);
  check('нет объектов сильно выше ±20% от 350k', pricesOver.length === 0, pricesOver.join(', '));

  console.log('\n=== 7. Район Adeje (не Galeón / ложный fuzzy) ===\n');
  check('la calma не = Palm-Mar', detectMicroAreas('la calma').groupIds.length === 0);
  check(
    'URL виллы не даёт ложный south',
    detectMicroAreas(
      'https://housetenerife.eu/property/for-sale-beautiful-villa-in-puerto-de-la-cruz/'
    ).broadIds.length === 0
  );
  check(
    'Adeje ≠ Santa Cruz в одной фразе',
    detectMicroAreas('Puerto de la Cruz').groupIds.join() === 'puerto_de_la_cruz'
  );
  check(
    'каталог Adeje без Galeón',
    ctxApt.found && !/галеон|gale[oó]n|tesoro del gale/i.test(ctxApt.text || '')
  );

  console.log('\n=== 8. FR / DE ===\n');
  const dFr = analyzeConversation(
    user('Bonjour, je cherche un appartement à Adeje pour vivre, budget 350000 euros'),
    'fr'
  );
  check('FR: hasPurpose (pour vivre)', dFr.hasPurpose);
  check('FR: NEED_FUNDS_NOW до подборки', dFr.stage === 'NEED_FUNDS_NOW');
  check('FR: apartments', dFr.propertyTypes.includes('apartments'));
  const dDe = analyzeConversation(
    user('Hallo, ich suche eine Wohnung in Adeje zum Wohnen, Budget 350000 Euro'),
    'de'
  );
  check('DE: hasPurpose', dDe.hasPurpose);
  check('DE: NEED_FUNDS_NOW до подборки', dDe.stage === 'NEED_FUNDS_NOW');

  const dFrReady = analyzeConversation(
    user(
      'Bonjour, je cherche un appartement à Adeje pour vivre, budget 350000 euros',
      'tout cash, sans crédit'
    ),
    'fr'
  );
  check('FR: SHOW_LISTINGS после финансов', dFrReady.stage === 'SHOW_LISTINGS');

  console.log('\n=== 8c. Без китайских иероглифов в RU ===\n');
  const {
    replyMismatchesLanguage,
    stripUnexpectedScripts,
  } = require('../reply-language');
  const cjkSample =
    'Чтобы не показывать варианты, которые明显 не подходят, подскажите бюджет.';
  check('cjk: mismatch детектится', replyMismatchesLanguage(cjkSample, 'ru'));
  const cleaned = stripUnexpectedScripts(cjkSample);
  check('cjk: иероглифы удаляются', !/[\u3400-\u9fff]/u.test(cleaned));
  check('cjk: русский текст остаётся', /не подходят/.test(cleaned) && /бюджет/.test(cleaned));

  console.log('\n=== 9. Три ценовых уровня ===\n');
  const ctxTier = searchForContext(dApt.allUserText, 5, {
    lang: 'ru',
    maxPrice: dApt.budget.maxPrice,
    priceTarget: derivePriceTarget(dApt.budget),
    propertyTypes: dApt.propertyTypes,
    macroRegions: dApt.macroRegions,
    microAreaGroupIds: dApt.microAreaGroupIds,
    contextText: dApt.allUserText,
    microDetection: dApt.microAreas,
  });
  const tierPrices = [...(ctxTier.text || '').matchAll(/€([\d,]+)/g)]
    .map((m) => parseInt(m[1].replace(/,/g, ''), 10))
    .filter((p) => p >= 50000);
  const uniquePrices = [...new Set(tierPrices)];
  check('≥3 варианта с ценой', uniquePrices.length >= 3, uniquePrices.join(', '));
  if (uniquePrices.length >= 3) {
    const sorted = [...uniquePrices].sort((a, b) => a - b);
    const spread = sorted[sorted.length - 1] - sorted[0];
    check('разброс цен > 20k (дешевле/средний/дороже)', spread > 20000, `spread=${spread}`);
  }

  console.log('\n=== 10. Восстановление истории после рестарта ===\n');
  const persisted = [
    { role: 'user', text: 'Ищу апартамент для жизни', at: '2026-07-20T10:00:00.000Z' },
    { role: 'assistant', text: 'Какой регион рассматриваете?', at: '2026-07-20T10:00:01.000Z' },
    { role: 'user', text: 'Tenerife, Puerto de la Cruz, до 400000 евро', at: '2026-07-20T10:00:02.000Z' },
    { role: 'manager', text: 'Подключаюсь к диалогу', at: '2026-07-20T10:00:03.000Z' },
  ];
  const restored = buildRuntimeHistory(persisted, 3);
  check('history: соблюдает лимит', restored.length === 3);
  check(
    'history: manager передаётся модели как assistant',
    restored[2]?.sender === 'assistant'
  );
  const historyMap = new Map();
  let loadCount = 0;
  const firstHydration = hydrateConversationHistory(historyMap, 'test@c.us', () => {
    loadCount += 1;
    return persisted;
  }, 20);
  const secondHydration = hydrateConversationHistory(historyMap, 'test@c.us', () => {
    loadCount += 1;
    return [];
  }, 20);
  check('history: архив загружается при первом обращении', firstHydration.hydrated);
  check('history: повторно файл не читается', !secondHydration.hydrated && loadCount === 1);
  const restoredDialog = analyzeConversation(historyMap.get('test@c.us'), 'ru');
  check('history: восстановлен тип объекта', restoredDialog.hasType);
  check('history: восстановлен район', restoredDialog.microAreaLabel === 'Puerto de la Cruz');
  check('history: восстановлен бюджет', restoredDialog.budget.maxPrice === 400000);

  console.log('\n=== 11. Долгосрочный профиль клиента ===\n');
  const oldProfile = {
    id: 'test@c.us',
    preferredLanguage: 'ru',
    interestedRegions: ['dubai'],
    lastCriteria: {
      purpose: 'investment',
      propertyTypes: ['villas'],
      regions: ['dubai'],
      microAreas: [],
      microAreaLabel: '',
      budget: { minPrice: null, maxPrice: 800000, ignoreBudget: false },
    },
    createdAt: '2026-07-01T00:00:00.000Z',
  };
  const newConversation = user(
    'Теперь ищу апартамент на Тенерифе для жизни',
    'Puerto de la Cruz, бюджет до 350000 евро'
  );
  const newDialog = analyzeConversation(newConversation, 'ru');
  const updatedProfile = buildUpdatedProfile(
    oldProfile,
    newConversation,
    newDialog,
    'ru',
    '2026-07-26T12:00:00.000Z'
  );
  check('profile: новая цель перекрывает старую', updatedProfile.lastCriteria.purpose === 'living');
  check(
    'profile: новый тип перекрывает старый',
    JSON.stringify(updatedProfile.lastCriteria.propertyTypes) === JSON.stringify(['apartments'])
  );
  check(
    'profile: активный регион обновлён',
    JSON.stringify(updatedProfile.lastCriteria.regions) === JSON.stringify(['tenerife'])
  );
  check(
    'profile: история интересов сохраняет оба региона',
    updatedProfile.interestedRegions.includes('dubai') &&
      updatedProfile.interestedRegions.includes('tenerife')
  );
  check('profile: последний бюджет имеет приоритет', updatedProfile.lastCriteria.budget.maxPrice === 350000);
  check('profile: цель investment распознаётся', detectPurposePreference('Ищу для инвестиций и дохода') === 'investment');
  const profilePrompt = formatUserProfileForPrompt(updatedProfile);
  check(
    'profile: prompt фиксирует приоритет текущего диалога',
    /latest explicit message.*override/i.test(profilePrompt)
  );

  console.log('\n=== 12. Intent / Topic Gate (observe mode) ===\n');
  const dubaiTopic = evaluateIntentGate(
    user('Ищу виллу в Дубае для инвестиций до 800000 евро'),
    'ru'
  );
  check('gate: первая тема создаётся', dubaiTopic.action === 'start_topic');
  check('gate: property search распознан', dubaiTopic.scenario === SCENARIOS.PROPERTY_SEARCH);
  const tenerifeTopic = evaluateIntentGate(
    user('Теперь хочу апартамент на Тенерифе для жизни'),
    'ru',
    dubaiTopic
  );
  check(
    'gate: смена Dubai → Tenerife обнаружена',
    tenerifeTopic.action === 'new_topic' && tenerifeTopic.reason === 'region_changed'
  );
  const shortContinuation = evaluateIntentGate(
    user('до 350000 евро'),
    'ru',
    tenerifeTopic
  );
  check(
    'gate: короткий бюджет продолжает тему',
    shortContinuation.action === 'continue' &&
      shortContinuation.scenario === SCENARIOS.PROPERTY_SEARCH
  );
  const mortgageTopic = evaluateIntentGate(
    user('Какие шаги нужны, чтобы оформить ипотеку?'),
    'ru',
    tenerifeTopic
  );
  check(
    'gate: ипотека меняет сценарий',
    mortgageTopic.action === 'scenario_change' &&
      mortgageTopic.scenario === SCENARIOS.MORTGAGE_DOCS
  );
  const resumeVillas = evaluateIntentGate(user('What about villas?'), 'en', mortgageTopic);
  check(
    'gate: What about villas? → property search',
    resumeVillas.scenario === SCENARIOS.PROPERTY_SEARCH
  );
  check('gate: resume после ипотеки', resumeVillas.resumeSearch === true);
  check(
    'gate: resume не education-запрос',
    resumeVillas.educationAsk === false && resumeVillas.casualResume === true
  );
  const resumePrompt = formatIntentGateForPrompt(resumeVillas);
  check(
    'gate: prompt запрещает лекцию про виллы',
    /FORBIDDEN|RESUME PROPERTY|не лекц|NO EDUCATION|brochure/i.test(resumePrompt)
  );
  const educationAsk = evaluateIntentGate(
    user('Tell me about investing in villas — why are they good?'),
    'en',
    mortgageTopic
  );
  check('gate: явный education-запрос', educationAsk.educationAsk === true);
  check(
    'gate: education prompt разрешает кратко объяснить',
    /INVESTMENT EDUCATION REQUEST/i.test(formatIntentGateForPrompt(educationAsk))
  );
  const resumeRu = evaluateIntentGate(user('а что по виллам?'), 'ru', mortgageTopic);
  check('gate: а что по виллам? → resume', resumeRu.resumeSearch && resumeRu.casualResume);
  // Глобально: mid-funnel без ипотеки
  const midFunnel = evaluateIntentGate(
    user('What about villas?'),
    'en',
    {
      scenario: SCENARIOS.PROPERTY_SEARCH,
      regions: ['tenerife'],
      propertyTypes: ['villas'],
      language: 'en',
    }
  );
  check(
    'gate: mid-funnel What about villas? без ипотеки → casual resume',
    midFunnel.casualResume && midFunnel.resumeSearch && !midFunnel.educationAsk
  );
  check(
    'gate: любой property_search имеет anti-lecture',
    /NO EDUCATION PITCH \(global\)/i.test(
      formatIntentGateForPrompt({
        scenario: SCENARIOS.PROPERTY_SEARCH,
        action: 'continue',
        language: 'en',
        educationAsk: false,
      })
    )
  );
  const { formatGlobalHumanChatRules } = require('../conversational-flow');
  check(
    'tone: глобальные правила чата в модуле',
    /ГЛОБАЛЬНЫЕ ПРАВИЛА|GLOBAL CHAT RULES/i.test(formatGlobalHumanChatRules('ru')) &&
      /в ЛЮБОЙ момент|anytime/i.test(formatGlobalHumanChatRules('ru') + formatGlobalHumanChatRules('en'))
  );
  const {
    isCasualSearchResume,
    wantsInvestmentEducation,
  } = require('../conversational-flow');
  const { softenRoboticPunctuation } = require('../reply-warmth');
  check('tone: casual resume EN', isCasualSearchResume('What about villas?'));
  check('tone: casual resume RU', isCasualSearchResume('а что по виллам?'));
  check(
    'tone: education не casual',
    !isCasualSearchResume('Tell me about investing in villas') &&
      wantsInvestmentEducation('Tell me about investing in villas')
  );
  const softened = softenRoboticPunctuation(
    'Villas are excellent for investment.\nThey attract long-term renters.\nWhich area do you prefer?',
    'NEED_REGION'
  );
  check(
    'tone: смягчение подряд идущих точек',
    !/\.\nThey attract/.test(softened) || softened.split('\n')[1].endsWith('renters')
  );
  check(
    'gate: техническая поддержка распознана',
    classifyScenario('У меня не работает сайт, нужна техническая поддержка').scenario ===
      SCENARIOS.SUPPORT_OTHER
  );
  const {
    isOffTopicChatter,
    isGreetingOrSmallTalk,
    hasPropertyRelevantKeywords,
  } = require('../keyword-relevance');
  check('kw: привет как дела = small talk', isGreetingOrSmallTalk('Привет, как дела?'));
  check('kw: how are you = off-topic', isOffTopicChatter('Hi, how are you?'));
  check(
    'kw: вилла инвестиции = relevant',
    hasPropertyRelevantKeywords('ищу виллу под инвестиции') &&
      !isOffTopicChatter('ищу виллу под инвестиции')
  );
  const greetDialog = analyzeConversation(user('Привет, как дела?'), 'ru');
  check(
    'kw: small talk → FIRST_CONTACT без подборки',
    greetDialog.stage === 'FIRST_CONTACT' &&
      greetDialog.offTopicChatter &&
      !greetDialog.readyForListings
  );
  check(
    'kw: инструкция запрещает виллы',
    /ЗАПРЕЩЕНО: виллы|не по теме|Какой у вас бюджет/i.test(greetDialog.stageInstruction)
  );
  const greetGate = evaluateIntentGate(user('Привет, как дела?'), 'ru', null);
  check(
    'kw: gate помечает offTopic',
    greetGate.offTopic === true && /ФИЛЬТР ПО КЛЮЧЕВЫМ|OFF-TOPIC|бюджет/i.test(formatIntentGateForPrompt(greetGate))
  );

  console.log('\n=== Coverage: 9 правил + 4 проблемы ===\n');
  const coverRules = require('../bot-core-rules');
  const coverKnowledge = require('../consultant-knowledge.json');
  const coverWeb = require('../web-search');
  check('cover: 9 CORE_RULES', coverRules.CORE_RULES.length === 9);
  check('cover: ±20% ratio', coverRules.BUDGET_RANGE_RATIO === 0.2);
  check(
    'cover: 2M → 1.6–2.4M',
    coverRules.expandBudgetBand({ maxPrice: 2_000_000 }).floor === 1_600_000 &&
      coverRules.expandBudgetBand({ maxPrice: 2_000_000 }).ceiling === 2_400_000
  );
  check(
    'cover: срок в правиле 3',
    /2 месяца.*3 месяца.*позже/i.test(coverRules.CORE_RULES.find((r) => r.id === 3).summary)
  );
  check(
    'cover: официальные источники ипотеки',
    Array.isArray(coverKnowledge.mortgage_lending_official?.primary_sources) &&
      coverKnowledge.mortgage_lending_official.primary_sources.some((s) => /bde\.es/i.test(s.url))
  );
  check(
    'cover: ипотека не в веб-поиск',
    coverWeb.isMortgageOrCreditQuery('ипотека на Тенерифе') &&
      coverWeb.shouldAugmentWithWeb('актуальные ставки по ипотеке') === false
  );
  check(
    'cover: эскалация жалоб',
    coverRules.wantsEscalation('это мошенничество хочу жалобу директору')
  );
  check(
    'cover: живой тон в промпте',
    /ГЛОБАЛЬНЫЕ ПРАВИЛА|не ставь точку/i.test(formatGlobalHumanChatRules('ru'))
  );
  check(
    'cover: финансы до подборки',
    analyzeConversation(user('инвестиции', 'бюджет 2 млн', 'через 2 месяца'), 'ru').stage ===
      'NEED_FUNDS_NOW'
  );
  const languageSwitch = evaluateIntentGate(user('ok'), 'en', tenerifeTopic);
  check(
    'gate: сильный sticky-язык отражается как switch',
    languageSwitch.action === 'language_switch'
  );
  check('gate: история пока не обрезается', languageSwitch.mode === 'observe');

  console.log('\n=== 13. Изоляция веток тем ===\n');
  const topicStore = { version: 1, chats: {}, updatedAt: null };
  const dubaiHistory = [
    { sender: 'user', text: 'Ищу виллу в Дубае для инвестиций до 800000', timestamp: 1 },
    { sender: 'assistant', text: 'Какой район Дубая рассматриваете?', timestamp: 2 },
  ];
  const firstTopicContext = prepareTopicContext(
    topicStore,
    'topics@test',
    dubaiHistory,
    dubaiTopic
  );
  const switchedHistory = [
    ...dubaiHistory,
    {
      sender: 'user',
      text: 'Теперь хочу апартамент на Тенерифе для жизни',
      timestamp: 3,
    },
  ];
  const secondTopicContext = prepareTopicContext(
    topicStore,
    'topics@test',
    switchedHistory,
    tenerifeTopic
  );
  check('topics: создано две ветки', Object.keys(topicStore.chats['topics@test'].topics).length === 2);
  check('topics: старая ветка приостановлена', firstTopicContext.topic.status === 'paused');
  check(
    'topics: новая ветка не содержит Dubai',
    !secondTopicContext.history.some((message) => /дуба/i.test(message.text))
  );
  check(
    'topics: новая ветка содержит Tenerife',
    secondTopicContext.history.some((message) => /тенериф/i.test(message.text))
  );
  const continuedContext = prepareTopicContext(
    topicStore,
    'topics@test',
    [
      ...secondTopicContext.history,
      { sender: 'assistant', text: 'Какой бюджет рассматриваете?', timestamp: 4 },
      { sender: 'user', text: 'до 350000 евро', timestamp: 5 },
    ],
    shortContinuation
  );
  check(
    'topics: короткий ответ остаётся в активной ветке',
    continuedContext.history.some((message) => /350000/.test(message.text))
  );
  const mortgageContext = prepareTopicContext(
    topicStore,
    'topics@test',
    [
      ...continuedContext.history,
      { sender: 'user', text: 'Какие шаги нужны для ипотеки?', timestamp: 6 },
    ],
    mortgageTopic
  );
  check(
    'topics: ипотека сохраняет контекст сделки',
    mortgageContext.topic.id === continuedContext.topic.id &&
      mortgageContext.history.some((message) => /тенериф/i.test(message.text))
  );
  const supportGate = evaluateIntentGate(
    user('У меня не работает сайт, нужна техническая поддержка'),
    'ru',
    mortgageTopic
  );
  const supportContext = prepareTopicContext(
    topicStore,
    'topics@test',
    [
      ...mortgageContext.history,
      {
        sender: 'assistant',
        text: 'Для ипотеки подготовьте паспорт, NIE и подтверждение дохода.',
        timestamp: 6.5,
      },
      {
        sender: 'user',
        text: 'У меня не работает сайт, нужна техническая поддержка',
        timestamp: 7,
      },
    ],
    supportGate
  );
  check(
    'topics: support изолирован от поиска недвижимости',
    supportContext.topic.id !== mortgageContext.topic.id &&
      !supportContext.history.some((message) => /тенериф|350000/i.test(message.text))
  );
  check(
    'topics: support получает отдельное системное правило',
    /do not run the property qualification funnel/i.test(formatIntentGateForPrompt(supportGate))
  );
  const returnToPropertyGate = evaluateIntentGate(
    user('Вернёмся к апартаменту на Тенерифе'),
    'ru',
    supportGate
  );
  const resumedContext = prepareTopicContext(
    topicStore,
    'topics@test',
    [
      ...supportContext.history,
      { sender: 'assistant', text: 'Опишите ошибку сайта подробнее.', timestamp: 8 },
      { sender: 'user', text: 'Вернёмся к апартаменту на Тенерифе', timestamp: 9 },
    ],
    returnToPropertyGate
  );
  check(
    'topics: после support возобновляется ветка сделки',
    resumedContext.resumed &&
      resumedContext.topic.id === mortgageContext.topic.id &&
      !resumedContext.history.some((message) => /ошибк.*сайт|техническ.*поддерж/i.test(message.text))
  );

  console.log('\n=== 14. Summary Memory ===\n');
  const longTopicHistory = [
    {
      sender: 'user',
      text: 'Ищу апартамент на Тенерифе в Puerto de la Cruz для жизни, бюджет до 800000 евро',
      timestamp: 10,
    },
    { sender: 'assistant', text: 'Подготовил варианты.', timestamp: 11 },
    { sender: 'user', text: 'Снизим бюджет до 350000 евро', timestamp: 12 },
    { sender: 'assistant', text: 'Учту новый бюджет.', timestamp: 13 },
  ];
  for (let i = 0; i < 6; i += 1) {
    longTopicHistory.push(
      { sender: 'user', text: `Уточнение ${i + 1}`, timestamp: 20 + i * 2 },
      { sender: 'assistant', text: `Ответ ${i + 1}`, timestamp: 21 + i * 2 }
    );
  }
  const structuredSummary = buildStructuredTopicSummary(longTopicHistory, 'ru');
  check('summary: сохраняет цель', structuredSummary.purpose === 'living');
  check(
    'summary: сохраняет тип',
    JSON.stringify(structuredSummary.propertyTypes) === JSON.stringify(['apartments'])
  );
  check('summary: сохраняет регион', structuredSummary.regions.includes('tenerife'));
  check('summary: сохраняет район', structuredSummary.microAreaLabel === 'Puerto de la Cruz');
  check('summary: последний бюджет имеет приоритет', structuredSummary.budget.maxPrice === 350000);
  const longTopic = {
    id: 'topic-long',
    scenario: 'property_search',
    criteria: { language: 'ru' },
    messages: longTopicHistory,
    summary: '',
  };
  refreshTopicSummary(longTopic, '2026-07-26T12:30:00.000Z');
  const compactHistory = getTopicContextHistory(longTopic);
  const summaryAnalysisHistory = getTopicAnalysisHistory(longTopic, compactHistory);
  const restoredFromSummary = analyzeConversation(summaryAnalysisHistory, 'ru');
  check(
    'summary: в AI идут только последние сообщения',
    compactHistory.length === TOPIC_RECENT_MESSAGES
  );
  check(
    'summary: критерии восстанавливаются для каталога',
    restoredFromSummary.hasPurpose &&
      restoredFromSummary.hasType &&
      restoredFromSummary.hasRegion &&
      restoredFromSummary.hasBudget &&
      restoredFromSummary.budget.maxPrice === 350000
  );
  check(
    'summary: prompt запрещает выдумывать значения и URL',
    /never invent missing values or urls/i.test(formatTopicSummaryForPrompt(longTopic.summary))
  );

  console.log('\n=== 15. Selective RAG ===\n');
  const fullKnowledge = getKnowledgeBase();
  const mortgageKnowledge = selectRelevantKnowledge(fullKnowledge, {
    query: 'Какие документы нужны и как получить ипотеку в Испании?',
    scenario: 'mortgage_docs',
    language: 'ru',
    maxSections: 6,
  });
  check('rag: ипотека получает mortgage_process', Boolean(mortgageKnowledge.mortgage_process));
  check('rag: ипотека получает purchase_documents', Boolean(mortgageKnowledge.purchase_documents));
  check(
    'rag: ипотека получает помощь House Tenerife',
    Boolean(mortgageKnowledge.mortgage_assistance) ||
      Boolean(fullKnowledge.mortgage_assistance?.pitch_keep_client)
  );
  check(
    'rag: ипотека получает официальные источники кредитования',
    Boolean(mortgageKnowledge.mortgage_lending_official) ||
      Boolean(fullKnowledge.mortgage_lending_official?.primary_sources?.length)
  );
  check(
    'rag: в lending official есть BdE и Ley 5/2019',
    Array.isArray(fullKnowledge.mortgage_lending_official?.primary_sources) &&
      fullKnowledge.mortgage_lending_official.primary_sources.some((s) => /bde\.es/i.test(s.url)) &&
      fullKnowledge.mortgage_lending_official.primary_sources.some((s) => /boe\.es/i.test(s.url))
  );
  check(
    'rag: запрет рекламы юристов в политике ипотеки',
    /НЕ цитируй|не реклам|Never cite lawyer|Nunca cites anuncios/i.test(
      JSON.stringify({
        a: fullKnowledge.mortgage_assistance,
        b: fullKnowledge.mortgage_lending_official,
        c: fullKnowledge.mortgage_process?.source_policy,
      })
    )
  );
  check(
    'rag: официальный Euríbor BdE в базе',
    fullKnowledge.mortgage_rates_official?.values?.euribor_1y_pct === 2.798
  );
  check('rag: устаревшие featured properties исключены', !mortgageKnowledge.featured_properties);
  check('rag: дублирующий concierge playbook исключён', !mortgageKnowledge.concierge_playbook);
  check(
    'rag: основной KB-контекст существенно уменьшен',
    JSON.stringify(mortgageKnowledge).length < JSON.stringify(fullKnowledge).length * 0.5
  );
  const englishMortgageKnowledge = selectRelevantKnowledge(fullKnowledge, {
    query: 'mortgage steps and documents',
    scenario: 'mortgage_docs',
    language: 'en',
    maxSections: 3,
  });
  check(
    'rag: ипотека локализуется до prompt',
    englishMortgageKnowledge.mortgage_process?.steps?.[0]?.title === 'Budget & deposit'
  );
  const supportKnowledge = selectRelevantKnowledge(fullKnowledge, {
    query: 'Не работает сайт, нужна техническая поддержка',
    scenario: 'support_other',
    language: 'ru',
    maxSections: 3,
  });
  check('rag: support получает контакты', Boolean(supportKnowledge.contacts));

  const { shouldAugmentWithWeb } = require('../web-search');
  check(
    'web: ипотека не уходит в веб-поиск (реклама юристов)',
    shouldAugmentWithWeb('Как получить ипотеку в Испании? актуальные ставки') === false
  );
  check(
    'web: кредит/mortgage не уходит в веб-поиск',
    shouldAugmentWithWeb('Tell me about mortgage rates in Tenerife today') === false
  );
  check(
    'web: обычный запрос про актуальность налогов может искать',
    shouldAugmentWithWeb('актуальные налоги на покупку недвижимости') === true
  );

  const fileDocs = loadFileDocKnowledge();
  const genericDocs = selectRelevantDocuments(
    fileDocs,
    'Ищу апартамент на Tenerife для жизни',
    { scenario: 'property_search' }
  );
  check('rag: generic-поиск не тащит проектные PDF', genericDocs.length === 0);
  const projectDocs = selectRelevantDocuments(
    fileDocs,
    'Инвестиционный проект вилл в Adeje Golf с ROI',
    { scenario: 'property_search', maxDocs: 3 }
  );
  check('rag: инвестиционный запрос находит проектные документы', projectDocs.length > 0);
  check(
    'rag: prompt-файлы исключены из документов',
    projectDocs.every(
      (doc) => !/system\s*prompt|промпт|ветк|branch/i.test(`${doc.title} ${doc.source_file}`)
    )
  );
  const exactProjectDocs = selectRelevantDocuments(fileDocs, 'Edificio Esmeralda', {
    scenario: 'property_search',
  });
  check(
    'rag: конкретное название проекта находится без общих слов',
    exactProjectDocs.some((doc) => /esmeralda/i.test(doc.title))
  );
  const docsPrompt = getFileDocKnowledgeForPrompt(
    'Инвестиционный проект вилл в Adeje Golf с ROI',
    6000,
    { scenario: 'property_search', maxDocs: 2 }
  );
  check(
    'rag: сформированный блок не содержит системные prompt-документы',
    Boolean(docsPrompt) && !/SYSTEM PROMPT|пронэмт по веткам/i.test(docsPrompt)
  );

  console.log('\n=== 16. Равноправные регионы и ссылки Ibiza ===\n');
  const spainRegion = detectRegionPreference('Ищу недвижимость в Испании', 'ru');
  const canaryRegion = detectRegionPreference('Ищу недвижимость на Канарах', 'ru');
  check('regions: Испания не выбирает Tenerife', !spainRegion.hasRegion);
  check(
    'regions: Канары по-прежнему распознаются как Tenerife',
    canaryRegion.regions.join() === 'tenerife'
  );

  const ibizaBudget = { minPrice: null, maxPrice: 500000 };
  const ibizaCtx = searchForContext(
    'villa Ibiza para vivir hasta 500000 euros',
    5,
    {
      lang: 'es',
      maxPrice: ibizaBudget.maxPrice,
      priceTarget: derivePriceTarget(ibizaBudget),
      propertyTypes: ['villas'],
      macroRegions: ['ibiza'],
      contextText: 'villa Ibiza para vivir hasta 500000 euros',
      allowBudgetFallback: true,
    }
  );
  const ibizaItems = (ibizaCtx.urls || [])
    .map((url) =>
      catalog.items.find((item) =>
        [item.url, ...Object.values(item.urls || {})].filter(Boolean).includes(url)
      )
    )
    .filter(Boolean);
  check('ibiza: каталог возвращает реальные ссылки', ibizaCtx.found && ibizaCtx.urls.length > 0);
  check('ibiza: включён прозрачный fallback выше бюджета', ibizaCtx.usedBudgetFallback);
  check(
    'ibiza: не подмешиваются другие регионы',
    ibizaItems.length === ibizaCtx.urls.length &&
      ibizaItems.every((item) => getPrimaryMacroRegion(item) === 'ibiza')
  );

  console.log('\n=== 16c. Смена региона: Тенерифе → Ибица ===\n');
  const switchHist = [
    { sender: 'user', text: 'Хочу купить на Тенерифе для жизни' },
    { sender: 'bot', text: 'Какой тип?' },
    { sender: 'user', text: 'апартаменты бюджет 300000 Costa Adeje' },
    { sender: 'bot', text: 'Вот варианты на Тенерифе' },
    { sender: 'user', text: 'хорошо, теперь давайте вернемся к ибице' },
    { sender: 'bot', text: 'Какой тип объекта на Ибице?' },
    {
      sender: 'user',
      text: 'давайте посмотрим бизнес апартаменты, покажите пожалуйста объекты которые у вас есть',
    },
  ];
  const dSwitch = analyzeConversation(switchHist, 'ru');
  check(
    'switch: активный регион только Ibiza',
    dSwitch.macroRegions.join() === 'ibiza',
    dSwitch.macroRegions.join(',')
  );
  check('switch: label без Тенерифе', !/тенериф|tenerife/i.test(dSwitch.regionLabel || ''));
  check(
    'switch: районы Тенерифе не тянутся',
    !(dSwitch.microAreaGroupIds || []).some((id) =>
      ['costa_adeje', 'los_cristianos', 'las_americas'].includes(id)
    ),
    (dSwitch.microAreaGroupIds || []).join(',')
  );
  const switchCtx = searchForContext(dSwitch.allUserText, 5, {
    lang: 'ru',
    maxPrice: dSwitch.budget.maxPrice,
    priceTarget: derivePriceTarget(dSwitch.budget),
    propertyTypes: dSwitch.propertyTypes,
    macroRegions: dSwitch.macroRegions,
    microAreaGroupIds: dSwitch.microAreaGroupIds,
    microDetection: dSwitch.microAreas,
    contextText: dSwitch.allUserText,
    allowBudgetFallback: true,
    allowTypeFamilyFallback: true,
  });
  const switchItems = (switchCtx.urls || [])
    .map((url) =>
      catalog.items.find((item) =>
        [item.url, ...Object.values(item.urls || {})].filter(Boolean).includes(url)
      )
    )
    .filter(Boolean);
  check('switch: каталог что-то нашёл на Ibiza', switchCtx.found && switchCtx.urls.length > 0);
  check(
    'switch: все карточки только Ibiza',
    switchItems.length === switchCtx.urls.length &&
      switchItems.every((item) => getPrimaryMacroRegion(item) === 'ibiza'),
    switchItems.map((i) => getPrimaryMacroRegion(i)).join(',')
  );

  const directIbiza = analyzeConversation(
    user('покажите бизнес апартаменты которые у вас есть на ибице'),
    'ru'
  );
  check('direct ibiza: только Ibiza', directIbiza.macroRegions.join() === 'ibiza');

  console.log('\n=== 16d. ES каталог + запрос ссылок Barcelona ===\n');
  const restaurant = catalog.items.find((i) =>
    /las-amerikas-360|las-americas-360/i.test(
      [i.url, ...Object.values(i.urls || {})].join(' ')
    )
  );
  check(
    'regions: ресторан Las Américas = Tenerife, не Barcelona',
    restaurant && getPrimaryMacroRegion(restaurant) === 'tenerife',
    restaurant && getPrimaryMacroRegion(restaurant)
  );
  const esLinkHist = [
    {
      sender: 'user',
      text: 'Muéstrame apartamentos en Barcelona para vivir, presupuesto 600000 euros.',
    },
    { sender: 'bot', text: 'Opciones inventadas…' },
    { sender: 'user', text: 'Por favor, proporcione enlaces a estos objetos.' },
  ];
  const dEsLinks = analyzeConversation(esLinkHist, 'es');
  check('es links: wantsPropertyLinks', dEsLinks.wantsPropertyLinks);
  check('es links: регион Barcelona', dEsLinks.macroRegions.join() === 'barcelona');
  const esAdeje = searchForContext('apartamentos Costa Adeje 350000', 3, {
    lang: 'es',
    propertyTypes: ['apartments'],
    macroRegions: ['tenerife'],
    maxPrice: 400000,
    priceTarget: derivePriceTarget({ maxPrice: 350000 }),
    allowBudgetFallback: true,
  });
  check('es catalog: есть URL', esAdeje.found && esAdeje.urls.length > 0);
  check(
    'es catalog: заголовок не кириллицей',
    esAdeje.found && !/[а-яё]{6,}/i.test((esAdeje.text || '').split('\n')[2] || ''),
    (esAdeje.text || '').split('\n')[2]
  );

  console.log('\n=== 16b. Ссылки по запросу + Marina Botafoch ===\n');
  check(
    'Marina Botafoch ≠ Los Cristianos/Arona',
    detectMicroAreas('Marina Botafoch', 'ru').groupIds.join() === 'ibiza_town'
  );
  check(
    'Marina Botafoch → регион Ibiza',
    detectRegionPreference('Marina Botafoch', 'ru').regions.join() === 'ibiza'
  );
  const linkHist = [
    { sender: 'user', text: 'Ищу апартаменты на Ибице для жизни, бюджет около 320000' },
    { sender: 'bot', text: 'В каком районе Ибицы смотрите?' },
    { sender: 'user', text: 'Marina Botafoch' },
    { sender: 'bot', text: 'Сколько есть сейчас на руках — все своими или часть + ипотека?' },
    { sender: 'user', text: 'часть + ипотека, на руках около 100000' },
    { sender: 'bot', text: 'Apartments in Marina-Botafoch — €320,000' },
    { sender: 'user', text: 'а дай пожалуйста на них ссылки' },
  ];
  const dLinks = analyzeConversation(linkHist, 'ru');
  check('links: wantsPropertyLinks', dLinks.wantsPropertyLinks);
  check('links: stage SHOW_LISTINGS', dLinks.stage === 'SHOW_LISTINGS');
  check('links: регион только Ibiza', dLinks.macroRegions.join() === 'ibiza');
  const aptIbizaCtx = searchForContext(dLinks.allUserText, 5, {
    lang: 'ru',
    maxPrice: dLinks.budget.maxPrice,
    priceTarget: derivePriceTarget(dLinks.budget),
    propertyTypes: dLinks.propertyTypes,
    macroRegions: dLinks.macroRegions,
    microAreaGroupIds: dLinks.microAreaGroupIds,
    microDetection: dLinks.microAreas,
    contextText: dLinks.allUserText,
    allowBudgetFallback: true,
    allowTypeFamilyFallback: true,
  });
  check(
    'links: каталог отдаёт реальные URL даже без апартаментов на Ibiza',
    aptIbizaCtx.found && aptIbizaCtx.urls.length > 0
  );
  check(
    'links: URL только housetenerife.eu/property/',
    (aptIbizaCtx.urls || []).every((u) => /housetenerife\.eu.*\/property\//i.test(u))
  );
  check(
    'ibiza: сохраняется тип villas',
    ibizaItems.every((item) => itemMatchesPropertyTypes(item, ['villas']))
  );
  check(
    'ibiza: prompt предупреждает о превышении бюджета',
    /superan el presupuesto/i.test(ibizaCtx.text)
  );

  const externalLinks =
    'Opciones: [Idealista](https://www.idealista.com/ibiza/) https://fotocasa.es/villas ' +
    `${ibizaCtx.urls[0]}`;
  const catalogOnly = stripNonCatalogUrls(externalLinks);
  check(
    'links: внешние порталы удаляются',
    !/idealista\.com|fotocasa\.es/i.test(catalogOnly)
  );
  check(
    'links: реальная карточка House Tenerife сохраняется',
    catalogOnly.includes(ibizaCtx.urls[0])
  );

  console.log('\n=== 17. Сессия и скорость ответа ===\n');
  check('session: UNLAUNCHED — промежуточное состояние', classifyObservedState('UNLAUNCHED') === 'transient');
  check('session: UNPAIRED ждёт QR/disconnected', classifyObservedState('UNPAIRED') === 'transient');
  check('session: только LOGOUT окончательно завершает авторизацию', isDefinitiveLogoutReason('LOGOUT'));
  check('session: DISCONNECTED не маскируется как LOGOUT', !isDefinitiveLogoutReason('DISCONNECTED'));
  check('batch: одиночное сообщение ждёт не более 3 с', REPLY_WAIT_MS <= 3000, REPLY_WAIT_MS);
  check('batch: пачка ждёт не более 6 с', REPLY_BATCH_WAIT_MS <= 6000, REPLY_BATCH_WAIT_MS);

  console.log('\n=== 18. Две ветки: инвестиции vs для себя ===\n');
  const { detectPurposeKind } = require('../dialog-context');
  check('purpose: инвестпроект → investment', detectPurposeKind('Ищу инвестиционный проект') === 'investment');
  check('purpose: для жизни → living', detectPurposeKind('для жизни на Тенерифе') === 'living');
  const invEarly = analyzeConversation(user('Ищу инвестиционный проект'), 'ru');
  check('invest: сразу NEED_BUDGET, не объекты', invEarly.stage === 'NEED_BUDGET' && invEarly.isInvestment);
  const invMid = analyzeConversation(
    user('инвестиции', 'бюджет 2 млн евро', 'в ближайшие месяцы'),
    'ru'
  );
  check('invest: после бюджета+срока → финансы', invMid.stage === 'NEED_FUNDS_NOW');
  const rememberBudget = analyzeConversation(
    user('Ищу виллу под инвестиции', 'Мой бюджет 2 миллиона'),
    'ru'
  );
  check(
    'memory: после бюджета → NEED_TIMELINE, не NEED_BUDGET',
    rememberBudget.stage === 'NEED_TIMELINE' &&
      rememberBudget.hasBudget &&
      rememberBudget.budget.maxPrice === 2_000_000
  );
  check(
    'memory: инструкция «запомнил» бюджет',
    /запомнил|ПАМЯТЬ КОНТЕКСТА/i.test(rememberBudget.stageInstruction)
  );
  check(
    'memory: запрет снова спрашивать бюджет',
    /НИКОГДА не спрашивай снова|НЕ переспрашивай|бюджет сохранён/i.test(
      `${rememberBudget.stageInstruction}\n${rememberBudget.memoryBlock}`
    )
  );
  check(
    'memory: дальше срок покупки из правил',
    /Когда вы планируете совершить покупку/i.test(rememberBudget.stageInstruction)
  );
  const keepBudget = analyzeConversation(
    user('инвестиции', 'бюджет 2 миллиона', 'через 2 месяца'),
    'ru'
  );
  check(
    'memory: бюджет живёт после срока',
    keepBudget.hasBudget && keepBudget.budget.maxPrice === 2_000_000
  );
  const invNeedTimeline = analyzeConversation(
    user('вилла под инвестиции', 'бюджет 2 миллиона'),
    'ru'
  );
  check(
    'invest: после бюджета → NEED_TIMELINE',
    invNeedTimeline.stage === 'NEED_TIMELINE' && invNeedTimeline.isInvestment
  );
  check(
    'invest: инструкция срока сейчас / 2–3 месяца',
    /Когда вы планируете совершить покупку|Через 2 месяца.*3 месяца.*позже/i.test(
      invNeedTimeline.stageInstruction
    )
  );
  check(
    'timeline: «через 2 месяца»',
    require('../bot-core-rules').detectInvestmentTimeline('через 2 месяца')
  );
  check(
    'timeline: «сейчас»',
    require('../bot-core-rules').detectInvestmentTimeline('сейчас')
  );
  check(
    'timeline: «позже»',
    require('../bot-core-rules').detectInvestmentTimeline('позже')
  );
  check(
    'timeline: «in 3 months»',
    require('../bot-core-rules').detectInvestmentTimeline('in 3 months')
  );
  check(
    'timeline: «now»',
    require('../bot-core-rules').detectInvestmentTimeline('now')
  );
  const invSkipLinks = analyzeConversation(
    user(
      'вилла Costa Adeje под инвестиции бюджет 2 млн все своими',
      'скинь ссылки'
    ),
    'ru'
  );
  check(
    'invest: ссылки без срока → всё равно NEED_TIMELINE',
    invSkipLinks.stage === 'NEED_TIMELINE' && !invSkipLinks.hasTimeline
  );
  const invLater = analyzeConversation(
    user('инвестиции', 'бюджет 2 млн', 'позже'),
    'ru'
  );
  check('invest: «позже» считается сроком', invLater.hasTimeline && invLater.stage === 'NEED_FUNDS_NOW');
  const { getStageInstruction } = require('../sales-localization');
  check(
    'invest: EN NEED_TIMELINE не падает в REFINE',
    /When do you plan to make the purchase|In 2 months.*3 months.*later/i.test(
      getStageInstruction('en', 'NEED_TIMELINE', {})
    )
  );
  const invSel = analyzeConversation(
    user('инвестиции', 'бюджет 2 млн', 'в ближайшие месяцы', 'все своими'),
    'ru'
  );
  check(
    'invest: после финансов → подбор без цены',
    invSel.stage === 'NEED_PROPERTY_TYPE' || invSel.stage === 'NEED_REGION'
  );
  const livEarly = analyzeConversation(user('Хочу купить для себя'), 'ru');
  check('living: после цели → регион', livEarly.stage === 'NEED_REGION' && !livEarly.isInvestment);
  const livFunds = analyzeConversation(
    user('апартамент Costa Adeje для жизни бюджет 350000'),
    'ru'
  );
  check('living: бюджет есть → финансы до подборки', livFunds.stage === 'NEED_FUNDS_NOW');
  const livReady = analyzeConversation(
    user('апартамент Costa Adeje для жизни бюджет 350000', 'все своими без ипотеки'),
    'ru'
  );
  check('living: после финансов → SHOW_LISTINGS', livReady.stage === 'SHOW_LISTINGS');

  console.log('\n=== 19. Бюджет обязателен до «покажи объекты» ===\n');
  const showNoBudget = analyzeConversation(user('Покажи объекты для инвестиций'), 'ru');
  check(
    'show: без бюджета → NEED_BUDGET',
    showNoBudget.stage === 'NEED_BUDGET' && !showNoBudget.readyForListings
  );
  check(
    'show: инструкция просит бюджет, не объекты',
    /бюджет|ЗАПРЕЩЕНО|±20%/i.test(showNoBudget.stageInstruction)
  );
  const band2m = derivePriceTarget({ maxPrice: 2_000_000 });
  check('show: 2M → пол 1.6M', band2m.floor === 1_600_000);
  check('show: 2M → потолок 2.4M', band2m.ceiling === 2_400_000);
  check(
    'show: label коридора',
    /1,600,000|1600000/.test(formatBudgetBandLabel({ maxPrice: 2_000_000 }, 'ru'))
  );
  const twoMln = extractBudgetRange('2 миллиона');
  check('show: «2 миллиона» → max 2M', twoMln.maxPrice === 2_000_000 && twoMln.minPrice == null);
  const twoMlnBand = derivePriceTarget(twoMln);
  check('show: «2 миллиона» → 1.6–2.4M', twoMlnBand.floor === 1_600_000 && twoMlnBand.ceiling === 2_400_000);

  console.log(`\n--- Итого: ${passed} passed, ${failed} failed ---\n`);
  return failed === 0;
}

const MANUAL_DIALOGS = [
  // ——— 9 правил QA (основной чеклист) ———
  {
    id: 'qa-1-budget-first',
    title: 'QA-1. Бюджет ДО объектов (не скидывать виллы сразу)',
    lang: 'ru',
    note: 'Правило 1 + проблема «неправильный порядок»',
    steps: [
      { who: 'user', text: 'Привет, ищу инвестиционный проект' },
      { who: 'bot', expect: 'Живой тон, без точек-робот. Спрашивает бюджет в €. ❌ НЕ ссылки на объекты.' },
      { who: 'user', text: 'Покажи варианты вилл' },
      { who: 'bot', expect: 'Всё ещё просит бюджет. ❌ НЕ подборка.' },
    ],
  },
  {
    id: 'qa-2-districts',
    title: 'QA-2. Районы под бюджет',
    lang: 'ru',
    note: 'Правило 2',
    steps: [
      { who: 'user', text: 'Инвестиции, бюджет 2 миллиона' },
      { who: 'bot', expect: 'Запомнил бюджет → срок покупки (2/3 мес / позже).' },
      { who: 'user', text: 'Через 2 месяца' },
      { who: 'bot', expect: 'Вопрос про деньги на руках / ипотеку.' },
      { who: 'user', text: 'Всё наличными' },
      { who: 'bot', expect: 'Тип/регион; может мягко подсказать зоны под 2M (Adeje / Ибица / Марбелья — из каталога). ❌ НЕ выдуманные названия.' },
    ],
  },
  {
    id: 'qa-3-timeline',
    title: 'QA-3. Срок инвестирования',
    lang: 'ru',
    note: 'Правило 3 — канон: «Когда вы планируете совершить покупку? Через 2 месяца, 3 месяца или позже?»',
    steps: [
      { who: 'user', text: 'Хочу инвестировать в недвижимость' },
      { who: 'bot', expect: 'Спрашивает бюджет.' },
      { who: 'user', text: 'Мой бюджет 2 миллиона' },
      { who: 'bot', expect: '«Отлично, запомнил…» + срок: 2 месяца / 3 месяца / позже. ❌ НЕ сразу финансы без срока. ❌ НЕ снова бюджет.' },
      { who: 'user', text: 'Скинь ссылки' },
      { who: 'bot', expect: 'Всё ещё ждёт срок. ❌ НЕ объекты.' },
      { who: 'user', text: 'Через 3 месяца' },
      { who: 'bot', expect: 'Переходит к финансам (нал / часть / ипотека).' },
    ],
  },
  {
    id: 'qa-4-finances',
    title: 'QA-4. Финансовые детали до подборки',
    lang: 'ru',
    note: 'Правило 4',
    steps: [
      { who: 'user', text: 'Инвестиции, бюджет полтора миллиона, через 2 месяца' },
      { who: 'bot', expect: 'Сколько на руках: всё / часть / нужна ипотека. ❌ НЕ объекты.' },
      { who: 'user', text: 'Часть наличными, часть ипотека' },
      { who: 'bot', expect: 'Дальше тип/регион или уточнение по ипотеке — без ссылок на объекты, пока не готовы критерии.' },
    ],
  },
  {
    id: 'qa-5-soft-call',
    title: 'QA-5. Мягкое предложение созвона',
    lang: 'ru',
    note: 'Правило 5 — созвон 10–15 мин, менеджер только после «да»',
    steps: [
      { who: 'user', text: 'Инвестиции вилла Тенерифе, бюджет 2 млн, через 2 месяца, всё наличными, Adeje' },
      { who: 'bot', expect: 'Может идти к подборке / уточнениям; где уместно — мягко предложить созвон 10–15 мин.' },
      { who: 'user', text: 'Да, давайте созвонимся' },
      { who: 'bot', expect: 'Передача менеджеру / запись. ❌ НЕ эскалация без согласия на предыдущих шагах.' },
    ],
  },
  {
    id: 'qa-6-band-20',
    title: 'QA-6. Коридор ±20% от бюджета',
    lang: 'ru',
    note: 'Правило 6 — бюджет 2M → объекты примерно €1.6M–€2.4M',
    steps: [
      { who: 'user', text: 'Инвестиции, вилла, Тенерифе, Adeje, бюджет 2 миллиона, через 2 месяца, всё наличными' },
      { who: 'bot', expect: 'Подборка в коридоре ~1.6–2.4M. ❌ НЕ виллы за 400k и НЕ за 5M без просьбы расширить.' },
    ],
  },
  {
    id: 'qa-7-memory',
    title: 'QA-7. Память контекста (бюджет не теряется)',
    lang: 'ru',
    note: 'Правило 7 + проблема «потеря контекста»',
    steps: [
      { who: 'user', text: 'Ищу инвестиции' },
      { who: 'bot', expect: 'Бюджет?' },
      { who: 'user', text: 'Мой бюджет 2 миллиона' },
      { who: 'bot', expect: 'Подтвердил бюджет → срок. ❌ НЕ «какой у вас бюджет?» снова.' },
      { who: 'user', text: 'Через 2 месяца' },
      { who: 'bot', expect: 'Финансы. ❌ НЕ переспрашивать бюджет.' },
      { who: 'user', text: 'А что по виллам?' },
      { who: 'bot', expect: 'Продолжает воронку с уже известным бюджетом. ❌ НЕ лекция про инвестиции. ❌ НЕ сброс бюджета.' },
    ],
  },
  {
    id: 'qa-8-keywords',
    title: 'QA-8. Small talk / ключевые слова (не сыпать виллами)',
    lang: 'ru',
    note: 'Правило 8',
    steps: [
      { who: 'user', text: 'Привет, как дела?' },
      { who: 'bot', expect: 'Коротко поздоровался, предложил помочь с недвижимостью/инвестициями, спросил бюджет или цель. ❌ НЕ список вилл.' },
      { who: 'user', text: 'Ок, хочу инвестировать' },
      { who: 'bot', expect: 'Вопрос про бюджет (старт воронки).' },
    ],
  },
  {
    id: 'qa-9-escalate',
    title: 'QA-9. Эскалация сложных / жалоб',
    lang: 'ru',
    note: 'Правило 9',
    steps: [
      { who: 'user', text: 'Это мошенничество, хочу жалобу директору' },
      { who: 'bot', expect: 'Не спорит по существу сделки — предлагает человека / эскалацию менеджеру. ❌ НЕ подборка объектов.' },
    ],
  },
  {
    id: 'qa-mortgage-sources',
    title: 'QA-A. Ипотека — официальные источники (не адвокаты)',
    lang: 'ru',
    note: 'Проблема «неправильные источники»',
    steps: [
      { who: 'user', text: 'Какие сейчас ставки по ипотеке в Испании для нерезидентов?' },
      { who: 'bot', expect: 'Опирается на Banco de España / Euríbor / закон; пакет помощи HT. ❌ НЕ ссылки на адвокатов / lawyer blogs / ads.' },
      { who: 'user', text: 'А что по виллам?' },
      { who: 'bot', expect: 'Возврат к подбору без лекции. Спрашивает следующий шаг воронки (бюджет и т.д.).' },
    ],
  },
  {
    id: 'qa-tone',
    title: 'QA-B. Разговорный тон (без точек-робота)',
    lang: 'ru',
    note: 'Проблема «слишком формальный тон»',
    steps: [
      { who: 'user', text: 'Привет' },
      { who: 'bot', expect: 'Как в WhatsApp: коротко, можно 🙂/:), не «Я предлагаю вам следующие варианты инвестиций.» с точкой в каждой строке.' },
      { who: 'user', text: 'Хочу купить для жизни на Тенерифе' },
      { who: 'bot', expect: 'Живой вопрос (тип/район), без буклета.' },
    ],
  },
  {
    id: 'qa-full-invest',
    title: 'QA-C. Полный инвест-путь (сквозной)',
    lang: 'ru',
    note: 'Все шаги подряд: бюджет → срок → финансы → регион → подборка ±20%',
    steps: [
      { who: 'user', text: 'Ищу инвестиционный проект' },
      { who: 'bot', expect: 'Бюджет?' },
      { who: 'user', text: '2 миллиона евро' },
      { who: 'bot', expect: 'Срок: 2 / 3 месяца / позже?' },
      { who: 'user', text: 'Сейчас' },
      { who: 'bot', expect: 'Нал / часть / ипотека?' },
      { who: 'user', text: 'Всё наличными' },
      { who: 'bot', expect: 'Тип недвижимости?' },
      { who: 'user', text: 'Вилла' },
      { who: 'bot', expect: 'Регион / зона (можно подсказать под бюджет).' },
      { who: 'user', text: 'Тенерифе, Costa Adeje' },
      { who: 'bot', expect: 'Подборка вилл ~1.6–2.4M, ссылки housetenerife.eu. Опционально мягкий созвон.' },
    ],
  },
  // ——— Регрессии каталога / языка ———
  {
    id: '1-lang',
    title: 'R1. Язык: Puerto de la Cruz не переключает на ES',
    lang: 'ru',
    steps: [
      { who: 'bot', expect: 'Приветствие на русском (первый контакт)' },
      { who: 'user', text: 'Привет, ищу недвижимость на Тенерифе для жизни' },
      { who: 'bot', expect: 'Ответ на русском, вопрос про тип или цель' },
      { who: 'user', text: 'Puerto de la Cruz' },
      { who: 'bot', expect: '❌ НЕ дублировать ответ на испанском. Язык остаётся RU. Не спрашивать «какую зону» — район уже назван.' },
    ],
  },
  {
    id: '2-zone',
    title: 'R2. Район не переспрашивать',
    lang: 'ru',
    steps: [
      { who: 'user', text: 'Хочу апартамент на Тенерифе для жизни' },
      { who: 'user', text: 'Puerto de la Cruz' },
      { who: 'bot', expect: '❌ НЕ «Какую зону вы имеете в виду?». Следующий вопрос — бюджет (мягко).' },
      { who: 'user', text: 'до 400000 евро' },
      { who: 'bot', expect: 'Подборка 3–5 апартаментов в Puerto de la Cruz / север, в коридоре бюджета.' },
    ],
  },
  {
    id: '3-catalog',
    title: 'R3. Вилла €860k — район Santa Cruz (не Puerto)',
    lang: 'ru',
    note: 'Проверка override: объект с slug puerto-de-la-krus для бота = Santa Cruz. На сайте CMS может быть иначе.',
    steps: [
      { who: 'user', text: 'Покажи виллы в Puerto de la Cruz до 900000 для жизни' },
      { who: 'bot', expect: 'В подборке НЕ должна быть «Красивая вилла… Пуэрто-де-ла-Крус €860k» (она в Santa Cruz).' },
      { who: 'user', text: 'А что есть в Santa Cruz до 900000?' },
      { who: 'bot', expect: 'Может появиться вилла €860k — это ожидаемо для Santa Cruz.' },
    ],
  },
  {
    id: '4-links',
    title: 'R4. Без дублирования ссылок',
    lang: 'ru',
    steps: [
      { who: 'user', text: 'Апартамент Costa Adeje до 350000 для жизни' },
      { who: 'bot', expect: '3–5 разных ссылок housetenerife.eu/property/… — каждая один раз, без дублей подряд.' },
      { who: 'user', text: 'Скинь ещё раз первый вариант' },
      { who: 'bot', expect: 'Одна ссылка на объект, не две одинаковые в одном сообщении.' },
    ],
  },
  {
    id: '5-type',
    title: 'R5. Только апартаменты',
    lang: 'ru',
    steps: [
      { who: 'user', text: 'Ищу апартамент в Adeje до 350000 для жизни' },
      { who: 'bot', expect: 'Только квартиры/апартаменты. ❌ НЕ виллы и НЕ таунхаусы.' },
    ],
  },
  {
    id: '6-budget',
    title: 'R6. Смена бюджета',
    lang: 'ru',
    steps: [
      { who: 'user', text: 'Вилла Adeje для жизни, бюджет 800000' },
      { who: 'user', text: 'Давайте до 350000' },
      { who: 'bot', expect: 'Подборка с объектами до ~350k (±20%). ❌ НЕ €1.5M и не €890k без явной просьбы «дороже».' },
    ],
  },
  {
    id: '7-area',
    title: 'R7. Adeje — не Galeón / другие районы',
    lang: 'ru',
    steps: [
      { who: 'user', text: 'Апартамент в Adeje до 400000 для жизни' },
      { who: 'bot', expect: 'Costa Adeje / Torviscas / El Duque и т.п. ❌ НЕ только «Tesoro del Galeón» как замена Adeje, ❌ НЕ Marbella/Dubai.' },
    ],
  },
  {
    id: '8-fr-de',
    title: 'R8. Французский',
    lang: 'fr',
    steps: [
      { who: 'user', text: 'Bonjour, je cherche un appartement à Adeje pour vivre, budget 350000 euros' },
      { who: 'bot', expect: 'Ответ на французском. Подборка 3+ appartements Costa Adeje, ссылки housetenerife.eu/fr/… или /property/…' },
    ],
  },
  {
    id: '8-de',
    title: 'R8b. Немецкий',
    lang: 'de',
    steps: [
      { who: 'user', text: 'Hallo, ich suche eine Wohnung in Adeje zum Wohnen, Budget 350000 Euro' },
      { who: 'bot', expect: 'Antwort auf Deutsch. 3+ Wohnungen in Adeje, Preise um 350k.' },
    ],
  },
  {
    id: '9-tiers',
    title: 'R9. Три ценовых уровня',
    lang: 'ru',
    steps: [
      { who: 'user', text: 'Апартамент Costa Adeje для жизни, бюджет 350000' },
      { who: 'bot', expect: '3–5 вариантов с разным ценником в коридоре ±20%. ❌ НЕ один единственный вариант.' },
    ],
  },
  {
    id: '10-ibiza-links',
    title: 'R10. Ibiza: реальные ссылки и честный fallback',
    lang: 'es',
    steps: [
      { who: 'user', text: 'Busco una villa en Ibiza para vivir, presupuesto hasta 500.000 euros' },
      { who: 'bot', expect: 'Если вилл до €500k нет — честно сообщает и показывает ближайшие только на Ibiza; без Idealista/Fotocasa.' },
    ],
  },
  {
    id: '11-fast-batch',
    title: 'R11. Быстрый ответ на серию сообщений',
    lang: 'ru',
    steps: [
      { who: 'user', text: 'Хочу купить виллу' },
      { who: 'user', text: 'На Ibiza, для жизни' },
      { who: 'user', text: 'Бюджет до 2 млн евро' },
      { who: 'bot', expect: 'Один объединённый ответ ~через 6 с после первого сообщения, без 20–30 с ожидания.' },
    ],
  },
];

function printManualDialogs() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  РУЧНЫЕ ТЕСТ-ДИАЛОГИ (WhatsApp / staging)');
  console.log('══════════════════════════════════════════════════════════\n');
  for (const scenario of MANUAL_DIALOGS) {
    console.log(`\n## ${scenario.title}`);
    if (scenario.note) console.log(`   (${scenario.note})`);
    console.log(`   Язык диалога: ${scenario.lang}\n`);
    for (const step of scenario.steps) {
      if (step.who === 'user') {
        console.log(`   👤 Клиент: ${step.text}`);
      } else {
        console.log(`   🤖 Бот: ${step.expect}`);
      }
    }
    console.log('');
  }
  console.log('──────────────────────────────────────────────────────────');
  console.log('Совет: перед каждым сценарием — новый чат или /start, чтобы сбросить sticky-язык и историю.');
  console.log('──────────────────────────────────────────────────────────\n');
}

async function runLiveSample() {
  if (!process.env.AI_API_KEY?.trim()) {
    console.log('\n⚠️  --live: задайте AI_API_KEY в .env\n');
    return;
  }
  const { askAI } = require('../ai-service');
  console.log('\n=== LIVE AI (один сценарий: апартамент Adeje 350k RU) ===\n');
  const history = user('Ищу апартамент в Adeje до 350000 евро для жизни');
  const reply = await askAI(history, 'ru');
  console.log('--- Ответ бота ---\n');
  console.log(reply);
  console.log('\n--- Проверьте глазами ---');
  console.log('• ≥3 ссылки /property/');
  console.log('• только апартаменты');
  console.log('• цены до ~390k');
  console.log('• нет дублей URL\n');
}

async function main() {
  console.log('House Tenerife — тест правок QA\n');
  const ok = runDeterministicTests();
  if (SHOW_MANUAL || !ok) printManualDialogs();
  else printManualDialogs();
  if (RUN_LIVE) await runLiveSample();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
