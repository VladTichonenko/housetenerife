'use strict';

const ALLOWED_ORIGINS = String(
  process.env.WEBCHAT_ALLOWED_ORIGINS ||
    'https://housetenerife.eu,https://www.housetenerife.eu'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const lastByChat = new Map();
const MIN_INTERVAL_MS = 800;

function originAllowed(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes('*')) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === 'housetenerife.eu' || host.endsWith('.housetenerife.eu');
  } catch (e) {
    return false;
  }
}

function applyCors(req, res) {
  const origin = String(req.headers.origin || '');
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}

function normalizeChatId(raw) {
  const id = String(raw || '').trim();
  if (!/^web:[A-Za-z0-9_-]{8,80}$/.test(id)) return '';
  return id;
}

function tooFast(chatId) {
  const now = Date.now();
  const prev = lastByChat.get(chatId) || 0;
  if (now - prev < MIN_INTERVAL_MS) return true;
  lastByChat.set(chatId, now);
  return false;
}

function registerWebchatRoutes(app, { processWebMessage }) {
  app.options('/api/webchat/message', (req, res) => {
    applyCors(req, res);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
  });

  app.post('/api/webchat/message', async (req, res) => {
    applyCors(req, res);
    const origin = String(req.headers.origin || '');
    if (origin && !originAllowed(origin)) {
      return res.status(403).json({ success: false, message: 'Forbidden origin' });
    }

    const text = String(req.body?.text || '').trim().slice(0, 2000);
    const chatId = normalizeChatId(req.body?.chatId);
    const pageUrl = String(req.body?.pageUrl || '').trim().slice(0, 500);
    const pageTitle = String(req.body?.pageTitle || '').trim().slice(0, 200);
    const languageHint = String(req.body?.language || '').trim().slice(0, 8);

    if (!text || !chatId) {
      return res.status(400).json({ success: false, message: 'text and chatId required' });
    }
    if (tooFast(chatId)) {
      return res.status(429).json({ success: false, message: 'Too many requests' });
    }

    try {
      const reply = await processWebMessage({
        chatId,
        text,
        pageUrl,
        pageTitle,
        languageHint,
      });
      return res.json({
        success: true,
        reply: reply.text,
        language: reply.language,
        chatId,
      });
    } catch (err) {
      console.error('webchat:', err.message);
      return res.status(500).json({ success: false, message: 'Chat unavailable' });
    }
  });
}

module.exports = { registerWebchatRoutes, normalizeChatId };
