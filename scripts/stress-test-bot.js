/**
 * Живой стресс-тест бота через askAI (без WhatsApp).
 *   node scripts/stress-test-bot.js
 *   node scripts/stress-test-bot.js --quick
 *
 * Нужен AI_API_KEY в .env. Пишет отчёт в data/stress-test-report.json
 */
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { askAI } = require('../ai-service');
const { detectLanguageFromText, getLanguageName } = require('../language-detector');
const { load } = require('../property-catalog');
const { AI_MODEL } = require('../ai-client');

const QUICK = process.argv.includes('--quick');
const OUT = path.join(__dirname, '..', 'data', 'stress-test-report.json');

function pickPropertyUrls() {
  const items = load().items || [];
  const withEs = items.find((i) => i.urls?.es) || items[0];
  const withDe = items.find((i) => i.urls?.de) || withEs;
  const withRu = items.find((i) => i.urls?.ru || /\/ru\//.test(i.url || '')) || withEs;
  const bar =
    items.find((i) => /bar|negocio|business/i.test(JSON.stringify(i.titles || i.title || ''))) ||
    items.find((i) => String(i.id).includes('748')) ||
    withEs;
  return {
    es: withEs?.urls?.es || withEs?.url,
    de: withDe?.urls?.de || withDe?.urls?.es || withDe?.url,
    ru: withRu?.urls?.ru || withRu?.url,
    bar: bar?.urls?.es || bar?.url,
    id: withEs?.id || 'HZ???',
    barId: bar?.id || 'HZ???',
  };
}

function hasCyrillic(s) {
  return /[а-яё]/i.test(s);
}
function hasGerman(s) {
  return /[äöüß]/i.test(s) || /\b(ich|sie|wir|und|für|bitte|danke|wohnung|immobilie)\b/i.test(s);
}
function hasSpanish(s) {
  return /[ñ¿¡]/i.test(s) || /\b(hola|gracias|presupuesto|inmueble|propiedad|quiero|busco)\b/i.test(s);
}
function hasPolish(s) {
  return /[ąćęłńóśźż]/i.test(s) || /\b(cześć|szukam|mieszkanie|budżet|inwestycja)\b/i.test(s);
}
function hasFrench(s) {
  return /[àâçéèêëîïôùûœ]/i.test(s) || /\b(bonjour|merci|appartement|budget|chercher)\b/i.test(s);
}
function hasDutch(s) {
  return /\b(hallo|goedemorgen|appartement|woning|budget|investering|graag)\b/i.test(s);
}
function countPropertyLinks(s) {
  const m = String(s || '').match(/housetenerife\.eu[^\s)]+/gi);
  return m ? m.length : 0;
}

