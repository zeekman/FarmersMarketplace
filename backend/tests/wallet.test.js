const jwt = require('jsonwebtoken');
const { request, app, mockQuery, getCsrf } = require('./setup');
const stellar = jest.requireMock('../src/utils/stellar');

beforeEach(() => {
  jest.clearAllMocks();
  stellar.isTestnet = true;
});

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const token = jwt.sign({ id: 1, role: 'buyer' }, SECRET);

describe('GET /api/wallet', () => {
  it('returns balance for authenticated user', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ stellar_public_key: 'GPUB', referral_code: null }],
      rowCount: 1,
    });
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
    mockQuery.mockResolvedValueOnce({ rows: [{ stellar_public_key: 'GPUB' }], rowCount: 1 });
    stellar.getTransactions.mockResolvedValueOnce({
      records: [{ id: 'tx1', amount: '10' }],
      next_cursor: null,
      prev_cursor: null,
    });
    const res = await request(app)
      .get('/api/wallet/transactions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('POST /api/wallet/fund', () => {
  it('funds the account on testnet', async () => {
    stellar.isTestnet = true;
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({ rows: [{ stellar_public_key: 'GPUB' }], rowCount: 1 });
    stellar.getBalance.mockResolvedValueOnce(10000);
    const res = await request(app)
      .post('/api/wallet/fund')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(10000);
  });

  it('returns 400 on mainnet', async () => {
    stellar.isTestnet = false;
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/wallet/fund')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(400);
  });
});

const EXTERNAL_KEY = 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37';
const USER_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('POST /api/wallet/send', () => {
  const validBody = { destination: EXTERNAL_KEY, amount: 10 };

  it('sends XLM successfully', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({
      rows: [{ stellar_public_key: USER_KEY, stellar_secret_key: 'SSECRET' }],
      rowCount: 1,
    });
    stellar.getBalance.mockResolvedValueOnce(500);
    stellar.sendPayment.mockResolvedValueOnce('TXHASH_SEND');
    const res = await request(app)
      .post('/api/wallet/send')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe('TXHASH_SEND');
    expect(res.body.amount).toBe(10);
    expect(res.body.destination).toBe(EXTERNAL_KEY);
  });

  it('sends XLM with optional memo', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({
      rows: [{ stellar_public_key: USER_KEY, stellar_secret_key: 'SSECRET' }],
      rowCount: 1,
    });
    stellar.getBalance.mockResolvedValueOnce(500);
    stellar.sendPayment.mockResolvedValueOnce('TXHASH_MEMO');
    const res = await request(app)
      .post('/api/wallet/send')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ ...validBody, memo: 'invoice #42' });
    expect(res.status).toBe(200);
    expect(res.body.memo).toBe('invoice #42');
    expect(stellar.sendPayment).toHaveBeenCalledWith(
      expect.objectContaining({ memo: 'invoice #42' })
    );
  });

  it('returns 402 when balance is insufficient', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({
      rows: [{ stellar_public_key: USER_KEY, stellar_secret_key: 'SSECRET' }],
      rowCount: 1,
    });
    stellar.getBalance.mockResolvedValueOnce(5);
    const res = await request(app)
      .post('/api/wallet/send')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send(validBody);
    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/insufficient/i);
  });

  it('returns 400 when sending to own wallet', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({
      rows: [{ stellar_public_key: USER_KEY, stellar_secret_key: 'SSECRET' }],
      rowCount: 1,
    });
    stellar.getBalance.mockResolvedValueOnce(500);
    const res = await request(app)
      .post('/api/wallet/send')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ destination: USER_KEY, amount: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own wallet/i);
  });

  it('returns 400 for invalid destination key', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/wallet/send')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ destination: 'not-a-stellar-key', amount: 10 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing amount', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/wallet/send')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ destination: EXTERNAL_KEY });
    expect(res.status).toBe(400);
  });

  it('returns 400 for negative amount', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/wallet/send')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ destination: EXTERNAL_KEY, amount: -5 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when memo exceeds 28 characters', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/wallet/send')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ destination: EXTERNAL_KEY, amount: 10, memo: 'a'.repeat(29) });
    expect(res.status).toBe(400);
  });

  it('returns 502 when Stellar transaction fails', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({
      rows: [{ stellar_public_key: USER_KEY, stellar_secret_key: 'SSECRET' }],
      rowCount: 1,
    });
    stellar.getBalance.mockResolvedValueOnce(500);
    stellar.sendPayment.mockRejectedValueOnce(new Error('op_no_destination'));
    const res = await request(app)
      .post('/api/wallet/send')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send(validBody);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/stellar transaction failed/i);
  });

  it('returns 401 without token', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/wallet/send')
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send(validBody);
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/wallet/budget', () => {
  const { token: csrf, cookieStr } = {};

  async function patchBudget(body) {
    const csrfData = await getCsrf();
    return request(app)
      .patch('/api/wallet/budget')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', csrfData.cookieStr)
      .set('X-CSRF-Token', csrfData.token)
      .send(body);
  }

  it('should_accept_valid_monthly_limit', async () => {
    // GET monthly_budget + GET spent
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE
      .mockResolvedValueOnce({ rows: [{ monthly_budget: 1000 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ spent: '0' }], rowCount: 1 });

    const res = await patchBudget({ monthly_limit: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.budgetGuardEnabled).toBe(true);
  });

  it('should_reject_negative_monthly_limit', async () => {
    const res = await patchBudget({ monthly_limit: -100 });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/cannot be negative/i);
  });

  it('should_disable_budget_guard_on_zero', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE sets null
      .mockResolvedValueOnce({ rows: [{ monthly_budget: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ spent: '0' }], rowCount: 1 });

    const res = await patchBudget({ monthly_limit: 0 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // 0 disables the guard — stored as null, budgetGuardEnabled should be false
    expect(res.body.budgetGuardEnabled).toBe(false);
  });

  it('should_reject_non_numeric_monthly_limit', async () => {
    const res = await patchBudget({ monthly_limit: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/must be a number/i);
  });
});
