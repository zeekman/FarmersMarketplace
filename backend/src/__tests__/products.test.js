/**
 * Integration tests for product CRUD endpoints.
 */

process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockDb = jest.requireMock('../db/schema');
const mockCache = jest.requireMock('../cache');

jest.mock('../cache', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}));

// Mount only the products router to avoid loading broken sibling route files
jest.mock('../routes', () => {
  const express = require('express');
  const router = express.Router();
  router.use('/api/products', require('../routes/products'));
  return router;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  mockCache.get.mockResolvedValue(null);
  mockCache.set.mockResolvedValue(undefined);
});

const app = require('../app');

const SECRET = process.env.JWT_SECRET;
const token = (id, role) => jwt.sign({ id, role }, SECRET);

const FARMER_ID = 1;
const BUYER_ID = 2;
const farmerToken = token(FARMER_ID, 'farmer');
const buyerToken = token(BUYER_ID, 'buyer');
const VALID_PRODUCT = { name: 'Tomatoes', price: 2.5, quantity: 100, category: 'vegetables' };

function createProduct(overrides = {}) {
  return request(app)
    .post('/api/products')
    .set('Authorization', `Bearer ${farmerToken}`)
    .send({ ...VALID_PRODUCT, ...overrides });
}

describe('GET /api/products', () => {
  it('returns in-stock products', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ id: 1, name: 'Tomatoes', price: 2.5, quantity: 100, farmer_name: 'Joe' }],
        rowCount: 1,
      });
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
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send(VALID_PRODUCT);
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

  it('accepts valid nutrition data', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 });
    const res = await createProduct({ nutrition: { calories: 50, protein: 2.5 } });
    expect(res.status).toBe(200);
  });

  it('returns 400 when nutrition has negative values', async () => {
    const res = await createProduct({ nutrition: { calories: -10 } });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/products/:id', () => {
  it('returns product when found', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 1, name: 'Tomatoes', price: 2.5, farmer_name: 'Joe' }],
      rowCount: 1,
    });
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
    const res = await request(app)
      .delete('/api/products/1')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("farmer cannot delete another farmer's product", async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .delete('/api/products/1')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-existent product', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .delete('/api/products/99999')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(404);
  });

  it('unauthenticated request receives 401', async () => {
    const res = await request(app).delete('/api/products/1');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/products/mine/list', () => {
  it('farmer gets their own products', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Tomatoes' }], rowCount: 1 });
    const res = await request(app)
      .get('/api/products/mine/list')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('buyer receives 403', async () => {
    const res = await request(app)
      .get('/api/products/mine/list')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });

  it('unauthenticated request receives 401', async () => {
    const res = await request(app).get('/api/products/mine/list');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/products/:id', () => {
  it('update to quantity 0 succeeds', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 1, farmer_id: FARMER_ID, quantity: 10 }], rowCount: 1 }) // SELECT existing
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE
    const res = await request(app)
      .patch('/api/products/1')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ quantity: 0 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('product with quantity 0 is hidden from GET /api/products', async () => {
    // GET /api/products defaults to available=true which filters quantity > 0
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('product with quantity 0 is still visible in GET /api/products/mine/list', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 1, name: 'Tomatoes', quantity: 0, farmer_id: FARMER_ID }],
      rowCount: 1,
    });
    const res = await request(app)
      .get('/api/products/mine/list')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].quantity).toBe(0);
  });

  it('returns 400 for negative quantity', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 1, farmer_id: FARMER_ID }], rowCount: 1 });
    const res = await request(app)
      .patch('/api/products/1')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ quantity: -1 });
    expect(res.status).toBe(400);
  });

  it('returns 403 for non-farmer', async () => {
    const res = await request(app)
      .patch('/api/products/1')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ quantity: 5 });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// #388 — product listing cache role isolation
// ---------------------------------------------------------------------------
describe('GET /api/products — cache role isolation (#388)', () => {
  const productRow = {
    id: 1,
    name: 'Tomatoes',
    price: 2.5,
    quantity: 100,
    farmer_name: 'Joe',
    low_stock_threshold: 5,
  };

  it('farmer response includes low_stock_threshold', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [productRow], rowCount: 1 });

    const res = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].low_stock_threshold).toBe(5);
  });

  it('buyer response does not include low_stock_threshold', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [productRow], rowCount: 1 });

    const res = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].low_stock_threshold).toBeUndefined();
  });

  it('unauthenticated response does not include low_stock_threshold', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [productRow], rowCount: 1 });

    const res = await request(app).get('/api/products');

    expect(res.status).toBe(200);
    expect(res.body.data[0].low_stock_threshold).toBeUndefined();
  });

  it('farmer and buyer requests use separate cache keys', async () => {
    // Simulate farmer cache hit — buyer must NOT receive it
    const farmerPayload = {
      success: true,
      data: [{ ...productRow }],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    };

    // First call: farmer hits cache
    mockCache.get.mockResolvedValueOnce(farmerPayload);
    const farmerRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(farmerRes.status).toBe(200);
    expect(farmerRes.body.data[0].low_stock_threshold).toBe(5);

    // Second call: buyer — cache returns null (different key), DB is queried
    mockCache.get.mockResolvedValueOnce(null);
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [productRow], rowCount: 1 });

    const buyerRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(buyerRes.status).toBe(200);
    expect(buyerRes.body.data[0].low_stock_threshold).toBeUndefined();

    // Verify the two cache.set calls used different keys
    const setCalls = mockCache.set.mock.calls;
    const keys = setCalls.map(([k]) => k);
    expect(keys.some((k) => k.includes(':farmer:'))).toBe(true);
    expect(keys.some((k) => k.includes(':buyer:'))).toBe(true);
  });
});
