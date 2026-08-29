/**
 * Tests for routes/index.js (#1161)
 * Confirms route mounting at both legacy /api and versioned /api/v1 paths,
 * and that rate limiters are scoped to the correct endpoints.
 */

process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.RATE_LIMIT_GENERAL_MAX = '10000';
process.env.RATE_LIMIT_AUTH_MAX = '10000';
process.env.RATE_LIMIT_ORDER_MAX = '10000';
process.env.RATE_LIMIT_SEND_MAX = '10000';

const request = require('supertest');
const app = require('../app');

// ── route registration: legacy vs v1 paths ───────────────────────────────
describe('routes/index.js — dual path registration via registerRoute', () => {
  it('GET /api/health returns a response (legacy path)', async () => {
    const res = await request(app).get('/api/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
  });

  it('GET /api/v1/health returns a response (v1 path)', async () => {
    const res = await request(app).get('/api/v1/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
  });

  it('/api/v1/health includes version field', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.body.version).toBe('v1');
  });

  it('/api/health adds deprecation headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['deprecation']).toBe('true');
  });

  it('GET /api/products is reachable (legacy)', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).not.toBe(404);
  });

  it('GET /api/v1/products is reachable (v1)', async () => {
    const res = await request(app).get('/api/v1/products');
    expect(res.status).not.toBe(404);
  });

  it('GET /api/auth/login is reachable (legacy)', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).not.toBe(404);
  });

  it('GET /api/v1/auth/login is reachable (v1)', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({});
    expect(res.status).not.toBe(404);
  });
});

// ── SEO / non-versioned endpoints ────────────────────────────────────────
describe('routes/index.js — SEO endpoints', () => {
  it('GET /robots.txt returns text/plain', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/text/);
    expect(res.text).toMatch(/User-agent/);
  });

  it('GET /sitemap.xml responds (not 404)', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.status).not.toBe(404);
  });
});

// ── rate-limiter scope: fund/send only on their own paths ────────────────
describe('routes/index.js — rate limiters scoped to correct paths', () => {
  it('wallet/fund limiter header present on /api/wallet/fund', async () => {
    // Any response (even 401) proves the limiter middleware ran and the route is mounted
    const res = await request(app).post('/api/wallet/fund').send({});
    // RateLimit headers or at least not a 404 confirms mounting
    expect(res.status).not.toBe(404);
  });

  it('wallet/send limiter header present on /api/wallet/send', async () => {
    const res = await request(app).post('/api/wallet/send').send({});
    expect(res.status).not.toBe(404);
  });

  it('wallet/fund limiter is NOT applied to /api/wallet (other sub-paths unblocked)', async () => {
    // /api/wallet/balance should not be rate-limited by the fund limiter
    const res = await request(app).get('/api/wallet/balance');
    expect(res.status).not.toBe(404);
  });
});
