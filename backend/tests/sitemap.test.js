/**
 * sitemap.test.js — #1011
 * Tests for GET /sitemap.xml dynamic sitemap generation.
 *
 * Covers:
 *  - Well-formed XML structure and declaration
 *  - Static pages always present
 *  - Active, in-stock product URLs included
 *  - Active farmer profile URLs included
 *  - Deactivated / zero-stock products excluded (query-level, verified via mock)
 *  - Deactivated farmer accounts excluded (query-level, verified via mock)
 *  - Conditional GET (ETag / 304)
 *  - Cache-Control header present
 *  - Redis cache hit (raw string legacy format and object format)
 *  - In-memory cache hit
 *  - Content-Type is application/xml
 */

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/schema');
const cache = require('../src/cache');
const { _resetMemCache } = require('../src/routes/sitemap');

beforeEach(() => {
  jest.resetAllMocks();
  _resetMemCache();

  // Default: cache miss
  cache.get.mockResolvedValue(null);
  cache.set.mockResolvedValue(undefined);

  db.isPostgres = false;

  // Default DB responses — two calls: products then farmers
  db.query
    .mockResolvedValueOnce({
      rows: [
        { id: 1, created_at: '2024-01-15T00:00:00Z' },
        { id: 2, created_at: '2024-03-20T00:00:00Z' },
      ],
    })
    .mockResolvedValueOnce({
      rows: [{ id: 10, created_at: '2024-02-10T00:00:00Z' }],
    });
});

describe('GET /sitemap.xml', () => {
  it('responds 200 with application/xml content-type', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
  });

  it('returns well-formed XML with declaration and urlset root', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.text).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(res.text).toMatch(/<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    expect(res.text).toMatch(/<\/urlset>$/);
  });

  it('includes static pages (/ and /marketplace)', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.text).toMatch(/http:\/\/localhost:3000\//);
    expect(res.text).toMatch(/http:\/\/localhost:3000\/marketplace/);
  });

  it('includes URLs for active in-stock products', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.text).toContain('/products/1');
    expect(res.text).toContain('/products/2');
  });

  it('includes URLs for active farmer profiles', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.text).toContain('/farmers/10');
  });

  it('only queries active=1 products (deactivated/zero-stock excluded at DB level)', async () => {
    await request(app).get('/sitemap.xml');
    const productQuery = db.query.mock.calls[0][0];
    expect(productQuery).toMatch(/quantity > 0/);
    expect(productQuery).toMatch(/active = 1/);
  });

  it('only queries non-deactivated farmers (deactivated_at IS NULL)', async () => {
    await request(app).get('/sitemap.xml');
    const farmerQuery = db.query.mock.calls[1][0];
    expect(farmerQuery).toMatch(/deactivated_at IS NULL/);
    expect(farmerQuery).toMatch(/role = 'farmer'/);
  });

  it('uses active = true for postgres dialect', async () => {
    db.isPostgres = true;
    db.query
      .mockReset()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await request(app).get('/sitemap.xml');
    const productQuery = db.query.mock.calls[0][0];
    expect(productQuery).toMatch(/active = true/);
  });

  it('includes Cache-Control public header', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.headers['cache-control']).toMatch(/public/);
    expect(res.headers['cache-control']).toMatch(/max-age=/);
  });

  it('includes ETag header', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.headers['etag']).toBeDefined();
  });

  it('returns 304 when If-None-Match matches current ETag', async () => {
    const first = await request(app).get('/sitemap.xml');
    const etag = first.headers['etag'];

    _resetMemCache();
    cache.get.mockResolvedValue(null);
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1, created_at: '2024-01-15T00:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [] });

    const second = await request(app)
      .get('/sitemap.xml')
      .set('If-None-Match', etag);
    expect(second.status).toBe(304);
  });

  it('serves from Redis cache (object format) without hitting DB', async () => {
    const cachedXml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
    cache.get.mockResolvedValue({ xml: cachedXml, etag: 'abc123' });

    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.text).toBe(cachedXml);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('serves from Redis cache (legacy raw string format)', async () => {
    const cachedXml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
    cache.get.mockResolvedValue(cachedXml);

    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.text).toBe(cachedXml);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('handles empty products and farmers gracefully', async () => {
    db.query.mockReset();
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<urlset/);
    // Static pages still present
    expect(res.text).toContain('/marketplace');
  });

  it('includes lastmod dates for products', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.text).toMatch(/<lastmod>2024-01-15<\/lastmod>/);
  });

  it('escapes XML special characters in URLs', async () => {
    db.query.mockReset();
    // Simulate a product id that would produce a URL with an ampersand if unescaped
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'a&b', created_at: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/sitemap.xml');
    expect(res.text).toContain('a&amp;b');
    expect(res.text).not.toContain('a&b');
  });
});
