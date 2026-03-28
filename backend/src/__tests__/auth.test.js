/**
 * Integration tests for auth endpoints.
 */

process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_AUTH_MAX    = '10000';
process.env.RATE_LIMIT_GENERAL_MAX = '10000';

const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockDb  = jest.requireMock('../db/schema');
const stellar = jest.requireMock('../utils/stellar');

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
});

const app = require('../app');

const VALID_USER = { name: 'Alice Farmer', email: 'alice@farm.test', password: 'Secure1pass', role: 'farmer' };

async function registerUser(data = VALID_USER) {
  return request(app).post('/api/auth/register').send(data);
}

describe('POST /api/auth/register', () => {
  it('returns 200 with token and user object on valid data', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })  // INSERT user
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });           // INSERT refresh_token
    const res = await registerUser();
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toMatchObject({ name: VALID_USER.name, email: VALID_USER.email, role: VALID_USER.role });
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
    mockDb.query.mockRejectedValueOnce(Object.assign(new Error('UNIQUE constraint failed'), { code: '23505' }));
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
      .mockResolvedValueOnce({ rows: [{ id: 1, name: VALID_USER.name, email: VALID_USER.email, password: hashed, role: VALID_USER.role, stellar_public_key: 'GPUB' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app).post('/api/auth/login').send({ email: VALID_USER.email, password: VALID_USER.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('returns a valid JWT on login', async () => {
    const hashed = await bcrypt.hash(VALID_USER.password, 12);
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: VALID_USER.name, email: VALID_USER.email, password: hashed, role: VALID_USER.role, stellar_public_key: 'GPUB' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app).post('/api/auth/login').send({ email: VALID_USER.email, password: VALID_USER.password });
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.id).toBeDefined();
  });

  it('sets an HttpOnly refresh token cookie on login', async () => {
    const hashed = await bcrypt.hash(VALID_USER.password, 12);
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: VALID_USER.name, email: VALID_USER.email, password: hashed, role: VALID_USER.role, stellar_public_key: 'GPUB' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app).post('/api/auth/login').send({ email: VALID_USER.email, password: VALID_USER.password });
    const cookie = res.headers['set-cookie']?.[0] || '';
    expect(cookie).toMatch(/refreshToken=/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('returns 401 for wrong password', async () => {
    const hashed = await bcrypt.hash(VALID_USER.password, 12);
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 1, password: hashed, role: VALID_USER.role }], rowCount: 1 });
    const res = await request(app).post('/api/auth/login').send({ email: VALID_USER.email, password: 'WrongPass1' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for unknown email', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@farm.test', password: VALID_USER.password });
    expect(res.status).toBe(401);
  });
});
