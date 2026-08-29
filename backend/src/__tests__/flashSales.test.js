/**
 * Unit tests for flashSales route (issue #1155)
 * Tests flash sale creation, validation, and overlap checking
 */

const request = require('supertest');
const express = require('express');
const flashSalesRouter = require('../routes/flashSales');
const db = require('../db/schema');

jest.mock('../db/schema');
jest.mock('../middleware/auth', () => (req, res, next) => {
  req.user = { id: 300, role: 'farmer' };
  next();
});

const app = express();
app.use(express.json());
app.use('/products', flashSalesRouter);

describe('PATCH /products/:id/flash-sale', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates flash sale successfully', async () => {
    const now = new Date();
    const starts = new Date(now.getTime() + 60000); // 1 min from now
    const ends = new Date(now.getTime() + 3600000); // 1 hour from now

    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 1, farmer_id: 300, price: '10.00', flash_sale_ends_at: null }],
      })
      .mockResolvedValueOnce() // UPDATE
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            price: '10.00',
            flash_sale_price: '7.50',
            flash_sale_starts_at: starts.toISOString(),
            flash_sale_ends_at: ends.toISOString(),
          },
        ],
      });

    const res = await request(app)
      .patch('/products/1/flash-sale')
      .send({
        flash_sale_price: 7.5,
        flash_sale_starts_at: starts.toISOString(),
        flash_sale_ends_at: ends.toISOString(),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.flash_sale_price).toBe('7.50');
  });

  test('rejects overlapping flash sales', async () => {
    const futureDate = new Date(Date.now() + 86400000); // 1 day from now

    db.query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          farmer_id: 300,
          price: '10.00',
          flash_sale_ends_at: futureDate.toISOString(),
        },
      ],
    });

    const res = await request(app)
      .patch('/products/1/flash-sale')
      .send({
        flash_sale_price: 7.5,
        flash_sale_starts_at: new Date().toISOString(),
        flash_sale_ends_at: new Date(Date.now() + 3600000).toISOString(),
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Cannot create overlapping flash sales on the same product');
    expect(res.body.code).toBe('flash_sale_overlap');
  });

  test('rejects flash sale price >= regular price', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 1, farmer_id: 300, price: '10.00', flash_sale_ends_at: null }],
    });

    const res = await request(app)
      .patch('/products/1/flash-sale')
      .send({
        flash_sale_price: 15.0,
        flash_sale_starts_at: new Date().toISOString(),
        flash_sale_ends_at: new Date(Date.now() + 3600000).toISOString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Flash sale price must be less than regular price');
  });

  test('rejects start time after end time', async () => {
    const now = new Date();
    const starts = new Date(now.getTime() + 3600000); // 1 hour from now
    const ends = new Date(now.getTime() + 60000); // 1 min from now (before starts)

    db.query.mockResolvedValueOnce({
      rows: [{ id: 1, farmer_id: 300, price: '10.00', flash_sale_ends_at: null }],
    });

    const res = await request(app)
      .patch('/products/1/flash-sale')
      .send({
        flash_sale_price: 7.5,
        flash_sale_starts_at: starts.toISOString(),
        flash_sale_ends_at: ends.toISOString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('flash_sale_starts_at must be before flash_sale_ends_at');
  });

  test('requires flash_sale_ends_at when setting flash sale', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 1, farmer_id: 300, price: '10.00', flash_sale_ends_at: null }],
    });

    const res = await request(app)
      .patch('/products/1/flash-sale')
      .send({
        flash_sale_price: 7.5,
        flash_sale_starts_at: new Date().toISOString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('flash_sale_ends_at is required when setting flash sale');
  });

  test('requires flash_sale_starts_at when setting flash sale', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 1, farmer_id: 300, price: '10.00', flash_sale_ends_at: null }],
    });

    const res = await request(app)
      .patch('/products/1/flash-sale')
      .send({
        flash_sale_price: 7.5,
        flash_sale_ends_at: new Date(Date.now() + 3600000).toISOString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('flash_sale_starts_at is required when setting flash sale');
  });

  test('rejects non-positive flash sale price', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 1, farmer_id: 300, price: '10.00', flash_sale_ends_at: null }],
    });

    const res = await request(app)
      .patch('/products/1/flash-sale')
      .send({
        flash_sale_price: 0,
        flash_sale_starts_at: new Date().toISOString(),
        flash_sale_ends_at: new Date(Date.now() + 3600000).toISOString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('flash_sale_price must be a positive number');
  });

  test('returns 404 for non-existent product', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch('/products/999/flash-sale')
      .send({
        flash_sale_price: 7.5,
        flash_sale_starts_at: new Date().toISOString(),
        flash_sale_ends_at: new Date(Date.now() + 3600000).toISOString(),
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Product not found');
  });

  test('rejects modification of other farmer product', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 1, farmer_id: 999, price: '10.00', flash_sale_ends_at: null }],
    });

    const res = await request(app)
      .patch('/products/1/flash-sale')
      .send({
        flash_sale_price: 7.5,
        flash_sale_starts_at: new Date().toISOString(),
        flash_sale_ends_at: new Date(Date.now() + 3600000).toISOString(),
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Not your product');
  });
});

describe('DELETE /products/:id/flash-sale', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('removes flash sale successfully', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1, farmer_id: 300 }] })
      .mockResolvedValueOnce(); // UPDATE

    const res = await request(app).delete('/products/1/flash-sale');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('returns 404 for non-existent product', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).delete('/products/999/flash-sale');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Product not found');
  });

  test('rejects deletion of other farmer product', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, farmer_id: 999 }] });

    const res = await request(app).delete('/products/1/flash-sale');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Not your product');
  });
});
