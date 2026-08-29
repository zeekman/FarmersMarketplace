/**
 * Unit tests for export route (issue #1155)
 * Tests CSV and PDF export for products and sales
 */

const request = require('supertest');
const express = require('express');
const exportRouter = require('../routes/export');
const db = require('../db/schema');

jest.mock('../db/schema');
jest.mock('../middleware/auth', () => (req, res, next) => {
  req.user = { id: 300, role: 'farmer' };
  next();
});

const app = express();
app.use(express.json());
app.use('/api', exportRouter);

describe('GET /api/products/export', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('exports products as CSV by default', async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          id: 1,
          name: 'Organic Tomatoes',
          category: 'vegetables',
          price: '5.50',
          quantity: 100,
          unit: 'kg',
          description: 'Fresh organic tomatoes',
          low_stock_threshold: 10,
          created_at: '2024-01-01T00:00:00.000Z',
        },
      ],
    });

    const res = await request(app).get('/api/products/export?format=csv');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toContain('products.csv');
    expect(res.text).toContain('Organic Tomatoes');
  });

  test('exports products as PDF', async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          id: 1,
          name: 'Organic Tomatoes',
          category: 'vegetables',
          price: '5.50',
          quantity: 100,
          unit: 'kg',
          description: 'Fresh tomatoes',
          low_stock_threshold: 10,
          created_at: '2024-01-01',
        },
      ],
    });

    const res = await request(app).get('/api/products/export?format=pdf');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('products.pdf');
  });

  test('rejects invalid format', async () => {
    const res = await request(app).get('/api/products/export?format=xml');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('format must be csv or pdf');
  });

  test('only allows farmers to export', async () => {
    const buyerApp = express();
    buyerApp.use(express.json());
    jest.mock('../middleware/auth', () => (req, res, next) => {
      req.user = { id: 100, role: 'buyer' };
      next();
    }, { virtual: true });
    buyerApp.use('/api', exportRouter);

    const res = await request(buyerApp).get('/api/products/export');

    expect(res.status).toBe(403);
  });
});

describe('GET /api/orders/sales/export', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('exports sales history as CSV', async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          id: 1001,
          product_name: 'Tomatoes',
          buyer_name: 'John Doe',
          quantity: 5,
          total_price: '27.50',
          status: 'paid',
          stellar_tx_hash: 'TX123ABC',
          created_at: '2024-01-15T10:30:00.000Z',
        },
      ],
    });

    const res = await request(app).get('/api/orders/sales/export?format=csv');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toContain('sales.csv');
    expect(res.text).toContain('Tomatoes');
    expect(res.text).toContain('John Doe');
  });

  test('exports sales history as PDF with totals', async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          id: 1001,
          product_name: 'Tomatoes',
          buyer_name: 'John Doe',
          quantity: 5,
          total_price: '27.50',
          status: 'paid',
          stellar_tx_hash: 'TX123',
          created_at: '2024-01-15',
        },
      ],
    });

    const res = await request(app).get('/api/orders/sales/export?format=pdf');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('sales.pdf');
  });

  test('filters by date range', async () => {
    db.query.mockResolvedValue({ rows: [] });

    await request(app).get('/api/orders/sales/export?format=csv&from=2024-01-01&to=2024-01-31');

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('o.created_at >='),
      expect.arrayContaining([300, '2024-01-01', '2024-01-31T23:59:59'])
    );
  });

  test('handles empty sales data', async () => {
    db.query.mockResolvedValue({ rows: [] });

    const res = await request(app).get('/api/orders/sales/export?format=csv');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
  });
});
