const jwt    = require('jsonwebtoken');
const { request, app, mockGet, mockRun } = require('./setup');
const stellar = jest.requireMock('../src/utils/stellar');

beforeEach(() => jest.clearAllMocks());

const SECRET = process.env.JWT_SECRET || 'secret';
const token  = jwt.sign({ id: 1, role: 'buyer' }, SECRET);

describe('GET /api/wallet', () => {
  it('returns balance for authenticated user', async () => {
    mockGet.mockReturnValueOnce({ stellar_public_key: 'GPUB' });
    stellar.getBalance.mockResolvedValueOnce(500);
    const res = await request(app).get('/api/wallet').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(500);
    expect(res.body.publicKey).toBe('GPUB');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/wallet');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/wallet/transactions', () => {
  it('returns transaction list', async () => {
    mockGet.mockReturnValueOnce({ stellar_public_key: 'GPUB' });
    stellar.getTransactions.mockResolvedValueOnce([{ id: 'tx1', amount: '10' }]);
    const res = await request(app)
      .get('/api/wallet/transactions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });
});

describe('POST /api/wallet/fund', () => {
  it('funds the account on testnet', async () => {
    process.env.STELLAR_NETWORK = 'testnet';
    mockGet.mockReturnValueOnce({ stellar_public_key: 'GPUB' });
    stellar.getBalance.mockResolvedValueOnce(10000);
    const res = await request(app)
      .post('/api/wallet/fund')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(10000);
  });

  it('returns 400 on mainnet', async () => {
    process.env.STELLAR_NETWORK = 'mainnet';
    const res = await request(app)
      .post('/api/wallet/fund')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    process.env.STELLAR_NETWORK = 'testnet';
  });
});
