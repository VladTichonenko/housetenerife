const crypto = require('crypto');
const QRCode = require('qrcode');
const { getBotConfig, saveBotConfig } = require('./bot-config');
const { getKnowledgeBase, saveKnowledgeBase } = require('./knowledge-base');
const { listProperties } = require('./property-catalog');

const ADMIN_CODE = process.env.ADMIN_CODE || '0397';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const sessions = new Map();

function createToken() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: Date.now() });
  return token;
}

function isValidToken(token) {
  if (!token || !sessions.has(token)) return false;
  const session = sessions.get(token);
  if (Date.now() - session.createdAt > TOKEN_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!isValidToken(token)) {
    return res.status(401).json({ success: false, message: 'Требуется авторизация' });
  }
  next();
}

function registerAdminRoutes(app, state) {
  app.post('/api/admin/login', (req, res) => {
    const code = String(req.body?.code || '').trim();
    if (code !== ADMIN_CODE) {
      return res.status(401).json({ success: false, message: 'Неверный код доступа' });
    }
    const token = createToken();
    res.json({ success: true, token });
  });

  app.get('/api/admin/session', requireAdmin, async (req, res) => {
    let clientState = 'unknown';
    try {
      if (state.client) {
        clientState = await state.client.getState();
      }
    } catch (e) {
      clientState = 'error';
    }

    res.json({
      success: true,
      ready: state.botReady,
      clientState,
      hasQr: Boolean(state.currentQr),
      account: state.accountInfo
    });
  });

  app.get('/api/admin/qr', requireAdmin, async (req, res) => {
    if (!state.currentQr) {
      return res.json({ success: true, qr: null, message: 'QR не требуется — сессия активна' });
    }
    try {
      const dataUrl = await QRCode.toDataURL(state.currentQr, {
        width: 280,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' }
      });
      res.json({ success: true, qr: dataUrl });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get('/api/admin/config', requireAdmin, (req, res) => {
    res.json({ success: true, config: getBotConfig() });
  });

  app.put('/api/admin/config', requireAdmin, (req, res) => {
    try {
      const config = saveBotConfig(req.body || {});
      res.json({ success: true, config, message: 'Настройки сохранены. Бот использует их при следующем сообщении.' });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get('/api/admin/knowledge', requireAdmin, (req, res) => {
    try {
      const knowledge = getKnowledgeBase();
      res.json({
        success: true,
        knowledge,
        updatedAt: knowledge._admin_meta?.updatedAt || null
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get('/api/admin/properties', requireAdmin, (req, res) => {
    try {
      const result = listProperties({
        q: req.query.q,
        page: req.query.page,
        limit: req.query.limit
      });
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.put('/api/admin/knowledge', requireAdmin, (req, res) => {
    try {
      const knowledge = saveKnowledgeBase(req.body?.knowledge ?? req.body);
      res.json({
        success: true,
        knowledge,
        updatedAt: knowledge._admin_meta?.updatedAt,
        message: 'База знаний сохранена. Бот использует её при следующем сообщении.'
      });
    } catch (e) {
      res.status(400).json({ success: false, message: e.message });
    }
  });
}

module.exports = { registerAdminRoutes, requireAdmin };
