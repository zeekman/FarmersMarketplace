/**
 * Unit tests for routes/bundleDiscounts.js — quantity-based bundle discount tiers
 */

process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');

const mockDb = jest.requireMock('../db/schema');

const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, process.env.JWT_SECRET);
const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, process.env.JWT_SECRET);

describe('GET /api/farmers/me/bundle-discounts', () => {
  it('returns all bundle discounts for the authenticated farmer', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [
        { id: 1, farmer_id: 1, min_products: 5, discount_percent: 10 },
        { id: 2, farmer_id: 1, min_products: 10, discount_percent: 20 },
      ],
      rowCount: 2,
    });

    const res = await request(app)
      .get('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].min_products).toBe(5);
  });

  it('returns 403 when a buyer tries to access', async () => {
    const res = await request(app)
      .get('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Farmers only/i);
  });

  it('returns empty array when farmer has no discounts', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .get('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('POST /api/farmers/me/bundle-discounts', () => {
  it('creates a new bundle discount tier', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 10, farmer_id: 1, min_products: 5, discount_percent: 15 }],
      rowCount: 1,
    });

    const res = await request(app)
      .post('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ min_products: 5, discount_percent: 15 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.min_products).toBe(5);
    expect(res.body.data.discount_percent).toBe(15);
  });

  it('returns 400 when min_products is less than 2', async () => {
    const res = await request(app)
      .post('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ min_products: 1, discount_percent: 10 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
    expect(res.body.error).toMatch(/min_products must be an integer >= 2/i);
  });

  it('returns 400 when min_products is not an integer', async () => {
    const res = await request(app)
      .post('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ min_products: 5.5, discount_percent: 10 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 when discount_percent is less than 1', async () => {
    const res = await request(app)
      .post('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ min_products: 5, discount_percent: 0 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
    expect(res.body.error).toMatch(/discount_percent must be between 1 and 50/i);
  });

  it('returns 400 when discount_percent is greater than 50', async () => {
    const res = await request(app)
      .post('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ min_products: 5, discount_percent: 51 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 409 when duplicate min_products tier already exists', async () => {
    const duplicateError = new Error('UNIQUE constraint failed');
    duplicateError.code = '23505';
    mockDb.query.mockRejectedValueOnce(duplicateError);

    const res = await request(app)
      .post('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ min_products: 5, discount_percent: 15 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('duplicate');
  });

  it('returns 403 when a buyer tries to create a discount', async () => {
    const res = await request(app)
      .post('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ min_products: 5, discount_percent: 10 });

    expect(res.status).toBe(403);
  });

  it('accepts discount_percent at exactly 1', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 11, farmer_id: 1, min_products: 3, discount_percent: 1 }],
      rowCount: 1,
    });

    const res = await request(app)
      .post('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ min_products: 3, discount_percent: 1 });

    expect(res.status).toBe(201);
  });

  it('accepts discount_percent at exactly 50', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 12, farmer_id: 1, min_products: 20, discount_percent: 50 }],
      rowCount: 1,
    });

    const res = await request(app)
      .post('/api/farmers/me/bundle-discounts')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ min_products: 20, discount_percent: 50 });

    expect(res.status).toBe(201);
  });
});

describe('PUT /api/farmers/me/bundle-discounts/:id', () => {
  it('updates an existing bundle discount tier', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 1, farmer_id: 1, min_products: 8, discount_percent: 25 }],
      rowCount: 1,
    });

    const res = await request(app)
      .put('/api/farmers/me/bundle-discounts/1')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ min_products: 8, discount_percent: 25 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.min_products).toBe(8);
  });

  it('returns 404 when discount tier does not exist', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .put('/api/farmers/me/bundle-discounts/999')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ min_products: 5, discount_percent: 10 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('returns 400 for invalid min_products', async () => {
    const res = await request(app)
      .put('/api/farmers/me/bundle-discounts/1')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ min_products: 0, discount_percent: 10 });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid discount_percent', async () => {
    const res = await request(app)
      .put('/api/farmers/me/bundle-discounts/1')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ min_products: 5, discount_percent: 100 });

    expect(res.status).toBe(400);
  });

  it('returns 403 when a buyer tries to update', async () => {
    const res = await request(app)
      .put('/api/farmers/me/bundle-discounts/1')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ min_products: 5, discount_percent: 10 });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/farmers/me/bundle-discounts/:id', () => {
  it('deletes a bundle discount tier', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .delete('/api/farmers/me/bundle-discounts/1')
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when discount tier does not exist', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .delete('/api/farmers/me/bundle-discounts/999')
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('returns 403 when a buyer tries to delete', async () => {
    const res = await request(app)
      .delete('/api/farmers/me/bundle-discounts/1')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(403);
  });

  it('prevents farmers from deleting other farmers\' discount tiers', async () => {
    // When SQL WHERE includes farmer_id, trying to delete another's tier returns 0 rowCount
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .delete('/api/farmers/me/bundle-discounts/1')
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(404);
  });
});
