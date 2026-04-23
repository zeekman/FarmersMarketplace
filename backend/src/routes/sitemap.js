const router = require('express').Router();
const db = require('../db/schema');

const BASE_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const STATIC_URLS = ['/', '/marketplace'];

router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, updated_at FROM products WHERE quantity > 0 ORDER BY id`
  );

  const staticEntries = STATIC_URLS.map(
    (path) => `  <url><loc>${BASE_URL}${path}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`
  ).join('\n');

  const productEntries = rows.map(
    (p) =>
      `  <url><loc>${BASE_URL}/product/${p.id}</loc><lastmod>${new Date(p.updated_at || Date.now()).toISOString().split('T')[0]}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`
  ).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticEntries}
${productEntries}
</urlset>`;

  res.type('application/xml').send(xml);
});

module.exports = router;
