/**
 * Integration tests for the full order payment flow — Issue #625
 *
 * Flow: register farmer → register buyer → list product → place order →
 *       mock Stellar payment → verify order status and wallet balance check.
 */

const jwt = require('jsonwebtoken');
const { request, app, getCsrf, mockDb } = require('./setup');
const stellar = jest.requireMock('../src/utils/stellar');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';

// Always resolves to the live db.query mock re-created by jest.setup.js's beforeEach.
const q = () => mockDb.query;

beforeEach(() => {
  jest.clearAllMocks();
  q().mockResolvedValue({ rows: [], rowCount: 0 });
  stellar.getBalance.mockResolvedValue(1000);
  stellar.sendPayment.mockResolvedValue('TXHASH_FLOW');
  stellar.createClaimableBalance.mockResolvedValue({ txHash: 'ESCROW_TX', balanceId: 'BAL_001' });
});

// ── Fixture data ──────────────────────────────────────────────────────────────

const farmerFixture = {
  id: 1,
  name: 'Farmer Alice',
  email: 'alice@farm.test',
  stellar_public_key: 'GPUB_FARMER',
};

const buyerFixture = {
  id: 2,
  name: 'Buyer Bob',
  email: 'bob@buyer.test',
  stellar_public_key: 'GPUB_BUYER',
  stellar_secret_key: 'SSECRET_BUYER',
  referred_by: null,
  referral_bonus_sent: 0,
};

const productFixture = {
  id: 10,
  farmer_id: 1,
  name: 'Organic Tomatoes',
  price: 3.5,
  quantity: 50,
  unit: 'kg',
  farmer_wallet: 'GPUB_FARMER',
  low_stock_threshold: 5,
  low_stock_alerted: 0,
  is_preorder: false,
  preorder_delivery_date: null,
  farm_lat: null,
  farm_lng: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Enqueue the auth-middleware active-user check (first call for any protected route). */
function mockActiveUser(active = 1) {
  q().mockResolvedValueOnce({ rows: [{ active }], rowCount: 1 });
}

async function registerUser(name, email, role) {
  q()
    .mockResolvedValueOnce({ rows: [{ id: role === 'farmer' ? 1 : 2 }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // refresh token
  return request(app).post('/api/auth/register').send({
    name,
    email,
    password: 'Secure1pass',
    role,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Full order payment flow (Issue #625)', () => {
  it('registers farmer and buyer, lists product, places order, verifies paid status and wallet', async () => {
    // 1. Register farmer
    const farmerRes = await registerUser('Farmer Alice', 'alice@farm.test', 'farmer');
    expect(farmerRes.status).toBe(200);
    expect(farmerRes.body.token).toBeDefined();
    expect(farmerRes.body.user.role).toBe('farmer');
    const farmerToken = farmerRes.body.token;

    // 2. Register buyer
    const buyerRes = await registerUser('Buyer Bob', 'bob@buyer.test', 'buyer');
    expect(buyerRes.status).toBe(200);
    const buyerToken = buyerRes.body.token;

    // 3. Farmer lists a product
    const { token: csrf1, cookieStr: cookie1 } = await getCsrf();
    mockActiveUser();
    q().mockResolvedValueOnce({ rows: [{ id: 10 }], rowCount: 1 });
    const productRes = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookie1)
      .set('X-CSRF-Token', csrf1)
      .send({ name: 'Organic Tomatoes', price: 3.5, quantity: 50, unit: 'kg' });
    expect(productRes.status).toBe(200);
    expect(productRes.body.id).toBe(10);

    // 4. Buyer browses products (public, no auth required)
    q()
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [productFixture], rowCount: 1 });
    const listRes = await request(app).get('/api/products');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].name).toBe('Organic Tomatoes');

    // 5. Buyer places order with mocked Stellar payment
    const { token: csrf2, cookieStr: cookie2 } = await getCsrf();
    mockActiveUser();
    stellar.getBalance.mockResolvedValueOnce(500);
    stellar.sendPayment.mockResolvedValueOnce('TXHASH_FLOW');
    q()
      .mockResolvedValueOnce({ rows: [productFixture], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyerFixture], rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [farmerFixture], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ quantity: 47, low_stock_threshold: 5, low_stock_alerted: 0 }],
        rowCount: 1,
      });

    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookie2)
      .set('X-CSRF-Token', csrf2)
      .send({ product_id: 10, quantity: 3 });

    // 6. Verify order status and wallet balance verification
    expect(orderRes.status).toBe(200);
    expect(orderRes.body.status).toBe('paid');
    expect(orderRes.body.txHash).toBe('TXHASH_FLOW');
    expect(orderRes.body.orderId).toBe(99);
    expect(stellar.getBalance).toHaveBeenCalledWith(buyerFixture.stellar_public_key);
    expect(stellar.sendPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        receiverPublicKey: productFixture.farmer_wallet,
        senderSecret: buyerFixture.stellar_secret_key,
      })
    );
  });

  it('rejects order when buyer wallet balance is insufficient', async () => {
    const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, SECRET);
    const { token: csrf, cookieStr } = await getCsrf();
    mockActiveUser();
    stellar.getBalance.mockResolvedValueOnce(0);
    q()
      .mockResolvedValueOnce({ rows: [productFixture], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyerFixture], rowCount: 1 });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 10, quantity: 1 });

    expect(res.status).toBe(402);
    expect(stellar.sendPayment).not.toHaveBeenCalled();
  });

  it('marks order failed when Stellar payment throws', async () => {
    const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, SECRET);
    const { token: csrf, cookieStr } = await getCsrf();
    mockActiveUser();
    stellar.getBalance.mockResolvedValueOnce(9999);
    stellar.sendPayment.mockRejectedValueOnce(new Error('network timeout'));
    q()
      .mockResolvedValueOnce({ rows: [productFixture], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyerFixture], rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 55 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 10, quantity: 2 });

    expect(res.status).toBe(402);
    expect(stellar.sendPayment).toHaveBeenCalled();
  });

  it('creates a pending SEP-0007 order without triggering a Stellar transfer', async () => {
    const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, SECRET);
    mockActiveUser();
    q()
      .mockResolvedValueOnce({ rows: [productFixture], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyerFixture], rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 77 }], rowCount: 1 });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 1, payment_method: 'sep7' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(res.body.orderId).toBe(77);
    expect(stellar.sendPayment).not.toHaveBeenCalled();
  });
});

