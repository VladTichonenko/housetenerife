'use strict';

const { normalizeSalesLang } = require('./sales-localization');

const WARM_MARKER_RE =
  /(?:[\u{1F300}-\u{1F9FF}\u2600-\u27BF])|: ?\)|; ?\)|:- ?\)|\(-:|🙂|😊|👋|👍/u;

const WARM_MARKER_GLOBAL_RE =
  /(?:[\u{1F300}-\u{1F9FF}\u2600-\u27BF]|: ?\)|; ?\)|:- ?\)|\(-:|🙂|😊|👋|👍)/gu;

const SKIP_STAGES =
  /^(SHOW_LISTINGS|FINANCE_DOCUMENTS|FINANCE_DOCUMENTS_CASH|PROPERTY_CLOSING)/;

const WARM_STAGES = new Set([
  'FIRST_CONTACT',
  'NEED_PURPOSE',
  'NEED_PROPERTY_TYPE',
  'NEED_REGION',
  'NEED_BUDGET',
  'NEED_TIMELINE',
  'NEED_LOCATION',
  'NEED_FUNDS_NOW',
  'NEED_MORTGAGE',
  'REFINE',
  'OFFER_MANAGER_CALL',
]);

/** Первый контакт — можно один смайлик; дальше — редко */
const ALWAYS_WARM_STAGES = new Set(['FIRST_CONTACT']);

const OPENER_PATTERNS = {
  ru: /^(Привет|Здравствуйте|Отлично|Понял|Поняла|Хорошо|Прекрасно|Замечательно|Супер|Окей|Ок)([!,.]?\s+)/i,
  en: /^(Hi|Hello|Hey|Great|Got it|Perfect|Sounds good|Nice|Lovely|Okay|Ok)([!,.]?\s+)/i,
  es: /^(Hola|Perfecto|Genial|Vale|Claro|Entendido|De acuerdo|Estupendo|Ok)([!,.]?\s+)/i,
  de: /^(Hallo|Guten Tag|Perfekt|Verstanden|Alles klar|Super|Okay|Ok|Prima)([!,.]?\s+)/i,
  fr: /^(Bonjour|Salut|Parfait|Compris|D.accord|Super|Okay|Ok|Génial)([!,.]?\s+)/i,
  pl: /^(Cześć|Dzień dobry|Świetnie|Rozumiem|Dobrze|Super|Okay|Ok|Jasne)([!,.]?\s+)/i,
  nl: /^(Hallo|Goedemorgen|Perfect|Begrepen|Prima|Super|Okay|Ok|Top)([!,.]?\s+)/i,
};

/** Контекст, где смайлик уместен (ack / привет), а не сухой переспрос бюджета */
const WARM_CONTEXT_RE =
  /^(Привет|Здравствуйте|Отлично|Понял|Поняла|Хорошо|Прекрасно|Замечательно|Супер|Окей|Hi|Hello|Hey|Great|Got it|Perfect|Hola|Genial|Vale|Hallo|Parfait|Compris|Cześć|Świetnie)\b/i;

function hasWarmMarker(text) {
  return WARM_MARKER_RE.test(String(text || ''));
}

function shouldSkipWarmth(stage) {
  return SKIP_STAGES.test(String(stage || ''));
}

function normalizeWarmMarkerSpacing(text) {
  return String(text || '')
    .replace(/:\s+\)/g, ':)')
    .replace(/;\s+\)/g, ';)')
    .replace(/:-\s+\)/g, ':-)');
}

function stripAllWarmMarkers(text) {
  return normalizeWarmMarkerSpacing(text)
    .replace(WARM_MARKER_GLOBAL_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ?\n /g, '\n')
    .trim();
}

function keepFirstWarmMarkerOnly(text) {
  let seen = false;
  return normalizeWarmMarkerSpacing(text)
    .replace(WARM_MARKER_GLOBAL_RE, (match) => {
      if (seen) return '';
      seen = true;
      if (/^: ?\)$/.test(match)) return ':)';
      if (/^; ?\)$/.test(match)) return ';)';
      if (/^:- ?\)$/.test(match)) return ':-)';
      return match;
    })
    .replace(/[ \t]{2,}/g, ' ');
}

function pickMarker(salesLang, text) {
  const useParens = (String(text || '').length + salesLang.length) % 3 !== 0;
  if (useParens) return ' :)';
  return ' 🙂';
}

