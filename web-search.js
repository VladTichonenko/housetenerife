const axios = require('axios');

/**
 * Краткие выдержки из DuckDuckGo Instant Answer API (без ключа).
 * Для серьёзной выдачи лучше подключить Brave Search API (см. .env.example).
 */
async function webSearchSnippets(query, maxTopics = 6) {
  if (process.env.DISABLE_WEB_SEARCH === '1' || process.env.DISABLE_WEB_SEARCH === 'true') {
    return '';
  }
  const q = String(query || '').trim().slice(0, 220);
  if (!q) return '';

  try {
    const { data } = await axios.get('https://api.duckduckgo.com/', {
      params: { q, format: 'json', no_html: 1, skip_disambig: 1 },
      timeout: 15000,
      headers: { 'User-Agent': 'HouseTenerifeBot/1.0 (educational)' }
    });
    const parts = [];
    if (data.AbstractText) parts.push(data.AbstractText);
    const topics = data.RelatedTopics || [];
    for (const t of topics) {
      if (parts.length >= maxTopics) break;
      if (typeof t.Text === 'string') parts.push(t.Text);
      else if (t.Topics && Array.isArray(t.Topics)) {
        for (const st of t.Topics) {
          if (parts.length >= maxTopics) break;
          if (st && typeof st.Text === 'string') parts.push(st.Text);
        }
      }
    }
    return parts.join('\n---\n').slice(0, 3200);
  } catch (e) {
    console.warn('webSearchSnippets:', e.message);
    return '';
  }
}

function shouldAugmentWithWeb(lastUserMessage) {
  const m = String(lastUserMessage || '').toLowerCase();
  const keys = [
    'интернет',
    'ссылк',
    'актуальн',
    'сегодня',
    'закон',
    'налог',
    'изменен',
    'официальн',
    'последн',
    'уточни',
    'найди',
    'погугл',
    'google'
  ];
  return keys.some((k) => m.includes(k));
}

module.exports = { webSearchSnippets, shouldAugmentWithWeb };
