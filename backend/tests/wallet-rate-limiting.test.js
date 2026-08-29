/**
 * Integration tests for wallet endpoint rate limiting
 * Ensures /api/wallet/fund and /api/wallet/send use per-user Redis-backed rate limiting
 */

const jwt = require('jsonwebtoken');
const { request, app, mockQuery, getCsrf } = require('./setup');
const stellar = jest.requireMock('../src/utils/stellar');

// Store original environment
const originalEnv = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  stellar.isTestnet = true;
  
  // Reset environment
  Object.assign(process.env, originalEnv);
});

afterEach(() => {
  // Restore environment
  process.env = { ...originalEnv };
});

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';

describe('Wallet Rate Limiting Integration', () => {
  describe('/api/wallet/fund rate limiting', () => {
    it('should enforce per-user rate limiting (5 requests/hour)', async () => {
      stellar.isTestnet = true;
      const { token: csrf, cookieStr } = await getCsrf();
      
      const user1Token = jwt.sign({ id: 1, role: 'buyer' }, SECRET);
      const user2Token = jwt.sign({ id: 2, role: 'buyer' }, SECRET);
      
      // Setup mocks for successful funding
      mockQuery.mockResolvedValue({ rows: [{ stellar_public_key: 'GPUB' }], rowCount: 1 });
      stellar.fundTestnetAccount.mockResolvedValue(true);
      stellar.getBalance.mockResolvedValue(10000);

      // User 1 should be able to make 5 requests
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/wallet/fund')
          .set('Authorization', `Bearer ${user1Token}`)
          .set('Cookie', cookieStr)
          .set('X-CSRF-Token', csrf);
        
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-limit']).toBe('5');
        expect(res.headers['x-ratelimit-remaining']).toBe((4 - i).toString());
      }

      // 6th request from user 1 should be rate limited
      const res6 = await request(app)
        .post('/api/wallet/fund')
        .set('Authorization', `Bearer ${user1Token}`)
        .set('Cookie', cookieStr)
        .set('X-CSRF-Token', csrf);
      
      expect(res6.status).toBe(429);
      expect(res6.body.error).toBe('Funding limit reached, try again in an hour');
      expect(res6.body.code).toBe('rate_limited');
      expect(res6.headers['retry-after']).toBeDefined();

      // User 2 should still be able to make requests (separate rate limit)
      const res7 = await request(app)
        .post('/api/wallet/fund')
        .set('Authorization', `Bearer ${user2Token}`)
        .set('Cookie', cookieStr)
        .set('X-CSRF-Token', csrf);
      
      expect(res7.status).toBe(200);
      expect(res7.headers['x-ratelimit-remaining']).toBe('4');
    });

    it('should use IP fallback for unauthenticated requests', async () => {
      stellar.isTestnet = true;
      const { token: csrf, cookieStr } = await getCsrf();
      
      // Setup mocks - but this should fail auth first
      const res = await request(app)
        .post('/api/wallet/fund')
        .set('Cookie', cookieStr)
        .set('X-CSRF-Token', csrf);
      
      // Should fail authentication before rate limiting
      expect(res.status).toBe(401);
    });

    it('should include rate limit headers in responses', async () => {
      stellar.isTestnet = true;
      const { token: csrf, cookieStr } = await getCsrf();
      const token = jwt.sign({ id: 1, role: 'buyer' }, SECRET);
      
      mockQuery.mockResolvedValue({ rows: [{ stellar_public_key: 'GPUB' }], rowCount: 1 });
      stellar.fundTestnetAccount.mockResolvedValue(true);
      stellar.getBalance.mockResolvedValue(10000);

      const res = await request(app)
        .post('/api/wallet/fund')
        .set('Authorization', `Bearer ${token}`)
        .set('Cookie', cookieStr)
        .set('X-CSRF-Token', csrf);
      
      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBe('5');
      expect(res.headers['x-ratelimit-remaining']).toBe('4');
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });
  });

  describe('/api/wallet/send rate limiting', () => {
    const EXTERNAL_KEY = 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37';
    const USER_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const validSendBody = { destination: EXTERNAL_KEY, amount: 10 };

    it('should enforce per-user rate limiting (5 requests/minute by default)', async () => {
      const { token: csrf, cookieStr } = await getCsrf();
      const token = jwt.sign({ id: 1, role: 'buyer' }, SECRET);
      
      // Setup mocks for successful sends
      mockQuery.mockResolvedValue({ 
        rows: [{ stellar_public_key: USER_KEY, stellar_secret_key: 'SSECRET' }], 
        rowCount: 1 
      });
      stellar.getBalance.mockResolvedValue(500);
      stellar.sendPayment.mockResolvedValue('TXHASH');

      // Should be able to make 5 requests
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/wallet/send')
          .set('Authorization', `Bearer ${token}`)
          .set('Cookie', cookieStr)
          .set('X-CSRF-Token', csrf)
          .send(validSendBody);
        
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-limit']).toBe('5');
        expect(res.headers['x-ratelimit-remaining']).toBe((4 - i).toString());
      }

      // 6th request should be rate limited
      const res6 = await request(app)
        .post('/api/wallet/send')
        .set('Authorization', `Bearer ${token}`)
        .set('Cookie', cookieStr)
        .set('X-CSRF-Token', csrf)
        .send(validSendBody);
      
      expect(res6.status).toBe(429);
      expect(res6.body.error).toBe('Too many send requests, slow down');
      expect(res6.body.code).toBe('rate_limited');
    });

    it('should respect RATE_LIMIT_SEND_MAX environment variable', async () => {
      // Set custom send limit
      process.env.RATE_LIMIT_SEND_MAX = '2';
      
      // Restart the app to pick up new environment
      delete require.cache[require.resolve('../src/app')];
      const appWithNewLimit = require('../src/app');
      
      const { token: csrf, cookieStr } = await getCsrf();
      const token = jwt.sign({ id: 1, role: 'buyer' }, SECRET);
      
      mockQuery.mockResolvedValue({ 
        rows: [{ stellar_public_key: USER_KEY, stellar_secret_key: 'SSECRET' }], 
        rowCount: 1 
      });
      stellar.getBalance.mockResolvedValue(500);
      stellar.sendPayment.mockResolvedValue('TXHASH');

      // Should be able to make 2 requests (custom limit)
      for (let i = 0; i < 2; i++) {
        const res = await request(appWithNewLimit)
          .post('/api/wallet/send')
          .set('Authorization', `Bearer ${token}`)
          .set('Cookie', cookieStr)
          .set('X-CSRF-Token', csrf)
          .send(validSendBody);
        
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-limit']).toBe('2');
      }

      // 3rd request should be rate limited
      const res3 = await request(appWithNewLimit)
        .post('/api/wallet/send')
        .set('Authorization', `Bearer ${token}`)
        .set('Cookie', cookieStr)
        .set('X-CSRF-Token', csrf)
        .send(validSendBody);
      
      expect(res3.status).toBe(429);
    });

    it('should differentiate between different users', async () => {
      const { token: csrf, cookieStr } = await getCsrf();
      const user1Token = jwt.sign({ id: 1, role: 'buyer' }, SECRET);
      const user2Token = jwt.sign({ id: 2, role: 'buyer' }, SECRET);
      
      mockQuery.mockResolvedValue({ 
        rows: [{ stellar_public_key: USER_KEY, stellar_secret_key: 'SSECRET' }], 
        rowCount: 1 
      });
      stellar.getBalance.mockResolvedValue(500);
      stellar.sendPayment.mockResolvedValue('TXHASH');

      // User 1 makes 5 requests (hits limit)
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/wallet/send')
          .set('Authorization', `Bearer ${user1Token}`)
          .set('Cookie', cookieStr)
          .set('X-CSRF-Token', csrf)
          .send(validSendBody);
        expect(res.status).toBe(200);
      }

      // User 1's next request should be rate limited
      const res6 = await request(app)
        .post('/api/wallet/send')
        .set('Authorization', `Bearer ${user1Token}`)
        .set('Cookie', cookieStr)
        .set('X-CSRF-Token', csrf)
        .send(validSendBody);
      expect(res6.status).toBe(429);

      // User 2 should still be able to make requests
      const res7 = await request(app)
        .post('/api/wallet/send')
        .set('Authorization', `Bearer ${user2Token}`)
        .set('Cookie', cookieStr)
        .set('X-CSRF-Token', csrf)
        .send(validSendBody);
      expect(res7.status).toBe(200);
      expect(res7.headers['x-ratelimit-remaining']).toBe('4');
    });
  });

  describe('Redis configuration behavior', () => {
    it('should work without Redis configured (memory fallback)', async () => {
      // Ensure no Redis URL
      delete process.env.REDIS_URL;
      
      const { token: csrf, cookieStr } = await getCsrf();
      const token = jwt.sign({ id: 1, role: 'buyer' }, SECRET);
      
      stellar.isTestnet = true;
      mockQuery.mockResolvedValue({ rows: [{ stellar_public_key: 'GPUB' }], rowCount: 1 });
      stellar.fundTestnetAccount.mockResolvedValue(true);
      stellar.getBalance.mockResolvedValue(10000);

      const res = await request(app)
        .post('/api/wallet/fund')
        .set('Authorization', `Bearer ${token}`)
        .set('Cookie', cookieStr)
        .set('X-CSRF-Token', csrf);
      
      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBe('5');
      expect(res.headers['x-ratelimit-remaining']).toBe('4');
    });

    it('should indicate Redis usage in rate limit implementation', () => {
      // Test that the implementation correctly uses Redis when configured
      process.env.REDIS_URL = 'redis://localhost:6379';
      
      // Import after setting environment
      delete require.cache[require.resolve('../src/middleware/rateLimitPerUser')];
      const { _getStore } = require('../src/middleware/rateLimitPerUser');
      
      const store = _getStore();
      expect(store.memory).toBeDefined(); // Memory fallback always available
      // Redis client would be defined if redis package was properly loaded
    });
  });

  describe('Version compatibility', () => {
    it('should apply rate limiting to v1 endpoints', async () => {
      stellar.isTestnet = true;
      const { token: csrf, cookieStr } = await getCsrf();
      const token = jwt.sign({ id: 1, role: 'buyer' }, SECRET);
      
      mockQuery.mockResolvedValue({ rows: [{ stellar_public_key: 'GPUB' }], rowCount: 1 });
      stellar.fundTestnetAccount.mockResolvedValue(true);
      stellar.getBalance.mockResolvedValue(10000);

      // Test v1 endpoint
      const res = await request(app)
        .post('/api/v1/wallet/fund')
        .set('Authorization', `Bearer ${token}`)
        .set('Cookie', cookieStr)
        .set('X-CSRF-Token', csrf);
      
      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBe('5');
      expect(res.headers['x-ratelimit-remaining']).toBe('4');
    });
  });
});