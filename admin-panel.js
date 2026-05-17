const fs = require('fs');
const path = require('path');
const express = require('express');

/**
 * React-панель на корне сайта (как в bot_rassylka): /, /assets/*
 * @returns {{ ok: boolean, distPath: string, indexHtml: string }}
 */
function setupAdminPanel(app) {
  const distPath = path.join(__dirname, 'web', 'dist');
  const indexHtml = path.join(distPath, 'index.html');
  const assetsDir = path.join(distPath, 'assets');
  const ok = fs.existsSync(indexHtml) && fs.existsSync(assetsDir);

  if (!ok) {
    console.warn(
      '⚠️ Веб-панель не собрана (web/dist). Docker: пересоберите образ. Локально: npm run build:web'
    );
    app.get('/', (req, res) => {
      res.status(503).json({
        success: false,
        message: 'Панель не собрана. Откройте /health для статуса бота.'
      });
    });
    return { ok: false, distPath, indexHtml };
  }

  const assetFiles = fs.readdirSync(assetsDir);
  console.log(`✅ Веб-панель: ${distPath} (${assetFiles.length} assets)`);

  // Старые ссылки /admin → корень
  app.get(['/admin', '/admin/'], (req, res) => {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(301, '/' + q);
  });
  app.get(/^\/admin\/.+/, (req, res) => {
    const sub = req.path.replace(/^\/admin/, '') || '/';
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(301, sub + q);
  });

  app.use(
    express.static(distPath, {
      index: 'index.html',
      maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
      fallthrough: true
    })
  );

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }
    if (req.path.startsWith('/api')) {
      return next();
    }
    if (/\.[a-z0-9]+$/i.test(req.path)) {
      return res.status(404).type('text/plain').send('Not found');
    }
    res.sendFile(indexHtml, (err) => {
      if (err) {
        console.error('[web] sendFile:', err.message);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: 'Ошибка загрузки панели' });
        }
      }
    });
  });

  app.get('/panel-health', (req, res) => {
    res.json({ success: true, adminUi: true, assets: assetFiles.length });
  });

  return { ok: true, distPath, indexHtml };
}

function getAdminPanelStatus() {
  const distPath = path.join(__dirname, 'web', 'dist');
  const indexHtml = path.join(distPath, 'index.html');
  const assetsDir = path.join(distPath, 'assets');
  return {
    adminUi: fs.existsSync(indexHtml),
    adminAssets: fs.existsSync(assetsDir)
  };
}

module.exports = { setupAdminPanel, getAdminPanelStatus };