function langLooksOk(reply, expected) {
  const r = String(reply || '');
  const detected = detectLanguageFromText(r.slice(0, 400));
  if (expected === 'ru') return hasCyrillic(r) && !/\b(hola|hello|bonjour)\b/i.test(r.slice(0, 80));
  if (expected === 'de') return hasGerman(r) && !hasCyrillic(r);
  if (expected === 'es') return (hasSpanish(r) || detected === 'es') && !hasCyrillic(r);
  if (expected === 'pl') return (hasPolish(r) || detected === 'pl') && !hasCyrillic(r);
  if (expected === 'fr') return (hasFrench(r) || detected === 'fr') && !hasCyrillic(r);
  if (expected === 'nl') return (hasDutch(r) || detected === 'nl') && !hasCyrillic(r);
  if (expected === 'en') return !hasCyrillic(r) && (detected === 'en' || /^[a-z0-9\s.,!?'"€$%-]/i.test(r.slice(0, 40)));
  return detected === expected;
}

async function runTurn(history, userText, lang, chatId) {
  history.push({ sender: 'user', text: userText });
  const reply = await askAI(history, lang, { chatId });
  history.push({ sender: 'assistant', text: reply });
  return reply;
}

function makeScenarios(urls) {
  const all = [
    {
      id: 'lang-de-umlaut',
      title: 'DE: umlaut + investment (бывший баг → ES)',
      lang: 'de',
      turns: [
        'Ich würde es gerne für ein Investment nutzen. Eventuell für Airbnb.',
      ],
      expect: { lang: 'de', noLinks: true },
    },
    {
      id: 'lang-es-spanish',
      title: 'ES: обычный интерес',
      lang: 'es',
      turns: ['Hola, busco un apartamento en Adeje para vivir, presupuesto 350000 euros'],
      expect: { lang: 'es' },
    },
    {
      id: 'lang-pl',
      title: 'PL: поиск квартиры',
      lang: 'pl',
      turns: ['Cześć, szukam mieszkania na Teneryfie, budżet około 350000 euro'],
      expect: { lang: 'pl' },
    },
    {
      id: 'lang-fr',
      title: 'FR: поиск',
      lang: 'fr',
      turns: ['Bonjour, je cherche un appartement à Adeje pour vivre, budget 350000 euros'],
      expect: { lang: 'fr' },
    },
    {
      id: 'lang-nl',
      title: 'NL: поиск',
      lang: 'nl',
      turns: ['Goedemorgen, ik zoek een appartement in Adeje, budget 350000 euro'],
      expect: { lang: 'nl' },
    },
    {
      id: 'lang-ru',
      title: 'RU: классика воронки',
      lang: 'ru',
      turns: ['Здравствуйте, ищу апартаменты в Costa Adeje для жизни, бюджет до 400000'],
      expect: { lang: 'ru' },
    },
    {
      id: 'lang-en',
      title: 'EN: investment',
      lang: 'en',
      turns: ['Hi, looking for an investment property in Tenerife, budget around 500000 euros'],
      expect: { lang: 'en' },
    },
    {
      id: 'link-es-known',
      title: 'Ссылка ES из каталога — должен описать объект',
      lang: 'es',
      turns: [
        `Me interesa este objeto: ${urls.es}`,
      ],
      expect: { lang: 'es', mentionsProperty: true },
    },
    {
      id: 'link-de-after-german',
      title: 'DE пишет + кидает ссылку',
      lang: 'de',
      turns: [
        'Hallo, ich interessiere mich für dieses Objekt.',
        urls.de || urls.es,
      ],
      expect: { lang: 'de', mentionsProperty: true },
    },
    {
      id: 'link-then-switch-lang',
      title: 'Ссылка (нейтрально) → затем немецкий текст',
      lang: 'de',
      turns: [
        urls.es,
        'Ich würde es gerne für ein Investment nutzen. Schöne Grüße.',
      ],
      expect: { lang: 'de' },
    },
    {
      id: 'offtopic-hi',
      title: 'Оффтоп: приветствие без темы',
      lang: 'ru',
      turns: ['Привет, как дела?'],
      expect: { lang: 'ru', noLinks: true, noVillaDump: true },
    },
    {
      id: 'offtopic-es',
      title: 'Оффтоп ES: ¿qué tal?',
      lang: 'es',
      turns: ['Hola, ¿qué tal?'],
      expect: { lang: 'es', noLinks: true, noVillaDump: true },
    },
    {
      id: 'confused-user',
      title: 'Клиент не понял ответ',
      lang: 'es',
      turns: [
        'Busco un bar en Los Cristianos',
        'No entiendo lo que escribiste.',
        '????',
      ],
      expect: { lang: 'es', noLinks: true },
    },
    {
      id: 'budget-only',
      title: 'Только сумма бюджета',
      lang: 'en',
      turns: [
        'Looking for apartment in Adeje to live',
        '350000 euros',
      ],
      expect: { lang: 'en' },
    },
    {
      id: 'place-name-only',
      title: 'Только топоним Puerto de la Cruz',
      lang: 'en',
      turns: [
        'I want property for living',
        'Puerto de la Cruz',
      ],
      expect: { lang: 'en' },
    },
    {
      id: 'mortgage-question',
      title: 'Вопрос про ипотеку',
      lang: 'es',
      turns: [
        'Quiero comprar un apartamento en Adeje para vivir, presupuesto 400000',
        '¿Puedo pedir hipoteca siendo extranjero?',
      ],
      expect: { lang: 'es' },
    },
    {
      id: 'investment-airbnb',
      title: 'Инвестиции + Airbnb DE',
      lang: 'de',
      turns: [
        'Hallo, ich suche eine Immobilie als Investment.',
        'Budget etwa 450000 Euro.',
        'Am besten etwas für Airbnb geeignet.',
      ],
      expect: { lang: 'de' },
    },
    {
      id: 'multi-turn-funnel-ru',
      title: 'Полная воронка RU (цель→бюджет)',
      lang: 'ru',
      turns: [
        'Хочу купить недвижимость',
        'Для жизни',
        'Тенерифе, Costa Adeje',
        'Апартаменты',
        'Бюджет до 350000 евро',
      ],
      expect: { lang: 'ru' },
    },
    {
      id: 'unexpected-emoji',
      title: 'Только эмодзи / ок',
      lang: 'ru',
      turns: [
        'Ищу виллу на Ибице для инвестиций, бюджет 2 млн',
        '👍',
        'ок',
      ],
      expect: { lang: 'ru' },
    },
    {
      id: 'mixed-spam',
      title: 'Неожиданное: политика / оффтоп',
      lang: 'en',
      turns: ['What do you think about the elections?'],
      expect: { lang: 'en', noLinks: true, stayRealEstate: true },
    },
    {
      id: 'hz-id-bare',
      title: 'Голый ID объекта HZ',
      lang: 'es',
      turns: [`Interesado en ${urls.id}`],
      expect: { lang: 'es', mentionsProperty: true },
    },
    {
      id: 'bar-business',
      title: 'Бизнес/бар по ссылке',
      lang: 'es',
      turns: [
        `Quiero ver este negocio: ${urls.bar}`,
        'Sí, ya tengo dinero. No necesito hipoteca. ¿Pueden confirmar visita a las 18:00?',
      ],
      expect: { lang: 'es' },
    },
  ];

  if (QUICK) {
    return all.filter((s) =>
      [
        'lang-de-umlaut',
        'lang-es-spanish',
        'lang-pl',
        'link-es-known',
        'offtopic-hi',
        'confused-user',
        'bar-business',
      ].includes(s.id)
    );
  }
  return all;
}

function evaluate(scenario, lastReply, allReplies) {
  const issues = [];
  const expect = scenario.expect || {};
  const reply = String(lastReply || '');
  const blob = allReplies.join('\n');

  if (expect.lang && !langLooksOk(reply, expect.lang)) {
    const det = detectLanguageFromText(reply.slice(0, 400));
    issues.push(`язык: ожидали ${expect.lang}, детект ответа≈${det}`);
  }
  if (expect.noLinks && countPropertyLinks(blob) > 0) {
    issues.push(`лишние ссылки на объекты (${countPropertyLinks(blob)})`);
  }
  if (expect.noVillaDump && /villa|вилл/i.test(blob) && countPropertyLinks(blob) > 0) {
    issues.push('дамп вилл на оффтопе');
  }
  if (expect.mentionsProperty) {
    const ok =
      countPropertyLinks(reply) > 0 ||
      /\bHZ\d+\b/i.test(reply) ||
      /€|EUR|евро|euro|precio|preis|price|цена/i.test(reply);
    if (!ok) issues.push('не видно описания/цены/ссылки объекта');
  }
  if (expect.stayRealEstate) {
    if (/election|trump|putin|политик/i.test(reply) && !/inmueble|property|real estate|недвижим|investimento|immobilie/i.test(reply)) {
      issues.push('ушёл в политику без возврата к недвижимости');
    }
  }
  if (!reply.trim()) issues.push('пустой ответ');
  if (/AI_API_KEY|не настроен|not configured/i.test(reply)) issues.push('ИИ не настроен');

  return issues;
}

async function main() {
  if (!process.env.AI_API_KEY?.trim()) {
    console.error('Нужен AI_API_KEY в .env');
    process.exit(1);
  }

  const urls = pickPropertyUrls();
  const scenarios = makeScenarios(urls);
  console.log(`\n🧪 Stress-test bot`);
  console.log(`   model: ${process.env.AI_MODEL || AI_MODEL}`);
  console.log(`   scenarios: ${scenarios.length}${QUICK ? ' (quick)' : ''}`);
  console.log(`   sample URLs: ${urls.es}`);
  console.log(`   bar URL: ${urls.bar} (${urls.barId})\n`);

  const results = [];
  let pass = 0;
  let fail = 0;

  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    const chatId = `stress-${sc.id}-${Date.now()}@c.us`;
    const history = [];
    const replies = [];
    process.stdout.write(`[${i + 1}/${scenarios.length}] ${sc.id} … `);

    try {
      // язык как у бота: детект по последнему сильному тексту
      let lang = sc.lang;
      for (const turn of sc.turns) {
        const detected = detectLanguageFromText(turn);
        if (turn.length > 12 && !/^https?:\/\//i.test(turn.trim())) {
          lang = detected || lang;
        }
        const reply = await runTurn(history, turn, lang, chatId);
        replies.push(reply);
      }
      const issues = evaluate(sc, replies[replies.length - 1], replies);
      const ok = issues.length === 0;
      if (ok) {
        pass++;
        console.log('PASS');
      } else {
        fail++;
        console.log('FAIL →', issues.join('; '));
      }
      results.push({
        id: sc.id,
        title: sc.title,
        ok,
        issues,
        langUsed: lang,
        langName: getLanguageName(lang),
        turns: sc.turns,
        replies: replies.map((r) => String(r).slice(0, 600)),
        linkCount: countPropertyLinks(replies.join('\n')),
      });
    } catch (e) {
      fail++;
      console.log('ERROR', e.message);
      results.push({
        id: sc.id,
        title: sc.title,
        ok: false,
        issues: [e.message],
        error: e.message,
      });
    }

    // пауза против 429
    await new Promise((r) => setTimeout(r, 800));
  }

  const report = {
    at: new Date().toISOString(),
    model: process.env.AI_MODEL || AI_MODEL,
    quick: QUICK,
    pass,
    fail,
    total: scenarios.length,
    urls,
    results,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');

  console.log(`\n────────────────────────────`);
  console.log(`Итого: ${pass} PASS / ${fail} FAIL из ${scenarios.length}`);
  console.log(`Отчёт: ${OUT}`);
  if (fail) {
    console.log('\nПровалы:');
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  • ${r.id}: ${(r.issues || []).join('; ')}`);
      if (r.replies?.[r.replies.length - 1]) {
        console.log(`    ↳ ${String(r.replies[r.replies.length - 1]).slice(0, 160).replace(/\n/g, ' ')}`);
      }
    }
  }
  process.exit(fail ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
