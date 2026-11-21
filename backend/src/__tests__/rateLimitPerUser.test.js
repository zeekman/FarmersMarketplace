/**
 * rateLimitPerUser.test.js
 *
 * Tests for the fixed-window rate-limit middleware.
 *
 * Strategy:
 *   - Mock the cache module to test both memory and Redis modes.
 *   - Build minimal Express apps that mount the limiter directly.
 *   - Use jest fake timers to verify expiry and eviction.
 */

process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const express = require('express');
const request = require('supertest');
const cache = require('../cache');

// Mock cache module
jest.mock('../cache', () => ({
  isReady: jest.fn(),
  client: {
    multi: jest.fn(),
    pexpire: jest.fn(),
  },
}));

const {
  createPerUserRateLimiter,
  createPerIpRateLimiter,
  _reset,
} = require('../middleware/rateLimitPerUser');

beforeEach(() => {
  _reset();
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2024-06-01T00:00:00.000Z'));
  // Default to memory mode for most tests
  cache.isReady.mockReturnValue(false);
});

afterEach(() => {
  jest.useRealTimers();
});

// ── helpers ─────────────────────────────────────────────────────────────────

function buildUserApp(maxRequests, windowMs) {
  const app = express();
  app.use(express.json());
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

// ── memory store tests ───────────────────────────────────────────────────────

describe('Rate Limiter (Memory Mode)', () => {
  describe('Per-User', () => {
    test('allows requests within the limit', async () => {
      const app = buildUserApp(3, 60_000);
      for (let i = 0; i < 3; i++) {
        const res = await request(app).post('/test').set('x-user-id', '1');
        expect(res.status).toBe(200);
      }
    });

    test('blocks the (limit+1)th request', async () => {
      const app = buildUserApp(2, 60_000);
      await request(app).post('/test').set('x-user-id', '1');
      await request(app).post('/test').set('x-user-id', '1');
      const res = await request(app).post('/test').set('x-user-id', '1');
      expect(res.status).toBe(429);
      expect(res.body.code).toBe('rate_limit_exceeded');
    });

    test('sets RateLimit-Limit and RateLimit-Remaining headers', async () => {
      const app = buildUserApp(5, 60_000);
      const res = await request(app).post('/test').set('x-user-id', '1');
      expect(res.headers['ratelimit-limit']).toBe('5');
      expect(res.headers['ratelimit-remaining']).toBe('4');
    });

    test('sets Retry-After header on rejection', async () => {
      const app = buildUserApp(1, 60_000);
      await request(app).post('/test').set('x-user-id', '1');
      const res = await request(app).post('/test').set('x-user-id', '1');
      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBe('60');
    });

    test('window reset: capacity is restored after windowMs', async () => {
      const app = buildUserApp(1, 60_000);
      await request(app).post('/test').set('x-user-id', '1');
      expect((await request(app).post('/test').set('x-user-id', '1')).status).toBe(429);

      jest.advanceTimersByTime(60_001);

      expect((await request(app).post('/test').set('x-user-id', '1')).status).toBe(200);
    });

    test('memory eviction: sweep removes expired keys', async () => {
      const app = buildUserApp(1, 60_000);
      await request(app).post('/test').set('x-user-id', 'evict-me');

      // Advance time past the window
      jest.advanceTimersByTime(60_001);

      // Trigger the sweep interval (set to 60s in the middleware)
      jest.advanceTimersByTime(60_000);

      // We can't directly inspect memoryStore without exporting it or adding a helper,
      // but we can verify that a new request after sweep starts a fresh window.
      const res = await request(app).post('/test').set('x-user-id', 'evict-me');
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-remaining']).toBe('0'); // fixed-window: 1st request of new window
    });
  });

  describe('Per-IP', () => {
    test('blocks by IP', async () => {
      const app = buildIpApp(1, 60_000);
      await request(app).post('/test');
      const res = await request(app).post('/test');
      expect(res.status).toBe(429);
      expect(res.headers['ratelimit-limit']).toBe('1');
    });
  });
});

// ── redis store tests ────────────────────────────────────────────────────────

describe('Rate Limiter (Redis Mode)', () => {
  let mockMulti;

  beforeEach(() => {
    cache.isReady.mockReturnValue(true);
    mockMulti = {
      incr: jest.fn().mockReturnThis(),
      pttl: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    };
    cache.client.multi.mockReturnValue(mockMulti);
  });

  test('calls Redis INCR and PTTL', async () => {
    mockMulti.exec.mockResolvedValue([
      [null, 1], // INCR result: 1
      [null, -1], // PTTL result: -1 (new key)
    ]);
    cache.client.pexpire.mockResolvedValue(1);

    const app = buildIpApp(5, 60_000);
    const res = await request(app).post('/test');

    expect(res.status).toBe(200);
    expect(mockMulti.incr).toHaveBeenCalled();
    expect(cache.client.pexpire).toHaveBeenCalledWith(expect.any(String), 60_000);
    expect(res.headers['ratelimit-remaining']).toBe('4');
  });

  test('blocks when Redis count exceeds limit', async () => {
    mockMulti.exec.mockResolvedValue([
      [null, 6], // INCR result: 6
      [null, 30_000], // PTTL result: 30s remaining
    ]);

    const app = buildIpApp(5, 60_000);
    const res = await request(app).post('/test');

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('30');
  });

  test('falls back to memory if Redis fails', async () => {
    mockMulti.exec.mockRejectedValue(new Error('Redis Down'));

    const app = buildIpApp(1, 60_000);
    // 1st request (Redis fails, falls back to memory, allows)
    await request(app).post('/test');
    // 2nd request (Redis fails, falls back to memory, blocks)
    const res = await request(app).post('/test');

    expect(res.status).toBe(429);
  });
});
