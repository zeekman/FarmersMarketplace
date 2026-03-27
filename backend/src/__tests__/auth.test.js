/**
 * Issue #99: Integration tests for auth endpoints.
 * Uses an in-memory SQLite database — fully isolated from production.
 */

process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const Database = require('better-sqlite3');
const request = require('supertest');
const jwt = require('jsonwebtoken');

// ── in-memory DB setup ────────────────────────────────────────────────────────
let testDb;

jest.mock('../db/schema', () => {
  // Return the testDb proxy — populated in beforeAll
  return new Proxy({}, { get: (_, prop) => testDb[prop] });
});

jest.mock('../utils/stellar', () => ({
  createWallet: jest.fn(() => ({
    publicKey: 'GPUBKEY123TEST',
    secretKey: 'SSECRETKEY123TEST',
  })),
}));

jest.mock('../utils/mailer', () => ({
  sendOrderEmails: jest.fn(),
}));

const app = require('../app');

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('farmer','buyer')),
      stellar_public_key TEXT,
      stellar_secret_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
});

afterAll(() => {
  testDb.close();
});

beforeEach(() => {
  testDb.exec('DELETE FROM refresh_tokens; DELETE FROM users;');
});

// ── helpers ───────────────────────────────────────────────────────────────────
const VALID_USER = {
  name: 'Alice Farmer',
  email: 'alice@farm.test',
  password: 'Secure1pass',
  role: 'farmer',
};

async function registerUser(data = VALID_USER) {
  return request(app).post('/api/auth/register').send(data);
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  it('returns 200 with token and user object on valid data', async () => {
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
    const res = await registerUser();
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.id).toBeDefined();
    expect(decoded.role).toBe(VALID_USER.role);
  });

  it('returns a Stellar public key in the response', async () => {
    const res = await registerUser();
    expect(res.body.user.publicKey).toBe('GPUBKEY123TEST');
  });

  it('sets an HttpOnly refresh token cookie', async () => {
    const res = await registerUser();
    const cookie = res.headers['set-cookie']?.[0] || '';
    expect(cookie).toMatch(/refreshToken=/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('returns 409 on duplicate email', async () => {
    await registerUser();
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

// ── POST /api/auth/login ──────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await registerUser(); // seed a user before each login test
  });

  it('returns 200 with token on correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('returns a valid JWT on login', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password });
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.id).toBeDefined();
  });

  it('sets an HttpOnly refresh token cookie on login', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password });
    const cookie = res.headers['set-cookie']?.[0] || '';
    expect(cookie).toMatch(/refreshToken=/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: 'WrongPass1' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@farm.test', password: VALID_USER.password });
    expect(res.status).toBe(401);
  });
});
