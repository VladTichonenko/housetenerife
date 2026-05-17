const fs = require('fs');
const path = require('path');
const express = require('express');

/**
 * Статика React-панели на /admin (собирается в Docker: web/dist).
 * @returns {{ ok: boolean, distPath: string, indexHtml: string }}
 */
function setupAdminPanel(app) {
  const distPath = path.join(__dirname, 'web', 'dist');
  const indexHtml = path.join(distPath, 'index.html');
  const assetsDir = path.join(distPath, 'assets');
  const ok = fs.existsSync(indexHtml) && fs.existsSync(assetsDir);

  if (!ok) {
    console.warn(
      '⚠️ Панель /admin недоступна: нет web/dist/index.html или web/dist/assets. Пересоберите Docker-образ.'
    );
    app.get(['/admin', '/admin/', /^\/admin\/.+/], (req, res) => {
      res.status(503).json({
        success: false,
        message: 'Веб-панель не собрана. Проверьте логи сборки Docker (stage web-build).'
      });
    });
    return { ok: false, distPath, indexHtml };
  }

  const assetFiles = fs.readdirSync(assetsDir);
  console.log(`✅ Панель /admin: ${distPath} (${assetFiles.length} файлов в assets/)`);

  const cacheAge = process.env.NODE_ENV === 'production' ? '1d' : 0;

  // Только файлы из dist/assets — без redirect loop на /admin/
  app.use(
    '/admin/assets',
    express.static(assetsDir, { maxAge: cacheAge, fallthrough: false })
  );

  const sendIndex = (req, res) => {
    res.sendFile(indexHtml, (err) => {
      if (err) {
        console.error('[admin] sendFile:', err.message);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: 'Ошибка загрузки панели' });
        }
      }
    });
  };

  app.get(['/admin', '/admin/'], sendIndex);

  // Клиентские маршруты React (без расширения файла)
  app.get(/^\/admin\/.+/, (req, res) => {
    if (/\.[a-z0-9]+$/i.test(req.path)) {
      return res.status(404).type('text/plain').send('Not found');
    }
    sendIndex(req, res);
  });

  app.get('/admin/health', (req, res) => {
    res.status(200).json({
      success: true,
      adminUi: true,
      assets: assetFiles.length,
      distPath
    });
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