describe('GET /api/products listing with cache (Issue #626)', () => {
  it('returns product list and stores it in cache with a 60-second TTL', async () => {
    const cache = jest.requireMock('../src/cache');
    cache.get.mockResolvedValueOnce(null); // cache miss
    q()
      .mockResolvedValueOnce({ rows: [{ count: '2' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [productFixture, { ...productFixture, id: 11, name: 'Apples' }],
        rowCount: 2,
      });

    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringContaining('products:'),
      expect.objectContaining({ success: true }),
      60
    );
  });

  it('serves a cache hit without querying the database', async () => {
    const cache = jest.requireMock('../src/cache');
    const cachedPayload = {
      success: true,
      data: [productFixture],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    };
    cache.get.mockResolvedValueOnce(cachedPayload);

    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(q()).not.toHaveBeenCalled();
  });
});

describe('Account deactivation (Issue #624)', () => {
  it('deactivates account, revokes session, and returns 30-day GDPR notice', async () => {
    const userToken = jwt.sign({ id: 5, role: 'buyer' }, SECRET);
    mockActiveUser();
    q()
      .mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .post('/api/auth/deactivate')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/anonymized after 30 days/i);
  });

  it('returns 404 when user is not found', async () => {
    const userToken = jwt.sign({ id: 999, role: 'buyer' }, SECRET);
    mockActiveUser();
    q().mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post('/api/auth/deactivate')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(404);
  });

  it('returns 401 without an auth token', async () => {
    const res = await request(app).post('/api/auth/deactivate');
    expect(res.status).toBe(401);
  });
});
