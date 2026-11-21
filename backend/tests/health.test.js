'use strict';

const request = require('supertest');
const app = require('../src/app');
const mockDb = require('../src/db/schema');
const { server: horizonServer } = require('../src/utils/stellar-config');
const { checkSorobanRPC } = require('../src/utils/stellar');
const packageJson = require('../package.json');

const mockRedisPing = jest.fn();
const mockRedisQuit = jest.fn().mockResolvedValue('OK');
const mockRedisDisconnect = jest.fn();

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    ping: mockRedisPing,
    quit: mockRedisQuit,
    disconnect: mockRedisDisconnect,
  }));
});

jest.mock('../src/utils/stellar', () => ({
  checkSorobanRPC: jest.fn(),
}));

describe('Health Endpoints (Backlog 026)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    process.env.RUN_JOBS = 'false';

    // Default mock setup: healthy database
    mockDb.query = jest.fn().mockResolvedValue({ rows: [{ 1: 1 }], rowCount: 1 });
    mockDb.ready = Promise.resolve();

    // Default mock setup: healthy Horizon root
    if (!horizonServer.root) {
      horizonServer.root = jest.fn();
    }
    const tenSecondsAgo = new Date(Date.now() - 10000).toISOString();
    horizonServer.root = jest.fn().mockResolvedValue({
      history_latest_ledger: 12345,
      history_latest_ledger_closed_at: tenSecondsAgo,
    });

    // Default mock setup: healthy Soroban RPC
    checkSorobanRPC.mockResolvedValue({
      status: 'healthy',
      responseTime: 100,
      details: {
        status: 'healthy',
        latestLedger: 12345,
        oldestLedger: 12000,
        ledgerRetentionWindow: 345,
      },
    });

    // Default mock setup: healthy Redis ping
    mockRedisPing.mockResolvedValue('PONG');
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ---------------------------------------------------------------------------
  // Acceptance Criteria 1: GET /health (liveness) stays dependency-free
  // ---------------------------------------------------------------------------
  describe('GET /health (Liveness)', () => {
    it('returns 200 { status: "ok" } without calling dependencies', async () => {
      // Intentionally break dependencies
      mockDb.query = jest.fn().mockRejectedValue(new Error('DB is dead'));
      mockDb.ready = Promise.reject(new Error('Migrations failed'));
      checkSorobanRPC.mockRejectedValue(new Error('Soroban is dead'));

      const res = await request(app).get('/health').expect(200);

      expect(res.body).toEqual({ status: 'ok' });
      // Liveness must NOT query database
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(checkSorobanRPC).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance Criteria 2: GET /health/ready returns 503 if DB SELECT 1 fails or db.ready not resolved
  // ---------------------------------------------------------------------------
  describe('GET /health/ready (Readiness)', () => {
    it('returns 200 when DB SELECT 1 succeeds and db.ready is resolved', async () => {
      mockDb.ready = Promise.resolve();
      mockDb.query.mockResolvedValueOnce({ rows: [{ 1: 1 }], rowCount: 1 });

      const res = await request(app).get('/health/ready').expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.ready).toBe(true);
      expect(res.body.db).toBe('healthy');
      expect(mockDb.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('returns 503 when DB SELECT 1 fails', async () => {
      mockDb.ready = Promise.resolve();
      mockDb.query.mockRejectedValueOnce(new Error('Connection refused'));

      const res = await request(app).get('/health/ready').expect(503);

      expect(res.body.status).toBe('error');
      expect(res.body.ready).toBe(false);
      expect(res.body.db).toBe('unhealthy');
      expect(res.body.error).toContain('Connection refused');
    });

    it('returns 503 when db.ready rejects (migrations failed)', async () => {
      mockDb.ready = Promise.reject(new Error('Migration syntax error'));

      const res = await request(app).get('/health/ready').expect(503);

      expect(res.body.status).toBe('error');
      expect(res.body.ready).toBe(false);
      expect(res.body.error).toContain('Migration syntax error');
    });

    it('also responds at alias /api/health/ready and /api/v1/health/ready', async () => {
      mockDb.ready = Promise.resolve();
      mockDb.query.mockResolvedValue({ rows: [{ 1: 1 }], rowCount: 1 });

      const res1 = await request(app).get('/api/health/ready').expect(200);
      expect(res1.body.status).toBe('ok');

      const res2 = await request(app).get('/api/v1/health/ready').expect(200);
      expect(res2.body.status).toBe('ok');
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance Criteria 3: /health/detailed reports db, redis, horizon, soroban, jobsLeader, version
  // ---------------------------------------------------------------------------
  describe('GET /health/detailed', () => {
    it('returns 200 with all healthy dependencies, jobsLeader boolean and package.json version', async () => {
      process.env.RUN_JOBS = 'true';
      const res = await request(app).get('/health/detailed').expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.version).toBe(packageJson.version);
      expect(res.body.jobsLeader).toBe(true);
      expect(typeof res.body.jobsLeader).toBe('boolean');
      expect(res.body.responseTime).toBeGreaterThanOrEqual(0);
      expect(res.body.timestamp).toBeDefined();

      // Services block
      expect(res.body.services.db.status).toBe('healthy');
      expect(res.body.services.redis.status).toBe('disabled');
      expect(res.body.services.horizon.status).toBe('healthy');
      expect(typeof res.body.services.horizon.latestLedgerAge).toBe('number');
      expect(res.body.services.horizon.latestLedgerAge).toBeGreaterThanOrEqual(0);
      expect(res.body.services.soroban.status).toBe('healthy');

      // Top-level aliases for direct access
      expect(res.body.db.status).toBe('healthy');
      expect(res.body.redis.status).toBe('disabled');
      expect(res.body.horizon.status).toBe('healthy');
      expect(res.body.soroban.status).toBe('healthy');
    });

    it('reports jobsLeader: false when RUN_JOBS is false or unset', async () => {
      process.env.RUN_JOBS = 'false';
      const res = await request(app).get('/health/detailed').expect(200);
      expect(res.body.jobsLeader).toBe(false);
    });

    // -------------------------------------------------------------------------
    // Acceptance Criteria 5: Tests mock each dependency failing
    // -------------------------------------------------------------------------
    it('mocks DB failure: reports db unhealthy and returns 503', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('PostgreSQL connection terminated'));

      const res = await request(app).get('/health/detailed').expect(503);

      expect(res.body.status).toBe('degraded');
      expect(res.body.services.db.status).toBe('unhealthy');
      expect(res.body.services.db.error).toContain('PostgreSQL connection terminated');
    });

    it('mocks Redis disabled: reports redis disabled when REDIS_URL is not set', async () => {
      delete process.env.REDIS_URL;

      const res = await request(app).get('/health/detailed').expect(200);

      expect(res.body.services.redis.status).toBe('disabled');
    });

    it('mocks Redis healthy: reports redis healthy when REDIS_URL is set and ping succeeds', async () => {
      process.env.REDIS_URL = 'redis://127.0.0.1:6379';
      mockRedisPing.mockResolvedValueOnce('PONG');

      const res = await request(app).get('/health/detailed').expect(200);

      expect(res.body.services.redis.status).toBe('healthy');
      expect(res.body.services.redis.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('mocks Redis failure: reports redis unhealthy and returns 503 when ping fails', async () => {
      process.env.REDIS_URL = 'redis://127.0.0.1:6379';
      mockRedisPing.mockRejectedValueOnce(new Error('ECONNREFUSED 127.0.0.1:6379'));

      const res = await request(app).get('/health/detailed').expect(503);

      expect(res.body.status).toBe('degraded');
      expect(res.body.services.redis.status).toBe('unhealthy');
      expect(res.body.services.redis.error).toContain('ECONNREFUSED');
    });

    it('mocks Horizon failure: reports horizon unhealthy and returns 503', async () => {
      horizonServer.root.mockRejectedValueOnce(new Error('Horizon 503 gateway timeout'));

      const res = await request(app).get('/health/detailed').expect(503);

      expect(res.body.status).toBe('degraded');
      expect(res.body.services.horizon.status).toBe('unhealthy');
      expect(res.body.services.horizon.error).toContain('Horizon 503');
    });

    it('mocks Horizon latest ledger age calculation', async () => {
      // 45 seconds ago
      const fortyFiveSecondsAgo = new Date(Date.now() - 45000).toISOString();
      horizonServer.root.mockResolvedValueOnce({
        history_latest_ledger: 99999,
        history_latest_ledger_closed_at: fortyFiveSecondsAgo,
      });

      const res = await request(app).get('/health/detailed').expect(200);

      expect(res.body.services.horizon.status).toBe('healthy');
      expect(res.body.services.horizon.latestLedgerAge).toBeGreaterThanOrEqual(44);
      expect(res.body.services.horizon.latestLedgerAge).toBeLessThanOrEqual(47);
      expect(res.body.services.horizon.latestLedger).toBe(99999);
    });

    it('mocks Soroban unhealthy status: reports soroban unhealthy and returns 503', async () => {
      checkSorobanRPC.mockResolvedValueOnce({
        status: 'unhealthy',
        responseTime: 200,
        error: 'Soroban RPC node unsynced',
      });

      const res = await request(app).get('/health/detailed').expect(503);

      expect(res.body.status).toBe('degraded');
      expect(res.body.services.soroban.status).toBe('unhealthy');
      expect(res.body.services.soroban.error).toContain('unsynced');
    });

    it('mocks Soroban error throwing: handles exception and returns 503', async () => {
      checkSorobanRPC.mockRejectedValueOnce(new Error('Soroban network error'));

      const res = await request(app).get('/health/detailed').expect(503);

      expect(res.body.status).toBe('degraded');
      expect(res.body.services.soroban.status).toBe('unhealthy');
      expect(res.body.services.soroban.error).toContain('Soroban network error');
    });

    it('works across versioned aliases /api/health/detailed and /api/v1/health/detailed', async () => {
      const res1 = await request(app).get('/api/health/detailed').expect(200);
      expect(res1.body.status).toBe('ok');

      const res2 = await request(app).get('/api/v1/health/detailed').expect(200);
      expect(res2.body.status).toBe('ok');
    });
  });
});
