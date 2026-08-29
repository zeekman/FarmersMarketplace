const jwt = require('jsonwebtoken');
const { request, app, mockQuery, getCsrf } = require('./setup');

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

const SECRET = process.env.JWT_SECRET || 'secret';
const authToken = (id = 1, role = 'farmer') => jwt.sign({ id, role }, SECRET);

async function fetchCsrfToken() {
  const res = await request(app).get('/api/csrf-token');
  expect(res.status).toBe(200);
  expect(res.body.csrfToken).toBeDefined();
  const setCookie = res.headers['set-cookie'] || [];
  const cookieStr = setCookie.find((c) => c.startsWith('csrf_token=')) || '';
  const token = cookieStr.split(';')[0].split('=')[1];
  return { token, cookieStr };
}

describe('GET /api/csrf-token', () => {
  it('returns a token in body and sets csrf_token cookie', async () => {
    const res = await request(app).get('/api/csrf-token');
    expect(res.status).toBe(200);
    expect(res.body.csrfToken).toMatch(/^[a-f0-9]{64}$/);
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some((c) => c.startsWith('csrf_token='))).toBe(true);
  });

  it('sets SameSite=Strict on the cookie', async () => {
    const res = await request(app).get('/api/csrf-token');
    const cookies = res.headers['set-cookie'] || [];
    const csrfCookie = cookies.find((c) => c.startsWith('csrf_token='));
    expect(csrfCookie).toMatch(/SameSite=Strict/i);
  });

  it('cookie is NOT HttpOnly (must be readable by JS)', async () => {
    const res = await request(app).get('/api/csrf-token');
    const cookies = res.headers['set-cookie'] || [];
    const csrfCookie = cookies.find((c) => c.startsWith('csrf_token='));
    expect(csrfCookie).not.toMatch(/HttpOnly/i);
  });
});

describe('CSRF exempt routes', () => {
  it('POST /api/auth/register works without CSRF token', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app).post('/api/auth/register').send({
      name: 'Test',
      email: 'test@test.com',
      password: 'Secure1pass',
      role: 'buyer',
    });
    expect(res.status).not.toBe(403);
  });

  it('POST /api/auth/login works without CSRF token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'x@x.com', password: 'secret1' });
    expect(res.status).not.toBe(403);
  });
});

describe('CSRF protection — missing token', () => {
  const jwt_token = authToken(1, 'farmer');

  it('POST /api/products returns 403 without CSRF token', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${jwt_token}`)
      .send({ name: 'Tomato', price: 5, quantity: 10 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/csrf/i);
  });

  it('DELETE /api/products/:id returns 403 without CSRF token', async () => {
    const res = await request(app)
      .delete('/api/products/1')
      .set('Authorization', `Bearer ${jwt_token}`);
    expect(res.status).toBe(403);
  });

  it('POST /api/orders returns 403 without CSRF token', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${authToken(1, 'buyer')}`)
      .send({ product_id: 1, quantity: 1 });
    expect(res.status).toBe(403);
  });

  it('POST /api/wallet/fund returns 403 without CSRF token', async () => {
    const res = await request(app)
      .post('/api/wallet/fund')
      .set('Authorization', `Bearer ${jwt_token}`);
    expect(res.status).toBe(403);
  });
});

describe('CSRF protection — mismatched token', () => {
  it('POST /api/products returns 403 with wrong CSRF header', async () => {
    const { cookieStr } = await fetchCsrfToken();
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${authToken(1, 'farmer')}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', 'totally-wrong-token')
      .send({ name: 'Tomato', price: 5, quantity: 10 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('POST /api/wallet/fund returns 403 with wrong CSRF header', async () => {
    const { cookieStr } = await fetchCsrfToken();
    const res = await request(app)
      .post('/api/wallet/fund')
      .set('Authorization', `Bearer ${authToken(1, 'buyer')}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', 'bad-token');
    expect(res.status).toBe(403);
  });
});

describe('CSRF protection — valid token passes through', () => {
  it('POST /api/products succeeds with matching CSRF token', async () => {
    const { token, cookieStr } = await fetchCsrfToken();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }], rowCount: 1 });
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${authToken(1, 'farmer')}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', token)
      .send({ name: 'Tomato', price: 5, quantity: 10 });
    expect(res.status).not.toBe(403);
  });

  it('DELETE /api/products/:id passes CSRF validation', async () => {
    const { token, cookieStr } = await fetchCsrfToken();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, farmer_id: 1, name: 'Tomato' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app)
      .delete('/api/products/1')
      .set('Authorization', `Bearer ${authToken(1, 'farmer')}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', token);
    expect(res.status).not.toBe(403);
  });

  it('POST /api/wallet/fund passes CSRF validation on testnet', async () => {
    const { token, cookieStr } = await fetchCsrfToken();
    mockQuery.mockResolvedValueOnce({ rows: [{ stellar_public_key: 'GPUB' }], rowCount: 1 });
    const stellar = jest.requireMock('../src/utils/stellar');
    stellar.getBalance.mockResolvedValueOnce(10000);
    const res = await request(app)
      .post('/api/wallet/fund')
      .set('Authorization', `Bearer ${authToken(1, 'buyer')}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', token);
    expect(res.status).not.toBe(403);
  });
});

describe('CSRF protection — GET routes are never blocked', () => {
  it('GET /api/products is accessible without CSRF token', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/products');
    expect(res.status).not.toBe(403);
  });

  it('GET /api/wallet is accessible without CSRF token (auth still required)', async () => {
    const res = await request(app).get('/api/wallet');
    expect(res.status).toBe(401);
  });
});
