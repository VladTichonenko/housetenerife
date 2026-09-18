/**
 * Регрессия детекта языка по всем SUPPORTED_DETECT + известные путаницы (ES↔FR, ES↔PL, DE↔ES…).
 *   node scripts/test-language-detect.js
 */
'use strict';

const {
  detectLanguageFromText,
  isStrongLanguageSignal,
  isAmbiguousShortReply,
  isUrlOnlyMessage,
  prepareDetectBody,
  SUPPORTED_DETECT,
  getLanguageName,
} = require('../language-detector');

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

function expectLang(exp, text, label = '') {
  const got = detectLanguageFromText(text);
  const tag = label || text.slice(0, 48);
  check(`${exp} ← «${tag}${text.length > 48 ? '…' : ''}»`, got === exp, `got ${got}`);
}

/** Канонические фразы по каждому поддерживаемому языку */
const CANONICAL = {
  ru: [
    'Здравствуйте, ищу виллу на Тенерифе для жизни, бюджет около 500 тысяч',
    'Хочу инвестировать в недвижимость, нужна ипотека',
    'Добрый день, подскажите по апартаментам в Adeje',
  ],
  en: [
    'Looking for an investment property in Tenerife, budget 500000',
    'Hi, I want to buy an apartment for living in Adeje',
    'We need a villa near the beach, cash available now',
  ],
  es: [
    'Buenos días podemos hablar por aquí ?',
    'Yo lo del parking',
    'Alquilarlo yo ya te pasé mi propuesta',
    'Por este te hablé yo que me hablastes',
    'Y me dijistes esto',
    'Yo ya te dije mi propuesta',
    'Hola, estoy interesado/a en [Parking à vendre 317] https://housetenerife.eu/es/property/parking-a-vendre-317-2/',
    'Sí, ya tengo dinero. No necesito hipoteca. ¿Pueden confirmar la visita?',
    'No entiendo lo que escribiste.',
    'Busco un apartamento en Costa Adeje para vivir, presupuesto 350000',
  ],
  de: [
    'Ich würde es gerne für ein Investment nutzen. Eventuell für Airbnb.',
    'Hallo, ich suche eine Wohnung in Adeje zum Wohnen, Budget 350000 Euro',
    'Wir möchten eine Villa kaufen, gerne mit Meerblick',
  ],
  fr: [
    'Bonjour, je cherche un appartement à Adeje',
    'Bonjour, nous voulons acheter une villa pour investir',
    'Merci, je suis intéressé par ce bien, pouvez-vous m’appeler ?',
  ],
  pl: [
    'Cześć, szukam mieszkania w Adeje, budżet 350000',
    'Dzień dobry, chcę kupić apartament na Teneryfie na inwestycję',
    'Proszę o kontakt, interesuje mnie ta oferta',
  ],
  nl: [
    'Goedemorgen, ik zoek een appartement in Adeje',
    'Hallo, wij willen een villa kopen om te wonen, budget 400000',
    'Bedankt, ik ben geïnteresseerd in dit object',
  ],
  uk: [
    'Добрий день, шукаю квартиру на Тенеріфе для життя',
    'Хочу інвестувати в нерухомість, бюджет 300 тисяч',
  ],
  pt: [
    'Olá, procuro um apartamento em Tenerife para viver',
    'Bom dia, quero comprar uma villa para investir, orçamento 400000',
  ],
  it: [
    'Buongiorno, cerco un appartamento a Tenerife per viverci',
    'Ciao, vorrei comprare una villa per investimento',
  ],
  tr: [
    'Merhaba, Tenerife’de yaşamak için daire arıyorum',
    'Yatırım için villa almak istiyorum, bütçe 350000',
  ],
};

/** Известные ложные срабатывания из продакшена */
const CONFUSION = [
  // ES é ≠ FR
  ['es', 'Alquilarlo yo ya te pasé mi propuesta'],
  ['es', 'Por este te hablé yo que me hablastes'],
  ['es', 'Y me dijistes esto'],
  // FR slug в ES-сообщении
  ['es', 'Hola, estoy interesado en Parking à vendre 317 https://housetenerife.eu/es/property/parking-a-vendre-317-2/'],
  // DE ü ≠ ES
  ['de', 'Ich würde es gerne für ein Investment nutzen.'],
  // ES ó ≠ PL (inversión)
  ['es', 'Busco inversión en Tenerife, presupuesto 400000 euros'],
  ['es', '¿Cuánto cuesta la inversión?'],
  // PL с ó
  ['pl', 'Szukam mieszkania, budżet około 350 tysięcy'],
  // топонимы / суммы не должны «красть» язык
  ['en', 'Puerto de la Cruz'],
  ['en', '350k'],
  ['en', 'https://housetenerife.eu/es/property/en-venta-un-bar-en-los-cristianos-748/'],
  // чистый FR vs ES
  ['fr', 'Bonjour, je cherche un appartement à Adeje pour investir'],
  ['es', 'Hola, busco un apartamento en Adeje para invertir'],
];

