/**
 * Офлайн-тесты QA-фиксов вебчата (без AI-ключей и без сети):
 *   1) проданные / зарезервированные объекты не рекомендуются
 *   2) тип / бюджет (k/m/Mio/tys.) / «вид на море» / заголовок подборки
 *   3) вопрос «Do you speak English?»
 *   4) язык ответа следует за последним сообщением клиента (страница ru, клиент en/de)
 *   5) внутренние токены не утекают в ответ вебчата
 *
 *   npm run test:qa
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// Временный каталог — ДО require модулей каталога
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ht-qa-'));
process.env.PROPERTIES_PATH = path.join(TMP, 'properties.json');
process.env.PROPERTY_LIVE_STATUS_CHECK = '0'; // тесты не ходят в сеть
delete process.env.CATALOG_EXCLUDE_IDS;
delete process.env.AI_API_KEY;

let pass = 0;
let fail = 0;
function ok(cond, name, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}
function section(t) {
  console.log(`\n${t}`);
}

const FIX = path.join(__dirname, 'fixtures');
const readFix = (n) => fs.readFileSync(path.join(FIX, n), 'utf8');

// ---------------------------------------------------------------------------
// Каталог-фикстура
// ---------------------------------------------------------------------------
const NOW = new Date().toISOString();
function mk(id, slug, title, price, type, extra = {}) {
  const url = `https://housetenerife.eu/property/${slug}/`;
  return {
    id,
    url,
    title,
    price: `€${price.toLocaleString('en-US')}`,
    overview: `Property type | ${type} | 3 | Bedroom | 2 | Bathroom | 200 | Area Size`,
    description: extra.description || `${title}. Costa Adeje, Tenerife.`,
    urls: { en: url, ru: url.replace('housetenerife.eu/', 'housetenerife.eu/ru/') },
    titles: { en: title, ru: title },
    descriptions: { en: extra.description || `${title}. Costa Adeje, Tenerife.` },
    overviews: { en: `Property type | ${type} | 3 | Bedroom | 2 | Bathroom | 200 | Area Size` },
    statusCheckedAt: NOW,
    ...extra.flags,
  };
}
const SOLD_VILLA = mk('HZ9001', 'sold-villa-costa-adeje-9001', 'Sold Villa in Costa Adeje 9001', 790000, 'Villas', {
  flags: { availability: 'sold', sold: true, statusLabels: ['Sold'], statusSlugs: ['sold'] },
});
const OK_VILLA = mk('HZ9002', 'villa-in-costa-adeje-9002', 'Villa in Costa Adeje 9002', 780000, 'Villas');
const OK_VILLA_SEA = mk('HZ9003', 'villa-ocean-views-costa-adeje-9003', 'Villa with ocean views in Costa Adeje 9003', 760000, 'Villas', {
  description: 'Villa with sea views and pool in Costa Adeje, Tenerife.',
});
const OK_HOUSE = mk('HZ9004', 'independent-house-costa-adeje-9004', 'Independent House With Ocean Views in Costa Adeje', 565000, 'Houses');
const BIZ = mk('HZ9005', 'business-for-sale-costa-adeje-9005', 'Restaurant business in Costa Adeje', 300000, 'Business for sale');
const LAND = mk('HZ9006', 'land-plot-costa-adeje-9006', 'Land plot in Costa Adeje', 250000, 'Land');
const SOLD_ONLY_ES = mk('HZ9007', 'only-sold-villa-adeje-9007', 'Villa in Adeje 9007', 700000, 'Villas', {
  flags: { statusLabels: ['Vendido'], statusSlugs: [] }, // статус только в метке (без флага sold)
});

fs.writeFileSync(
  process.env.PROPERTIES_PATH,
  JSON.stringify({ syncedAt: NOW, count: 7, items: [SOLD_VILLA, OK_VILLA, OK_VILLA_SEA, OK_HOUSE, BIZ, LAND, SOLD_ONLY_ES] }, null, 2)
);

const R = (m) => require(path.join(__dirname, '..', m));

(async () => {
  // =========================================================================
  section('1) Статус «Продано» — парсер HTML (sync / live-fetch)');
  const S = R('property-status');
  {
    const ru = S.extractStatusFromHtml(readFix('property-sold-ru.html'));
    ok(ru.availability === 'sold' && ru.sold === true, 'RU «Продано» → sold', JSON.stringify(ru));
    ok(ru.slugs.includes('prodano'), 'slug таксономии status = prodano');
    ok(ru.labels.includes('Продано'), 'метка «Продано» сохранена');
    const en = S.extractStatusFromHtml(readFix('property-available-en.html'));
    ok(en.availability === 'available' && en.sold === false, 'Available + Sold у соседних карточек Similar → available', JSON.stringify(en));
    ok(en.slugs.includes('for-sale') && !en.slugs.includes('sold'), 'бейджи Similar Listings игнорируются');
    const es = S.extractStatusFromHtml(readFix('property-reserved-es.html'));
    ok(es.availability === 'reserved' && es.sold === true, 'ES «Reservado» → reserved (тоже не рекомендуем)', JSON.stringify(es));
  }
  {
    const wrap = (label, slug) =>
      `<div class="property-labels-wrap"><a href="https://housetenerife.eu/${slug}" class="label-status label">${label}</a></div>`;
    const labels = [
      ['ПРОДАНО', 'ru/status/prodano/'],
      ['Sold', 'status/sold/'],
      ['Vendido', 'es/status/vendido/'],
      ['Verkauft', 'de/status/verkauft/'],
      ['Vendu', 'fr/status/vendu/'],
      ['Sprzedane', 'pl/status/sprzedane/'],
      ['Prodáno', 'cs/status/prodano/'],
      ['Verkocht', 'nl/status/verkocht/'],
      ['Sold', 'status/for-sold/'],
    ];
    for (const [label, slug] of labels) {
      const r = S.extractStatusFromHtml(wrap(label, slug));
      ok(r.sold, `метка «${label}» (/${slug}) → sold`);
    }
    // только slug, без текста
    ok(S.extractStatusFromHtml(`<a href="/ru/status/prodano/" class="label-status"></a>`).sold, 'только ссылка /status/prodano/ → sold');
    // только текст, без ссылки
    ok(S.extractStatusFromHtml(`<span class="label-status">SOLD</span>`).sold, 'только текст бейджа SOLD → sold');
    ok(!S.extractStatusFromHtml(wrap('For Sale', 'status/for-sale/')).sold, 'For Sale → не sold');
    ok(!S.extractStatusFromHtml(wrap('Se vende', 'es/status/en-venta/')).sold, 'ES «Se vende» → не sold');
  }

  section('1b) isListingAvailable / каталог');
  ok(!S.isListingAvailable(SOLD_VILLA), 'флаг availability=sold → недоступен');
  ok(!S.isListingAvailable({ id: 'X', statusLabels: ['Продано'] }), 'только statusLabels → недоступен');
  ok(!S.isListingAvailable({ id: 'X', statusSlugs: ['prodano'] }), 'только statusSlugs → недоступен');
  ok(!S.isListingAvailable({ id: 'X', title: 'SOLD - Villa Adeje' }), 'заголовок «SOLD - …» → недоступен');
  ok(S.isListingAvailable({ id: 'X', title: 'Villa sold fully furnished' }), '«sold fully furnished» в описании ≠ продано');
  ok(S.isListingAvailable(OK_VILLA), 'обычный объект доступен');
  {
    process.env.CATALOG_EXCLUDE_IDS = 'HZ9002';
    ok(!S.isListingAvailable(OK_VILLA), 'CATALOG_EXCLUDE_IDS исключает вручную');
    delete process.env.CATALOG_EXCLUDE_IDS;
  }

  section('1b2) sync-db / sync-status записывают флаг статуса');
  {
    const sync = R('scripts/sync-properties.js');
    const ruHtml = readFix('property-sold-ru.html');
    const parsed = sync.parseProperty(ruHtml, 'https://housetenerife.eu/ru/property/udobnaya-kvartira-v-kosta-adehe-1276/');
    const item = sync.buildMultilingualItem(parsed, ruHtml, {}, {});
    ok(item.sold === true && item.availability === 'sold', 'sync-properties: item.sold=true для «Продано»', JSON.stringify({ s: item.sold, a: item.availability }));
    ok(item.statusSlugs.includes('prodano') && !!item.statusCheckedAt, 'sync-properties: statusSlugs/statusCheckedAt записаны');
    const avail = sync.buildMultilingualItem(
      sync.parseProperty(readFix('property-available-en.html'), 'https://housetenerife.eu/property/villa-for-sale-in-roque-del-conde/'),
      readFix('property-available-en.html'),
      { es: sync.parseProperty(readFix('property-reserved-es.html'), 'https://housetenerife.eu/es/property/villa-en-adeje/') },
      {}
    );
    ok(avail.availability === 'reserved' && avail.sold === true, 'sync: худший статус из языковых страниц (EN available + ES reserved → reserved)');
    ok(!S.isListingAvailable(item), 'запись из sync сразу исключается из рекомендаций');

    const { refreshStatuses } = R('scripts/sync-status.js');
    const items = [
      { id: 'A', url: 'https://housetenerife.eu/ru/property/a/', urls: { ru: 'https://housetenerife.eu/ru/property/a/' } },
      { id: 'B', url: 'https://housetenerife.eu/ru/property/b/', urls: { ru: 'https://housetenerife.eu/ru/property/b/' } },
    ];
    const rep = await refreshStatuses(items, {
      delayMs: 0,
      fetchHtmlFn: async (u) => (/\/a\/$/.test(u) ? readFix('property-sold-ru.html') : readFix('property-available-en.html')),
    });
    ok(items[0].sold === true && items[1].sold === false, 'sync-status: A sold, B available');
    ok(rep.sold.length === 1 && rep.checked === 2, 'sync-status: отчёт', JSON.stringify(rep));
    const items2 = [{ id: 'C', url: 'https://housetenerife.eu/ru/property/c/', sold: true, availability: 'sold' }];
    await refreshStatuses(items2, { delayMs: 0, fetchHtmlFn: async () => { throw new Error('net'); } });
    ok(items2[0].availability === 'sold', 'sync-status: при ошибке сети прежний флаг не затирается');
  }

  section('1c) Поиск / подборки не содержат проданного');
  const catalog = R('property-catalog');
  const D = R('dialog-context');
  const dlg = D.analyzeConversation(
    [{ sender: 'user', text: 'Hello, I want a villa with sea view in Costa Adeje, budget 800k.' }],
    'en'
  );
  const baseOpts = {
    minPrice: dlg.budget.minPrice,
    maxPrice: dlg.budget.maxPrice,
    priceTarget: D.derivePriceTarget(dlg.budget),
    propertyTypes: dlg.propertyTypes,
    macroRegions: dlg.macroRegions,
    microAreaGroupIds: dlg.microAreaGroupIds,
    microDetection: dlg.microAreas,
    lang: 'en',
    contextText: dlg.allUserText,
    allowBudgetFallback: true,
    allowTypeFamilyFallback: true,
  };
  const res = catalog.searchForContext(dlg.allUserText, 18, baseOpts);
  ok(res.found, 'поиск нашёл объекты');
  ok(!res.urls.some((u) => /sold-villa-costa-adeje-9001|only-sold-villa-adeje-9007/.test(u)), 'sold-вилла не в результатах поиска', res.urls.join(' | '));
  ok(res.urls.some((u) => /villa-in-costa-adeje-9002|villa-ocean-views-costa-adeje-9003/.test(u)), 'доступные виллы в результатах');
  ok(!/Sold Villa/i.test(res.text), 'текст подборки не содержит sold-объект');
  ok(res.totalInDb === 5, 'totalInDb = только доступные объекты', String(res.totalInDb));

  // «Похожие»: без типа/региона и с широкими fallback — sold всё равно не просачивается
  for (const [name, o] of [
    ['без фильтров', { lang: 'en', allowBudgetFallback: true, allowTypeFamilyFallback: true }],
    ['только бюджет', { lang: 'en', maxPrice: 800000, allowBudgetFallback: true }],
    ['тип villas + last-resort', { lang: 'en', propertyTypes: ['villas'], allowTypeFamilyFallback: true, allowBudgetFallback: true }],
  ]) {
    const r = catalog.searchForContext('villa costa adeje', 25, o);
    ok(!r.urls.some((u) => /sold-villa|only-sold-villa/.test(u)), `similar/fallback «${name}» без sold`, r.urls.join(' | '));
  }

  section('1d) buildDeterministicListingsReply — sold / типы в заголовке');
  const AI = R('ai-service');
  {
    const urls = [SOLD_VILLA, OK_VILLA, OK_HOUSE, BIZ, LAND, SOLD_ONLY_ES].map((i) => i.urls.en);
    const reply = AI.buildDeterministicListingsReply(urls, 'en', dlg, [], {});
    ok(!/sold-villa-costa-adeje-9001|only-sold-villa-adeje-9007/.test(reply), 'детерминированный ответ пропускает sold');
    ok(/villa-in-costa-adeje-9002/.test(reply), 'доступная вилла показана');
    ok(!/business/i.test(reply.split('\n')[0]) && !/land/i.test(reply.split('\n')[0]), 'в заголовке нет business / land для запроса виллы', reply.split('\n').slice(0, 3).join(' / '));
    ok(!/business-for-sale|land-plot/.test(reply), 'бизнес и земля не подмешаны к вилле');
    const iVilla = reply.indexOf('villa-in-costa-adeje-9002');
    const iHouse = reply.indexOf('independent-house-costa-adeje-9004');
    ok(iVilla !== -1 && (iHouse === -1 || iVilla < iHouse), 'точный тип (вилла) выше таунхауса/дома');
  }
  {
    // Виллы нет вообще → ближайшие дома; заголовок только про показанные типы
    const urls = [OK_HOUSE, BIZ, LAND].map((i) => i.urls.en);
    const reply = AI.buildDeterministicListingsReply(urls, 'en', dlg, [], { usedLastResortTypeFallback: true });
    const head = reply.split('\n\n').slice(0, 2).join(' ');
    ok(/houses/i.test(head) && !/business/i.test(head) && !/land \/ plots/i.test(head), 'заголовок = только реально показанные типы (дома)', head);
    ok(!/business-for-sale|land-plot/.test(reply), 'запрос жилья не получает business/land даже в последнем fallback');
    ok(/no exact-type|nearest residential/i.test(reply), 'честная пометка «точного типа нет»');
  }
  {
    // Если показана точная вилла — предупреждения «нет точного типа» быть не должно
    const reply = AI.buildDeterministicListingsReply([OK_VILLA.urls.en, OK_HOUSE.urls.en], 'en', dlg, [], { usedLastResortTypeFallback: true });
    ok(!/no exact-type/i.test(reply), 'есть точная вилла → без ложного «no exact-type»');
  }

  section('1e) Live-проверка статуса (кэш, fail-open)');
  const LF = R('property-live-fetch');
  {
    LF.clearStatusCache();
    S.clearRuntimeAvailability();
    let calls = 0;
    const stale = mk('HZ9100', 'stale-villa-9100', 'Stale Villa 9100', 500000, 'Villas', { flags: { statusCheckedAt: '2020-01-01T00:00:00Z' } });
    const url = stale.urls.en;
    const fetchHtmlFn = async () => {
      calls++;
      return readFix('property-sold-ru.html');
    };
    const r1 = await LF.verifyListingUrlsAvailable([url, url], { fetchHtmlFn });
    ok(r1.blocked.length === 1 && r1.blocked[0].availability === 'sold', 'live-check ловит «Продано» на старой записи', JSON.stringify(r1));
    const r2 = await LF.verifyListingUrlsAvailable([url], { fetchHtmlFn });
    ok(calls === 1, 'повторная проверка — из кэша (1 HTTP-запрос)', `calls=${calls}`);
    ok(r2.blocked.length === 1, 'кэш хранит sold');
    ok(!S.isListingAvailable(stale), 'runtime-метка: объект исключается из поиска до рестарта');
    S.clearRuntimeAvailability();
    LF.clearStatusCache();

    const err = await LF.verifyListingUrlsAvailable([url], {
      fetchHtmlFn: async () => {
        throw new Error('ETIMEDOUT');
      },
    });
    ok(err.blocked.length === 0 && err.ok.length === 1, 'сеть недоступна → fail-open (не блокируем ответ)');
    LF.clearStatusCache();

    const fresh = await LF.verifyListingUrlsAvailable([OK_VILLA.urls.en], {
      fetchHtmlFn: async () => {
        throw new Error('не должно вызываться');
      },
    });
    ok(fresh.ok.length === 1, 'свежий statusCheckedAt в каталоге → запрос не нужен');
    const known = await LF.verifyListingUrlsAvailable([SOLD_VILLA.urls.en], {
      fetchHtmlFn: async () => {
        throw new Error('не должно вызываться');
      },
    });
    ok(known.blocked.length === 1, 'известный sold блокируется без запроса');
  }
  {
    const { guardUnavailableListings } = AI;
    const reply = `Here are options:\n\n• *Sold Villa* — €790,000\n${SOLD_VILLA.urls.en}\n\n• *Villa* — €780,000\n${OK_VILLA.urls.en}\n\nWhich one?`;
    const cleaned = await guardUnavailableListings(reply, { lastUserText: 'villa 800k', userLanguage: 'en' });
    ok(!cleaned.includes('sold-villa-costa-adeje-9001') && cleaned.includes('villa-in-costa-adeje-9002'), 'guard вырезает карточку sold, остальные остаются');
    const kept = await guardUnavailableListings(`This one is sold: ${SOLD_VILLA.urls.en}`, {
      lastUserText: `what about ${SOLD_VILLA.urls.en}`,
      userLanguage: 'en',
    });
    ok(kept.includes('sold-villa-costa-adeje-9001'), 'ссылка, присланная самим клиентом, не вырезается (можно объяснить, что продано)');
  }

  // =========================================================================
  section('2) Тип / бюджет / море');
  {
    const cases = [
      ['budget 800k', 800000],
      ['бюджет 800к', 800000],
      ['бюджет 800 тыс. евро', 800000],
      ['бюджет 0,8 млн', 800000],
      ['budget 1.2m', 1200000],
      ['budget 1.5M', 1500000],
      ['presupuesto 800 mil euros', 800000],
      ['presupuesto 1,2 millones', 1200000],
      ['Budget 800 Tsd', 800000],
      ['Budget bis 1,5 Mio €', 1500000],
      ['Budget 2 Mio.', 2000000],
      ['budżet 800 tys.', 800000],
      ['budget 800 mille euros', 800000],
      ['rozpočet 800 tisíc', 800000],
      ['villa 250 m2, 4 bedrooms', null],
      ['100 m from the sea', null],
    ];
    for (const [text, want] of cases) {
      const b = D.extractBudgetRange(text);
      ok(b.maxPrice === want, `«${text}» → ${want ?? 'нет бюджета'}`, JSON.stringify(b));
    }
    const full = D.analyzeConversation(
      [{ sender: 'user', text: 'Hello, I want a villa with sea view in Costa Adeje, budget 800k. Do you speak English?' }],
      'en'
    );
    ok(full.propertyTypes.length === 1 && full.propertyTypes[0] === 'villas', 'тип = villas (не business/land)', JSON.stringify(full.propertyTypes));
    ok(full.budget.maxPrice === 800000, 'бюджет 800k распознан в полном сообщении');
    ok(full.microAreaGroupIds.includes('costa_adeje'), 'район Costa Adeje');
  }
  {
    const F = R('property-features');
    ok(F.detectFeatureWishes('villa with sea view').includes('seaView'), 'EN sea view');
    ok(F.detectFeatureWishes('вилла с видом на море').includes('seaView'), 'RU вид на море');
    ok(F.detectFeatureWishes('Haus mit Meerblick').includes('seaView'), 'DE Meerblick');
    ok(F.detectFeatureWishes('villa con vistas al mar').includes('seaView'), 'ES vistas al mar');
    const withSea = catalog.searchForContext(dlg.allUserText, 6, { ...baseOpts });
    const first = withSea.urls[0] || '';
    ok(/ocean-views/.test(first), 'при равных условиях вилла с видом на море — первая', withSea.urls.join(' | '));
    const noSeaDlg = D.analyzeConversation([{ sender: 'user', text: 'I want a villa in Costa Adeje, budget 800k.' }], 'en');
    const noSea = catalog.searchForContext(noSeaDlg.allUserText, 6, { ...baseOpts, contextText: noSeaDlg.allUserText });
    ok(noSea.found, 'без «sea view» поиск тоже работает');
  }

  // =========================================================================
  section('3) Вопрос «Do you speak English?»');
  const LQ = R('language-question');
  {
    const q = LQ.detectLanguageQuestion('Hello, I want a villa with sea view in Costa Adeje, budget 800k. Do you speak English?');
    ok(q.asked && q.askedLangs.includes('en') && !q.only, 'смешанное сообщение: вопрос про язык + запрос');
    ok(!/speak/i.test(q.rest) && /villa/i.test(q.rest) && /800k/.test(q.rest), 'rest без фразы про язык, суть сохранена', q.rest);
    const cases = [
      ['Do you speak English?', 'en', true],
      ['Sprechen Sie Deutsch?', 'de', true],
      ['Вы говорите по-английски?', 'en', true],
      ['¿Hablan español?', 'es', true],
      ['Parlez-vous français ?', 'fr', true],
      ['Mówicie po polsku?', 'pl', true],
      ['What languages do you speak?', null, true],
      ['На каких языках вы работаете?', null, true],
    ];
    for (const [text, lang, only] of cases) {
      const r = LQ.detectLanguageQuestion(text);
      ok(r.asked && r.only === only && (lang ? r.askedLangs.includes(lang) : true), `«${text}»`, JSON.stringify(r));
    }
    ok(!LQ.detectLanguageQuestion('I speak English, can you help me find a villa?').asked, '«I speak English…» — не вопрос');
    ok(!LQ.detectLanguageQuestion('villa in Costa Adeje 800k').asked, 'обычный запрос — не вопрос про язык');
    ok(!LQ.detectLanguageQuestion('Do you speak with the owners directly?').asked, '«speak with owners» — не вопрос про язык');
  }
  {
    const only = await AI.askAI([{ sender: 'user', text: 'Do you speak English?' }], 'en', { chatId: 'web:qa-test-0001_ru' });
    ok(/We speak English, German, Spanish, French, Polish, Czech and Russian/.test(only), 'EN: отвечает «да, мы говорим на …»', only);
    ok(!/housetenerife\.eu\/.*property/.test(only), 'без подборки в этом сообщении');
    const ru = await AI.askAI([{ sender: 'user', text: 'Вы говорите по-английски?' }], 'ru', {});
    ok(/английском, немецком, испанском, французском, польском, чешском и русском/.test(ru), 'RU: ответ на русском');
    const de = await AI.askAI([{ sender: 'user', text: 'Sprechen Sie Deutsch?' }], 'de', {});
    ok(/Ja, natürlich/.test(de) && /Englisch, Deutsch/.test(de), 'DE: ответ на немецком');
    const mixed = await AI.askAI(
      [{ sender: 'user', text: 'Hello, I want a villa with sea view in Costa Adeje, budget 800k. Do you speak English?' }],
      'en',
      {}
    );
    ok(/^Yes, of course/.test(mixed), 'смешанное: сначала ответ про язык', mixed.slice(0, 80));
    ok(!/property\//.test(mixed), 'смешанное: подборка не вываливается');
  }
  {
    const dump = `Here are some options (villas) in Costa Adeje:\n\n• *Villa* — €780,000\nvillas, 3 bedrooms\nhttps://housetenerife.eu/property/villa-1/\n\n• *Villa 2* — €790,000\nhttps://housetenerife.eu/property/villa-2/\n\nWhich feels closest?`;
    const stripped = LQ.stripListingDump(dump);
    ok(!/property\//.test(stripped) && !/Here are some options/.test(stripped), 'stripListingDump убирает подборку и её вводную строку', stripped);
    ok(/Which feels closest/.test(stripped), 'вопрос воронки остаётся');
  }

  // =========================================================================
  section('4) Язык ответа следует за последним сообщением (страница RU)');
  const LD = R('language-detector');
  {
    const res = (sticky, text, hist = []) =>
      LD.resolveConversationLanguage({ sticky, currentText: text, historyTexts: [...hist, text], fallback: 'ru' });
    ok(res('ru', 'Hello, I want a villa with sea view in Costa Adeje, budget 800k. Do you speak English?', ['Здравствуйте']) === 'en', 'ru-страница + английское сообщение → en');
    ok(res('ru', 'Do you speak english', ['Привет']) === 'en', '«Do you speak english» (без «?») → en, не pl');
    ok(res('ru', 'Hallo, ich suche eine Villa mit Meerblick in Costa Adeje, Budget 800k', ['Привет']) === 'de', 'ru-страница + немецкое сообщение → de');
    ok(res('ru', 'Sprechen Sie Deutsch?', ['Привет']) === 'de', '«Sprechen Sie Deutsch?» → de');
    ok(res('en', 'Hola, busco una villa en Costa Adeje', ['Hello villa']) === 'es', 'en → es по сильному сигналу');
    ok(res('ru', 'English please', ['Привет']) === 'en', '«English please» переключает с ru на en');
    ok(res('ru', 'по-немецки пожалуйста', ['Привет']) === 'de', '«по-немецки пожалуйста» → de');
    ok(res('en', '800k', ['Hello villa']) === 'en', 'короткая сумма не меняет sticky');
    ok(res('ru', 'ok', ['Привет']) === 'ru', '«ok» не переключает язык');
    ok(res('en', 'Привет, ищу виллу', ['Hello']) === 'ru', 'ответ по-русски → ru');
  }
  {
    // Полный путь index.js → resolveDialogLanguage использует тот же resolveConversationLanguage
    const rl = R('reply-language');
    ok(typeof rl.replyMismatchesLanguage === 'function', 'reply-language доступен для проверки ответа');
    ok(rl.replyMismatchesLanguage('Привет! Это вилла в Адехе за 800 тысяч евро, рассмотрим?', 'en') === true, 'русский ответ на en-диалоге помечается как неверный язык');
  }

  // =========================================================================
  section('5) Утечка внутренних токенов в вебчат');
  const G = R('reply-guards');
  {
    const leaked =
      "Hello!\n\n[Website page property — current listing]\nTitle: Villa 1276\nID: HZ1276\nPrice: €199,000\nURL: https://housetenerife.eu/property/x/\nThe client opened the website chat on THIS property page. Treat it as the selected listing unless they clearly ask for other options.\n\nHow can I help?";
    const clean = G.sanitizeWebReply(leaked, 'en');
    ok(!/Website page property|The client opened the website chat|ID: HZ1276/.test(clean), 'блок [Website page property …] вырезан', clean);
    ok(/Hello!/.test(clean) && /How can I help\?/.test(clean), 'полезный текст сохранён');
    const c2 = G.sanitizeWebReply("[Full catalog: 600 listings; search picked 5] I'm looking at this property: https://housetenerife.eu/property/x/\nSure, here you go [описание фото]\nSTATUS: SOLD — this listing is NOT available", 'en');
    ok(!/Full catalog|I'm looking at this property|описание фото|STATUS: SOLD/.test(c2), 'catalog-header / photo-tag / STATUS вырезаны', c2);
    ok(G.sanitizeWebReply('[Website page property — current listing]', 'ru').startsWith('Здравствуйте'), 'пустой после очистки → безопасное приветствие на языке клиента');
    ok(G.sanitizeWebReply('Обычный ответ без токенов.', 'ru') === 'Обычный ответ без токенов.', 'чистый ответ не меняется');
  }
  {
    // HTTP-слой вебчата: ответ процессора санитайзится
    const { registerWebchatRoutes } = R('webchat-api');
    const routes = {};
    const app = { options: (p, h) => (routes[`OPTIONS ${p}`] = h), post: (p, h) => (routes[`POST ${p}`] = h) };
    registerWebchatRoutes(app, {
      processWebMessage: async () => ({
        text: '[Website page property — current listing]\nTitle: X\nThe client opened the website chat on THIS property page. Treat it as the selected listing unless they clearly ask for other options.\n\nYes, of course 🙂',
        language: 'en',
      }),
    });
    let body = null;
    const res = {
      setHeader() {},
      status(c) {
        this.code = c;
        return this;
      },
      json(b) {
        body = b;
        return this;
      },
      end() {},
    };
    await routes['POST /api/webchat/message'](
      { headers: { origin: 'https://housetenerife.eu' }, body: { text: 'hi', chatId: 'web:abcdef123456_ru', language: 'ru' } },
      res
    );
    ok(body && body.success && body.reply === 'Yes, of course 🙂', 'POST /api/webchat/message отдаёт очищенный reply', JSON.stringify(body));
  }

  // ---------------------------------------------------------------------------
  console.log(`\n────────────────────────────\nИтого: ${pass} PASS / ${fail} FAIL\n`);
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
