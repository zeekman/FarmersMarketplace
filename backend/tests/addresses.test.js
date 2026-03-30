'use strict';

const jwt = require('jsonwebtoken');
const { request, app, mockQuery, getCsrf } = require('./setup');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const buyerToken = jwt.sign({ id: 1, role: 'buyer' }, SECRET);
const farmerToken = jwt.sign({ id: 2, role: 'farmer' }, SECRET);

const validAddr = { label: 'Home', street: '123 Main St', city: 'Nairobi', country: 'Kenya' };
const addrRow = { id: 1, user_id: 1, ...validAddr, postal_code: null, is_default: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── GET /api/addresses ────────────────────────────────────────────────────────
describe('GET /api/addresses', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/addresses');
    expect(res.status).toBe(401);
  });

  it('returns 403 for farmers', async () => {
    const res = await request(app)
      .get('/api/addresses')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(403);
  });

  it('returns buyer address list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [addrRow], rowCount: 1 });
    const res = await request(app)
      .get('/api/addresses')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].label).toBe('Home');
  });

  it('returns empty array when no addresses', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get('/api/addresses')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ── POST /api/addresses ───────────────────────────────────────────────────────
describe('POST /api/addresses', () => {
  it('returns 403 for farmers', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/addresses')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send(validAddr);
    expect(res.status).toBe(403);
  });

  it('returns 400 when required fields are missing', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/addresses')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ label: 'Home', street: '123 Main St' }); // missing city & country
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('creates address successfully', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // INSERT RETURNING id
      .mockResolvedValueOnce({ rows: [addrRow], rowCount: 1 }); // SELECT addr
    const res = await request(app)
      .post('/api/addresses')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send(validAddr);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.label).toBe('Home');
  });

  it('clears other defaults when is_default is true', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE clear defaults
      .mockResolvedValueOnce({ rows: [{ id: 2 }], rowCount: 1 }) // INSERT
      .mockResolvedValueOnce({ rows: [{ ...addrRow, id: 2, is_default: 1 }], rowCount: 1 });
    const res = await request(app)
      .post('/api/addresses')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ ...validAddr, is_default: true });
    expect(res.status).toBe(201);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE addresses SET is_default/i),
      expect.any(Array)
    );
  });
});

// ── PUT /api/addresses/:id ────────────────────────────────────────────────────
describe('PUT /api/addresses/:id', () => {
  it('returns 400 when required fields are missing', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .put('/api/addresses/1')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ label: 'Work' }); // missing street, city, country
    expect(res.status).toBe(400);
  });

  it('returns 404 when address not found or not owned', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .put('/api/addresses/99')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send(validAddr);
    expect(res.status).toBe(404);
  });

  it('updates address successfully', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const updated = { ...addrRow, city: 'Mombasa' };
    mockQuery
      .mockResolvedValueOnce({ rows: [addrRow], rowCount: 1 }) // SELECT ownership check
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE
      .mockResolvedValueOnce({ rows: [updated], rowCount: 1 }); // SELECT result
    const res = await request(app)
      .put('/api/addresses/1')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ ...validAddr, city: 'Mombasa' });
    expect(res.status).toBe(200);
    expect(res.body.data.city).toBe('Mombasa');
  });
});

// ── PATCH /api/addresses/:id/default ─────────────────────────────────────────
describe('PATCH /api/addresses/:id/default', () => {
  it('returns 403 for farmers', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .patch('/api/addresses/1/default')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(403);
  });

  it('returns 404 when address not found', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .patch('/api/addresses/99/default')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(404);
  });

  it('sets address as default', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery
      .mockResolvedValueOnce({ rows: [addrRow], rowCount: 1 }) // ownership check
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // clear defaults
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // set default
      .mockResolvedValueOnce({ rows: [{ ...addrRow, is_default: 1 }], rowCount: 1 }); // SELECT
    const res = await request(app)
      .patch('/api/addresses/1/default')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect(res.body.data.is_default).toBe(1);
  });
});

// ── DELETE /api/addresses/:id ─────────────────────────────────────────────────
describe('DELETE /api/addresses/:id', () => {
  it('returns 403 for farmers', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .delete('/api/addresses/1')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(403);
  });

  it('returns 404 when address not found', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .delete('/api/addresses/99')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(404);
  });

  it('returns 400 when address is used in orders', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery
      .mockResolvedValueOnce({ rows: [addrRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: '2' }], rowCount: 1 }); // orders exist
    const res = await request(app)
      .delete('/api/addresses/1')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('address_in_use');
  });

  it('deletes address successfully when not used in orders', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery
      .mockResolvedValueOnce({ rows: [addrRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE
    const res = await request(app)
      .delete('/api/addresses/1')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
