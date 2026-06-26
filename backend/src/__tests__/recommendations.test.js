/**
 * Tests for GET /api/recommendations
 * Covers: personalised path, cold-start fallback, and cache hit.
 */

process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockDb = jest.requireMock('../db/schema');
const mockCache = jest.requireMock('../cache');

jest.mock('../routes', () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/recommendations', require('../routes/recommendations'));
  return app;
});

const app = require('../app');

const SECRET = process.env.JWT_SECRET;
const buyerToken = jwt.sign({ id: 10, role: 'buyer' }, SECRET);
const authHeader = `Bearer ${buyerToken}`;

// active user row for auth middleware
const ACTIVE_USER = { rows: [{ active: 1 }], rowCount: 1 };
const EMPTY = { rows: [], rowCount: 0 };

const PRODUCTS = [
  { id: 1, name: 'Tomatoes', category: 'vegetables', price: 2.5, avg_rating: 4.5, view_count: 100, created_at: '2024-01-01', farmer_name: 'Alice' },
  { id: 2, name: 'Carrots', category: 'vegetables', price: 1.5, avg_rating: 4.0, view_count: 80, created_at: '2024-01-02', farmer_name: 'Bob' },
];

beforeEach(() => {
  mockCache.get.mockResolvedValue(null);
  mockCache.set.mockResolvedValue(undefined);
});

describe('GET /api/recommendations', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/recommendations');
    expect(res.status).toBe(401);
  });

  it('cold-start: returns top products by avg_rating for user with no orders', async () => {
    mockDb.query = jest.fn()
      .mockResolvedValueOnce(ACTIVE_USER)          // auth check
      .mockResolvedValueOnce(EMPTY)                // no order categories
      .mockResolvedValueOnce({ rows: PRODUCTS });  // cold-start query

    const res = await request(app)
      .get('/api/recommendations')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(PRODUCTS);
    expect(mockCache.set).toHaveBeenCalledWith(
      expect.stringContaining('recommendations:10'),
      PRODUCTS,
      15 * 60
    );
  });

  it('personalised: returns products from purchased categories, excluding already-purchased', async () => {
    // Return 12 products so the fill path is not triggered (limit defaults to 12)
    const catProducts = Array.from({ length: 12 }, (_, i) => ({
      id: i + 2, name: `Product ${i + 2}`, category: 'vegetables', price: 1.5,
      avg_rating: 4.0, view_count: 80, created_at: '2024-01-02', farmer_name: 'Bob',
    }));
    mockDb.query = jest.fn()
      .mockResolvedValueOnce(ACTIVE_USER)                               // auth check
      .mockResolvedValueOnce({ rows: [{ category: 'vegetables' }] })   // order categories
      .mockResolvedValueOnce({ rows: [{ product_id: 1 }] })            // purchased ids
      .mockResolvedValueOnce({ rows: catProducts });                    // category-filtered products

    const res = await request(app)
      .get('/api/recommendations')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(12);
  });

  it('personalised: fills remaining slots from cold-start when not enough category matches', async () => {
    mockDb.query = jest.fn()
      .mockResolvedValueOnce(ACTIVE_USER)                               // auth check
      .mockResolvedValueOnce({ rows: [{ category: 'vegetables' }] })   // categories
      .mockResolvedValueOnce({ rows: [{ product_id: 99 }] })           // purchased ids
      .mockResolvedValueOnce({ rows: [PRODUCTS[0]] })                  // 1 category match
      .mockResolvedValueOnce({ rows: [PRODUCTS[1]] });                  // cold-start fill

    const res = await request(app)
      .get('/api/recommendations?limit=2')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('cache hit: returns cached data without querying DB', async () => {
    mockCache.get.mockResolvedValue(PRODUCTS);
    mockDb.query = jest.fn()
      .mockResolvedValueOnce(ACTIVE_USER); // auth check only

    const res = await request(app)
      .get('/api/recommendations')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.data).toEqual(PRODUCTS);
    // Only auth query called, no recommendation queries
    expect(mockDb.query).toHaveBeenCalledTimes(1);
  });

  it('respects ?limit=N capped at 20', async () => {
    mockDb.query = jest.fn()
      .mockResolvedValueOnce(ACTIVE_USER)   // auth check
      .mockResolvedValueOnce(EMPTY)         // no order categories
      .mockResolvedValueOnce({ rows: [] }); // cold-start returns empty

    await request(app)
      .get('/api/recommendations?limit=50')
      .set('Authorization', authHeader);

    // Second call is cold-start; its first param is the limit
    const coldStartParams = mockDb.query.mock.calls[2][1];
    expect(coldStartParams[0]).toBe(20);
  });
});