function recentAssistantHadWarm(history, lookback = 2) {
  const assistants = (history || [])
    .filter((message) => message?.sender === 'assistant')
    .slice(-Math.max(1, lookback));
  return assistants.some((message) => hasWarmMarker(message.text));
}

function assistantReplyCount(history) {
  return (history || []).filter((message) => message?.sender === 'assistant').length;
}

/**
 * Разрешаем смайлик редко: не чаще чем раз в 3 ответа бота,
 * и только на тёплых этапах / ack-контексте.
 */
function shouldAllowWarmMarker(stage, text, history = []) {
  if (shouldSkipWarmth(stage)) return false;
  if (!WARM_STAGES.has(stage) && !ALWAYS_WARM_STAGES.has(stage)) return false;

  // В двух последних ответах уже был смайлик — пропускаем
  if (recentAssistantHadWarm(history, 2)) return false;

  const body = String(text || '').trim();
  const isFirstContact = ALWAYS_WARM_STAGES.has(stage) && assistantReplyCount(history) === 0;
  if (isFirstContact) return true;

  const warmContext = WARM_CONTEXT_RE.test(body);
  if (!warmContext && stage !== 'FIRST_CONTACT') {
    // Сухой уточняющий вопрос без ack — без скобочек
    return false;
  }

  // Каждое 3-е исходящее (0, 3, 6…) + лёгкий хэш, чтобы не было ритма-метронома
  const n = assistantReplyCount(history);
  if (n % 3 !== 0) return false;
  const hash = (body.length * 17 + String(stage || '').length * 7) % 100;
  return hash < 70;
}

function insertAfterOpener(text, salesLang) {
  const lang = normalizeSalesLang(salesLang);
  const pattern = OPENER_PATTERNS[lang] || OPENER_PATTERNS.en;
  const match = text.match(pattern);
  if (!match) return null;
  const marker = pickMarker(lang, text);
  const idx = match[0].length;
  return `${text.slice(0, idx).trimEnd()}${marker} ${text.slice(idx).trimStart()}`;
}

function appendMarker(text, salesLang) {
  const trimmed = text.trimEnd();
  const marker = pickMarker(normalizeSalesLang(salesLang), text);
  if (trimmed.endsWith('?') || trimmed.endsWith('!')) {
    return `${trimmed}${marker}`;
  }
  return `${trimmed}${marker}`;
}

function collapseDuplicateWarmMarkers(text) {
  let out = normalizeWarmMarkerSpacing(text);
  // «Привет :) :)» / «Привет 🙂 :)» / «на руках : )» → один маркер
  out = out.replace(
    /([🙂😊👋👍]|:\)|;\)|:-\))\s*(?:[🙂😊👋👍]|:\)|;\)|:-\))+/gu,
    '$1'
  );
  // Второй смайлик в другом месте сообщения
  out = keepFirstWarmMarkerOnly(out);
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Политика смайликов: максимум один на сообщение; не чаще раза в несколько ответов;
 * только когда контекст (ack/привет) это позволяет. Лишние — вырезаем из ответа модели.
 * @param {string} text
 * @param {string} salesLang
 * @param {string} stage
 * @param {{ history?: Array<{sender:string,text:string}> }} [options]
 */
function maybeAddWarmSmiley(text, salesLang, stage, options = {}) {
  const history = options.history || [];
  let body = collapseDuplicateWarmMarkers(String(text || '').trim());
  if (!body) return text;

  const allow = shouldAllowWarmMarker(stage, body, history);

  if (!allow) {
    if (hasWarmMarker(body)) return stripAllWarmMarkers(body);
    return body;
  }

  // Уже есть один — оставляем (после collapse)
  if (hasWarmMarker(body)) return keepFirstWarmMarkerOnly(body);

  if (shouldSkipWarmth(stage) || !WARM_STAGES.has(stage)) return body;

  const withOpener = insertAfterOpener(body, salesLang);
  if (withOpener) return collapseDuplicateWarmMarkers(withOpener);

  // Не дописываем смайлик в конец сухого вопроса без opener —
  // только если уже тёплый контекст в начале
  if (!WARM_CONTEXT_RE.test(body) && !ALWAYS_WARM_STAGES.has(stage)) return body;

  return collapseDuplicateWarmMarkers(appendMarker(body, salesLang));
}

