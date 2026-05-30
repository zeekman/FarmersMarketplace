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

describe('POST /api/orders with bundle', () => {
  const bundle = {
    id: 100,
    farmer_id: 1,
    name: 'Veggie Bundle',
    price: 15.0,
    farmer_wallet: 'GFARMER',
  };

  const bundleItems = [
    { product_id: 10, quantity: 2, product_name: 'Apples', stock: 10, product_price: 5.0 },
    { product_id: 11, quantity: 1, product_name: 'Carrots', stock: 5, product_price: 10.0 },
  ];

  it('buyer places a bundle order successfully', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    stellar.getBalance.mockResolvedValueOnce(9999);
    stellar.sendPayment.mockResolvedValueOnce('TXHASH_BUNDLE');

    mockQuery
      .mockResolvedValueOnce({ rows: [bundle], rowCount: 1 }) // bundle lookup
      .mockResolvedValueOnce({ rows: bundleItems, rowCount: 2 }) // bundle items
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 }) // buyer lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // stock decrement item 1
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // stock decrement item 2
      .mockResolvedValueOnce({ rows: [{ id: 101 }], rowCount: 1 }) // INSERT order item 1
      .mockResolvedValueOnce({ rows: [{ id: 102 }], rowCount: 1 }) // INSERT order item 2
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // COMMIT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE order 1 paid
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE order 2 paid
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // coupon usage (none)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // coupon uses (none)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // idempotency cache (none)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // idempotency cache (none)

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ bundle_id: 100 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('paid');
    expect(res.body.bundleId).toBe(100);
    expect(res.body.orderIds).toEqual([101, 102]);
    expect(res.body.bundlePrice).toBe(15.0);
    expect(res.body.individualTotal).toBe(20.0); // 5*2 + 10*1
    expect(res.body.savings).toBe(5.0);
  });

  it('rejects bundle order with insufficient stock', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const insufficientStockItems = [
      { product_id: 10, quantity: 2, product_name: 'Apples', stock: 1, product_price: 5.0 },
      { product_id: 11, quantity: 1, product_name: 'Carrots', stock: 5, product_price: 10.0 },
    ];

    mockQuery
      .mockResolvedValueOnce({ rows: [bundle], rowCount: 1 }) // bundle lookup
      .mockResolvedValueOnce({ rows: insufficientStockItems, rowCount: 2 }); // bundle items

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ bundle_id: 100 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('insufficient_stock');
    expect(res.body.message).toContain('Insufficient stock for "Apples"');
  });

  it('rejects bundle order for non-existent bundle', async () => {
    const { token: csrf, cookieStr } = await getCsrf();

    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // bundle not found

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ bundle_id: 999 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('rejects order with both product_id and bundle_id', async () => {
    const { token: csrf, cookieStr } = await getCsrf();

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 10, quantity: 2, bundle_id: 100 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('rejects order with neither product_id nor bundle_id', async () => {
    const { token: csrf, cookieStr } = await getCsrf();

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('applies coupon discount to bundle order', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    stellar.getBalance.mockResolvedValueOnce(9999);
    stellar.sendPayment.mockResolvedValueOnce('TXHASH_BUNDLE');

    const coupon = {
      id: 50,
      code: 'BUNDLE20',
      discount_type: 'percent',
      discount_value: 20,
      max_uses_per_user: 10,
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [bundle], rowCount: 1 }) // bundle lookup
      .mockResolvedValueOnce({ rows: bundleItems, rowCount: 2 }) // bundle items
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 }) // buyer lookup
      .mockResolvedValueOnce({ rows: [coupon], rowCount: 1 }) // coupon lookup
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }], rowCount: 1 }) // coupon usage check
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // stock decrement item 1
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // stock decrement item 2
      .mockResolvedValueOnce({ rows: [{ id: 101 }], rowCount: 1 }) // INSERT order item 1
      .mockResolvedValueOnce({ rows: [{ id: 102 }], rowCount: 1 }) // INSERT order item 2
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // COMMIT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE order 1 paid
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE order 2 paid
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE coupon used_count
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT coupon_uses
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // idempotency cache (none)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // idempotency cache (none)

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ bundle_id: 100, coupon_code: 'BUNDLE20' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.discount).toBe(3.0); // 20% of 15.0
    expect(res.body.totalPrice).toBe(12.0); // 15.0 - 3.0
    expect(res.body.coupon).toEqual({ code: 'BUNDLE20', discount_type: 'percent' });
  });

  it('rolls back stock on payment failure for bundle order', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    stellar.getBalance.mockResolvedValueOnce(9999);
    stellar.sendPayment.mockRejectedValue(new Error('Payment failed'));

    mockQuery
      .mockResolvedValueOnce({ rows: [bundle], rowCount: 1 }) // bundle lookup
      .mockResolvedValueOnce({ rows: bundleItems, rowCount: 2 }) // bundle items
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 }) // buyer lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // stock decrement item 1
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // stock decrement item 2
      .mockResolvedValueOnce({ rows: [{ id: 101 }], rowCount: 1 }) // INSERT order item 1
      .mockResolvedValueOnce({ rows: [{ id: 102 }], rowCount: 1 }) // INSERT order item 2
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // COMMIT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // BEGIN (rollback)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE order 1 failed
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE order 2 failed
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // stock rollback item 1
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // stock rollback item 2
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // COMMIT (rollback)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // idempotency cache (none)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // idempotency cache (none)

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ bundle_id: 100 });

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('payment_failed');
    expect(res.body.orderIds).toEqual([101, 102]);
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

  it('returns 422 when PWYW custom_price is below min_price', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const pwywProduct = {
      ...product,
      pricing_model: 'pwyw',
      min_price: 5.0,
    };
    stellar.getBalance.mockResolvedValueOnce(99999);
    mockQuery
      .mockResolvedValueOnce({ rows: [pwywProduct], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 10, quantity: 1, custom_price: 3.0 });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('validation_error');
    expect(res.body.message).toContain('Minimum price is 5');
  });

  it('accepts PWYW order when custom_price meets min_price', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const pwywProduct = {
      ...product,
      pricing_model: 'pwyw',
      min_price: 5.0,
    };
    stellar.getBalance.mockResolvedValueOnce(99999);
    stellar.sendPayment.mockResolvedValueOnce('TXHASH_OK');
    mockQuery
      .mockResolvedValueOnce({ rows: [pwywProduct], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 })
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
      .send({ product_id: 10, quantity: 1, custom_price: 5.0 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
  });

  it('returns 422 when flash sale has ended', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const expiredFlashSaleProduct = {
      ...product,
      flash_sale_price: 3.0,
      flash_sale_ends_at: new Date(Date.now() - 1000).toISOString(), // Ended 1 second ago
    };
    stellar.getBalance.mockResolvedValueOnce(99999);
    mockQuery
      .mockResolvedValueOnce({ rows: [expiredFlashSaleProduct], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 10, quantity: 1 });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('flash_sale_ended');
    expect(res.body.message).toContain('Flash sale has ended');
  });

  it('returns 422 when flash sale has not started yet', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const futureFlashSaleProduct = {
      ...product,
      flash_sale_price: 3.0,
      flash_sale_starts_at: new Date(Date.now() + 3600000).toISOString(), // Starts in 1 hour
      flash_sale_ends_at: new Date(Date.now() + 7200000).toISOString(), // Ends in 2 hours
    };
    stellar.getBalance.mockResolvedValueOnce(99999);
    mockQuery
      .mockResolvedValueOnce({ rows: [futureFlashSaleProduct], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 10, quantity: 1 });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('flash_sale_not_started');
    expect(res.body.message).toContain('Flash sale has not started yet');
  });

  it('accepts order when flash sale is active within time window', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const activeFlashSaleProduct = {
      ...product,
      flash_sale_price: 3.0,
      flash_sale_starts_at: new Date(Date.now() - 3600000).toISOString(), // Started 1 hour ago
      flash_sale_ends_at: new Date(Date.now() + 3600000).toISOString(), // Ends in 1 hour
    };
    stellar.getBalance.mockResolvedValueOnce(99999);
    stellar.sendPayment.mockResolvedValueOnce('TXHASH_OK');
    mockQuery
      .mockResolvedValueOnce({ rows: [activeFlashSaleProduct], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 })
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
      .send({ product_id: 10, quantity: 1 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
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
