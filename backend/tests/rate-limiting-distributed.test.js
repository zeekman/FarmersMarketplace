/**
 * Tests for distributed rate limiting with Redis backend
 * Simulates multiple backend instances sharing rate limit state
 */

const jwt = require('jsonwebtoken');
const { request } = require('./setup');
const { createRateLimitPerUser } = require('../src/middleware/rateLimitPerUser');
const redis = require('redis');

// Mock Redis client for testing
let mockRedisClient = null;
let redisOperations = [];

// Mock Redis implementation
jest.mock('redis', () => ({
  createClient: jest.fn(() => {
    mockRedisClient = {
      isOpen: true,
      connect: jest.fn(),
      quit: jest.fn(),
      on: jest.fn(),
      multi: jest.fn(() => ({
        zRemRangeByScore: jest.fn(function(key, min, max) {
          redisOperations.push({ op: 'zRemRangeByScore', key, min, max });
          return this;
        }),
        zAdd: jest.fn(function(key, scoreValue) {
          redisOperations.push({ op: 'zAdd', key, scoreValue });
          return this;
        }),
        zCard: jest.fn(function(key) {
          redisOperations.push({ op: 'zCard', key });
          return this;
        }),
        expire: jest.fn(function(key, ttl) {
          redisOperations.push({ op: 'expire', key, ttl });
          return this;
        }),
        exec: jest.fn(() => {
          // Simulate Redis responses - return current request count for testing
          const zCardResults = redisOperations.filter(op => op.op === 'zCard');
          const count = mockRedisRequestCount || 1;
          return Promise.resolve([
            [null, 0], // zRemRangeByScore
            [null, 1], // zAdd
            [null, count], // zCard - this is what we use for rate limiting
            [null, 1]  // expire
          ]);
        })
      }))
    };
    return mockRedisClient;
  })
}));

// Control mock Redis request count for testing
let mockRedisRequestCount = 1;

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';

