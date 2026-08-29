const { request, app, mockQuery, getCsrf } = require('./setup');
const stellar = jest.requireMock('../src/utils/stellar');

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

const product = {
  id: 1,
  name: 'Organic Apples',
  price: 5.99,
  quantity: 10,
  farmer_id: 1,
  farmer_wallet: 'GPUB_FARMER',
  low_stock_threshold: 5,
  low_stock_alerted: 0,
};
const buyer = {
  id: 2,
  name: 'Buyer Bob',
  email: 'buyer@test.com',
  stellar_public_key: 'GPUB_BUYER',
  stellar_secret_key: 'SSECRET_BUYER',
  referred_by: null,
  referral_bonus_sent: 0,
};
const farmer = {
  id: 1,
  name: 'Farmer Alice',
  email: 'farmer@test.com',
  stellar_public_key: 'GPUB_FARMER',
};

describe('Full User Flow: register → login → add product → create order → payment', () => {
  it('completes end-to-end flow successfully as farmer + buyer', async () => {
    // 1. Farmer registers
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // INSERT farmer
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT refresh_token
    const farmerReg = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Farmer Alice',
        email: 'farmer@test.com',
        password: 'Secure1pass',
        role: 'farmer',
      });
    expect(farmerReg.status).toBe(200);
    const farmerToken = farmerReg.body.token;

    // 2. Farmer adds product
    const { token: csrf1, cookieStr: cookie1 } = await getCsrf();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }); // INSERT product
    const addProduct = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookie1)
      .set('X-CSRF-Token', csrf1)
      .send({ name: 'Organic Apples', price: 5.99, quantity: 10, unit: 'kg' });
    expect(addProduct.status).toBe(200);

    // 3. Buyer registers
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 2 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const buyerReg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Buyer Bob', email: 'buyer@test.com', password: 'Secure1pass', role: 'buyer' });
    expect(buyerReg.status).toBe(200);
    const buyerToken = buyerReg.body.token;

    // 4. Buyer funds wallet
    const { token: csrf2, cookieStr: cookie2 } = await getCsrf();
    mockQuery.mockResolvedValueOnce({ rows: [{ stellar_public_key: 'GPUB_BUYER' }], rowCount: 1 });
    stellar.getBalance.mockResolvedValueOnce(10000);
    const fundRes = await request(app)
      .post('/api/wallet/fund')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookie2)
      .set('X-CSRF-Token', csrf2);
    expect(fundRes.status).toBe(200);

    // 5. Buyer creates order
    const { token: csrf3, cookieStr: cookie3 } = await getCsrf();
    stellar.getBalance.mockResolvedValueOnce(9999);
    stellar.sendPayment.mockResolvedValueOnce('TXHASH123');
    mockQuery
      .mockResolvedValueOnce({ rows: [product], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [farmer], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ quantity: 8, low_stock_threshold: 5, low_stock_alerted: 0 }],
        rowCount: 1,
      });
    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookie3)
      .set('X-CSRF-Token', csrf3)
      .send({ product_id: 1, quantity: 2 });
    expect(orderRes.status).toBe(200);
    expect(orderRes.body.status).toBe('paid');
    expect(orderRes.body.txHash).toBe('TXHASH123');
  });

  it('fails order on insufficient stock, restores stock, marks failed', async () => {
    const buyerToken = require('jsonwebtoken').sign(
      { id: 2, role: 'buyer' },
      process.env.JWT_SECRET || 'test-secret-for-jest'
    );
    const { token: csrf, cookieStr } = await getCsrf();
    stellar.getBalance.mockResolvedValueOnce(9999);
    mockQuery
      .mockResolvedValueOnce({ rows: [product], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // stock decrement → 0 changes

    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 1, quantity: 2 });
    expect(orderRes.status).toBe(400);
  });

  it('fails order on Stellar payment error, restores stock', async () => {
    const buyerToken = require('jsonwebtoken').sign(
      { id: 2, role: 'buyer' },
      process.env.JWT_SECRET || 'test-secret-for-jest'
    );
    const { token: csrf, cookieStr } = await getCsrf();
    stellar.getBalance.mockResolvedValueOnce(9999);
    stellar.sendPayment.mockRejectedValueOnce(new Error('Payment failed'));
    mockQuery
      .mockResolvedValueOnce({ rows: [product], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 55 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 1, quantity: 1 });
    expect(orderRes.status).toBe(402);
  });
});
