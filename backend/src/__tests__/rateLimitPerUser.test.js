/**
 * rateLimitPerUser.test.js
 *
 * Tests for the sliding-window rate-limit middleware.
 *
 * Strategy:
 *   - Force in-memory mode by unsetting REDIS_URL.
 *   - Build minimal Express apps that mount the limiter directly (not the full app),
 *     so limits can be set to small values without fighting the prod defaults.
 *   - Call _reset() in beforeEach to clear the in-memory store between tests.
 *   - Use jest fake timers so sliding-window expiry can be verified without sleeping.
 *
 * Scenarios covered:
 *   Per-user limiter:
 *     - Allows requests within the limit
 *     - Blocks the (N+1)th request with HTTP 429 and code: 'rate_limit_exceeded'
 *     - Sets X-RateLimit-Limit and X-RateLimit-Remaining headers correctly
 *     - Sets Retry-After header on rejection
 *     - X-RateLimit-Remaining decrements with each request
 *     - Different users are tracked independently
 *     - Sliding window: requests older than the window expire and free capacity
 *     - Returns 401 when req.user is absent
 *
 *   Per-IP limiter:
 *     - Allows requests within the limit
 *     - Blocks the (N+1)th request with HTTP 429 and code: 'rate_limit_exceeded'
 *     - Sets required response headers
 *     - Sets Retry-After on rejection
 *     - Sliding window: old requests expire
 *
 *   Response body:
 *     - 429 body contains { success: false, code: 'rate_limit_exceeded' }
 */

process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const express = require('express');
const request = require('supertest');

const {
  createPerUserRateLimiter,
  createPerIpRateLimiter,
  _reset,
} = require('../middleware/rateLimitPerUser');

beforeEach(() => {
  _reset();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2024-06-01T00:00:00.000Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

// ── helpers ─────────────────────────────────────────────────────────────────

function buildUserApp(maxRequests, windowMs) {
  const app = express();
  app.use(express.json());
  // Inject a fake user so auth-limiter doesn't 401 on us
  app.use((req, _res, next) => {
    req.user = { id: parseInt(req.headers['x-user-id'] || '1', 10), role: 'buyer' };
    next();
  });
  const limiter = createPerUserRateLimiter(maxRequests, windowMs);
  app.post('/test', limiter, (_req, res) => res.json({ success: true }));
  return app;
}

function buildIpApp(maxRequests, windowMs) {
  const app = express();
  app.use(express.json());
  const limiter = createPerIpRateLimiter(maxRequests, windowMs);
  app.post('/test', limiter, (_req, res) => res.json({ success: true }));
  return app;
}

// ── per-user limiter ─────────────────────────────────────────────────────────

describe('Per-User Rate Limiter', () => {
  test('allows requests within the limit', async () => {
    const app = buildUserApp(3, 60_000);
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/test').set('x-user-id', '1');
      expect(res.status).toBe(200);
    }
  });

  test('blocks the (limit+1)th request with HTTP 429', async () => {
    const app = buildUserApp(3, 60_000);
    for (let i = 0; i < 3; i++) {
      await request(app).post('/test').set('x-user-id', '1');
    }
    const res = await request(app).post('/test').set('x-user-id', '1');
    expect(res.status).toBe(429);
  });

  test('429 body has code: rate_limit_exceeded', async () => {
    const app = buildUserApp(1, 60_000);
    await request(app).post('/test').set('x-user-id', '1');
    const res = await request(app).post('/test').set('x-user-id', '1');
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ success: false, code: 'rate_limit_exceeded' });
  });

  test('sets X-RateLimit-Limit and X-RateLimit-Remaining headers', async () => {
    const app = buildUserApp(5, 60_000);
    const res = await request(app).post('/test').set('x-user-id', '1');
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('5');
    expect(res.headers['x-ratelimit-remaining']).toBe('4');
  });

  test('X-RateLimit-Remaining decrements with each request', async () => {
    const app = buildUserApp(5, 60_000);
    const r1 = await request(app).post('/test').set('x-user-id', '1');
    const r2 = await request(app).post('/test').set('x-user-id', '1');
    const r3 = await request(app).post('/test').set('x-user-id', '1');
    expect(r1.headers['x-ratelimit-remaining']).toBe('4');
    expect(r2.headers['x-ratelimit-remaining']).toBe('3');
    expect(r3.headers['x-ratelimit-remaining']).toBe('2');
  });

  test('sets Retry-After header on rejection', async () => {
    const app = buildUserApp(1, 60_000);
    await request(app).post('/test').set('x-user-id', '1');
    const res = await request(app).post('/test').set('x-user-id', '1');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
  });

  test('Retry-After reflects the window length in seconds', async () => {
    const app = buildUserApp(1, 30_000);
    await request(app).post('/test').set('x-user-id', '1');
    const res = await request(app).post('/test').set('x-user-id', '1');
    expect(res.headers['retry-after']).toBe('30');
  });

  test('different users are tracked independently', async () => {
    const app = buildUserApp(2, 60_000);
    // exhaust user 1's limit
    await request(app).post('/test').set('x-user-id', '1');
    await request(app).post('/test').set('x-user-id', '1');
    const blocked = await request(app).post('/test').set('x-user-id', '1');
    expect(blocked.status).toBe(429);
    // user 2 still has capacity
    const allowed = await request(app).post('/test').set('x-user-id', '2');
    expect(allowed.status).toBe(200);
  });

  test('sliding window: requests older than the window expire and free capacity', async () => {
    const app = buildUserApp(2, 60_000);

    // Fill the window
    await request(app).post('/test').set('x-user-id', '1');
    await request(app).post('/test').set('x-user-id', '1');

    // At limit — should be blocked
    const blocked = await request(app).post('/test').set('x-user-id', '1');
    expect(blocked.status).toBe(429);

    // Advance past the full window so all stored timestamps expire
    jest.advanceTimersByTime(60_001);

    // Window reset — request should succeed
    const allowed = await request(app).post('/test').set('x-user-id', '1');
    expect(allowed.status).toBe(200);
  });

  test('returns 401 when req.user is absent', async () => {
    // Build an app WITHOUT the user-injection middleware
    const app = express();
    app.use(express.json());
    const limiter = createPerUserRateLimiter(10, 60_000);
    app.post('/test', limiter, (_req, res) => res.json({ success: true }));

    const res = await request(app).post('/test');
    expect(res.status).toBe(401);
  });
});

