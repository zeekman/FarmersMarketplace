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
