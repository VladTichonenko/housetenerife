const QRCode = require('qrcode');
const { getBotConfig, saveBotConfig } = require('./bot-config');
const { getKnowledgeBase, saveKnowledgeBase } = require('./knowledge-base');
const { listProperties } = require('./property-catalog');
const { listHandoffs, getHandoff, assignHandoff, closeHandoff } = require('./handoff-leads');
const { listClients, getClient } = require('./clients-store');
const { getDbStats, DB_PATH } = require('./db');
const {
  findManagerByCode,
  createToken,
  getSession,
  isValidToken,
  listManagersPublic,
} = require('./managers-auth');
const {
  recordMessage,
  getMessages,
  listConversationChats,
} = require('./conversation-store');
const { getChatSettings, setAiDisabled } = require('./chat-settings');
const { getInterestedProperties } = require('./property-interest');

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const session = getSession(token);
  if (!session) {
    return res.status(401).json({ success: false, message: 'Требуется авторизация' });
  }
  req.managerSession = session;
  next();
}

function registerAdminRoutes(app, state) {
  app.post('/api/admin/login', (req, res) => {
    const code = String(req.body?.code || '').trim();
    const manager = findManagerByCode(code);
    if (!manager) {
      return res.status(401).json({ success: false, message: 'Неверный пароль' });
    }
    const token = createToken(manager);
    res.json({
      success: true,
      token,
      manager: { id: manager.id, name: manager.name },
    });
  });

  app.get('/api/admin/me', requireAdmin, (req, res) => {
    res.json({
      success: true,
      manager: {
        id: req.managerSession.managerId,
        name: req.managerSession.managerName,
      },
    });
  });

  app.get('/api/admin/managers', requireAdmin, (req, res) => {
    res.json({ success: true, managers: listManagersPublic() });
  });

  app.get('/api/admin/session', requireAdmin, async (req, res) => {
    let ready = Boolean(state.botReady);
    let clientState = state.waWatchState || (ready ? 'CONNECTED' : 'unknown');
    let stateCached = true;

    try {
      if (typeof state.getAdminSessionSnapshot === 'function') {
        const snap = await state.getAdminSessionSnapshot();
        ready = Boolean(snap.ready);
        clientState = snap.clientState || clientState;
        stateCached = Boolean(snap.stateCached);
      } else if (state.client) {
        // Fallback: короткий race, без ожидания protocolTimeout (минуты)
        const timeoutMs = 2500;
        clientState = await Promise.race([
          state.client.getState(),
          new Promise((resolve) => setTimeout(() => resolve(clientState), timeoutMs)),
        ]);
        stateCached = clientState === (state.waWatchState || clientState);
        ready = clientState === 'CONNECTED' || ready;
      }
    } catch {
      clientState = state.waWatchState || 'error';
    }

    res.json({
      success: true,
      ready,
      clientState,
      stateCached,
      hasQr: Boolean(state.currentQr),
      account: state.accountInfo,
      manager: {
        id: req.managerSession.managerId,
        name: req.managerSession.managerName,
      },
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
        color: { dark: '#1a1a2e', light: '#ffffff' },
      });
      res.json({ success: true, qr: dataUrl });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post('/api/admin/session/logout', requireAdmin, async (req, res) => {
    if (typeof state.logoutWhatsAppSession !== 'function') {
      return res.status(501).json({ success: false, message: 'Выход из сессии не поддерживается' });
    }
    try {
      const result = await state.logoutWhatsAppSession();
      res.status(result.success ? 200 : 500).json(result);
    } catch (e) {
      res.status(500).json({ success: false, message: e.message || 'Ошибка выхода из сессии' });
    }
  });

  app.get('/api/admin/config', requireAdmin, (req, res) => {
    res.json({ success: true, config: getBotConfig() });
  });

  app.put('/api/admin/config', requireAdmin, (req, res) => {
    try {
      const config = saveBotConfig(req.body || {});
      res.json({
        success: true,
        config,
        message: 'Настройки сохранены. Бот использует их при следующем сообщении.',
      });
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
        updatedAt: knowledge._admin_meta?.updatedAt || null,
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
        limit: req.query.limit,
      });
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get('/api/admin/clients', requireAdmin, (req, res) => {
    try {
      const result = listClients({
        page: req.query.page,
        limit: req.query.limit,
        q: req.query.q,
      });
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get('/api/admin/db/stats', requireAdmin, (req, res) => {
    try {
      const stats = getDbStats();
      res.json({ success: true, stats, path: DB_PATH });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get('/api/admin/db/users', requireAdmin, (req, res) => {
    try {
      const result = listClients({
        page: req.query.page,
        limit: req.query.limit,
        q: req.query.q,
      });
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get('/api/admin/db/users/:id', requireAdmin, (req, res) => {
    try {
      const item = getClient(req.params.id);
      if (!item) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
      }
      const messages = getMessages(req.params.id);
      res.json({ success: true, item, messages });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get('/api/admin/clients/:id', requireAdmin, (req, res) => {
    try {
      const item = getClient(req.params.id);
      if (!item) {
        return res.status(404).json({ success: false, message: 'Клиент не найден' });
      }
      res.json({ success: true, item });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get('/api/admin/conversations', requireAdmin, (req, res) => {
    try {
      const result = listConversationChats({
        page: req.query.page,
        limit: req.query.limit,
        q: req.query.q,
      });
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get('/api/admin/chats/:chatId/messages', requireAdmin, (req, res) => {
    try {
      const chatId = decodeURIComponent(req.params.chatId);
      const excludeAssistant = req.query.excludeAssistant === 'true';
      let messages = getMessages(chatId, { excludeAssistant });
      const settings = getChatSettings(chatId);
      const client = getClient(chatId);
      const interestedProperties = getInterestedProperties(chatId, client?.language || 'ru');

      if (!messages.length && client?.lastMessages?.length) {
        messages = client.lastMessages.map((m, idx) => ({
          id: `legacy-${idx}`,
          role: 'user',
          text: m.text,
          at: m.at,
          kind: m.kind || 'text',
        }));
      }

      res.json({
        success: true,
        chatId,
        messages,
        settings,
        client,
        interestedProperties,
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post('/api/admin/chats/:chatId/messages', requireAdmin, async (req, res) => {
    try {
      const chatId = decodeURIComponent(req.params.chatId);
      const text = String(req.body?.text || '').trim();
      if (!text) {
        return res.status(400).json({ success: false, message: 'Текст сообщения обязателен' });
      }
      if (typeof state.sendManagerMessage !== 'function') {
        return res.status(501).json({ success: false, message: 'Отправка сообщений недоступна' });
      }

      const result = await state.sendManagerMessage(chatId, text, {
        managerId: req.managerSession.managerId,
        managerName: req.managerSession.managerName,
      });

      if (!result.success) {
        return res.status(result.status || 500).json(result);
      }

      res.json({ success: true, message: result.message, settings: result.settings });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.put('/api/admin/chats/:chatId/ai-disabled', requireAdmin, (req, res) => {
    try {
      const chatId = decodeURIComponent(req.params.chatId);
      const disabled = Boolean(req.body?.disabled);
      const settings = setAiDisabled(chatId, disabled);
      res.json({ success: true, settings });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get('/api/admin/handoffs', requireAdmin, (req, res) => {
    try {
      let filter = req.query.filter || 'open';
      let managerId = String(req.query.managerId || '');
      if (filter === 'mine') {
        managerId = req.managerSession.managerId;
      }

      const result = listHandoffs({
        page: req.query.page,
        limit: req.query.limit,
        q: req.query.q,
        filter,
        managerId,
      });
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get('/api/admin/handoffs/:id', requireAdmin, (req, res) => {
    try {
      const item = getHandoff(req.params.id);
      if (!item) {
        return res.status(404).json({ success: false, message: 'Лид не найден' });
      }
      const settings = getChatSettings(item.chatId);
      const interestedProperties =
        item.interestedProperties?.length
          ? item.interestedProperties
          : getInterestedProperties(item.chatId, item.language);
      res.json({
        success: true,
        item: { ...item, chatSettings: settings, interestedProperties },
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.put('/api/admin/handoffs/:id/assign', requireAdmin, (req, res) => {
    try {
      const item = assignHandoff(req.params.id, {
        id: req.managerSession.managerId,
        name: req.managerSession.managerName,
      });
      if (!item) {
        return res.status(404).json({ success: false, message: 'Заявка не найдена' });
      }
      res.json({ success: true, item });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.put('/api/admin/handoffs/:id/close', requireAdmin, (req, res) => {
    try {
      const item = closeHandoff(req.params.id, {
        id: req.managerSession.managerId,
        name: req.managerSession.managerName,
      });
      if (!item) {
        return res.status(404).json({ success: false, message: 'Заявка не найдена' });
      }
      res.json({ success: true, item });
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
        message: 'База знаний сохранена. Бот использует её при следующем сообщении.',
      });
    } catch (e) {
      res.status(400).json({ success: false, message: e.message });
    }
  });
}

module.exports = { registerAdminRoutes, requireAdmin, isValidToken };