// ── per-IP limiter ───────────────────────────────────────────────────────────

describe('Per-IP Rate Limiter', () => {
  test('allows requests within the limit', async () => {
    const app = buildIpApp(3, 60_000);
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/test');
      expect(res.status).toBe(200);
    }
  });

  test('blocks the (limit+1)th request with HTTP 429', async () => {
    const app = buildIpApp(3, 60_000);
    for (let i = 0; i < 3; i++) {
      await request(app).post('/test');
    }
    const res = await request(app).post('/test');
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('rate_limit_exceeded');
  });

  test('sets X-RateLimit-Limit and X-RateLimit-Remaining headers', async () => {
    const app = buildIpApp(5, 60_000);
    const res = await request(app).post('/test');
    expect(res.headers['x-ratelimit-limit']).toBe('5');
    expect(res.headers['x-ratelimit-remaining']).toBe('4');
  });

  test('sets Retry-After header on rejection', async () => {
    const app = buildIpApp(1, 45_000);
    await request(app).post('/test');
    const res = await request(app).post('/test');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('45');
  });

  test('sliding window: old requests expire and allow new ones', async () => {
    const app = buildIpApp(2, 60_000);

    await request(app).post('/test');
    await request(app).post('/test');

    const blocked = await request(app).post('/test');
    expect(blocked.status).toBe(429);

    jest.advanceTimersByTime(60_001);

    const allowed = await request(app).post('/test');
    expect(allowed.status).toBe(200);
  });
});

// ── response body ────────────────────────────────────────────────────────────

describe('429 response body', () => {
  test('contains success: false and code: rate_limit_exceeded', async () => {
    const app = buildUserApp(1, 60_000);
    await request(app).post('/test').set('x-user-id', '42');
    const res = await request(app).post('/test').set('x-user-id', '42');
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      success: false,
      code: 'rate_limit_exceeded',
    });
  });
});
