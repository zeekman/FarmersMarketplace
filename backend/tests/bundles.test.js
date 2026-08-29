'use strict';

/**
 * Tests for backend/src/routes/bundles.js and bundleDiscounts.js
 * Closes #1004
 */

const jwt = require('jsonwebtoken');
const { request, app, mockDb, mockQuery, getCsrf } = require('./setup');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken  = jwt.sign({ id: 2, role: 'buyer'  }, SECRET);

function mockPrepare(getResult, allResult, runResult) {
  mockDb.prepare.mockReturnValue({
    get:  jest.fn().mockReturnValue(getResult),
    all:  jest.fn().mockReturnValue(allResult  ?? []),
    run:  jest.fn().mockReturnValue(runResult  ?? { lastInsertRowid: 1, changes: 1 }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── GET /api/bundles ──────────────────────────────────────────────────────────
describe('GET /api/bundles', () => {
  it('returns empty list when no bundles exist', async () => {
    mockPrepare(null, []);
    const res = await request(app).get('/api/bundles');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('returns bundles with their items', async () => {
    const bundle = { id: 1, name: 'Veggie Box', price: 20, farmer_name: 'Alice' };
    const items  = [{ product_id: 5, quantity: 2, product_name: 'Carrot', unit: 'kg', stock: 10 }];

    // first prepare call → .all() for bundles; second → .all(id) for items
    mockDb.prepare
      .mockReturnValueOnce({ all: jest.fn().mockReturnValue([bundle]) })
      .mockReturnValueOnce({ all: jest.fn().mockReturnValue(items) });

    const res = await request(app).get('/api/bundles');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].items).toHaveLength(1);
  });
});

// ── POST /api/bundles ─────────────────────────────────────────────────────────
describe('POST /api/bundles', () => {
  const validPayload = {
    name: 'Fruit Box',
    description: 'Mixed fruits',
    price: 15,
    items: [{ product_id: 3, quantity: 2 }],
  };

  it('returns 401 without auth', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/bundles')
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send(validPayload);
    expect(res.status).toBe(401);
  });

  it('returns 403 for buyers', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/bundles')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send(validPayload);
    expect(res.status).toBe(403);
  });

  it('returns 400 when name is missing', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/bundles')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ price: 10, items: [{ product_id: 1, quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 when price is invalid', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/bundles')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ name: 'Box', price: -5, items: [{ product_id: 1, quantity: 1 }] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when items array is empty', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/bundles')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ name: 'Box', price: 10, items: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when a product does not belong to the farmer', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    // product exists but belongs to farmer_id 99, not 1
    mockDb.prepare.mockReturnValue({
      get: jest.fn().mockReturnValue({ id: 3, farmer_id: 99 }),
      all: jest.fn().mockReturnValue([]),
      run: jest.fn().mockReturnValue({ lastInsertRowid: 1, changes: 1 }),
    });
    const res = await request(app)
      .post('/api/bundles')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send(validPayload);
    expect(res.status).toBe(400);
  });

  it('creates a bundle and returns 201', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    // product ownership check passes (farmer_id === 1)
    mockDb.prepare.mockReturnValue({
      get: jest.fn().mockReturnValue({ id: 3, farmer_id: 1 }),
      all: jest.fn().mockReturnValue([]),
      run: jest.fn().mockReturnValue({ lastInsertRowid: 7, changes: 1 }),
    });
    mockDb.transaction.mockImplementation((fn) => () => fn());

    const res = await request(app)
      .post('/api/bundles')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send(validPayload);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeDefined();
  });
});

// ── DELETE /api/bundles/:id ───────────────────────────────────────────────────
describe('DELETE /api/bundles/:id', () => {
  it('returns 403 for buyers', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .delete('/api/bundles/1')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(403);
  });

  it('returns 404 when bundle not found', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockPrepare(null);
    const res = await request(app)
      .delete('/api/bundles/999')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(404);
  });

  it('deletes own bundle and returns 200', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockDb.prepare
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue({ id: 1, farmer_id: 1 }) })
      .mockReturnValueOnce({ run: jest.fn().mockReturnValue({ changes: 1 }) });
    const res = await request(app)
      .delete('/api/bundles/1')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── POST /api/bundles/purchase ────────────────────────────────────────────────
describe('POST /api/bundles/purchase', () => {
  it('returns 403 for farmers', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/bundles/purchase')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ bundle_id: 1 });
    expect(res.status).toBe(403);
  });

  it('returns 400 when bundle_id is missing', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/bundles/purchase')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 when bundle does not exist', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockPrepare(null);
    const res = await request(app)
      .post('/api/bundles/purchase')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ bundle_id: 999 });
    expect(res.status).toBe(404);
  });
});

// ── GET /api/bundles/orders ───────────────────────────────────────────────────
describe('GET /api/bundles/orders', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/bundles/orders');
    expect(res.status).toBe(401);
  });

  it('returns buyer order history', async () => {
    mockPrepare(null, [{ id: 1, bundle_name: 'Fruit Box', total_price: 15 }]);
    const res = await request(app)
      .get('/api/bundles/orders')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

// ── Bundle Discount CRUD (bundleDiscounts.js) ─────────────────────────────────
describe('GET /api/farmers/me/bundle-discounts', () => {
  it('returns 403 for buyers', async () => {
    const res = await request(app)
      .get('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });

  it('returns discount tiers for the farmer', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 1, min_products: 3, discount_percent: 10 }],
      rowCount: 1,
    });
    const res = await request(app)
      .get('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('POST /api/farmers/me/bundle-discounts', () => {
  it('returns 403 for buyers', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ min_products: 3, discount_percent: 10 });
    expect(res.status).toBe(403);
  });

  it('returns 400 when min_products < 2', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ min_products: 1, discount_percent: 10 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 when discount_percent is out of range', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ min_products: 3, discount_percent: 75 });
    expect(res.status).toBe(400);
  });

  it('creates a discount tier and returns 201', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 5, farmer_id: 1, min_products: 3, discount_percent: 10 }],
      rowCount: 1,
    });
    const res = await request(app)
      .post('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ min_products: 3, discount_percent: 10 });
    expect(res.status).toBe(201);
    expect(res.body.data.min_products).toBe(3);
  });

  it('returns 409 on duplicate tier', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockDb.query.mockRejectedValueOnce(
      Object.assign(new Error('UNIQUE constraint failed'), { code: '23505' })
    );
    const res = await request(app)
      .post('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ min_products: 3, discount_percent: 10 });
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/farmers/me/bundle-discounts/:id', () => {
  it('returns 404 when tier not found', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .delete('/api/farmers/me/bundle-discounts/99')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(404);
  });

  it('deletes tier and returns 200', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app)
      .delete('/api/farmers/me/bundle-discounts/1')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
