/**
 * Unit tests for routes/rates.js — XLM/USD exchange rate caching
 */

process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const request = require('supertest');

// Mock fetch before requiring app
global.fetch = jest.fn();

const app = require('../app');

describe('GET /api/rates/xlm-usd', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the cache module by clearing require cache
    jest.resetModules();
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('fetches rate from CoinGecko and caches it', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stellar: { usd: 0.123 },
      }),
    });

    const res = await request(app).get('/api/rates/xlm-usd');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.rate).toBe(0.123);
    expect(res.body.cached).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
      { headers: { Accept: 'application/json' } }
    );
  });

  it('returns cached rate on subsequent request within TTL', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stellar: { usd: 0.123 },
      }),
    });

    // First request
    await request(app).get('/api/rates/xlm-usd');

    // Second request (should use cache)
    const res = await request(app).get('/api/rates/xlm-usd');

    expect(res.status).toBe(200);
    expect(res.body.rate).toBe(0.123);
    expect(res.body.cached).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1); // Only called once
  });

  it('returns 502 when CoinGecko request fails and no cache exists', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const res = await request(app).get('/api/rates/xlm-usd');

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Unable to fetch exchange rate/i);
    expect(res.body.code).toBe('rate_fetch_error');
  });

  it('returns stale cache when CoinGecko fails but cache exists', async () => {
    // First request succeeds
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stellar: { usd: 0.123 },
      }),
    });

    await request(app).get('/api/rates/xlm-usd');

    // Manipulate time to expire cache (mock Date.now after 61 seconds)
    const originalDateNow = Date.now;
    Date.now = jest.fn(() => originalDateNow() + 61000);

    // Second request fails
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    const res = await request(app).get('/api/rates/xlm-usd');

    expect(res.status).toBe(200);
    expect(res.body.rate).toBe(0.123);
    expect(res.body.cached).toBe(true);
    expect(res.body.stale).toBe(true);

    Date.now = originalDateNow;
  });

  it('throws error when rate not found in CoinGecko response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}), // Empty response
    });

    const res = await request(app).get('/api/rates/xlm-usd');

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('rate_fetch_error');
  });

  it('throws error when stellar.usd is missing', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stellar: {}, // No usd field
      }),
    });

    const res = await request(app).get('/api/rates/xlm-usd');

    expect(res.status).toBe(502);
  });

  it('throws error when fetch throws network error', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network error'));

    const res = await request(app).get('/api/rates/xlm-usd');

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('rate_fetch_error');
  });

  it('caches rate for 60 seconds', async () => {
    const originalDateNow = Date.now;
    let currentTime = originalDateNow();
    Date.now = jest.fn(() => currentTime);

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        stellar: { usd: 0.123 },
      }),
    });

    // First request
    await request(app).get('/api/rates/xlm-usd');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Request at 59 seconds (still cached)
    currentTime += 59000;
    await request(app).get('/api/rates/xlm-usd');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Request at 61 seconds (cache expired)
    currentTime += 2000;
    await request(app).get('/api/rates/xlm-usd');
    expect(global.fetch).toHaveBeenCalledTimes(2);

    Date.now = originalDateNow;
  });

  it('handles rate value of 0', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stellar: { usd: 0 },
      }),
    });

    const res = await request(app).get('/api/rates/xlm-usd');

    expect(res.status).toBe(502); // 0 is falsy, treated as missing
  });

  it('handles very small rate values', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stellar: { usd: 0.000001 },
      }),
    });

    const res = await request(app).get('/api/rates/xlm-usd');

    expect(res.status).toBe(200);
    expect(res.body.rate).toBe(0.000001);
  });

  it('handles very large rate values', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stellar: { usd: 999999.99 },
      }),
    });

    const res = await request(app).get('/api/rates/xlm-usd');

    expect(res.status).toBe(200);
    expect(res.body.rate).toBe(999999.99);
  });

  it('works without authentication (public endpoint)', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stellar: { usd: 0.123 },
      }),
    });

    const res = await request(app).get('/api/rates/xlm-usd');

    expect(res.status).toBe(200);
  });

  it('handles JSON parse errors gracefully', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error('Invalid JSON');
      },
    });

    const res = await request(app).get('/api/rates/xlm-usd');

    expect(res.status).toBe(502);
  });
});
