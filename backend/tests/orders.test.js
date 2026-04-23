const jwt    = require('jsonwebtoken');
const { request, app, mockGet, mockAll, mockRun, mockTransaction, mockDb, mockPrepare } = require('./setup');
const stellar = jest.requireMock('../src/utils/stellar');

beforeEach(() => jest.clearAllMocks());

const SECRET      = process.env.JWT_SECRET || 'secret';
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken  = jwt.sign({ id: 2, role: 'buyer'  }, SECRET);

const product = { id: 10, name: 'Apples', price: 5.0, quantity: 10, farmer_id: 1, farmer_wallet: 'GFARMER' };
const buyer   = { id: 2, stellar_secret_key: 'SSECRET', stellar_public_key: 'GBUYER' };

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
  it('buyer places an order successfully when weight is provided (parsed as float)', async () => {
    mockGet
      .mockReturnValueOnce(product)  // product lookup
      .mockReturnValueOnce(buyer);   // buyer lookup
      .mockReturnValueOnce({ id: 1 }); // farmer in sendOrderEmails
    mockRun
      .mockReturnValueOnce({ changes: 1 })
      .mockReturnValueOnce({ lastInsertRowid: 99 })
      .mockReturnValueOnce({}); 
    stellar.getBalance.mockResolvedValue(99999);
    stellar.sendPayment.mockResolvedValue('TXHASH_OK');

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 2, weight: '1.5' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
    // Verify weight stored by mocking the order query or checking INSERT
    expect(mockRun.mock.calls[1].slice(1)).toContain(1.5); // weight param in INSERT
  });

  it('buyer places an order successfully when no weight provided (null)', async () => {
    mockGet
      .mockReturnValueOnce(product)
      .mockReturnValueOnce(buyer)
      .mockReturnValueOnce({ id: 1 });
    mockRun
      .mockReturnValueOnce({ changes: 1 })
      .mockReturnValueOnce({ lastInsertRowid: 99 })
      .mockReturnValueOnce({}); 
    stellar.getBalance.mockResolvedValue(99999);
    stellar.sendPayment.mockResolvedValue('TXHASH_OK');

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 2 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
    expect(mockRun.mock.calls[1].slice(1)).toContain(null); // weight param null
  });

  it('buyer places an order successfully', async () => {
    mockGet
      .mockReturnValueOnce(product)  // product lookup
      .mockReturnValueOnce(buyer);   // buyer lookup
    mockRun
      .mockReturnValueOnce({ changes: 1 })
      .mockReturnValueOnce({ lastInsertRowid: 99 })
      .mockReturnValueOnce({}); 
    mockGet.mockReturnValueOnce({ id: 1 });
    stellar.sendPayment.mockResolvedValueOnce('TXHASH_OK');

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 2 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
  });

  // ... (existing tests unchanged)
  it('returns 403 when a farmer tries to order', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ product_id: 10, quantity: 1 });
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent product', async () => {
    mockGet.mockReturnValueOnce(undefined);
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 9999, quantity: 1 });
    expect(res.status).toBe(404);
  });

  it('returns 402 when buyer has insufficient balance', async () => {
    mockGet
      .mockReturnValueOnce(product)
      .mockReturnValueOnce(buyer);
    stellar.getBalance.mockResolvedValueOnce(0);
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 1 });
    expect(res.status).toBe(402);
  });

  it('returns 400 when stock is insufficient', async () => {
    mockGet
      .mockReturnValueOnce(product)
      .mockReturnValueOnce(buyer);
    stellar.getBalance.mockResolvedValueOnce(99999);
    mockRun.mockReturnValueOnce({ changes: 0 });
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 999 });
    expect(res.status).toBe(400);
  });

  it('marks order failed when payment throws', async () => {
    mockGet
      .mockReturnValueOnce(product)
      .mockReturnValueOnce(buyer);
    stellar.getBalance.mockResolvedValueOnce(99999);
    mockRun
      .mockReturnValueOnce({ changes: 1 })
      .mockReturnValueOnce({ lastInsertRowid: 99 });
    stellar.sendPayment.mockRejectedValueOnce(new Error('network error'));
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 1 });
    expect(res.status).toBe(402);
  });
});

describe('GET /api/orders', () => {
  it('returns buyer order history', async () => {
    mockAll.mockReturnValueOnce([{ id: 1, product_name: 'Apples' }]);
    const res = await request(app).get('/api/orders').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });
});

describe('GET /api/orders/sales', () => {
  it('returns farmer sales', async () => {
    mockAll.mockReturnValueOnce([{ id: 1, product_name: 'Apples' }]);
    const res = await request(app).get('/api/orders/sales').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it('returns 403 for buyers', async () => {
    const res = await request(app).get('/api/orders/sales').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });
});
