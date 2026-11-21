process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = jest.requireMock('../db/schema');
const reviewsRouter = require('../routes/reviews');

const app = express();
app.use(express.json());
app.use('/api/reviews', reviewsRouter);
app.use('/api/admin/reviews', reviewsRouter.adminRouter);
app.use('/api/products', reviewsRouter.productRouter);

const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, process.env.JWT_SECRET);
const adminToken = jwt.sign({ id: 99, role: 'admin' }, process.env.JWT_SECRET);

beforeEach(() => {
  db.query.mockImplementation(async (sql) => {
    if (/SELECT active FROM users/i.test(sql)) return { rows: [{ active: 1 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
});

describe('review route database queries', () => {
  it('lists approved product reviews (paginated, body field)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 }) // total count
      .mockResolvedValueOnce({
        rows: [{ id: 4, rating: 5, body: 'Fresh produce', buyer_name: 'Buyer' }],
        rowCount: 1,
      });

    const response = await request(app).get('/api/reviews/5');

    expect(response.status).toBe(200);
    expect(response.body.data[0].body).toBe('Fresh produce');
    expect(response.body.page).toBe(1);
    expect(response.body.limit).toBe(20);
    expect(response.body.total).toBe(1);

    // The data query reads the schema column (comment) and exposes it as `body`.
    const dataCall = db.query.mock.calls.find(([sql]) => /r\.comment AS body/i.test(sql));
    expect(dataCall).toBeDefined();
    expect(dataCall[0]).toContain("r.status = $2");
  });

  it('caps the page size limit at 100', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const response = await request(app).get('/api/reviews/5?limit=500');

    expect(response.status).toBe(200);
    expect(response.body.limit).toBe(100);

    const dataCall = db.query.mock.calls.find(([sql]) => /LIMIT \$3 OFFSET \$4/i.test(sql));
    expect(dataCall[1]).toEqual(['5', 'approved', 100, 0]);
  });

  it('treats a page below 1 as page 1', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const response = await request(app).get('/api/reviews/5?page=0');

    expect(response.status).toBe(200);
    expect(response.body.page).toBe(1);

    const dataCall = db.query.mock.calls.find(([sql]) => /LIMIT \$3 OFFSET \$4/i.test(sql));
    expect(dataCall[1]).toEqual(['5', 'approved', 20, 0]);
  });

  it('deletes a buyer-owned review and recalculates its product rating', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/SELECT active FROM users/i.test(sql)) return { rows: [{ active: 1 }], rowCount: 1 };
      if (/SELECT \* FROM reviews WHERE id = \$1 AND buyer_id = \$2/i.test(sql)) {
        return { rows: [{ id: 4, product_id: 5 }], rowCount: 1 };
      }
      if (/SELECT ROUND\(AVG\(rating\)/i.test(sql)) {
        return { rows: [{ avg: 4, cnt: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const response = await request(app)
      .delete('/api/reviews/4')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Review deleted');
    expect(db.query.mock.calls.some(([sql]) => /DELETE FROM reviews WHERE id = \$1/i.test(sql))).toBe(true);
    expect(db.query.mock.calls.some(([sql]) => /UPDATE products SET avg_rating = \$1/i.test(sql))).toBe(true);
  });

  it('approves a review and recalculates the product rating', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/SELECT active FROM users/i.test(sql)) return { rows: [{ active: 1 }], rowCount: 1 };
      if (/SELECT \* FROM reviews WHERE id = \$1/i.test(sql)) {
        return { rows: [{ id: 4, product_id: 5 }], rowCount: 1 };
      }
      if (/SELECT ROUND\(AVG\(rating\)/i.test(sql)) {
        return { rows: [{ avg: 5, cnt: 2 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const response = await request(app)
      .patch('/api/admin/reviews/4/approve')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Review approved');
    expect(db.query.mock.calls.some(([sql]) => /UPDATE reviews SET status = 'approved'/i.test(sql))).toBe(true);
  });
});