function getWarmTonePromptBlock(salesLang) {
  const lang = normalizeSalesLang(salesLang);
  if (lang === 'es') {
    return `**TONO CÁLIDO (WhatsApp):** Habla como persona en chat. Frases cortas. 🙂 o :) — *raro*: como máximo 1 cada 3–4 mensajes, solo tras «Perfecto/Hola/Entendido», nunca en cada mensaje y nunca dos en uno. Sin smileys en preguntas secas de presupuesto. Si el cliente envía un emoji — duplícalo. No tono folleto.`;
  }
  if (lang === 'en') {
    return `**WARM TONE (WhatsApp):** Sound like a real person texting — short lines. 🙂 or :) — *rarely*: at most once every 3–4 replies, only after «Great/Hi/Got it», never every message, never two in one. No smileys on dry budget questions. If the client sends an emoji — mirror it. Never brochure voice.`;
  }
  if (lang === 'de') {
    return `**WARMER TON (WhatsApp):** Wie ein Mensch im Chat. 🙂 oder :) — *selten*: höchstens alle 3–4 Nachrichten, nur nach «Perfekt/Hallo». Nie in jeder Nachricht. Emoji des Kunden spiegeln.`;
  }
  if (lang === 'fr') {
    return `**TON CHALEUREUX (WhatsApp):** Comme une vraie personne. 🙂 ou :) — *rare*: au plus 1 tous les 3–4 messages, seulement après «Parfait/Bonjour». Jamais à chaque message. Dupliquer l’emoji du client.`;
  }
  if (lang === 'pl') {
    return `**CIEPLY TON (WhatsApp):** Jak człowiek na czacie. 🙂 lub :) — *rzadko*: max 1 na 3–4 wiadomości, tylko po «Świetnie/Cześć». Nigdy w każdej. Odzwierciedl emoji klienta.`;
  }
  if (lang === 'nl') {
    return `**WARME TOON (WhatsApp):** Als een echt persoon. 🙂 of :) — *zelden*: max 1 per 3–4 berichten, alleen na «Perfect/Hallo». Nooit in elk bericht. Spiegel emoji van de klant.`;
  }
  return `**ТЁПЛЫЙ ТОН (WhatsApp):** Пиши как живой человек на «Вы». Короткие строки. 🙂 или :) — *редко*: максимум раз в 3–4 ответа, только после «Отлично/Привет/Понял», никогда в каждом сообщении и никогда два в одном. В сухих вопросах про бюджет/срок — без скобочек. Если клиент прислал смайлик — дублируй его же. Без тона буклета.`;
}

/**
 * Смягчает «робот-точки» на коротких строках тёплых этапов (не трогает URL, списки, цифры).
 */
function softenRoboticPunctuation(text, stage) {
  const body = String(text || '');
  if (!body.trim()) return text;
  if (/^SHOW_LISTINGS$/i.test(String(stage || ''))) return text;
  if (/FINANCE_DOCUMENTS|PROPERTY_CLOSING/i.test(String(stage || ''))) return text;

  const lines = body.split('\n');
  let consecutivePeriodLines = 0;
  const out = lines.map((line) => {
    const trimmed = line.trimEnd();
    if (!trimmed) {
      consecutivePeriodLines = 0;
      return line;
    }
    if (/^\s*(?:[•\-*]|\d+[.)])\s/.test(trimmed)) {
      consecutivePeriodLines = 0;
      return line;
    }
    if (/https?:\/\/|housetenerife\.eu|€|eur\b|\d[\d\s.,]*\d/i.test(trimmed)) {
      consecutivePeriodLines = 0;
      return line;
    }
    if (/[.]$/.test(trimmed) && !/[?!…]$/.test(trimmed) && trimmed.length <= 160) {
      consecutivePeriodLines += 1;
      const brochure =
        /(?:I offer you|Я предлагаю|Le ofrezco|excellent for investment|отлично подходят для|attract long-term)/i.test(
          trimmed
        );
      if (consecutivePeriodLines >= 2 || brochure) {
        return trimmed.replace(/\.\s*$/, '');
      }
    } else {
      consecutivePeriodLines = 0;
    }
    return line;
  });
  return collapseDuplicateWarmMarkers(out.join('\n'));
}

module.exports = {
  maybeAddWarmSmiley,
  getWarmTonePromptBlock,
  softenRoboticPunctuation,
  hasWarmMarker,
  collapseDuplicateWarmMarkers,
  stripAllWarmMarkers,
  shouldAllowWarmMarker,
};
