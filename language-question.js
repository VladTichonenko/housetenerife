'use strict';

/**
 * Вопросы клиента про язык общения: «Do you speak English?», «Вы говорите по-немецки?»,
 * «Sprechen Sie Deutsch?», «¿Hablan español?», «Mówicie po polsku?» …
 *
 * Бот должен коротко ответить (да, мы говорим на en/de/es/fr/pl/cs/ru) на языке клиента
 * ДО продолжения воронки и не вываливать подборку в этом сообщении, если её не просили.
 */

/** Языки, на которых реально общается команда. */
const TEAM_LANGUAGES = ['en', 'de', 'es', 'fr', 'pl', 'cs', 'ru'];

/** Название языка (на разных языках) → код. */
const LANG_TOKENS = [
  ['en', 'english|ingl[eé]s|englisch|anglais|angielsk\\p{L}*|engels|англ\\p{L}*|angli[ck]\\p{L}*|inglese|ingl[eê]s|ingilizce'],
  ['de', 'german|deutsch|alem[aá]n|allemand|niemieck\\p{L}*|duits|нем[еи]ц\\p{L}*|німец\\p{L}*|німецьк\\p{L}*|n[eě]mec\\p{L}*|n[eě]mcin\\p{L}*|tedesco|alem[aã]o|almanca'],
  ['es', 'spanish|espa[nñ]ol|spanisch|espagnol|hiszpa[nń]sk\\p{L}*|spaans|испан\\p{L}*|[sš]pan[eě]lsk\\p{L}*|[sš]pan[eě]l\\p{L}*|spagnolo|espanhol'],
  ['fr', 'french|franc[eé]s|franz[oö]sisch|fran[cç]ais|francuski\\p{L}*|frans|француз\\p{L}*|francouz\\p{L}*|francese|franc[eê]s'],
  ['pl', 'polish|polaco|polnisch|polonais|polsk\\p{L}*|pools|польск\\p{L}*|polsky|polsk[yý]\\p{L}*|polacco|polon[eê]s'],
  ['cs', 'czech|checo|tschechisch|tch[eè]que|czesk\\p{L}*|tsjechisch|чешск\\p{L}*|[cč]esk\\p{L}*|[cč]esky|[cč]e[sš]tin\\p{L}*|ceco|tcheco'],
  ['ru', 'russian|ruso|russisch|russe|rosyjsk\\p{L}*|рус{1,2}к\\p{L}*|rusk\\p{L}*|rusky|ru[sš]tin\\p{L}*|russo'],
  ['uk', 'ukrainian|ucraniano|ukrainisch|ukrainien|ukrai[nń]sk\\p{L}*|oekra[iï]ens|украин\\p{L}*|українськ\\p{L}*|ukrajinsk\\p{L}*'],
  ['it', 'italian|italiano|italienisch|italien|w[lł]osk\\p{L}*|italiaans|итальян\\p{L}*|itali[ae]nsk\\p{L}*'],
  ['pt', 'portuguese|portugu[eé]s|portugiesisch|portugais|portugalsk\\p{L}*|portugees|португальск\\p{L}*'],
  ['nl', 'dutch|neerland[eé]s|niederl[aä]ndisch|n[eé]erlandais|holenderski\\p{L}*|nederlands|голландск\\p{L}*|нидерландск\\p{L}*'],
  ['tr', 'turkish|turco|t[uü]rkisch|turc|turecki\\p{L}*|turks|турецк\\p{L}*'],
];

const LANG_ANY = LANG_TOKENS.map(([, t]) => `(?:${t})`).join('|');

/** [язык, в котором написан вопрос, regexp глагола] */
const VERB_PATTERNS = [
  ['en', '(?:speak|speaks|speaking|talk|talking|understand|write|communicate|chat)'],
  ['ru', '(?:говор\\p{L}*|разговарива\\p{L}*|общает\\p{L}*|владе\\p{L}*|пишет\\p{L}*|понима\\p{L}*|знает\\p{L}*|есть\\s+ли)'],
  ['es', '(?:habl\\p{L}*|escrib\\p{L}*|entiend\\p{L}*)'],
  ['de', '(?:sprech\\p{L}*|sprich\\p{L}*|spricht|k[oö]nn\\p{L}*|verstehen)'],
  ['fr', '(?:parl\\p{L}*|[eé]crivez|comprenez)'],
  ['pl', '(?:m[oó]wi\\p{L}*|rozmawia\\p{L}*|pisze\\p{L}*)'],
  ['nl', '(?:spreek\\p{L}*|spreekt|praat\\p{L}*)'],
  ['cs', '(?:mluv\\p{L}*|domluv\\p{L}*)'],
  ['uk', '(?:розмовля\\p{L}*|говор\\p{L}*|спілку\\p{L}*)'],
];

