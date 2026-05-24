/**
 * Проверка ключа io.net Intelligence (локально).
 *   node scripts/test-ai-key.js
 * Нужен AI_API_KEY в .env
 */
require('dotenv').config();
const axios = require('axios');

const URL =
  process.env.AI_API_URL || 'https://api.intelligence.io.solutions/api/v1/chat/completions';
const KEY = process.env.AI_API_KEY;
const MODEL = process.env.AI_MODEL || 'openrouter/free';

function headers(style) {
  const h =
    style === 'x-api-key'
      ? { 'Content-Type': 'application/json', 'x-api-key': KEY }
      : { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` };
  if (URL.includes('openrouter.ai')) {
    h['HTTP-Referer'] = process.env.OPENROUTER_REFERER || 'https://housetenerife.eu';
    h['X-Title'] = 'House Tenerife Bot Test';
  }
  return h;
}

async function tryCall(style) {
  const res = await axios.post(
    URL,
    {
      model: MODEL,
      messages: [{ role: 'user', content: 'Ответь одним словом: ок' }],
      max_completion_tokens: 20,
      temperature: 0.2
    },
    { headers: headers(style), timeout: 60000, validateStatus: () => true }
  );
  return { style, status: res.status, body: res.data };
}

async function main() {
  if (!KEY?.trim()) {
    console.error('Задайте AI_API_KEY в .env');
    process.exit(1);
  }
  console.log('URL:', URL);
  console.log('MODEL:', MODEL);
  console.log('KEY prefix:', KEY.slice(0, 12) + '…');

  for (const style of ['x-api-key', 'bearer']) {
    try {
      const { status, body } = await tryCall(style);
      console.log(`\n[${style}] HTTP`, status);
      if (status >= 200 && status < 300) {
        console.log('OK:', body.choices?.[0]?.message?.content);
        console.log('\n→ В Railway: AI_AUTH_STYLE=' + style);
        return;
      }
      console.log('Error:', JSON.stringify(body).slice(0, 500));
    } catch (e) {
      console.log(`\n[${style}]`, e.message);
    }
  }
  console.log('\nСписок моделей:');
  for (const style of ['x-api-key', 'bearer']) {
    try {
      const res = await axios.get(
        'https://api.intelligence.io.solutions/api/v1/models',
        { headers: headers(style), timeout: 30000, validateStatus: () => true }
      );
      console.log(`[${style}] models HTTP`, res.status);
      if (res.status === 200 && Array.isArray(res.data?.data)) {
        console.log(res.data.data.slice(0, 8).map((m) => m.id).join('\n'));
        break;
      }
    } catch (e) {
      console.log(style, e.message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
