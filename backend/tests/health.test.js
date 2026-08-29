const request = require('supertest');
const app = require('../src/app');
const { checkSorobanRPC } = require('../src/utils/stellar');

// Mock the stellar utility to avoid actual network calls in tests
jest.mock('../src/utils/stellar', () => ({
  checkSorobanRPC: jest.fn(),
}));

describe('Health Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/health', () => {
    it('should return basic health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).toEqual({
        status: 'ok'
      });
    });
  });

  describe('GET /api/v1/health', () => {
    it('should return basic health status for v1', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(response.body).toEqual({
        status: 'ok'
      });
    });
  });

  describe('GET /api/health/detailed', () => {
    it('should return detailed health status when Soroban is healthy', async () => {
      const mockSorobanHealth = {
        status: 'healthy',
        responseTime: 150,
        details: {
          status: 'healthy',
          latestLedger: 12345,
          oldestLedger: 12000,
          ledgerRetentionWindow: 345
        }
      };

      checkSorobanRPC.mockResolvedValue(mockSorobanHealth);

      const response = await request(app)
        .get('/api/health/detailed')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        version: 'v1',
        services: {
          soroban: mockSorobanHealth
        }
      });

      expect(response.body.responseTime).toBeGreaterThanOrEqual(0);
      expect(response.body.timestamp).toBeDefined();
    });

    it('should return degraded status when Soroban is unhealthy', async () => {
      const mockSorobanHealth = {
        status: 'unhealthy',
        responseTime: 5000,
        error: 'Connection timeout',
        details: {
          code: 'NETWORK_ERROR',
          type: 'Error'
        }
      };

      checkSorobanRPC.mockResolvedValue(mockSorobanHealth);

      const response = await request(app)
        .get('/api/health/detailed')
        .expect(503);

      expect(response.body).toMatchObject({
        status: 'degraded',
        version: 'v1',
        services: {
          soroban: mockSorobanHealth
        }
      });

      expect(response.body.responseTime).toBeGreaterThanOrEqual(0);
      expect(response.body.timestamp).toBeDefined();
    });

    it('should handle Soroban health check errors', async () => {
      const error = new Error('Network unavailable');
      checkSorobanRPC.mockRejectedValue(error);

      const response = await request(app)
        .get('/api/health/detailed')
        .expect(503);

      expect(response.body).toMatchObject({
        status: 'error',
        version: 'v1',
        error: 'Network unavailable',
        services: {
          soroban: {
            status: 'error',
            error: 'Network unavailable'
          }
        }
      });

      expect(response.body.responseTime).toBeGreaterThanOrEqual(0);
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('GET /api/v1/health/detailed', () => {
    it('should work for versioned endpoint', async () => {
      const mockSorobanHealth = {
        status: 'healthy',
        responseTime: 100,
        details: {
          status: 'healthy',
          latestLedger: 12345
        }
      };

      checkSorobanRPC.mockResolvedValue(mockSorobanHealth);

      const response = await request(app)
        .get('/api/v1/health/detailed')
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.services.soroban).toEqual(mockSorobanHealth);
    });
  });
});