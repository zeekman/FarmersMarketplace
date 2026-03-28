'use strict';

const jwt = require('jsonwebtoken');
const { request, app, mockDb, getCsrf } = require('./setup');

const SECRET      = process.env.JWT_SECRET || 'test-secret-for-jest';
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken  = jwt.sign({ id: 2, role: 'buyer'  }, SECRET);

// coupons.js uses the legacy prepare() API (SQLite sync)
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

// ── POST /api/coupons ─────────────────────────────────────────────────────────
describe('POST /api/coupons', () => {
  it('returns 403 for buyers', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/coupons')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ code: 'SAVE10', discount_type: 'percent', discount_value: 10 });
    expect(res.status).toBe(403);
  });

  it('returns 400 when required fields are missing', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/coupons')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ code: 'SAVE10' }); // missing discount_type & discount_value
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 for invalid discount_type', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/coupons')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ code: 'SAVE10', discount_type: 'bogus', discount_value: 10 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-positive discount_value', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/coupons')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ code: 'SAVE10', discount_type: 'fixed', discount_value: 0 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when percent discount exceeds 100', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/coupons')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ code: 'SAVE10', discount_type: 'percent', discount_value: 101 });
    expect(res.status).toBe(400);
  });

  it('returns 409 on duplicate coupon code', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockDb.prepare.mockReturnValue({
      run: jest.fn().mockImplementation(() => { throw new Error('UNIQUE constraint failed'); }),
    });
    const res = await request(app)
      .post('/api/coupons')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ code: 'DUPE', discount_type: 'fixed', discount_value: 5 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('conflict');
  });

  it('farmer creates a percent coupon successfully', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockDb.prepare.mockReturnValue({
      run: jest.fn().mockReturnValue({ lastInsertRowid: 7 }),
    });
    const res = await request(app)
      .post('/api/coupons')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ code: 'summer20', discount_type: 'percent', discount_value: 20 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe(7);
    expect(res.body.code).toBe('SUMMER20'); // uppercased
  });
});

// ── GET /api/coupons ──────────────────────────────────────────────────────────
describe('GET /api/coupons', () => {
  it('returns 403 for buyers', async () => {
    const res = await request(app)
      .get('/api/coupons')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/coupons');
    expect(res.status).toBe(401);
  });

  it('returns farmer coupons list', async () => {
    const coupons = [{ id: 1, code: 'SAVE10', discount_type: 'percent', discount_value: 10 }];
    mockDb.prepare.mockReturnValue({ all: jest.fn().mockReturnValue(coupons) });
    const res = await request(app)
      .get('/api/coupons')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].code).toBe('SAVE10');
  });

  it('returns empty array when farmer has no coupons', async () => {
    mockDb.prepare.mockReturnValue({ all: jest.fn().mockReturnValue([]) });
    const res = await request(app)
      .get('/api/coupons')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ── DELETE /api/coupons/:id ───────────────────────────────────────────────────
describe('DELETE /api/coupons/:id', () => {
  it('returns 403 for buyers', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .delete('/api/coupons/1')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(403);
  });

  it('returns 404 when coupon not found or belongs to another farmer', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockDb.prepare.mockReturnValue({ get: jest.fn().mockReturnValue(null) });
    const res = await request(app)
      .delete('/api/coupons/99')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(404);
  });

  it('farmer deletes own coupon successfully', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const runMock = jest.fn();
    mockDb.prepare.mockReturnValue({
      get: jest.fn().mockReturnValue({ id: 1, farmer_id: 1, code: 'SAVE10' }),
      run: runMock,
    });
    const res = await request(app)
      .delete('/api/coupons/1')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── POST /api/coupons/validate ────────────────────────────────────────────────
describe('POST /api/coupons/validate', () => {
  it('returns 400 when code or product_id is missing', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ code: 'SAVE10' }); // missing product_id
    expect(res.status).toBe(400);
  });

  it('returns 404 when product does not exist', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockDb.prepare.mockReturnValue({ get: jest.fn().mockReturnValue(null) });
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ code: 'SAVE10', product_id: 999 });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid coupon code', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockDb.prepare
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue({ id: 1, price: 10, farmer_id: 1 }) }) // product
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue(null) }); // coupon not found
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ code: 'BADCODE', product_id: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_coupon');
  });

  it('returns 400 for expired coupon', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const expiredCoupon = { id: 1, farmer_id: 1, discount_type: 'percent', discount_value: 10, expires_at: '2000-01-01', max_uses: null, used_count: 0 };
    mockDb.prepare
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue({ id: 1, price: 10, farmer_id: 1 }) })
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue(expiredCoupon) });
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ code: 'OLD10', product_id: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('coupon_expired');
  });

  it('returns 400 when coupon usage limit is reached', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const exhaustedCoupon = { id: 1, farmer_id: 1, discount_type: 'fixed', discount_value: 5, expires_at: null, max_uses: 10, used_count: 10 };
    mockDb.prepare
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue({ id: 1, price: 20, farmer_id: 1 }) })
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue(exhaustedCoupon) });
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ code: 'USED', product_id: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('coupon_exhausted');
  });

  it('returns 400 when coupon belongs to a different farmer', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const wrongFarmerCoupon = { id: 1, farmer_id: 99, discount_type: 'percent', discount_value: 10, expires_at: null, max_uses: null, used_count: 0 };
    mockDb.prepare
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue({ id: 1, price: 10, farmer_id: 1 }) })
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue(wrongFarmerCoupon) });
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ code: 'OTHER', product_id: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_coupon');
  });

  it('calculates percent discount correctly', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const validCoupon = { id: 1, farmer_id: 1, discount_type: 'percent', discount_value: 20, expires_at: null, max_uses: null, used_count: 0 };
    mockDb.prepare
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue({ id: 1, price: 50, farmer_id: 1 }) })
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue(validCoupon) });
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ code: 'SAVE20', product_id: 1, quantity: 1 });
    expect(res.status).toBe(200);
    expect(res.body.discount).toBeCloseTo(10);
    expect(res.body.final_total).toBeCloseTo(40);
  });

  it('calculates fixed discount correctly and does not go below 0', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const validCoupon = { id: 1, farmer_id: 1, discount_type: 'fixed', discount_value: 999, expires_at: null, max_uses: null, used_count: 0 };
    mockDb.prepare
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue({ id: 1, price: 5, farmer_id: 1 }) })
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue(validCoupon) });
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ code: 'BIG', product_id: 1, quantity: 1 });
    expect(res.status).toBe(200);
    expect(res.body.final_total).toBe(0); // capped at 0
  });
});
