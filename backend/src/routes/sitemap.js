const crypto = require('crypto');
const router = require('express').Router();
const db = require('../db/schema');
const cache = require('../cache');

const BASE_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const CACHE_TTL = 3600; // 1 hour in seconds

// In-memory fallback used when Redis is unavailable
let memCache = null; // { xml, etag, expires }

const STATIC_PAGES = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/marketplace', changefreq: 'daily', priority: '0.9' },
];

function toDateStr(ts) {
  if (!ts) return new Date().toISOString().split('T')[0];
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().split('T')[0] : d.toISOString().split('T')[0];
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  const lines = [`  <url>`, `    <loc>${escapeXml(loc)}</loc>`];
  if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
  if (changefreq) lines.push(`    <changefreq>${changefreq}</changefreq>`);
  if (priority) lines.push(`    <priority>${priority}</priority>`);
  lines.push(`  </url>`);
  return lines.join('\n');
}

async function generateSitemapXml() {
  const activeVal = db.isPostgres ? 'true' : '1';

  // Active, in-stock products only — excludes quantity=0 and deactivated (active=false/0)
  const { rows: products } = await db.query(
    `SELECT id, created_at FROM products
     WHERE quantity > 0 AND active = ${activeVal}
     ORDER BY id ASC`
  );

  // Public farmer profiles — excludes deactivated accounts
  const { rows: farmers } = await db.query(
    `SELECT id, created_at FROM users
     WHERE role = 'farmer' AND deactivated_at IS NULL AND active = ${activeVal}
     ORDER BY id ASC`
  );

  const entries = [
    ...STATIC_PAGES.map(({ path, changefreq, priority }) =>
      urlEntry({ loc: `${BASE_URL}${path}`, changefreq, priority })
    ),
    ...products.map((p) =>
      urlEntry({
        loc: `${BASE_URL}/products/${p.id}`,
        lastmod: toDateStr(p.created_at),
        changefreq: 'weekly',
        priority: '0.6',
      })
    ),
    ...farmers.map((f) =>
      urlEntry({
        loc: `${BASE_URL}/farmers/${f.id}`,
        lastmod: toDateStr(f.created_at),
        changefreq: 'weekly',
        priority: '0.7',
      })
    ),
  ];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries.join('\n'),
    '</urlset>',
  ].join('\n');
}

router.get('/', async (req, res) => {
  let xml;
  let etag;

  // 1. Redis cache (shared across instances)
  const redisHit = await cache.get('sitemap');
  if (redisHit) {
    if (typeof redisHit === 'string') {
      // Tolerate legacy cache format that stored raw XML
      xml = redisHit;
      etag = crypto.createHash('sha1').update(xml).digest('hex');
    } else if (redisHit.xml) {
      xml = redisHit.xml;
      etag = redisHit.etag;
    }
  }

  // 2. In-memory fallback (single-instance, no Redis)
  if (!xml && memCache && Date.now() < memCache.expires) {
    xml = memCache.xml;
    etag = memCache.etag;
  }

  // 3. Generate fresh, then populate both cache tiers
  if (!xml) {
    xml = await generateSitemapXml();
    etag = crypto.createHash('sha1').update(xml).digest('hex');
    await cache.set('sitemap', { xml, etag }, CACHE_TTL);
    memCache = { xml, etag, expires: Date.now() + CACHE_TTL * 1000 };
  }

  res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL}`);
  res.setHeader('ETag', `"${etag}"`);

  // Honour conditional GET — avoids redundant XML transmission on re-crawl
  if (req.headers['if-none-match'] === `"${etag}"`) {
    return res.status(304).end();
  }

  res.type('application/xml').send(xml);
});

module.exports = router;
module.exports.generateSitemapXml = generateSitemapXml;
module.exports._resetMemCache = () => { memCache = null; };
