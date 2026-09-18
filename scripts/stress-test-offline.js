/**
 * Офлайн-прогон пайплайна бота (без вызова LLM).
 * Язык, ссылки, каталог, intent-gate, LID, off-topic маркеры.
 *   node scripts/stress-test-offline.js
 */
'use strict';

const { detectLanguageFromText, isAmbiguousShortReply, isStrongLanguageSignal, isUrlOnlyMessage } = require('../language-detector');
const {
  extractPropertyItemsFromText,
  userMessageHasPropertyLink,
  formatLinkedPropertiesForPrompt,
  getLinkedPropertyStageInstruction,
} = require('../property-interest');
const { formatOffTopicInstruction, isOffTopicChatter } = require('../keyword-relevance');
const { evaluateIntentGate } = require('../intent-gate');
const { formatContactDisplay, isWhatsAppLid } = require('../manager-handoff');
const { getLanguageFromPhone, getTranslation } = require('../phone-utils');
const { load } = require('../property-catalog');
const { resolveModel } = require('../ai-client');

let pass = 0;
let fail = 0;
const fails = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    fails.push(`${name}${detail ? ': ' + detail : ''}`);
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function main() {
  console.log('\n🧪 Offline pipeline stress-test\n');

  console.log('1) Языки');
  const langCases = [
    ['de', 'Ich würde es gerne für ein Investment nutzen. Eventuell für Airbnb.'],
    ['de', 'Hallo, ich suche eine Wohnung in Adeje zum Wohnen, Budget 350000 Euro'],
    ['es', 'Sí, ya tengo dinero. No necesito hipoteca. ¿Pueden confirmar la visita?'],
    ['es', 'No entiendo lo que escribiste.'],
    ['es', 'Alquilarlo yo ya te pasé mi propuesta'],
    ['es', 'Hola, estoy interesado/a en [Parking à vendre 317] https://housetenerife.eu/es/property/parking-a-vendre-317-2/'],
    ['pl', 'Cześć, szukam mieszkania w Adeje, budżet 350000'],
    ['fr', 'Bonjour, je cherche un appartement à Adeje'],
    ['fr', 'Merci, je suis intéressé par ce bien, pouvez-vous m’appeler ?'],
    ['nl', 'Goedemorgen, ik zoek een appartement in Adeje'],
    ['nl', 'Bedankt, ik ben geïnteresseerd in dit object'],
    ['ru', 'Здравствуйте, ищу виллу на Тенерифе для жизни'],
    ['en', 'Looking for an investment property in Tenerife, budget 500000'],
    ['uk', 'Добрий день, шукаю квартиру на Тенеріфе для життя'],
    ['it', 'Buongiorno, cerco un appartamento a Tenerife per viverci'],
    ['pt', 'Olá, procuro um apartamento em Tenerife para viver'],
    ['tr', 'Merhaba, Tenerife’de yaşamak için daire arıyorum'],
  ];
  for (const [exp, text] of langCases) {
    const got = detectLanguageFromText(text);
    check(`${exp}: ${text.slice(0, 42)}…`, got === exp, `got ${got}`);
  }
  check(
    'ES pasé не strong для FR',
    isStrongLanguageSignal('Alquilarlo yo ya te pasé mi propuesta', 'es') &&
      !isStrongLanguageSignal('Alquilarlo yo ya te pasé mi propuesta', 'fr')
  );
  const url = 'https://housetenerife.eu/es/property/en-venta-un-bar-en-los-cristianos-748/';
  check('URL-only ambiguous', isUrlOnlyMessage(url) && isAmbiguousShortReply(url));
  check('URL не задаёт ES', detectLanguageFromText(url) === 'en');
  check(
    'DE strong vs sticky ES',
    isStrongLanguageSignal(langCases[0][1], 'de')
  );

  console.log('\n2) Ссылки / каталог');
  const catalog = load();
  check('каталог не пуст', (catalog.items || []).length > 100, `count=${catalog.items?.length}`);
  const sample = (catalog.items || []).find((i) => i.urls?.es) || catalog.items[0];
  const sampleUrl = sample?.urls?.es || sample?.url;
  check('есть ES url', Boolean(sampleUrl), sampleUrl || '');
  check('userMessageHasPropertyLink', userMessageHasPropertyLink(`mira ${sampleUrl}`));
  const extracted = extractPropertyItemsFromText(`Interesa: ${sampleUrl}`);
  check('extract из каталога', extracted.length >= 1, `n=${extracted.length} id=${extracted[0]?.id}`);
  const promptBlock = formatLinkedPropertiesForPrompt(extracted, 'es');
  check('prompt блок ссылки', /OBJETO|ENLACE|PROPERTY|OBJEKT|OFERTA/i.test(promptBlock) && promptBlock.length > 80);
  for (const lang of ['ru', 'es', 'de', 'fr', 'pl', 'nl', 'en']) {
    const instr = getLinkedPropertyStageInstruction(lang);
    check(`linked stage ${lang}`, instr.length > 40);
  }
  const missing = extractPropertyItemsFromText('https://housetenerife.eu/es/property/this-slug-does-not-exist-999999/');
  check('miss в каталоге → empty (live-fetch в рантайме)', missing.length === 0);

  console.log('\n3) Off-topic / gate');
  for (const lang of ['ru', 'es', 'de', 'fr', 'pl', 'nl', 'en']) {
    const t = formatOffTopicInstruction(lang, {});
    check(`offtopic instr ${lang}`, /OFF-TOPIC|НЕ ПО ТЕМЕ|HORS SUJET|OFF-TOPIC|STICHWORT|FILTR|TREFWOORD|KEYWORD/i.test(t));
  }
  check('isOffTopicChatter RU привет', isOffTopicChatter('Привет, как дела?'));
  check('не off-topic поиск', !isOffTopicChatter('Ищу апартаменты в Adeje бюджет 350000'));

  const gate = evaluateIntentGate(
    [{ sender: 'user', text: 'Hola, ¿qué tal?' }],
    'es',
    null
  );
  check('gate существует', Boolean(gate?.action));

  console.log('\n4) Телефоны / LID / переводы');
  const lid = formatContactDisplay('198848513318995@lid');
  check('LID display', lid.isLid && !lid.waLink && /WhatsApp ID/i.test(lid.display));
  const phone = formatContactDisplay('34612345678@c.us');
  check('реальный телефон', !phone.isLid && phone.waLink?.includes('34612345678'));
  check('getLanguageFromPhone LID → null', getLanguageFromPhone('198848513318995@lid') === null);
  check('PL manager_handoff alias', /Przekazałem|manager|WhatsApp/i.test(getTranslation('pl', 'manager_handoff')));
  check('NL handoff_ask_name alias', getTranslation('nl', 'handoff_ask_name').length > 10);
  for (const lang of ['de', 'fr', 'it', 'pt', 'uk', 'tr']) {
    const start = getTranslation(lang, 'start');
    check(
      `start ${lang} Maxim`,
      /Maxim|Maksim|Максим/i.test(start) && !/WhatsApp bot|WhatsApp бот/i.test(start)
    );
    check(`ciphertext ${lang}`, getTranslation(lang, 'ciphertext_reply').length > 20);
  }

  const { getLocalizedItem, containsCyrillic } = require('../property-catalog');
  const hz = (catalog.items || []).find((i) => String(i.id).toUpperCase() === 'HZ741') || catalog.items[0];
  const deCard = getLocalizedItem(hz, 'de');
  check('DE карточка без кириллицы', deCard.title && !containsCyrillic(deCard.title + deCard.description));
  check('DE factsLine', Boolean(deCard.factsLine));

  const itCard = getLocalizedItem(hz, 'it');
  check('IT карточка без кириллицы', itCard.title && !containsCyrillic(itCard.title + (itCard.description || '')));
  const parking = (catalog.items || []).find((i) => /parking/i.test(String(i.url || '') + String(i.title || '')));
  if (parking) {
    const { getItemPropertyCategories } = require('../property-types');
    check('parking категория', getItemPropertyCategories(parking).includes('parking'));
  }

  console.log('\n5) Модель');
  check('gpt-4.1 резолвится', resolveModel('openai/gpt-4.1') === 'openai/gpt-4.1');
  const prev = process.env.AI_ALLOW_ANY_MODEL;
  process.env.AI_ALLOW_ANY_MODEL = '0';
  check('claude без флага → gpt fallback', resolveModel('anthropic/claude-sonnet-4') === 'openai/gpt-4.1');
  process.env.AI_ALLOW_ANY_MODEL = '1';
  // resolveModel читает env на каждый вызов через allowAnyModel()
  check('claude с AI_ALLOW_ANY_MODEL', resolveModel('anthropic/claude-sonnet-4') === 'anthropic/claude-sonnet-4');
  process.env.AI_ALLOW_ANY_MODEL = prev;

  console.log('\n6) Неожиданные входы (детект не падает)');
  for (const t of ['????', '👍', 'ok', '350k', '€', '', '   ', '!!!!!', 'asdkjhaskjd']) {
    try {
      detectLanguageFromText(t);
      check(`detect tolerates «${t || '(empty)'}»`, true);
    } catch (e) {
      check(`detect tolerates «${t}»`, false, e.message);
    }
  }

  console.log(`\n────────────────────────────`);
  console.log(`Итого: ${pass} PASS / ${fail} FAIL`);
  if (fails.length) {
    console.log('Провалы:');
    fails.forEach((f) => console.log('  •', f));
  }
  process.exit(fail ? 2 : 0);
}

main();
