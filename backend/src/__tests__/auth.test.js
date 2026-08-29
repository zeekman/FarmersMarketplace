/**
 * Integration tests for auth endpoints.
 */

process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_AUTH_MAX = '10000';
process.env.RATE_LIMIT_GENERAL_MAX = '10000';
process.env.RATE_LIMIT_LOGIN_MAX = '10000';
process.env.RATE_LIMIT_REGISTER_MAX = '10000';

const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockDb = jest.requireMock('../db/schema');
const stellar = jest.requireMock('../utils/stellar');

beforeEach(() => {
  mockDb.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  stellar.createWalletFromMnemonic.mockReturnValue({ publicKey: 'GPUBKEY', secretKey: 'SSECRET', mnemonic: 'word '.repeat(12).trim() });
});

const app = require('../app');

const VALID_USER = {
  name: 'Alice Farmer',
  email: 'alice@farm.test',
  password: 'Secure1pass',
  role: 'farmer',
};

async function registerUser(data = VALID_USER) {
  return request(app).post('/api/auth/register').send(data);
}

describe('POST /api/auth/register', () => {
  it('returns 200 with token and user object on valid data', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // INSERT user
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT refresh_token
    const res = await registerUser();
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toMatchObject({
      name: VALID_USER.name,
      email: VALID_USER.email,
      role: VALID_USER.role,
    });
  });

  it('returns a valid JWT on success', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await registerUser();
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.id).toBeDefined();
    expect(decoded.role).toBe(VALID_USER.role);
  });

  it('returns a Stellar public key in the response', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await registerUser();
    expect(res.body.user.publicKey).toBe('GPUBKEY');
  });

  it('sets an HttpOnly refresh token cookie', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await registerUser();
    const cookie = res.headers['set-cookie']?.[0] || '';
    expect(cookie).toMatch(/refreshToken=/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('returns 409 on duplicate email', async () => {
    mockDb.query.mockRejectedValueOnce(
      Object.assign(new Error('UNIQUE constraint failed'), { code: '23505' })
    );
    const res = await registerUser();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('returns 400 when name is missing', async () => {
    const res = await registerUser({ ...VALID_USER, name: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is missing', async () => {
    const res = await registerUser({ ...VALID_USER, email: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const res = await registerUser({ ...VALID_USER, password: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid role', async () => {
    const res = await registerUser({ ...VALID_USER, role: 'admin' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  const bcrypt = require('bcryptjs');

  it('returns 200 with token on correct credentials', async () => {
    const hashed = await bcrypt.hash(VALID_USER.password, 12);
    mockDb.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name: VALID_USER.name,
            email: VALID_USER.email,
            password: hashed,
            role: VALID_USER.role,
            stellar_public_key: 'GPUB',
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('returns a valid JWT on login', async () => {
    const hashed = await bcrypt.hash(VALID_USER.password, 12);
    mockDb.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name: VALID_USER.name,
            email: VALID_USER.email,
            password: hashed,
            role: VALID_USER.role,
            stellar_public_key: 'GPUB',
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password });
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.id).toBeDefined();
  });

  it('sets an HttpOnly refresh token cookie on login', async () => {
    const hashed = await bcrypt.hash(VALID_USER.password, 12);
    mockDb.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name: VALID_USER.name,
            email: VALID_USER.email,
            password: hashed,
            role: VALID_USER.role,
            stellar_public_key: 'GPUB',
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password });
    const cookie = res.headers['set-cookie']?.[0] || '';
    expect(cookie).toMatch(/refreshToken=/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('returns 401 for wrong password', async () => {
    const hashed = await bcrypt.hash(VALID_USER.password, 12);
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 1, password: hashed, role: VALID_USER.role }],
      rowCount: 1,
    });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: 'WrongPass1' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for unknown email', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@farm.test', password: VALID_USER.password });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/refresh', () => {
  const crypto = require('crypto');

  function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  it('returns 200 with new access token on valid refresh token', async () => {
    const rawToken = 'valid-refresh-token-abc123';
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    mockDb.query
      // /refresh: SELECT by token_hash
      .mockResolvedValueOnce({
        rows: [{ id: 1, user_id: 1, token_hash: tokenHash, expires_at: expiresAt, family_id: 'fam1', used: 0 }],
        rowCount: 1,
      })
      // rotateRefreshToken: SELECT by token_hash + user_id
      .mockResolvedValueOnce({
        rows: [{ id: 1, user_id: 1, token_hash: tokenHash, expires_at: expiresAt, family_id: 'fam1', used: 0 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE used=1
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT new token
      .mockResolvedValueOnce({ rows: [{ id: 1, role: 'farmer' }], rowCount: 1 }); // SELECT user

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=${rawToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('returns 401 with token_reuse_detected when replaying an already-used token', async () => {
    const oldToken = 'already-used-token';
    const tokenHash = hashToken(oldToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    mockDb.query
      // /refresh: SELECT by token_hash — found but used=1
      .mockResolvedValueOnce({
        rows: [{ id: 1, user_id: 42, token_hash: tokenHash, expires_at: expiresAt, family_id: 'fam1', used: 1 }],
        rowCount: 1,
      })
      // rotateRefreshToken: SELECT by token_hash + user_id — same used=1 row
      .mockResolvedValueOnce({
        rows: [{ id: 1, user_id: 42, token_hash: tokenHash, expires_at: expiresAt, family_id: 'fam1', used: 1 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE family

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=${oldToken}`]);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('token_reuse_detected');
    expect(res.body.error).toMatch(/reuse/i);
  });

  it('invalidates the entire token family on reuse detection', async () => {
    const oldToken = 'replayed-token';
    const tokenHash = hashToken(oldToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    mockDb.query
      .mockResolvedValueOnce({
        rows: [{ id: 1, user_id: 42, token_hash: tokenHash, expires_at: expiresAt, family_id: 'fam-xyz', used: 1 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 1, user_id: 42, token_hash: tokenHash, expires_at: expiresAt, family_id: 'fam-xyz', used: 1 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE family

    await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=${oldToken}`]);

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM refresh_tokens WHERE user_id.*family_id/i),
      [42, 'fam-xyz']
    );
  });

  it('returns 401 when refresh token is expired', async () => {
    const rawToken = 'expired-token';
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() - 1000).toISOString();

    mockDb.query
      .mockResolvedValueOnce({
        rows: [{ id: 1, user_id: 1, token_hash: tokenHash, expires_at: expiresAt, family_id: 'fam1', used: 0 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE expired token

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=${rawToken}`]);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('returns 401 when no refresh token cookie is provided', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/No refresh token/i);
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 200 and clears the refreshToken cookie', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE refresh_tokens

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'refreshToken=some-raw-token');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Express clearCookie sets Max-Age=0 or Expires in the past
    const cookie = res.headers['set-cookie']?.find((c) => c.startsWith('refreshToken=')) || '';
    expect(cookie).toMatch(/refreshToken=/);
    expect(cookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it('deletes the hashed token from the database when a cookie is present', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'refreshToken=tok-to-invalidate');

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM refresh_tokens WHERE token_hash\s*=\s*\$1/i),
      expect.any(Array),
    );
  });

  it('returns 200 even with no cookie present and performs no DB write', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('invalidates the token so a subsequent refresh attempt fails', async () => {
    const rawToken = 'token-that-gets-revoked';
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Logout: DELETE
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `refreshToken=${rawToken}`);

    // Subsequent refresh: token no longer in DB
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `refreshToken=${rawToken}`);

    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the current user profile when the access token is valid', async () => {
    const token = jwt.sign({ id: 1, role: 'farmer' }, process.env.JWT_SECRET);

    mockDb.query
      .mockResolvedValueOnce({ rows: [{ active: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name: VALID_USER.name,
            email: VALID_USER.email,
            role: VALID_USER.role,
            stellar_public_key: 'GPUBKEY',
            referral_code: 'REF123',
          },
        ],
        rowCount: 1,
      });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 1,
      name: VALID_USER.name,
      email: VALID_USER.email,
      role: VALID_USER.role,
      publicKey: 'GPUBKEY',
      referralCode: 'REF123',
    });
  });

  it('returns 401 when no access token is provided', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/No token provided/i);
  });
});

// ---------------------------------------------------------------------------
// #804 — Email verification enforcement & resend rate limit
// ---------------------------------------------------------------------------
describe('#804 — requireEmailVerified on order creation', () => {
  const jwt = require('jsonwebtoken');
  const unverifiedToken = jwt.sign({ id: 3, role: 'buyer', email_verified_at: null }, process.env.JWT_SECRET);
  const verifiedToken   = jwt.sign({ id: 3, role: 'buyer', email_verified_at: '2024-01-01T00:00:00.000Z' }, process.env.JWT_SECRET);
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

  it('blocks unverified buyer from placing an order (403)', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${unverifiedToken}`)
      .set('X-Idempotency-Key', VALID_UUID)
      .send({ product_id: 10, quantity: 1 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('email_not_verified');
  });

  it('allows verified buyer to proceed past the middleware', async () => {
    // Verified user will pass requireEmailVerified and hit UUID check (key already passes)
    // then DB query — returning 404 for product is fine, proves middleware passed
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // address check skipped, product not found
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', VALID_UUID)
      .send({ product_id: 999, quantity: 1 });
    // Not 403 — middleware passed
    expect(res.status).not.toBe(403);
  });
});

describe('#804 — resend-verification rate limit', () => {
  it('returns 429 after 3 requests within an hour', async () => {
    // The emailVerification router uses req.db (knex), not mockDb.query.
    // We test the limiter fires by checking the 4th call returns 429.
    // We need to mount the router directly since app mounts auth routes differently.
    const express = require('express');
    const emailVerRouter = require('../routes/emailVerification');
    const testApp = express();
    testApp.use(express.json());
    // Provide a stub req.db
    testApp.use((req, _res, next) => { req.db = () => ({ where: () => ({ first: async () => null }) }); next(); });
    testApp.use('/api/auth', emailVerRouter);

    const send = () => require('supertest')(testApp)
      .post('/api/auth/resend-verification')
      .send({ email: 'test@example.com' });

    await send(); await send(); await send();
    const fourth = await send();
    expect(fourth.status).toBe(429);
  });
});
