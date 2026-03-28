/**
 * Integration tests for product CRUD endpoints.
 */

process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockDb = jest.requireMock('../db/schema');

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
});

const app = require('../app');

const SECRET = process.env.JWT_SECRET;
const token = (id, role) => jwt.sign({ id, role }, SECRET);

const FARMER_ID = 1;
const BUYER_ID  = 2;
const farmerToken = token(FARMER_ID, 'farmer');
const buyerToken  = token(BUYER_ID,  'buyer');
const VALID_PRODUCT = { name: 'Tomatoes', price: 2.5, quantity: 100, category: 'vegetables' };

function createProduct(overrides = {}) {
  return request(app).post('/api/products').set('Authorization', `Bearer ${farmerToken}`).send({ ...VALID_PRODUCT, ...overrides });
}

describe('GET /api/products', () => {
  it('returns in-stock products', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Tomatoes', price: 2.5, quantity: 100, farmer_name: 'Joe' }], rowCount: 1 });
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('returns empty array when no products exist', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('POST /api/products', () => {
  it('farmer can create a product', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 });
    const res = await createProduct();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeDefined();
  });

  it('buyer receives 403', async () => {
    const res = await request(app).post('/api/products').set('Authorization', `Bearer ${buyerToken}`).send(VALID_PRODUCT);
    expect(res.status).toBe(403);
  });

  it('unauthenticated request receives 401', async () => {
    const res = await request(app).post('/api/products').send(VALID_PRODUCT);
    expect(res.status).toBe(401);
  });

  it('returns 400 when name is missing', async () => {
    const res = await createProduct({ name: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when price is invalid', async () => {
    const res = await createProduct({ price: -1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when quantity is zero', async () => {
    const res = await createProduct({ quantity: 0 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/products/:id', () => {
  it('returns product when found', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Tomatoes', price: 2.5, farmer_name: 'Joe' }], rowCount: 1 });
    const res = await request(app).get('/api/products/1');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });

  it('returns 404 for non-existent product', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/products/99999');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/products/:id', () => {
  it('farmer can delete their own product', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 1, farmer_id: FARMER_ID }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app).delete('/api/products/1').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("farmer cannot delete another farmer's product", async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).delete('/api/products/1').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-existent product', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).delete('/api/products/99999').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(404);
  });

  it('unauthenticated request receives 401', async () => {
    const res = await request(app).delete('/api/products/1');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/products/mine/list', () => {
  it("farmer gets their own products", async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Tomatoes' }], rowCount: 1 });
    const res = await request(app).get('/api/products/mine/list').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('buyer receives 403', async () => {
    const res = await request(app).get('/api/products/mine/list').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });

  it('unauthenticated request receives 401', async () => {
    const res = await request(app).get('/api/products/mine/list');
    expect(res.status).toBe(401);
  });
});
