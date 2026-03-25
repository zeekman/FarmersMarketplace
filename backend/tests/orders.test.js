const jwt    = require('jsonwebtoken');
const { request, app, mockGet, mockAll, mockRun, mockTransaction } = require('./setup');
const stellar = jest.requireMock('../src/utils/stellar');

beforeEach(() => jest.clearAllMocks());

const SECRET      = process.env.JWT_SECRET || 'secret';
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken  = jwt.sign({ id: 2, role: 'buyer'  }, SECRET);

const product = { id: 10, name: 'Apples', price: 5.0, quantity: 10, farmer_id: 1, farmer_wallet: 'GFARMER' };
const buyer   = { id: 2, stellar_secret_key: 'SSECRET', stellar_public_key: 'GBUYER' };

describe('POST /api/orders', () => {
  it('buyer places an order successfully', async () => {
    mockGet
      .mockReturnValueOnce(product)  // product lookup
      .mockReturnValueOnce(buyer);   // buyer lookup
    // transaction callback: deduct stock + insert order
    mockRun
      .mockReturnValueOnce({ changes: 1 })          // UPDATE products (deduct)
      .mockReturnValueOnce({ lastInsertRowid: 99 })  // INSERT order
      .mockReturnValueOnce({});                      // UPDATE order status=paid
    mockGet.mockReturnValueOnce({ id: 1 });          // farmer lookup for email

    stellar.sendPayment.mockResolvedValueOnce('TXHASH_OK');

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 2 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
    expect(res.body.txHash).toBe('TXHASH_OK');
  });

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
    stellar.getBalance.mockResolvedValueOnce(99999); // sufficient balance
    // transaction: deduct returns changes=0 → throws
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
    stellar.getBalance.mockResolvedValueOnce(99999); // sufficient balance
    mockRun
      .mockReturnValueOnce({ changes: 1 })
      .mockReturnValueOnce({ lastInsertRowid: 99 });
    stellar.sendPayment.mockRejectedValueOnce(new Error('network error'));
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 1 });
    expect(res.status).toBe(402);
    expect(res.body.orderId).toBeDefined();
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
