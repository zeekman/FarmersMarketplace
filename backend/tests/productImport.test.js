'use strict';

/**
 * Tests for backend/src/routes/productImport.js
 * Closes #1005
 */

const jwt = require('jsonwebtoken');
const { request, app, mockQuery, getCsrf } = require('./setup');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken  = jwt.sign({ id: 2, role: 'buyer'  }, SECRET);

// Minimal valid CSV content
const VALID_CSV = 'name,price,quantity,unit,category\nApple,1.5,100,kg,fruit\nBanana,0.8,200,kg,fruit\n';

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── Authorization ─────────────────────────────────────────────────────────────
describe('POST /api/products/import — auth', () => {
  it('returns 401 without auth', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/products/import')
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .set('Content-Type', 'application/json')
      .send([{ name: 'Apple', price: 1, quantity: 10 }]);
    expect(res.status).toBe(401);
  });

  it('returns 403 for buyers', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .set('Content-Type', 'application/json')
      .send([{ name: 'Apple', price: 1, quantity: 10 }]);
    expect(res.status).toBe(403);
  });
});

// ── JSON import ───────────────────────────────────────────────────────────────
describe('POST /api/products/import — JSON', () => {
  it('returns 400 for empty body', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .set('Content-Type', 'application/json')
      .send([]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('imports well-formed JSON and returns counts', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    // existing names query returns empty → no duplicates
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // SELECT existing names
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // INSERT row 1
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT row 2

    const res = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .set('Content-Type', 'application/json')
      .send([
        { name: 'Apple', price: 1.5, quantity: 100, unit: 'kg', category: 'fruit' },
        { name: 'Banana', price: 0.8, quantity: 200, unit: 'kg', category: 'fruit' },
      ]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.imported).toBe(2);
    expect(res.body.skipped).toBe(0);
  });

  it('skips rows with invalid price and reports errors', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // existing names

    const res = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .set('Content-Type', 'application/json')
      .send([{ name: 'BadProduct', price: -1, quantity: 10 }]);

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(1);
    expect(res.body.errors[0].row).toBe(1);
  });

  it('skips rows with invalid allergen values', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .set('Content-Type', 'application/json')
      .send([{ name: 'Exotic', price: 2, quantity: 5, allergens: 'unknown_allergen' }]);

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(1);
    expect(res.body.errors[0].error).toMatch(/allergen/i);
  });
});

// ── Duplicate detection ───────────────────────────────────────────────────────
describe('POST /api/products/import — duplicate detection', () => {
  it('skips a product whose name already exists for this farmer', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    // existing names returns 'apple'
    mockQuery.mockResolvedValueOnce({ rows: [{ lname: 'apple' }], rowCount: 1 });

    const res = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .set('Content-Type', 'application/json')
      .send([{ name: 'Apple', price: 1.5, quantity: 50 }]);

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(1);
    expect(res.body.errors[0].skipped).toBe(true);
  });

  it('skips a second occurrence of the same name within the same batch', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // no pre-existing products
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT first Apple succeeds

    const res = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .set('Content-Type', 'application/json')
      .send([
        { name: 'Apple', price: 1.5, quantity: 50 },
        { name: 'Apple', price: 2.0, quantity: 30 }, // duplicate in same batch
      ]);

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(1);
  });
});

// ── CSV import ────────────────────────────────────────────────────────────────
describe('POST /api/products/import — CSV', () => {
  it('returns 400 when no file is provided for multipart request', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf);
    // Without JSON content-type or file, route returns 400
    expect([400, 415]).toContain(res.status);
  });

  it('imports a well-formed CSV file', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .attach('file', Buffer.from(VALID_CSV), { filename: 'products.csv', contentType: 'text/csv' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.imported).toBe(2);
  });
});
