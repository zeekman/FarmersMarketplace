const request = require('supertest');
const app = require('../src/app');
const jwt = require('jsonwebtoken');

const mockDb = jest.requireMock('../src/db/schema');
const stellar = jest.requireMock('../src/utils/stellar');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const buyerToken  = jwt.sign({ id: 1, role: 'buyer' },  SECRET, { expiresIn: '1h' });
const farmerToken = jwt.sign({ id: 2, role: 'farmer' }, SECRET, { expiresIn: '1h' });

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
});

const SENSITIVE_FIELDS = ['stellar_secret_key', 'password'];

function checkNoSensitiveFields(obj, path = '') {
  if (obj === null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach((item, i) => checkNoSensitiveFields(item, `${path}[${i}]`)); return; }
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.includes(key)) throw new Error(`Sensitive field '${key}' found at path '${path}.${key}'`);
    checkNoSensitiveFields(value, `${path}.${key}`);
  }
}

describe('Security - Sensitive field exposure', () => {
  describe('Auth endpoints', () => {
    it('POST /api/auth/register should not expose stellar_secret_key', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const res = await request(app).post('/api/auth/register').send({ name: 'New User', email: `newuser${Date.now()}@test.com`, password: 'Secure1pass', role: 'buyer' });
      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });

    it('POST /api/auth/login should not expose stellar_secret_key', async () => {
      const bcrypt = require('bcryptjs');
      const hashed = await bcrypt.hash('Secure1pass', 12);
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Buyer', email: 'buyer@test.com', password: hashed, role: 'buyer', stellar_public_key: 'GPUB' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const res = await request(app).post('/api/auth/login').send({ email: 'buyer@test.com', password: 'Secure1pass' });
      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });
  });

  describe('Wallet endpoints', () => {
    it('GET /api/wallet should not expose stellar_secret_key', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [{ stellar_public_key: 'GPUB', referral_code: null }], rowCount: 1 });
      stellar.getBalance.mockResolvedValueOnce(500);
      const res = await request(app).get('/api/wallet').set('Authorization', `Bearer ${buyerToken}`);
      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });

    it('GET /api/wallet/transactions should not expose stellar_secret_key', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [{ stellar_public_key: 'GPUB' }], rowCount: 1 });
      stellar.getTransactions.mockResolvedValueOnce([]);
      const res = await request(app).get('/api/wallet/transactions').set('Authorization', `Bearer ${buyerToken}`);
      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });
  });

  describe('Product endpoints', () => {
    it('GET /api/products should not expose stellar_secret_key', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const res = await request(app).get('/api/products');
      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });

    it('GET /api/products/:id should not expose stellar_secret_key', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Test', price: 10, farmer_name: 'Joe' }], rowCount: 1 });
      const res = await request(app).get('/api/products/1');
      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });

    it('GET /api/products/mine/list should not expose stellar_secret_key', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Test' }], rowCount: 1 });
      const res = await request(app).get('/api/products/mine/list').set('Authorization', `Bearer ${farmerToken}`);
      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });
  });

  describe('Order endpoints', () => {
    it('GET /api/orders should not expose stellar_secret_key', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const res = await request(app).get('/api/orders').set('Authorization', `Bearer ${buyerToken}`);
      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });

    it('GET /api/orders/sales should not expose stellar_secret_key', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const res = await request(app).get('/api/orders/sales').set('Authorization', `Bearer ${farmerToken}`);
      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });
  });

  describe('Review endpoints', () => {
    it('GET /api/reviews/product/:productId should not expose stellar_secret_key', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const res = await request(app).get('/api/products/1/reviews');
      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });
  });
});
