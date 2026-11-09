'use strict';

/**
 * Пожелания клиента к характеристикам («вид на море», «бассейн», «первая линия»)
 * на любом языке → мягкий буст при ранжировании каталога (не жёсткий фильтр).
 */

const U = (src) => new RegExp(src, 'iu');

/** Одно и то же регулярное выражение работает и для запроса клиента, и для текста карточки. */
const FEATURES = {
  seaView: {
    boost: 16,
    re: U(
      '(?:sea|ocean|water|coast(?:al)?)[\\s-]*views?|views?\\s+(?:of|to|over|onto)\\s+(?:the\\s+)?(?:sea|ocean|atlantic|coast)|(?:vista|vistas)\\s+(?:al|a\\s+la|del|de[l]?\\s+)?\\s*(?:mar|oc[eé]ano|costa)|(?:meer|meeres|ozean)[\\s-]?(?:blick|sicht)|blick\\s+(?:auf|aufs)\\s+(?:das\\s+)?(?:meer|ozean)|vue\\s+(?:sur|mer|oc[eé]an)|vue\\s+(?:de\\s+la\\s+)?mer|widok\\s+na\\s+(?:morze|ocean)|(?:zee|oceaan)[\\s-]?(?:zicht|uitzicht)|uitzicht\\s+(?:op\\s+)?(?:de\\s+)?(?:zee|oceaan)|вид\\p{L}*\\s+(?:на\\s+)?(?:море|морю|океан\\p{L}*|мор\\p{L}*)|(?:морск|океанск)\\p{L}*\\s+вид\\p{L}*|з\\s+видом\\s+на\\s+(?:мор\\p{L}*|океан\\p{L}*)|(?:sea|ocean)\\s*front'
    ),
  },
  pool: {
    boost: 9,
    re: U('\\b(?:swimming\\s+)?pool\\b|piscina|schwimmbad|\\bpool\\b|piscine|basen\\b|zwembad|бассейн\\p{L}*'),
  },
  firstLine: {
    boost: 12,
    re: U(
      'first\\s+line|front\\s*line|beach\\s*front|primera\\s+l[ií]nea|erste\\s+reihe|premi[eè]re\\s+ligne|pierwsza\\s+linia|eerste\\s+lijn|перв\\p{L}*\\s+лини\\p{L}*'
    ),
  },
};

/** @returns {string[]} ключи FEATURES, которые просит клиент */
function detectFeatureWishes(text) {
  const s = String(text || '');
  if (!s.trim()) return [];
  return Object.keys(FEATURES).filter((k) => FEATURES[k].re.test(s));
}

/**
 * @param {string} blob  текст карточки (title+description+overview всех языков)
 * @param {string[]} wishes
 */
function scoreFeatureFit(blob, wishes) {
  if (!wishes?.length || !blob) return 0;
  let sc = 0;
  for (const k of wishes) {
    const f = FEATURES[k];
    if (f && f.re.test(blob)) sc += f.boost;
  }
  return sc;
}

module.exports = { FEATURES, detectFeatureWishes, scoreFeatureFit };
