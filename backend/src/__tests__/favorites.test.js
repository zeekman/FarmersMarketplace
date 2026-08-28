/**
 * Unit tests for favorites route (issue #1155)
 * Tests buyer favorites list management
 */

const request = require('supertest');
const express = require('express');
const favoritesRouter = require('../routes/favorites');
const db = require('../db/schema');

jest.mock('../db/schema');
jest.mock('../middleware/auth', () => (req, res, next) => {
  req.user = { id: 100, role: 'buyer' };
  next();
});

const app = express();
app.use(express.json());
app.use('/api/favorites', favoritesRouter);

describe('POST /api/favorites', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('adds product to favorites', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 200 }] }) // product exists
      .mockResolvedValueOnce({ rows: [] }); // insert success

    const res = await request(app).post('/api/favorites').send({ product_id: 200 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Added to favorites');
  });

  test('rejects missing product_id', async () => {
    const res = await request(app).post('/api/favorites').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Product ID is required');
  });

  test('rejects non-existent product', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/favorites').send({ product_id: 999 });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Product not found');
  });

  test('rejects duplicate favorite', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 200 }] })
      .mockRejectedValueOnce({ code: '23505', message: 'UNIQUE constraint violation' });

    const res = await request(app).post('/api/favorites').send({ product_id: 200 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Already in favorites');
  });

  test('only buyers can add favorites', async () => {
    const farmerApp = express();
    farmerApp.use(express.json());
    jest.mock('../middleware/auth', () => (req, res, next) => {
      req.user = { id: 300, role: 'farmer' };
      next();
    }, { virtual: true });
    farmerApp.use('/api/favorites', favoritesRouter);

    const res = await request(farmerApp).post('/api/favorites').send({ product_id: 200 });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/favorites/:product_id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('removes product from favorites', async () => {
    db.query.mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app).delete('/api/favorites/200');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Removed from favorites');
  });

  test('returns 404 when favorite not found', async () => {
    db.query.mockResolvedValueOnce({ rowCount: 0 });

    const res = await request(app).delete('/api/favorites/999');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Favorite not found');
  });
});

describe('GET /api/favorites', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns buyer favorites list with pagination', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 200,
            name: 'Tomatoes',
            price: '5.50',
            farmer_id: 300,
            farmer_name: 'Farm Co',
            avg_rating: '4.5',
            review_count: '10',
            favorited_at: '2024-01-01',
          },
          {
            id: 201,
            name: 'Carrots',
            price: '3.00',
            farmer_id: 301,
            farmer_name: 'Veggie Farm',
            avg_rating: '4.8',
            review_count: '5',
            favorited_at: '2024-01-02',
          },
        ],
      });

    const res = await request(app).get('/api/favorites');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
    expect(res.body.totalPages).toBe(1);
  });

  test('supports pagination parameters', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '50' }] })
      .mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/favorites?page=2&limit=10');

    expect(db.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([100, 10, 10]) // offset = (2-1) * 10
    );
  });

  test('returns empty list when no favorites', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/favorites');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });
});

describe('GET /api/favorites/check/:product_id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns true when product is favorited', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const res = await request(app).get('/api/favorites/check/200');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.isFavorited).toBe(true);
  });

  test('returns false when product is not favorited', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/favorites/check/200');

    expect(res.status).toBe(200);
    expect(res.body.isFavorited).toBe(false);
  });
});
