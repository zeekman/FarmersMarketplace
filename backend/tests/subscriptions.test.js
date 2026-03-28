'use strict';

const jwt = require('jsonwebtoken');
const { request, app, mockDb } = require('./setup');

const SECRET      = process.env.JWT_SECRET || 'test-secret-for-jest';
const buyerToken  = jwt.sign({ id: 1, role: 'buyer'  }, SECRET);
const farmerToken = jwt.sign({ id: 2, role: 'farmer' }, SECRET);

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── POST /api/subscriptions ───────────────────────────────────────────────────
describe('POST /api/subscriptions', () => {
  it('returns 403 for farmers', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ product_id: 1, frequency: 'weekly', quantity: 2 });
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .send({ product_id: 1, frequency: 'weekly', quantity: 1 });
    expect(res.status).toBe(401);
  });

  it('returns 400 when product_id is missing', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ frequency: 'weekly', quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 for invalid frequency', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 1, frequency: 'daily', quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 for quantity less than 1', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 1, frequency: 'weekly', quantity: 0 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 for non-integer quantity', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 1, frequency: 'weekly', quantity: 1.5 });
    expect(res.status).toBe(400);
  });

  it('returns 404 when product does not exist', async () => {
    mockDb.prepare.mockReturnValue({ get: jest.fn().mockReturnValue(null) });
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 999, frequency: 'monthly', quantity: 1 });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('creates subscription successfully', async () => {
    mockDb.prepare.mockReturnValue({
      get: jest.fn().mockReturnValue({ id: 1 }),
      run: jest.fn().mockReturnValue({ lastInsertRowid: 5 }),
    });
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 1, frequency: 'weekly', quantity: 2 });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe(5);
  });

  it('accepts all valid frequencies', async () => {
    for (const freq of ['weekly', 'biweekly', 'monthly']) {
      mockDb.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue({ id: 1 }),
        run: jest.fn().mockReturnValue({ lastInsertRowid: 1 }),
      });
      const res = await request(app)
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ product_id: 1, frequency: freq, quantity: 1 });
      expect(res.status).toBe(201);
    }
  });
});

// ── GET /api/subscriptions ────────────────────────────────────────────────────
describe('GET /api/subscriptions', () => {
  it('returns 403 for farmers', async () => {
    const res = await request(app)
      .get('/api/subscriptions')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/subscriptions');
    expect(res.status).toBe(401);
  });

  it('returns buyer subscriptions', async () => {
    const subs = [{ id: 1, product_name: 'Apples', frequency: 'weekly', quantity: 2 }];
    mockDb.prepare.mockReturnValue({ all: jest.fn().mockReturnValue(subs) });
    const res = await request(app)
      .get('/api/subscriptions')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].product_name).toBe('Apples');
  });

  it('returns empty array when no subscriptions', async () => {
    mockDb.prepare.mockReturnValue({ all: jest.fn().mockReturnValue([]) });
    const res = await request(app)
      .get('/api/subscriptions')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ── PATCH /api/subscriptions/:id/pause ───────────────────────────────────────
describe('PATCH /api/subscriptions/:id/pause', () => {
  it('returns 404 when subscription not found', async () => {
    mockDb.prepare.mockReturnValue({ get: jest.fn().mockReturnValue(null) });
    const res = await request(app)
      .patch('/api/subscriptions/99/pause')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 400 when subscription is already cancelled', async () => {
    mockDb.prepare.mockReturnValue({
      get: jest.fn().mockReturnValue({ id: 1, buyer_id: 1, status: 'cancelled' }),
    });
    const res = await request(app)
      .patch('/api/subscriptions/1/pause')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_state');
  });

  it('pauses an active subscription', async () => {
    mockDb.prepare.mockReturnValue({
      get: jest.fn().mockReturnValue({ id: 1, buyer_id: 1, status: 'active' }),
      run: jest.fn(),
    });
    const res = await request(app)
      .patch('/api/subscriptions/1/pause')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── PATCH /api/subscriptions/:id/resume ──────────────────────────────────────
describe('PATCH /api/subscriptions/:id/resume', () => {
  it('returns 404 when subscription not found', async () => {
    mockDb.prepare.mockReturnValue({ get: jest.fn().mockReturnValue(null) });
    const res = await request(app)
      .patch('/api/subscriptions/99/resume')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 400 when subscription is cancelled', async () => {
    mockDb.prepare.mockReturnValue({
      get: jest.fn().mockReturnValue({ id: 1, buyer_id: 1, status: 'cancelled', frequency: 'weekly' }),
    });
    const res = await request(app)
      .patch('/api/subscriptions/1/resume')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_state');
  });

  it('resumes a paused subscription', async () => {
    mockDb.prepare.mockReturnValue({
      get: jest.fn().mockReturnValue({ id: 1, buyer_id: 1, status: 'paused', frequency: 'monthly' }),
      run: jest.fn(),
    });
    const res = await request(app)
      .patch('/api/subscriptions/1/resume')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── DELETE /api/subscriptions/:id ────────────────────────────────────────────
describe('DELETE /api/subscriptions/:id', () => {
  it('returns 404 when subscription not found or not owned', async () => {
    mockDb.prepare.mockReturnValue({ get: jest.fn().mockReturnValue(null) });
    const res = await request(app)
      .delete('/api/subscriptions/99')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(404);
  });

  it('cancels subscription successfully', async () => {
    mockDb.prepare.mockReturnValue({
      get: jest.fn().mockReturnValue({ id: 1, buyer_id: 1, status: 'active' }),
      run: jest.fn(),
    });
    const res = await request(app)
      .delete('/api/subscriptions/1')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('can cancel an already-paused subscription', async () => {
    mockDb.prepare.mockReturnValue({
      get: jest.fn().mockReturnValue({ id: 1, buyer_id: 1, status: 'paused' }),
      run: jest.fn(),
    });
    const res = await request(app)
      .delete('/api/subscriptions/1')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
  });
});
