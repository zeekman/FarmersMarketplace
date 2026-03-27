const jwt = require('jsonwebtoken');
const { request, app, mockGet, mockAll, mockRun } = require('./setup');

beforeEach(() => jest.clearAllMocks());

const SECRET      = process.env.JWT_SECRET || 'test-secret-for-jest';
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken  = jwt.sign({ id: 2, role: 'buyer'  }, SECRET);

const farmerRow = { id: 1, name: 'Alice', bio: 'Organic farmer', location: 'Nairobi', avatar_url: null, created_at: '2024-01-01' };

describe('GET /api/farmers/:id', () => {
  it('returns public farmer profile with listings', async () => {
    mockGet.mockReturnValueOnce(farmerRow);
    mockAll.mockReturnValueOnce([{ id: 10, name: 'Tomatoes', price: 2.5, quantity: 50 }]);

    const res = await request(app).get('/api/farmers/1');
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Alice');
    expect(res.body.data.listings).toHaveLength(1);
  });

  it('does not expose password or stellar_secret_key', async () => {
    mockGet.mockReturnValueOnce(farmerRow);
    mockAll.mockReturnValueOnce([]);

    const res = await request(app).get('/api/farmers/1');
    expect(res.status).toBe(200);
    expect(res.body.data.password).toBeUndefined();
    expect(res.body.data.stellar_secret_key).toBeUndefined();
    expect(res.body.data.email).toBeUndefined();
  });

  it('returns 404 for non-existent farmer', async () => {
    mockGet.mockReturnValueOnce(undefined);
    const res = await request(app).get('/api/farmers/9999');
    expect(res.status).toBe(404);
  });

  it('is publicly accessible without auth', async () => {
    mockGet.mockReturnValueOnce(farmerRow);
    mockAll.mockReturnValueOnce([]);
    const res = await request(app).get('/api/farmers/1');
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/farmers/me', () => {
  it('farmer can update bio and location', async () => {
    mockRun.mockReturnValueOnce({ changes: 1 });
    mockGet.mockReturnValueOnce({ ...farmerRow, bio: 'Updated bio', location: 'Mombasa' });

    const res = await request(app)
      .patch('/api/farmers/me')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ bio: 'Updated bio', location: 'Mombasa' });

    expect(res.status).toBe(200);
    expect(res.body.data.bio).toBe('Updated bio');
    expect(res.body.data.location).toBe('Mombasa');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).patch('/api/farmers/me').send({ bio: 'test' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when buyer tries to update farmer profile', async () => {
    const res = await request(app)
      .patch('/api/farmers/me')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ bio: 'test' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when no fields are provided', async () => {
    const res = await request(app)
      .patch('/api/farmers/me')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for bio exceeding 500 characters', async () => {
    const res = await request(app)
      .patch('/api/farmers/me')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ bio: 'x'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid avatar_url', async () => {
    const res = await request(app)
      .patch('/api/farmers/me')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ avatar_url: 'https://evil.com/hack.jpg' });
    expect(res.status).toBe(400);
  });

  it('accepts null avatar_url to clear avatar', async () => {
    mockRun.mockReturnValueOnce({ changes: 1 });
    mockGet.mockReturnValueOnce({ ...farmerRow, avatar_url: null });

    const res = await request(app)
      .patch('/api/farmers/me')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ avatar_url: null });

    expect(res.status).toBe(200);
    expect(res.body.data.avatar_url).toBeNull();
  });
});
