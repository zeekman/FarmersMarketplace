const request = require('supertest');
const app = require('../src/app');
const StellarSdk = require('@stellar/stellar-sdk');

jest.mock('@stellar/stellar-sdk');

describe('Contracts API', () => {
  const mockContractId = 'CB64QI2T36AWF5V5KFC3M7RD5DPIAD4Y5A5K7J2Q7K2Q7K2Q';

  beforeEach(() => {
    StellarSdk.SorobanRpc.Server.mockImplementation(() => ({
      getContractData: jest.fn()
    }));
  });

  describe('GET /api/contracts/:contractId/state', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .get(`/api/contracts/${mockContractId}/state`)
        .expect(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('should fetch contract state for auth user', async () => {
      const mockServer = {
        getContractData: jest.fn().mockResolvedValue({
          data: {
            key: StellarSdk.nativeToScVal(Buffer.from('testkey'), { type: 'Symbol' }),
            val: StellarSdk.nativeToScVal(42, { type: 'u32' }),
            durability: 'Persistent'
          },
          pagingToken: null,
          latestLedger: false
        })
      };
      StellarSdk.SorobanRpc.Server.mockReturnValue(mockServer);

      const res = await request(app)
        .get(`/api/contracts/${mockContractId}/state`)
        .set('Authorization', 'Bearer valid.token.here')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].key).toBe('testkey');
      expect(res.body.data[0].val).toBe(42);
      expect(res.body.data[0].durability).toBe('Persistent');
    });

    it('should filter by prefix', async () => {
      const mockServer = {
        getContractData: jest.fn().mockResolvedValue({
          data: {
            key: StellarSdk.nativeToScVal(Buffer.from('ADMIN_users'), { type: 'Symbol' }),
            val: StellarSdk.nativeToScVal('data', { type: 'String' }),
            durability: 'Persistent'
          },
          pagingToken: null,
          latestLedger: false
        })
      };
      StellarSdk.SorobanRpc.Server.mockReturnValue(mockServer);

      const res = await request(app)
        .get(`/api/contracts/${mockContractId}/state?prefix=ADMIN_`)
        .set('Authorization', 'Bearer valid.token.here')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].key).toBe('ADMIN_users');
    });

    it('should return 404 for non-existent contract', async () => {
      const mockServer = {
        getContractData: jest.fn().mockRejectedValue({ code: 404, message: 'not found' })
      };
      StellarSdk.SorobanRpc.Server.mockReturnValue(mockServer);

      const res = await request(app)
        .get(`/api/contracts/${mockContractId}/state`)
        .set('Authorization', 'Bearer valid.token.here')
        .expect(404);

      expect(res.body.error).toBe('Contract state not found');
    });

    it('should validate contractId format', async () => {
      const res = await request(app)
        .get('/api/contracts/invalid/state')
        .set('Authorization', 'Bearer valid.token.here')
        .expect(400);

      expect(res.body.error).toBe('Invalid contractId format (base32 or hex expected)');
    });

    it('should handle RPC errors', async () => {
      const mockServer = {
        getContractData: jest.fn().mockRejectedValue(new Error('RPC timeout'))
      };
      StellarSdk.SorobanRpc.Server.mockReturnValue(mockServer);

      const res = await request(app)
        .get(`/api/contracts/${mockContractId}/state`)
        .set('Authorization', 'Bearer valid.token.here')
        .expect(500);

      expect(res.body.error).toContain('RPC timeout');
    });
  });
};
