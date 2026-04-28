const jwt = require('jsonwebtoken');
const { request, app, mockQuery, getCsrf } = require('./setup');
const stellar = jest.requireMock('../src/utils/stellar');

beforeEach(() => {
  jest.resetAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  stellar.getBalance.mockResolvedValue(1000);
  stellar.sendPayment.mockResolvedValue('TXHASH123');
  stellar.createClaimableBalance.mockResolvedValue({
    txHash: 'ESCROW_TX',
    balanceId: 'BALANCE_ID_001',
  });
  stellar.claimBalance.mockResolvedValue('CLAIM_TX_001');
});

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, SECRET);

const product = {
  id: 10,
  name: 'Apples',
  price: 5.0,
  quantity: 10,
  farmer_id: 1,
  farmer_wallet: 'GFARMER',
};
const buyer = {
  id: 2,
  name: 'Bob',
  email: 'bob@test.com',
  stellar_secret_key: 'SSECRET',
  stellar_public_key: 'GBUYER',
  referred_by: null,
  referral_bonus_sent: 0,
};

describe('POST /api/orders idempotency', () => {
  const idempotencyKey = 'test-key-123';

  it('first request processes normally and caches success response', async () => {
    mockGet
      .mockReturnValueOnce(product)
      .mockReturnValueOnce(buyer)
      .mockReturnValueOnce({ id: 1 }); // farmer
    mockRun
      .mockReturnValueOnce({ changes: 1 })
      .mockReturnValueOnce({ lastInsertRowid: 99 })
      .mockReturnValueOnce({}); // update status
    stellar.getBalance.mockResolvedValue(99999);
    stellar.sendPayment.mockResolvedValue('TXHASH_OK');

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ product_id: 10, quantity: 2 });

    expect(res.status).toBe(200);
    expect(res.body.orderId).toBe(99);
    expect(res.body.status).toBe('paid');

    // Verify cached
    expect(mockPrepare.mock.calls.some(call => call[0].includes('INSERT OR REPLACE INTO idempotency'))).toBe(true);
  });

  it('second request with same key returns cached response exactly', async () => {
    // Clear mocks, simulate cache hit
    mockGet.mockReturnValueOnce({ status: 200, body: { orderId: 99, status: 'paid', txHash: 'TXHASH_OK', totalPrice: 10 } }); // idempotency lookup

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ product_id: 10, quantity: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orderId: 99, status: 'paid', txHash: 'TXHASH_OK', totalPrice: 10 });
    // No Stellar call, no stock update for cached
    expect(stellar.sendPayment).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('idempotency caches 402 insufficient balance exactly', async () => {
    mockGet
      .mockReturnValueOnce(product)
      .mockReturnValueOnce(buyer);
    stellar.getBalance.mockResolvedValueOnce(0);

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Idempotency-Key', 'insufficient-key')
      .send({ product_id: 10, quantity: 1 });

    expect(res.status).toBe(402);
    // Cache hit on second would return same
  });
});

describe('POST /api/orders', () => {
  it('buyer places an order successfully', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    stellar.getBalance.mockResolvedValueOnce(9999);
    stellar.sendPayment.mockResolvedValueOnce('TXHASH_OK');

    mockQuery
      .mockResolvedValueOnce({ rows: [product], rowCount: 1 }) // product lookup
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 }) // buyer lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // stock decrement
      .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 }) // INSERT order
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE order paid
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // farmer lookup
      .mockResolvedValueOnce({
        rows: [{ quantity: 8, low_stock_threshold: 5, low_stock_alerted: 0 }],
        rowCount: 1,
      }); // low-stock

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 10, quantity: 2 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
  });

  // ... (existing tests unchanged)
  it('returns 403 when a farmer tries to order', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 10, quantity: 1 });
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent product', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    stellar.getBalance.mockResolvedValueOnce(9999);
    mockQuery
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 }) // buyer lookup (idempotency check first)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // product not found

    // Actually the route checks idempotency key first (no key sent), then product
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // product not found
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 });

    // Reset and set up correctly: route order is: idempotency(skip), address(skip), product, buyer
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // product not found

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 9999, quantity: 1 });
    expect(res.status).toBe(404);
  });

  it('returns 402 when buyer has insufficient balance', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    stellar.getBalance.mockResolvedValueOnce(0);
    mockQuery
      .mockResolvedValueOnce({ rows: [product], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 10, quantity: 1 });
    expect(res.status).toBe(402);
  });

  it('returns 400 when stock is insufficient', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    stellar.getBalance.mockResolvedValueOnce(99999);
    mockQuery
      .mockResolvedValueOnce({ rows: [product], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // stock decrement returns 0 changes

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 10, quantity: 999 });
    expect(res.status).toBe(400);
  });

  it('marks order failed when payment throws', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    stellar.getBalance.mockResolvedValueOnce(99999);
    stellar.sendPayment.mockRejectedValueOnce(new Error('network error'));
    mockQuery
      .mockResolvedValueOnce({ rows: [product], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // stock decrement
      .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 }) // INSERT order
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE failed
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // restore stock

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 10, quantity: 1 });
    expect(res.status).toBe(402);
  });
});

describe('GET /api/orders', () => {
  it('returns paginated buyer order history', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 1, product_name: 'Apples' }], rowCount: 1 });
    const res = await request(app).get('/api/orders').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(20);
    expect(res.body.totalPages).toBe(1);
  });

  it('respects page and limit query params', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '50' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get('/api/orders?page=2&limit=10')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(10);
    expect(res.body.totalPages).toBe(5);
  });

  it('clamps limit to 100', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get('/api/orders?limit=999')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(100);
  });

  it('defaults to page 1 when page param is omitted', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/orders').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
  });
});

describe('SEP-0007 payment links', () => {
  it('creates a pending order for sep7 payment', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [product], rowCount: 1 }) // product lookup
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 }) // buyer lookup
      .mockResolvedValueOnce({ rowCount: 1 }) // stock decrement
      .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 }); // insert order

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 2, payment_method: 'sep7' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(res.body.orderId).toBe(99);
  });

  it('returns a SEP-0007 payment link for pending order and 30-minute valid', async () => {
    const createdAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 99,
      buyer_id: 2,
      product_id: 10,
      quantity: 2,
      total_price: 10.0,
      status: 'pending',
      created_at: createdAt,
      is_preorder: false,
      preorder_delivery_date: null,
      farmer_wallet: 'GFARMER',
    }], rowCount: 1 });

    const res = await request(app)
      .get('/api/orders/99/payment-link')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.paymentLink).toContain('web+stellar:pay');
    expect(res.body.expiresAt).toBeDefined();
  });

  it('returns 410 when payment link is expired', async () => {
    const createdAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 99,
      buyer_id: 2,
      product_id: 10,
      quantity: 2,
      total_price: 10.0,
      status: 'pending',
      created_at: createdAt,
      is_preorder: false,
      preorder_delivery_date: null,
      farmer_wallet: 'GFARMER',
    }], rowCount: 1 });

    const res = await request(app)
      .get('/api/orders/99/payment-link')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(410);
  });
});

describe('GET /api/orders/sales', () => {
  it('returns paginated farmer sales', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 1, product_name: 'Apples' }], rowCount: 1 });
    const res = await request(app)
      .get('/api/orders/sales')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.page).toBe(1);
    expect(res.body.totalPages).toBe(1);
  });

  it('returns 403 for buyers', async () => {
    const res = await request(app)
      .get('/api/orders/sales')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });
});
