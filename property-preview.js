/**
 * GET /p/:id?lang=en — HTML с og:* для превью WhatsApp, редирект на страницу объекта.
 */
const express = require('express');
const {
  load,
  getLocalizedItem,
  normalizeLang,
  getCatalogSiteUrl,
  cleanDescription
} = require('./property-catalog');

const router = express.Router();

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function findById(id) {
  const up = String(id || '').toUpperCase();
  const data = load();
  return data.items.find((i) => String(i.id || '').toUpperCase() === up) || null;
}

router.get('/p/:id', (req, res) => {
  const item = findById(req.params.id);
  const lang = normalizeLang(req.query.lang || req.query.l || 'en');

  if (!item) {
    return res.redirect(302, getCatalogSiteUrl(lang));
  }

  const loc = getLocalizedItem(item, lang);
  const target = loc.url || getCatalogSiteUrl(lang);
  const title = escapeHtml(loc.title);
  const desc = escapeHtml(cleanDescription(loc.description));
  const image = item.ogImage ? escapeHtml(item.ogImage) : '';

  res.set('Cache-Control', 'public, max-age=3600');
  res.type('html').send(`<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${title}"/>
<meta property="og:description" content="${desc}"/>
<meta property="og:url" content="${escapeHtml(target)}"/>
${image ? `<meta property="og:image" content="${image}"/>` : ''}
<meta name="twitter:card" content="summary_large_image"/>
<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}"/>
</head>
<body><p><a href="${escapeHtml(target)}">${title}</a></p></body>
</html>`);
});

module.exports = router;