const SUBJECT_STATEMENT_RE =
  /(?:^|[\s,;.!?])(?:i|we|я|мы|ich|wir|yo|nosotros|je|nous|ja|my|ik|wij|j[aá])\s+(?:also\s+|only\s+|just\s+|can\s+|only\s+|don'?t\s+|do\s+not\s+|не\s+|nur\s+|solo\s+|seulement\s+|tylko\s+|jen\s+)*(?:speak|говор|sprech|habl|parl|m[oó]wi|spreek|mluv)/iu;

const DANGLING_SUBJECT_RE =
  /(?:[¿¡]\s*|(?<![\p{L}\p{N}])(?:(?:do|does|can|could|would|will|are|is)\s+(?:you|u|ya|y'?all|they|someone|anyone)(?:\s+guys)?(?:\s+(?:also|really|both))?|(?:а\s+)?(?:ли\s+)?(?:вы|ты)(?:\s+ли)?|usted(?:es)?|vosotros|t[uú]|vous|tu|sie|ihr|du|(?:czy\s+)?(?:pan[ie]?|pa[nń]stwo)|u|je|jij|jullie|(?:ty|vy))\s*)$/iu;

function buildQuestionRegexes() {
  const list = [];
  for (const [lang, verb] of VERB_PATTERNS) {
    // глагол … (до ~28 символов) … название языка
    list.push([
      lang,
      new RegExp(
        `(?<![\\p{L}\\p{N}])${verb}(?![\\p{L}\\p{N}])[^.!?\\n]{0,28}?(?<![\\p{L}\\p{N}])(?:${LANG_ANY})(?![\\p{L}\\p{N}])[^.!?\\n]{0,16}`,
        'iu'
      ),
    ]);
  }
  return list;
}

const QUESTION_REGEXES = buildQuestionRegexes();

/** «Какие языки?» без названия языка */
const WHICH_LANGUAGES = [
  ['en', /(?:what|which)\s+languages?\b[^.!?\n]{0,40}/iu],
  ['en', /\bany\s+(?:english|german|spanish|french|polish|czech|russian)[\s-]*speaking\b[^.!?\n]{0,30}/iu],
  ['en', /\b(?:english|german|spanish|french|polish|czech|russian)[\s-]*speaking\s+(?:agent|manager|someone|person|staff|consultant|team)s?\b[^.!?\n]{0,20}/iu],
  ['ru', /(?:на\s+каких|какие)\s+язык\p{L}*[^.!?\n]{0,40}/iu],
  ['ru', /на\s+каком\s+язык\p{L}*[^.!?\n]{0,40}/iu],
  ['es', /(?:qu[eé]|en\s+qu[eé]|cu[aá]les)\s+idiomas?[^.!?\n]{0,40}/iu],
  ['de', /(?:welche|in\s+welchen)\s+sprachen?[^.!?\n]{0,40}/iu],
  ['fr', /(?:quelles?|en\s+quelles?)\s+langues?[^.!?\n]{0,40}/iu],
  ['pl', /(?:jakie|w\s+jakich)\s+j[eę]zyk\p{L}*[^.!?\n]{0,40}/iu],
  ['nl', /(?:welke)\s+talen[^.!?\n]{0,40}/iu],
  ['cs', /(?:jak[eé]|v\s+jak[eé]m)\s+jazyk\p{L}*[^.!?\n]{0,40}/iu],
];

const GREETING_ONLY_RE =
  /^(?:hello|hi|hey|good\s+(?:morning|afternoon|evening|day)|привет\p{L}*|здравствуй\p{L}*|добрый\s+(?:день|вечер)|доброе\s+утро|hola|buenos\s+d[ií]as|buenas|hallo|guten\s+(?:tag|morgen|abend)|bonjour|salut|bonsoir|cze[sś][cć]|dzie[nń]\s+dobry|hoi|goedendag|dobr[yý]\s+den|ahoj|thanks?|thank\s+you|спасибо|please|пожалуйста|bitte|por\s+favor|s'il\s+vous\s+pla[iî]t|prosz[eę]|and|и|y|und|et|oraz|en|a)$/iu;

function normalizeLangCode(code) {
  if (!code) return null;
  return String(code).toLowerCase().slice(0, 2);
}

function languagesMentioned(text) {
  const out = [];
  for (const [code, tokens] of LANG_TOKENS) {
    if (new RegExp(`(?<![\\p{L}\\p{N}])(?:${tokens})(?![\\p{L}\\p{N}])`, 'iu').test(text)) out.push(code);
  }
  return out;
}

/**
 * @param {string} text сообщение клиента
 * @returns {{
 *   asked: boolean,
 *   questionLang: string|null,   // язык, на котором написан вопрос (если определён)
 *   askedLangs: string[],        // о каких языках спросили (может быть пусто: «какие языки?»)
 *   only: boolean,               // в сообщении больше ничего нет (кроме приветствия)
 *   rest: string,                // сообщение без фразы про язык
 *   wantsListings: boolean       // явно просит подборку/ссылки
 * }}
 */
function detectLanguageQuestion(text) {
  const empty = {
    asked: false,
    questionLang: null,
    askedLangs: [],
    only: false,
    rest: String(text || ''),
    wantsListings: false,
  };
  const s = String(text || '').trim();
  if (!s || s.length > 1200) return empty;

  let match = null;
  let questionLang = null;
  for (const [lang, re] of QUESTION_REGEXES) {
    const m = re.exec(s);
    if (m && (!match || m.index < match.index)) {
      match = m;
      questionLang = lang;
    }
  }
  let whichOnly = false;
  if (!match) {
    for (const [lang, re] of WHICH_LANGUAGES) {
      const m = re.exec(s);
      if (m) {
        match = m;
        questionLang = lang;
        whichOnly = true;
        break;
      }
    }
  }
  if (!match) return empty;

  // «I speak English, can you help?» — утверждение клиента, не вопрос
  const before = s.slice(Math.max(0, match.index - 40), match.index + 12);
  if (!whichOnly && SUBJECT_STATEMENT_RE.test(before)) {
    return empty;
  }

  const phrase = match[0];
  const askedLangs = whichOnly ? [] : languagesMentioned(phrase);
  // «Do you / Вы / ¿ / Sie» перед глаголом — тоже часть вопроса про язык
  const head = s
    .slice(0, match.index)
    .replace(DANGLING_SUBJECT_RE, ' ');
  const rest = (head + ' ' + s.slice(match.index + phrase.length))
    .replace(/\s*\?+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:.!\-–—]+|[\s,;:\-–—]+$/g, '')
    .trim();

  const words = rest
    .split(/[\s,;:.!?]+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => !GREETING_ONLY_RE.test(w));
  const only = words.length <= 1;

  const wantsListings =
    /(?:show|send|links?|options|examples|listings|properties\s+(?:to\s+see|list)|покаж\p{L}*|скин\p{L}*|пришл\p{L}*|вариант\p{L}*|ссылк\p{L}*|muestr\p{L}*|env[ií]a\p{L}*|enlaces|opciones|zeig\p{L}*|schick\p{L}*|angebote|montr\p{L}*|envoy\p{L}*|liens|pokaż|wyślij|oferty|toon|stuur|opties)/iu.test(
      rest
    );

  return { asked: true, questionLang, askedLangs, only, rest, wantsListings };
}

const EXPLICIT_CODES = ['en', 'de', 'es', 'fr', 'pl', 'ru', 'uk', 'it', 'pt', 'nl', 'tr'];

function firstLangIn(fragment) {
  const found = languagesMentioned(fragment).filter((c) => EXPLICIT_CODES.includes(c));
  return found[0] || null;
}

/**
 * Явная просьба сменить язык: «English please», «по-немецки пожалуйста», «please write in Spanish».
 * @returns {string|null} код языка
 */
function detectExplicitLanguageRequest(text) {
  const s = String(text || '').trim();
  if (!s || s.length > 160) return null;
  // «Do you speak German?» — вопрос, а не просьба; «please speak German» — просьба
  const looksLikeQuestion =
    /\?\s*$/.test(s) ||
    /(?:^|[\s,.;!])(?:do|does|can|could|would|will)\s+(?:you|u|ya|y'?all)\b/i.test(s) ||
    /(?:говорите|говорит|sprechen\s+sie|sprichst|habl[aá]n?\b|parlez|m[oó]wicie|mówisz|spreekt|mluv[ií]te)/i.test(s);
  if (looksLikeQuestion && detectLanguageQuestion(s).asked) return null;
  const A = new RegExp(
    `(?:^|[\\s,.;!?])(?:please\\s+)?(?:speak|write|reply|answer|respond|switch(?:\\s+to)?|continue|talk|chat)\\s+(?:to\\s+me\\s+)?(?:in\\s+)?((?:${LANG_ANY}))(?![\\p{L}\\p{N}])`,
    'iu'
  );
  const B = new RegExp(
    `(?<![\\p{L}\\p{N}])((?:${LANG_ANY}))(?![\\p{L}\\p{N}])\\s*[,.!]?\\s*(?:please|pls|plz|bitte|пожалуйста|пож\\.?|por\\s+favor|s'il\\s+vous\\s+pla[iî]t|prosz[eę])(?![\\p{L}])`,
    'iu'
  );
  const C = new RegExp(
    `(?:давайте|давай|можно|пишите|отвечайте|переключитесь|перейд[её]м|лучше)\\s+(?:лучше\\s+)?(?:по[-\\s]|на\\s+)((?:${LANG_ANY}))(?![\\p{L}\\p{N}])`,
    'iu'
  );
  for (const re of [A, B, C]) {
    const m = re.exec(s);
    if (m) {
      const code = firstLangIn(m[1]);
      if (code) return code;
    }
  }
  return null;
}

const NAMES = {
  ru: 'английском, немецком, испанском, французском, польском, чешском и русском',
  en: 'English, German, Spanish, French, Polish, Czech and Russian',
  es: 'inglés, alemán, español, francés, polaco, checo y ruso',
  de: 'Englisch, Deutsch, Spanisch, Französisch, Polnisch, Tschechisch und Russisch',
  fr: 'anglais, allemand, espagnol, français, polonais, tchèque et russe',
  pl: 'angielskim, niemieckim, hiszpańskim, francuskim, polskim, czeskim i rosyjskim',
  nl: 'Engels, Duits, Spaans, Frans, Pools, Tsjechisch en Russisch',
  uk: 'англійською, німецькою, іспанською, французькою, польською, чеською та російською',
};

function langKey(lang) {
  const l = normalizeLangCode(lang) || 'en';
  return NAMES[l] ? l : 'en';
}

/**
 * Короткий ответ про языки на языке клиента.
 * @param {string} lang язык ответа
 * @param {{ askedLangs?: string[] }} [opts]
 */
function buildLanguageAnswer(lang, opts = {}) {
  const k = langKey(lang);
  const asked = (opts.askedLangs || []).filter(Boolean);
  const unsupported = asked.length > 0 && asked.every((c) => !TEAM_LANGUAGES.includes(c));
  const names = NAMES[k];
  const T = {
    ru: unsupported
      ? `К сожалению, на этом языке пока не работаем. Мы общаемся на ${names} — пишите на любом из них 🙂`
      : `Да, конечно 🙂 Мы общаемся на ${names} — пишите так, как вам удобнее.`,
    en: unsupported
      ? `Unfortunately not in that language yet. We work in ${names} — feel free to write in any of them 🙂`
      : `Yes, of course 🙂 We speak ${names} — write in whichever is easiest for you.`,
    es: unsupported
      ? `Por ahora no en ese idioma. Trabajamos en ${names} — escríbenos en el que prefieras 🙂`
      : `¡Sí, por supuesto! 🙂 Hablamos ${names} — escríbenos en el que te resulte más cómodo.`,
    de: unsupported
      ? `In dieser Sprache leider noch nicht. Wir sprechen ${names} — schreiben Sie gern in einer davon 🙂`
      : `Ja, natürlich 🙂 Wir sprechen ${names} — schreiben Sie in der Sprache, die Ihnen am besten passt.`,
    fr: unsupported
      ? `Pas encore dans cette langue, malheureusement. Nous parlons ${names} — écrivez dans celle qui vous convient 🙂`
      : `Oui, bien sûr 🙂 Nous parlons ${names} — écrivez dans la langue qui vous convient le mieux.`,
    pl: unsupported
      ? `Niestety jeszcze nie w tym języku. Rozmawiamy po ${names} — proszę pisać w dowolnym z nich 🙂`
      : `Tak, oczywiście 🙂 Rozmawiamy po ${names} — proszę pisać w tym języku, który jest wygodniejszy.`,
    nl: unsupported
      ? `Helaas nog niet in die taal. Wij spreken ${names} — schrijf gerust in een van die talen 🙂`
      : `Ja, natuurlijk 🙂 Wij spreken ${names} — schrijf in de taal die voor u het prettigst is.`,
    uk: unsupported
      ? `На жаль, цією мовою поки що ні. Ми спілкуємось ${names} — пишіть будь-якою з них 🙂`
      : `Так, звісно 🙂 Ми спілкуємось ${names} — пишіть так, як вам зручніше.`,
  };
  return T[k];
}

/** Мягкое продолжение воронки после ответа про язык. */
function buildLanguageFollowUp(lang, { hasCriteria = false, hasPurpose = false } = {}) {
  const k = langKey(lang);
  const T = {
    ru: hasCriteria
      ? hasPurpose
        ? 'Продолжим подбор?'
        : 'Для чего рассматриваете: для жизни, инвестиций или отдыха?'
      : 'Что ищете на Тенерифе — тип объекта, район и примерный бюджет?',
    en: hasCriteria
      ? hasPurpose
        ? 'Shall we continue with the selection?'
        : 'Is it for living, investment or holidays?'
      : 'What are you looking for in Tenerife — property type, area and rough budget?',
    es: hasCriteria
      ? hasPurpose
        ? '¿Seguimos con la selección?'
        : '¿Es para vivir, invertir o vacaciones?'
      : '¿Qué busca en Tenerife — tipo de inmueble, zona y presupuesto aproximado?',
    de: hasCriteria
      ? hasPurpose
        ? 'Sollen wir mit der Auswahl fortfahren?'
        : 'Ist es zum Wohnen, als Investment oder für den Urlaub?'
      : 'Was suchen Sie auf Teneriffa — Objektart, Gegend und grobes Budget?',
    fr: hasCriteria
      ? hasPurpose
        ? 'On continue la sélection ?'
        : 'C’est pour y vivre, investir ou les vacances ?'
      : 'Que recherchez-vous à Tenerife — type de bien, secteur et budget approximatif ?',
    pl: hasCriteria
      ? hasPurpose
        ? 'Kontynuujemy wybór?'
        : 'Czy to do mieszkania, inwestycji czy na wakacje?'
      : 'Czego szukacie na Teneryfie — typ nieruchomości, rejon i orientacyjny budżet?',
    nl: hasCriteria
      ? hasPurpose
        ? 'Zullen we doorgaan met de selectie?'
        : 'Is het om te wonen, te beleggen of voor vakantie?'
      : 'Wat zoekt u op Tenerife — type woning, gebied en globaal budget?',
    uk: hasCriteria
      ? hasPurpose
        ? 'Продовжимо підбір?'
        : 'Для чого розглядаєте: для життя, інвестицій чи відпочинку?'
      : 'Що шукаєте на Тенерифе — тип об’єкта, район і орієнтовний бюджет?',
  };
  return T[k];
}

/**
 * Для сообщения «язык + суть»: язык ответа ПЕРЕД основным ответом.
 * @param {string} answer ответ про языки
 * @param {string} body основной ответ воронки (может быть пустым)
 */
function prependLanguageAnswer(answer, body) {
  const b = String(body || '').trim();
  if (!b) return answer;
  return `${answer}\n\n${b}`;
}

/**
 * Убирает «подборку» из ответа (ссылки /property/ и абзацы-карточки),
 * оставляя вводный текст/вопрос. Если ничего осмысленного не осталось → ''.
 */
function stripListingDump(reply) {
  const text = String(reply || '').trim();
  if (!text) return '';
  const urlRe = /https?:\/\/(?:www\.)?housetenerife\.eu(?:\/(?:ru|es|en|de|fr|pl|nl))?\/property\//i;
  if (!urlRe.test(text)) return text;

  const blocks = text.split(/\n{2,}/);
  const kept = [];
  for (const b of blocks) {
    if (urlRe.test(b)) continue;
    // карточка без ссылки: «• *Title* — €…» / «1. Title — €…»
    if (/^\s*(?:[•\-*]|\d+[.)])\s+.*(?:€|eur|евро)/i.test(b)) continue;
    kept.push(b);
  }
  let out = kept.join('\n\n').trim();
  // Вводная строка подборки («Вот варианты:», «Here are some options:») без самой подборки
  out = out
    .split('\n')
    .filter((line, i, arr) => {
      const l = line.trim();
      if (!/:\s*$/.test(l)) return true;
      return !(
        /(?:вот\s+вариант|подбор|here\s+are|aqu[ií]\s+tienes|hier\s+sind|voici|oto\s+opcje|hieronder)/i.test(l) ||
        i === arr.length - 1
      );
    })
    .join('\n')
    .trim();
  return out;
}

module.exports = {
  TEAM_LANGUAGES,
  detectLanguageQuestion,
  detectExplicitLanguageRequest,
  buildLanguageAnswer,
  buildLanguageFollowUp,
  prependLanguageAnswer,
  stripListingDump,
};
