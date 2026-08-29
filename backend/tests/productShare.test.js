'use strict';

/**
 * Tests for backend/src/routes/productShare.js
 * Closes #1007
 */

const jwt = require('jsonwebtoken');
const { request, app, mockQuery, getCsrf } = require('./setup');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, SECRET);

const productRow = {
  id: 1,
  name: 'Fresh Tomatoes',
  description: 'Organic tomatoes',
  image_url: '/uploads/tomato.jpg',
  farmer_name: 'Alice',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── GET /api/products/:id/share ───────────────────────────────────────────────
describe('GET /api/products/:id/share', () => {
  it('returns 400 for a non-numeric product id', async () => {
    const res = await request(app).get('/api/products/abc/share');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 404 when the product does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/products/999/share');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('returns share metadata for a valid product', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [productRow], rowCount: 1 });
    const res = await request(app).get('/api/products/1/share');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.productId).toBe(1);
    expect(res.body.data.title).toContain('Fresh Tomatoes');
    expect(res.body.data.url).toMatch(/\/product\/1/);
  });

  it('uses farmer name in description when product has no description', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...productRow, description: null }],
      rowCount: 1,
    });
    const res = await request(app).get('/api/products/1/share');
    expect(res.status).toBe(200);
    expect(res.body.data.description).toContain('Alice');
  });
});

// ── POST /api/products/:id/share ──────────────────────────────────────────────
describe('POST /api/products/:id/share', () => {
  it('returns 400 for a non-numeric product id', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/products/abc/share')
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ platform: 'twitter' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unsupported platform', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/products/1/share')
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ platform: 'myspace' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('records a share event for an authenticated user', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT share_events

    const res = await request(app)
      .post('/api/products/1/share')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ platform: 'twitter' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO share_events'),
      [1, 2, 'twitter', expect.anything()]
    );
  });

  it('records a share event for an unauthenticated visitor (user_id null)', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .post('/api/products/1/share')
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .send({ platform: 'whatsapp' });

    expect(res.status).toBe(201);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO share_events'),
      [1, null, 'whatsapp', expect.anything()]
    );
  });

  it('accepts all supported platforms', async () => {
    const platforms = ['whatsapp', 'twitter', 'facebook', 'copy_link', 'native_share'];
    for (const platform of platforms) {
      const { token: csrf, cookieStr } = await getCsrf();
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const res = await request(app)
        .post('/api/products/1/share')
        .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
        .send({ platform });
      expect(res.status).toBe(201);
    }
  });
});
