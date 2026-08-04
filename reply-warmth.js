'use strict';

const { normalizeSalesLang } = require('./sales-localization');

const WARM_MARKER_RE =
  /(?:[\u{1F300}-\u{1F9FF}\u2600-\u27BF])|:\)|;\)|:-\)|\(-:|🙂|😊|👋|👍/u;

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

/** Всегда тёплый тон на первом контакте; на остальных — примерно каждое второе сообщение */
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

function hasWarmMarker(text) {
  return WARM_MARKER_RE.test(String(text || ''));
}

function shouldSkipWarmth(stage) {
  return SKIP_STAGES.test(String(stage || ''));
}

function pickMarker(salesLang, text) {
  const useParens = (String(text || '').length + salesLang.length) % 3 !== 0;
  if (useParens) return ' :)';
  return ' 🙂';
}

function shouldInjectWarmth(stage, text) {
  if (ALWAYS_WARM_STAGES.has(stage)) return true;
  // ~45–55%: не в каждом сообщении, но достаточно часто для «живого» консультанта
  const hash = (String(text || '').length * 17 + String(stage || '').length * 7) % 100;
  return hash < 50;
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
  let out = String(text || '');
  // «Привет :) :)» / «Привет 🙂 :)» → один маркер
  out = out.replace(/([🙂😊👋👍]|:\)|;\)|:-\))\s*(?:[🙂😊👋👍]|:\)|;\)|:-\))+/gu, '$1');
  return out;
}

/**
 * Добавляет один уместный смайлик / :) если модель не добавила.
 * Не в каждом сообщении — чтобы звучать как консультант, не как бот со смайлами.
 * @param {string} text
 * @param {string} salesLang
 * @param {string} stage
 */
function maybeAddWarmSmiley(text, salesLang, stage) {
  const body = collapseDuplicateWarmMarkers(String(text || '').trim());
  if (!body || hasWarmMarker(body)) return collapseDuplicateWarmMarkers(text);
  if (shouldSkipWarmth(stage)) return text;
  if (!WARM_STAGES.has(stage)) return text;
  if (!shouldInjectWarmth(stage, body)) return text;

  const withOpener = insertAfterOpener(body, salesLang);
  if (withOpener) return collapseDuplicateWarmMarkers(withOpener);

  return collapseDuplicateWarmMarkers(appendMarker(body, salesLang));
}

function getWarmTonePromptBlock(salesLang) {
  const lang = normalizeSalesLang(salesLang);
  if (lang === 'es') {
    return `**TONO CÁLIDO (WhatsApp):** Habla como persona en chat, no como robot. Frases cortas, a veces sin punto final. En etapas de conversación (saludo, objetivo, tipo, región, zona, presupuesto) incluye de vez en cuando *un* emoji suave 🙂 o :) — no en cada mensaje, sí en saludo y en ~cada segunda respuesta cálida. Ejemplo: «Perfecto :) ¿qué tipo…?» Si el cliente envía un emoji — duplícalo. No suenes a folleto («Le ofrezco las siguientes opciones…»). No en listados densos con enlaces.`;
  }
  if (lang === 'en') {
    return `**WARM TONE (WhatsApp):** Sound like a real person texting — short lines, not every sentence ending with a period. On conversation stages occasionally include *one* 🙂 or :) — not every message, yes on greetings and roughly every other warm reply. Example: «Got it :) What area works for you?» If the client sends an emoji — mirror it. Never brochure voice («I offer you the following investment options…»). Skip dense listing blocks.`;
  }
  if (lang === 'de') {
    return `**WARMER TON (WhatsApp):** Wie ein Mensch im Chat — kurze Zeilen, nicht nach jedem Satz einen Punkt. Gelegentlich *ein* 🙂 oder :). Kein Broschüren-Ton. Emoji des Kunden spiegeln.`;
  }
  if (lang === 'fr') {
    return `**TON CHALEUREUX (WhatsApp):** Comme une vraie personne en chat — phrases courtes, pas un point à chaque ligne. Parfois *un* 🙂 ou :). Pas de ton brochure. Dupliquer l’emoji du client.`;
  }
  if (lang === 'pl') {
    return `**CIEPLY TON (WhatsApp):** Jak człowiek na czacie — krótkie linie, nie kropka po każdej. Czasem *jeden* 🙂 lub :). Bez tonu ulotki. Odzwierciedl emoji klienta.`;
  }
  if (lang === 'nl') {
    return `**WARME TOON (WhatsApp):** Als een echt persoon in chat — korte regels, niet na elke zin een punt. Af en toe *één* 🙂 of :). Geen brochure-toon. Spiegel emoji van de klant.`;
  }
  return `**ТЁПЛЫЙ ТОН (WhatsApp):** Пиши как живой человек в чате на «Вы», не как робот. Короткие строки, не точка в конце каждой фразы подряд. На этапах диалога иногда *один* 🙂 или :) — не два подряд. Пример: «Отлично :) Какой район ближе?» Если клиент прислал смайлик — дублируй его же. Запрещён тон буклета («Я предлагаю вам следующие варианты инвестиций…»). Не в плотной подборке со ссылками.`;
}

/**
 * Смягчает «робот-точки» на коротких строках тёплых этапов (не трогает URL, списки, цифры).
 */
function softenRoboticPunctuation(text, stage) {
  const body = String(text || '');
  if (!body.trim()) return text;
  // Плотная подборка со ссылками — не трогаем; остальное — живой WhatsApp
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
};
