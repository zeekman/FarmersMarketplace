const jwt = require('jsonwebtoken');
const { request, app, mockQuery, getCsrf } = require('./setup');

beforeEach(() => { jest.clearAllMocks(); mockQuery.mockResolvedValue({ rows: [], rowCount: 0 }); });

const SECRET      = process.env.JWT_SECRET || 'test-secret-for-jest';
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken  = jwt.sign({ id: 2, role: 'buyer' }, SECRET);

const farmerRow = { id: 1, name: 'Alice', bio: 'Organic farmer', location: 'Nairobi', avatar_url: null, created_at: '2024-01-01' };

describe('GET /api/farmers/:id', () => {
  it('returns public farmer profile with listings', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [farmerRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 10, name: 'Tomatoes', price: 2.5, quantity: 50 }], rowCount: 1 });
    const res = await request(app).get('/api/farmers/1');
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Alice');
    expect(res.body.data.listings).toHaveLength(1);
  });

  it('does not expose password or stellar_secret_key', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [farmerRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/farmers/1');
    expect(res.status).toBe(200);
    expect(res.body.data.password).toBeUndefined();
    expect(res.body.data.stellar_secret_key).toBeUndefined();
    expect(res.body.data.email).toBeUndefined();
  });

  it('returns 404 for non-existent farmer', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/farmers/9999');
    expect(res.status).toBe(404);
  });

  it('is publicly accessible without auth', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [farmerRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/farmers/1');
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/farmers/me', () => {
  it('farmer can update bio and location', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // UPDATE
      .mockResolvedValueOnce({ rows: [{ ...farmerRow, bio: 'Updated bio', location: 'Mombasa' }], rowCount: 1 }); // SELECT
    const res = await request(app)
      .patch('/api/farmers/me')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ bio: 'Updated bio', location: 'Mombasa' });
    expect(res.status).toBe(200);
    expect(res.body.data.bio).toBe('Updated bio');
    expect(res.body.data.location).toBe('Mombasa');
  });

  it('returns 401 without auth', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .patch('/api/farmers/me')
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ bio: 'test' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when buyer tries to update farmer profile', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .patch('/api/farmers/me')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ bio: 'test' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when no fields are provided', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .patch('/api/farmers/me')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for bio exceeding 500 characters', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .patch('/api/farmers/me')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ bio: 'x'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid avatar_url', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .patch('/api/farmers/me')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ avatar_url: 'https://evil.com/hack.jpg' });
    expect(res.status).toBe(400);
  });

  it('accepts null avatar_url to clear avatar', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ ...farmerRow, avatar_url: null }], rowCount: 1 });
    const res = await request(app)
      .patch('/api/farmers/me')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ avatar_url: null });
    expect(res.status).toBe(200);
    expect(res.body.data.avatar_url).toBeNull();
  });
});
