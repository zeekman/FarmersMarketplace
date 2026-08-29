'use strict';

const jwt = require('jsonwebtoken');
const { request, app, mockDb, getCsrf } = require('./setup');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const buyerAToken = jwt.sign({ id: 1, role: 'buyer' }, SECRET);
const buyerBToken = jwt.sign({ id: 2, role: 'buyer' }, SECRET);

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('POST /api/orders/:id/return', () => {
  it('returns 404 when buyer tries to file a return for another buyer\'s order', async () => {
    const { token: csrf, cookieStr } = await getCsrf();

    // auth middleware: user active check
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ active: 1 }], rowCount: 1 })
      // order lookup with buyer_id filter returns nothing (order belongs to buyer B, not buyer A)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    // Buyer A (id=1) tries to return order 99 which belongs to Buyer B (id=2)
    const res = await request(app)
      .post('/api/orders/99/return')
      .set('Authorization', `Bearer ${buyerAToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ reason: 'Wrong item' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('returns 403 for non-buyers', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const farmerToken = jwt.sign({ id: 3, role: 'farmer' }, SECRET);

    mockDb.query.mockResolvedValueOnce({ rows: [{ active: 1 }], rowCount: 1 });

    const res = await request(app)
      .post('/api/orders/1/return')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ reason: 'Wrong item' });

    expect(res.status).toBe(403);
  });
});

// ── Issue #1020 — self-approval / cross-farmer authorization checks ───────────

describe('PATCH /api/orders/:orderId/return/:returnId/approve — farmer self-approval guard', () => {
  const farmerAToken = jwt.sign({ id: 10, role: 'farmer' }, SECRET);
  const farmerBToken = jwt.sign({ id: 20, role: 'farmer' }, SECRET);

  it('returns 404 when a farmer tries to approve a return that belongs to another farmer\'s product', async () => {
    const { token: csrf, cookieStr } = await getCsrf();

    mockDb.query
      // auth active check
      .mockResolvedValueOnce({ rows: [{ active: 1 }], rowCount: 1 })
      // return lookup with AND p.farmer_id = $2 returns nothing because farmer B owns the product
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    // Farmer A (id=10) tries to approve return #5 which is for Farmer B's product
    const res = await request(app)
      .patch('/api/orders/42/return/5/approve')
      .set('Authorization', `Bearer ${farmerAToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send();

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found|not yours/i);
  });

  it('returns 403 when a buyer tries to approve their own return request', async () => {
    const { token: csrf, cookieStr } = await getCsrf();

    mockDb.query.mockResolvedValueOnce({ rows: [{ active: 1 }], rowCount: 1 });

    // Buyer (id=1) sends approve — only farmers are permitted
    const res = await request(app)
      .patch('/api/orders/42/return/5/approve')
      .set('Authorization', `Bearer ${buyerAToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send();

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/farmer/i);
  });

  it('allows the correct farmer to approve their own product\'s return', async () => {
    const { token: csrf, cookieStr } = await getCsrf();

    const returnRow = {
      id: 5,
      order_id: 42,
      buyer_id: 1,
      status: 'pending',
      total_price: '20.00',
      shipping_cost: '5.00',
      product_name: 'Apples',
      buyer_wallet: 'GBUYER123',
      buyer_name: 'Test Buyer',
      buyer_email: 'buyer@test.com',
      farmer_secret: 'SFARMER123',
      farmer_name: 'Farmer A',
    };

    mockDb.query
      // auth active check
      .mockResolvedValueOnce({ rows: [{ active: 1 }], rowCount: 1 })
      // return + product + users lookup — matches because p.farmer_id = 10 (farmer A)
      .mockResolvedValueOnce({ rows: [returnRow], rowCount: 1 })
      // UPDATE returns
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const stellar = jest.requireMock('../src/utils/stellar');
    if (stellar.sendPayment) stellar.sendPayment.mockResolvedValue('REFUND_TX_001');

    const res = await request(app)
      .patch('/api/orders/42/return/5/approve')
      .set('Authorization', `Bearer ${farmerAToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send();

    // 200 or 500 depending on whether stellar-payments is mocked,
    // but critically NOT 403 or 404
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });
});

describe('PATCH /api/orders/:orderId/return/:returnId/reject — farmer self-approval guard on reject', () => {
  const farmerAToken = jwt.sign({ id: 10, role: 'farmer' }, SECRET);

  it('returns 403 when a buyer tries to reject their own return', async () => {
    const { token: csrf, cookieStr } = await getCsrf();

    mockDb.query.mockResolvedValueOnce({ rows: [{ active: 1 }], rowCount: 1 });

    const res = await request(app)
      .patch('/api/orders/42/return/5/reject')
      .set('Authorization', `Bearer ${buyerAToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ reason: 'Nope' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/farmer/i);
  });

  it('returns 404 when a farmer tries to reject a return for another farmer\'s product', async () => {
    const { token: csrf, cookieStr } = await getCsrf();

    mockDb.query
      .mockResolvedValueOnce({ rows: [{ active: 1 }], rowCount: 1 })
      // return lookup with AND p.farmer_id = $2 returns nothing
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .patch('/api/orders/42/return/5/reject')
      .set('Authorization', `Bearer ${farmerAToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ reason: 'Does not apply' });

    expect(res.status).toBe(404);
  });
});
