const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { mockDb } = require('./setup');

const addressRouter = require('../src/routes/addresses');
const returnsRouter = require('../src/routes/returns');
const reviewsRouter = require('../src/routes/reviews');
const stellar = require('../src/utils/stellar');

const app = express();
app.use(express.json());
app.use('/api/addresses', addressRouter);
app.use('/api/returns', returnsRouter);
app.use('/api/reviews', reviewsRouter);

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const buyerToken = jwt.sign({ id: 1, role: 'buyer' }, SECRET);
const secondBuyerToken = jwt.sign({ id: 2, role: 'buyer' }, SECRET);
const adminToken = jwt.sign({ id: 99, role: 'admin' }, SECRET);
const validAddress = {
  label: 'Home',
  street: '123 Main St',
  city: 'Nairobi',
  country: 'Kenya',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('Issue #1128 — address limit is concurrency-safe', () => {
  it('stores no more than MAX_ADDRESSES_PER_USER under concurrent creates', async () => {
    const previousMax = process.env.MAX_ADDRESSES_PER_USER;
    process.env.MAX_ADDRESSES_PER_USER = '10';
    let storedCount = 0;
    let nextId = 1;

    mockDb.query.mockImplementation(async (sql, params = []) => {
      if (/SELECT active FROM users/i.test(sql))
        return { rows: [{ active: 1 }], rowCount: 1 };
      if (/INSERT INTO addresses/i.test(sql)) {
        const max = Number(params[7]);
        if (storedCount >= max) return { rows: [], rowCount: 0 };
        storedCount += 1;
        return { rows: [{ id: nextId++ }], rowCount: 1 };
      }
      if (/SELECT \* FROM addresses WHERE id/i.test(sql))
        return { rows: [{ id: params[0], ...validAddress, is_default: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    try {
      const responses = await Promise.all(
        Array.from({ length: 15 }, (_, index) => request(app)
          .post('/api/addresses')
          .set('Authorization', `Bearer ${buyerToken}`)
          .send({ ...validAddress, label: `Home ${index}` }))
      );

      expect(responses.filter((response) => response.status === 201)).toHaveLength(10);
      expect(responses.filter((response) => response.status === 422)).toHaveLength(5);
      expect(storedCount).toBe(10);
    } finally {
      if (previousMax === undefined) delete process.env.MAX_ADDRESSES_PER_USER;
      else process.env.MAX_ADDRESSES_PER_USER = previousMax;
    }
  });
});

describe('Issue #1129 — deleting the default promotes a replacement', () => {
  it('promotes the most-recently-created remaining address', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ active: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 1, user_id: 1, is_default: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const response = await request(app)
      .delete('/api/addresses/1')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(response.status).toBe(200);
    expect(mockDb.query).toHaveBeenNthCalledWith(
      5,
      expect.stringMatching(/UPDATE addresses SET is_default = 0/i),
      [1]
    );
    expect(mockDb.query).toHaveBeenNthCalledWith(
      6,
      expect.stringMatching(/UPDATE addresses SET is_default = 1[\s\S]*ORDER BY created_at DESC/i),
      [1]
    );
  });
});

describe('Issue #1130 — return approval is idempotent', () => {
  it('burns reward tokens only on the first approval', async () => {
    stellar.burnRewardTokens.mockClear();
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ active: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        id: 7,
        order_id: 42,
        buyer_id: 1,
        status: 'pending',
        stellar_public_key: 'GTESTBUYER',
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ total_price: '20.00' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ active: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        id: 7,
        order_id: 42,
        buyer_id: 1,
        status: 'approved',
        stellar_public_key: 'GTESTBUYER',
      }], rowCount: 1 });

    const first = await request(app)
      .patch('/api/returns/7/approve')
      .set('Authorization', `Bearer ${adminToken}`);
    const second = await request(app)
      .patch('/api/returns/7/approve')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(stellar.burnRewardTokens).toHaveBeenCalledTimes(1);
  });

  it('sanitizes return reasons before insertion', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ active: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 42, buyer_id: 1, status: 'paid' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 });

    const response = await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ order_id: 42, reason: '<b>Damaged item</b>' });

    expect(response.status).toBe(201);
    expect(mockDb.query).toHaveBeenLastCalledWith(
      expect.stringMatching(/INSERT INTO returns/i),
      [42, 1, 'Damaged item']
    );
  });
});

describe('Issue #1131 — the purchase-verified review handler is active', () => {
  it('registers exactly one POST / handler', () => {
    const postHandlers = reviewsRouter.stack.filter(
      (layer) => layer.route?.path === '/' && layer.route.methods.post
    );
    expect(postHandlers).toHaveLength(1);
  });

  it('rejects a buyer without a paid order for the product', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ active: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const response = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${secondBuyerToken}`)
      .send({ product_id: 5, rating: 4, comment: 'No purchase' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('purchase_required');
  });

  it('sanitizes review text before insertion for a paid order', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ active: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 10, buyer_id: 2, product_id: 5, status: 'paid' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 3 }], rowCount: 1 });

    const response = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${secondBuyerToken}`)
      .send({ product_id: 5, rating: 5, comment: '<b>Great product</b>' });

    expect(response.status).toBe(201);
    expect(mockDb.query).toHaveBeenLastCalledWith(
      expect.stringMatching(/INSERT INTO reviews/i),
      [10, 2, 5, 5, 'Great product']
    );
  });
});