describe('Distributed Rate Limiting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisOperations = [];
    mockRedisRequestCount = 1;
    
    // Mock Redis URL to enable Redis backend
    process.env.REDIS_URL = 'redis://localhost:6379';
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  describe('Per-user rate limiting with Redis', () => {
    it('should use Redis when REDIS_URL is configured', async () => {
      const limiter = createRateLimitPerUser({
        windowMs: 60000,
        max: 5,
        message: 'Too many requests'
      });

      const token = jwt.sign({ id: 1, role: 'buyer' }, SECRET);
      const req = {
        headers: { authorization: `Bearer ${token}` },
        ip: '127.0.0.1'
      };
      const res = {
        set: jest.fn(),
        status: jest.fn(() => ({ json: jest.fn() })),
        json: jest.fn()
      };
      const next = jest.fn();

      await limiter(req, res, next);

      expect(mockRedisClient.multi).toHaveBeenCalled();
      expect(redisOperations).toHaveLength(4);
      expect(redisOperations[0].op).toBe('zRemRangeByScore');
      expect(redisOperations[1].op).toBe('zAdd');
      expect(redisOperations[2].op).toBe('zCard');
      expect(redisOperations[3].op).toBe('expire');
      expect(next).toHaveBeenCalled();
    });

    it('should rate limit based on user ID, not IP', async () => {
      const limiter = createRateLimitPerUser({
        windowMs: 60000,
        max: 2,
        message: 'Too many requests'
      });

      const user1Token = jwt.sign({ id: 1, role: 'buyer' }, SECRET);
      const user2Token = jwt.sign({ id: 2, role: 'buyer' }, SECRET);

      // User 1 makes requests
      const req1a = {
        headers: { authorization: `Bearer ${user1Token}` },
        ip: '127.0.0.1'
      };
      const req1b = {
        headers: { authorization: `Bearer ${user1Token}` },
        ip: '192.168.1.1' // Different IP, same user
      };

      // User 2 makes request from same IP as user 1
      const req2 = {
        headers: { authorization: `Bearer ${user2Token}` },
        ip: '127.0.0.1' // Same IP as user 1
      };

      const createMockResponse = () => ({
        set: jest.fn(),
        status: jest.fn(() => ({ json: jest.fn() })),
        json: jest.fn()
      });

      // First request from user 1 (count = 1)
      mockRedisRequestCount = 1;
      const res1a = createMockResponse();
      const next1a = jest.fn();
      await limiter(req1a, res1a, next1a);
      expect(next1a).toHaveBeenCalled();
      expect(redisOperations.some(op => op.key === 'rate_limit:user:1')).toBe(true);

      // Second request from user 1 (count = 2)
      redisOperations = [];
      mockRedisRequestCount = 2;
      const res1b = createMockResponse();
      const next1b = jest.fn();
      await limiter(req1b, res1b, next1b);
      expect(next1b).toHaveBeenCalled();
      expect(redisOperations.some(op => op.key === 'rate_limit:user:1')).toBe(true);

      // Third request from user 1 should be rate limited (count = 3 > max = 2)
      redisOperations = [];
      mockRedisRequestCount = 3;
      const res1c = createMockResponse();
      const next1c = jest.fn();
      await limiter(req1a, res1c, next1c);
      expect(next1c).not.toHaveBeenCalled();
      expect(res1c.status).toHaveBeenCalledWith(429);

      // First request from user 2 should succeed (different user, count = 1)
      redisOperations = [];
      mockRedisRequestCount = 1;
      const res2 = createMockResponse();
      const next2 = jest.fn();
      await limiter(req2, res2, next2);
      expect(next2).toHaveBeenCalled();
      expect(redisOperations.some(op => op.key === 'rate_limit:user:2')).toBe(true);
    });

    it('should handle requests without auth token using IP fallback', async () => {
      const limiter = createRateLimitPerUser({
        windowMs: 60000,
        max: 2,
        message: 'Too many requests'
      });

      const req = {
        headers: {},
        ip: '127.0.0.1'
      };
      const res = {
        set: jest.fn(),
        status: jest.fn(() => ({ json: jest.fn() })),
        json: jest.fn()
      };
      const next = jest.fn();

      await limiter(req, res, next);

      expect(redisOperations.some(op => op.key === 'rate_limit:ip:127.0.0.1')).toBe(true);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Multi-instance coordination', () => {
    it('should enforce combined rate limits across simulated instances', async () => {
      const limiter = createRateLimitPerUser({
        windowMs: 60000,
        max: 3,
        message: 'Rate limit exceeded'
      });

      const token = jwt.sign({ id: 1, role: 'buyer' }, SECRET);

      // Simulate instance 1 handling 2 requests
      mockRedisRequestCount = 2;
      const req1 = {
        headers: { authorization: `Bearer ${token}` },
        ip: '127.0.0.1'
      };
      const res1 = {
        set: jest.fn(),
        status: jest.fn(() => ({ json: jest.fn() })),
        json: jest.fn()
      };
      const next1 = jest.fn();
      await limiter(req1, res1, next1);
      expect(next1).toHaveBeenCalled();

      // Simulate instance 2 handling 1 more request (total: 3, at limit)
      redisOperations = [];
      mockRedisRequestCount = 3;
      const req2 = {
        headers: { authorization: `Bearer ${token}` },
        ip: '192.168.1.1' // Different IP (simulating different instance)
      };
      const res2 = {
        set: jest.fn(),
        status: jest.fn(() => ({ json: jest.fn() })),
        json: jest.fn()
      };
      const next2 = jest.fn();
      await limiter(req2, res2, next2);
      expect(next2).toHaveBeenCalled();

      // Simulate instance 3 handling request that should be rate limited (total: 4 > max: 3)
      redisOperations = [];
      mockRedisRequestCount = 4;
      const req3 = {
        headers: { authorization: `Bearer ${token}` },
        ip: '10.0.0.1' // Another different IP (simulating third instance)
      };
      const res3 = {
        set: jest.fn(),
        status: jest.fn(() => ({ json: jest.fn() })),
        json: jest.fn()
      };
      const next3 = jest.fn();
      await limiter(req3, res3, next3);
      
      expect(next3).not.toHaveBeenCalled();
      expect(res3.status).toHaveBeenCalledWith(429);
    });

    it('should set proper rate limit headers with Redis backend', async () => {
      const limiter = createRateLimitPerUser({
        windowMs: 60000,
        max: 5,
        message: 'Rate limit exceeded'
      });

      const token = jwt.sign({ id: 1, role: 'buyer' }, SECRET);
      mockRedisRequestCount = 2; // 2 requests already made

      const req = {
        headers: { authorization: `Bearer ${token}` },
        ip: '127.0.0.1'
      };
      const res = {
        set: jest.fn(),
        status: jest.fn(() => ({ json: jest.fn() })),
        json: jest.fn()
      };
      const next = jest.fn();

      await limiter(req, res, next);

      expect(res.set).toHaveBeenCalledWith({
        'X-RateLimit-Limit': 5,
        'X-RateLimit-Remaining': 3, // 5 - 2 = 3
        'X-RateLimit-Reset': expect.any(String)
      });
    });
  });

  describe('Fallback to memory store', () => {
    it('should fall back to memory store when Redis is not available', async () => {
      delete process.env.REDIS_URL;
      
      const limiter = createRateLimitPerUser({
        windowMs: 60000,
        max: 2,
        message: 'Rate limit exceeded'
      });

      const token = jwt.sign({ id: 1, role: 'buyer' }, SECRET);
      const req = {
        headers: { authorization: `Bearer ${token}` },
        ip: '127.0.0.1'
      };
      const res = {
        set: jest.fn(),
        status: jest.fn(() => ({ json: jest.fn() })),
        json: jest.fn()
      };
      const next = jest.fn();

      await limiter(req, res, next);

      // Should not have made Redis calls
      expect(redisOperations).toHaveLength(0);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should continue on Redis errors', async () => {
      // Mock Redis error
      mockRedisClient.multi = jest.fn(() => ({
        zRemRangeByScore: jest.fn(function() { return this; }),
        zAdd: jest.fn(function() { return this; }),
        zCard: jest.fn(function() { return this; }),
        expire: jest.fn(function() { return this; }),
        exec: jest.fn(() => Promise.reject(new Error('Redis connection failed')))
      }));

      const limiter = createRateLimitPerUser({
        windowMs: 60000,
        max: 2,
        message: 'Rate limit exceeded'
      });

      const token = jwt.sign({ id: 1, role: 'buyer' }, SECRET);
      const req = {
        headers: { authorization: `Bearer ${token}` },
        ip: '127.0.0.1'
      };
      const res = {
        set: jest.fn(),
        status: jest.fn(() => ({ json: jest.fn() })),
        json: jest.fn()
      };
      const next = jest.fn();

      await limiter(req, res, next);

      // Should continue even on Redis error
      expect(next).toHaveBeenCalled();
    });
  });
});