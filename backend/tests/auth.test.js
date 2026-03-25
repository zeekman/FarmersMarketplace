const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { request, app, mockGet, mockRun, mockPrepare } = require('./setup');

beforeEach(() => jest.clearAllMocks());

const SECRET = process.env.JWT_SECRET || 'secret';
const token  = (id, role) => jwt.sign({ id, role }, SECRET);

describe('POST /api/auth/register', () => {
  it('registers a new user and returns a token', async () => {
    mockRun.mockReturnValueOnce({ lastInsertRowid: 1 });
    const res = await request(app).post('/api/auth/register').send({
      name: 'Alice', email: 'alice@test.com', password: 'secret1', role: 'farmer',
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('farmer');
  });

  it('returns 409 on duplicate email', async () => {
    mockRun.mockImplementationOnce(() => { throw new Error('UNIQUE constraint failed'); });
    const res = await request(app).post('/api/auth/register').send({
      name: 'Bob', email: 'bob@test.com', password: 'secret1', role: 'buyer',
    });
    expect(res.status).toBe(409);
  });

  it('returns 400 for invalid role', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'X', email: 'x@test.com', password: 'secret1', role: 'admin',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const hashed = await bcrypt.hash('secret1', 10);
    mockGet.mockReturnValueOnce({ id: 1, name: 'Carol', email: 'carol@test.com', password: hashed, role: 'buyer', stellar_public_key: 'GPUB' });
    const res = await request(app).post('/api/auth/login').send({ email: 'carol@test.com', password: 'secret1' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('returns 401 for wrong password', async () => {
    const hashed = await bcrypt.hash('secret1', 10);
    mockGet.mockReturnValueOnce({ id: 1, password: hashed, role: 'buyer' });
    const res = await request(app).post('/api/auth/login').send({ email: 'carol@test.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for unknown email', async () => {
    mockGet.mockReturnValueOnce(undefined);
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@test.com', password: 'secret1' });
    expect(res.status).toBe(401);
  });
});
