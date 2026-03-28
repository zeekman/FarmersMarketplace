'use strict';

const { request, app, mockQuery } = require('./setup');
const mailer = require('../src/utils/mailer');
const jwt = require('jsonwebtoken');

const SECRET      = process.env.JWT_SECRET || 'test-secret-for-jest';
const buyerToken  = jwt.sign({ id: 1, role: 'buyer'  }, SECRET, { expiresIn: '1h' });
const farmerToken = jwt.sign({ id: 2, role: 'farmer' }, SECRET, { expiresIn: '1h' });

beforeEach(() => { jest.clearAllMocks(); mockQuery.mockResolvedValue({ rows: [], rowCount: 0 }); });

describe('POST /api/products/:id/alert', () => {
  test('403 if caller is not a buyer', async () => {
    const res = await request(app).post('/api/products/5/alert').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(403);
  });

  test('404 if product not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).post('/api/products/5/alert').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(404);
  });

  test('400 if product is in stock', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, quantity: 10 }], rowCount: 1 });
    const res = await request(app).post('/api/products/5/alert').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('in_stock');
  });

  test('200 — inserts alert for out-of-stock product', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, quantity: 0 }], rowCount: 1 })  // product lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });                        // INSERT alert
    const res = await request(app).post('/api/products/5/alert').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('409 on duplicate subscription', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, quantity: 0 }], rowCount: 1 })
      .mockRejectedValueOnce(Object.assign(new Error('UNIQUE constraint failed'), { code: '23505' }));
    const res = await request(app).post('/api/products/5/alert').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('conflict');
  });
});

describe('DELETE /api/products/:id/alert', () => {
  test('401 if not authenticated', async () => {
    const res = await request(app).delete('/api/products/5/alert');
    expect(res.status).toBe(401);
  });

  test('200 — removes alert for authenticated user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app).delete('/api/products/5/alert').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
  });

  test('200 even if no alert existed (idempotent)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).delete('/api/products/5/alert').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/products/:id/alert/status', () => {
  test('200 subscribed=true when alert exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });
    const res = await request(app).get('/api/products/5/alert/status').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.subscribed).toBe(true);
  });

  test('200 subscribed=false when no alert', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/products/5/alert/status').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.subscribed).toBe(false);
  });
});

describe('PATCH /api/products/:id/restock — back-in-stock alerts', () => {
  const subscribers = [
    { email: 'alice@example.com', name: 'Alice' },
    { email: 'bob@example.com',   name: 'Bob'   },
  ];

  test('notifies subscribers and deletes alerts when restocking from 0', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, name: 'Tomatoes', quantity: 0, farmer_id: 2 }], rowCount: 1 }) // SELECT product
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                                                        // UPDATE quantity
      .mockResolvedValueOnce({ rows: subscribers, rowCount: 2 })                                               // SELECT subscribers
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });                                                       // DELETE alerts

    const res = await request(app)
      .patch('/api/products/5/restock')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ quantity: 10 });

    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 30));
    expect(mailer.sendBackInStockEmail).toHaveBeenCalledTimes(2);
    expect(mailer.sendBackInStockEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice@example.com', productName: 'Tomatoes' })
    );
  });

  test('does not notify when restocking a product that was already in stock', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, name: 'Tomatoes', quantity: 5, farmer_id: 2 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .patch('/api/products/5/restock')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ quantity: 10 });

    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 20));
    expect(mailer.sendBackInStockEmail).not.toHaveBeenCalled();
  });

  test('does not fail if email send throws', async () => {
    mailer.sendBackInStockEmail.mockRejectedValueOnce(new Error('SMTP down'));
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, name: 'Tomatoes', quantity: 0, farmer_id: 2 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ email: 'x@x.com', name: 'X' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .patch('/api/products/5/restock')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ quantity: 5 });
    expect(res.status).toBe(200);
  });
});