function simulateSticky(messages) {
  let sticky = null;
  const out = [];
  for (const m of messages) {
    const fromText = detectLanguageFromText(m);
    let used = fromText;
    if (sticky) {
      if (isAmbiguousShortReply(m)) {
        used = sticky;
      } else if (fromText !== sticky) {
        if (isStrongLanguageSignal(m, fromText)) sticky = fromText;
        used = sticky;
      } else {
        sticky = fromText;
      }
    } else if (!isAmbiguousShortReply(m)) {
      sticky = fromText;
      used = sticky;
    }
    out.push({ text: m, det: fromText, used });
  }
  return out;
}

function main() {
  console.log('\n🌐 Language detect regression\n');
  console.log(`Поддерживаемые: ${SUPPORTED_DETECT.map((c) => `${c}(${getLanguageName(c)})`).join(', ')}\n`);

  console.log('1) Канонические фразы по языкам');
  for (const code of SUPPORTED_DETECT) {
    const samples = CANONICAL[code];
    if (!samples?.length) {
      check(`есть канон для ${code}`, false, 'нет тестовых фраз');
      continue;
    }
    for (const text of samples) {
      expectLang(code, text);
    }
  }

  console.log('\n2) Путаницы / регрессии из продакшена');
  for (const [exp, text] of CONFUSION) {
    expectLang(exp, text);
  }

  console.log('\n3) Sticky: испанский тред со скриншота (не залипать на FR)');
  const esThread = [
    'Buenos días podemos hablar por aquí ?',
    '.',
    'Yo lo del parking',
    'Alquilarlo yo ya te pasé mi propuesta',
    'Hola, estoy interesado/a en [Parking à vendre 317] https://housetenerife.eu/es/property/parking-a-vendre-317-2/',
    'Por este te hablé yo que me hablastes',
    'Y me dijistes esto',
    'Yo ya te dije mi propuesta',
  ];
  const stickyEs = simulateSticky(esThread);
  for (const row of stickyEs) {
    check(
      `sticky ES «${row.text.slice(0, 40)}…» → ${row.used}`,
      row.used === 'es',
      `det=${row.det} used=${row.used}`
    );
  }

  console.log('\n4) Sticky: немецкий не уходит в ES');
  const deThread = [
    'Hallo, ich suche eine Wohnung',
    'Ich würde es gerne für ein Investment nutzen.',
    'Budget 350000 Euro bitte',
  ];
  const stickyDe = simulateSticky(deThread);
  for (const row of stickyDe) {
    check(`sticky DE «${row.text.slice(0, 40)}» → ${row.used}`, row.used === 'de', `det=${row.det}`);
  }

  console.log('\n5) URL / каталожный шум');
  const noisy =
    'Hola, estoy interesado/a en [Parking à vendre 317] https://housetenerife.eu/es/property/parking-a-vendre-317-2/';
  const prepared = prepareDetectBody(noisy);
  check('prepareDetectBody убирает à vendre', !/à\s+vendre/i.test(prepared) && /Hola|interesado/i.test(prepared));
  check(
    'URL-only → ambiguous',
    isUrlOnlyMessage('https://housetenerife.eu/es/property/foo-123/')
  );
  check(
    'ES с é — strong для es, не для fr',
    isStrongLanguageSignal('Alquilarlo yo ya te pasé mi propuesta', 'es') === true &&
      isStrongLanguageSignal('Alquilarlo yo ya te pasé mi propuesta', 'fr') === false
  );
  check(
    'FR bonjour — strong fr',
    isStrongLanguageSignal('Bonjour, je cherche un appartement à Adeje', 'fr')
  );

  console.log('\n────────────────────────────');
  console.log(`Итого: ${pass} PASS / ${fail} FAIL`);
  if (fails.length) {
    console.log('\nПровалы:');
    fails.forEach((f) => console.log('  -', f));
  }
  console.log('');
  process.exit(fail ? 1 : 0);
}

main();
