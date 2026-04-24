/**
 * Integration tests for the Orders API using mockQuery.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../app');

const mockDb = jest.requireMock('../db/schema');
const stellar = jest.requireMock('../utils/stellar');

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
});

const SECRET = process.env.JWT_SECRET;
const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, SECRET);
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);

const product = {
  id: 10,
  name: 'Apples',
  price: 5.0,
  quantity: 10,
  farmer_id: 1,
  farmer_wallet: 'GFARMER123',
  low_stock_threshold: 5,
  low_stock_alerted: 0,
};
const buyer = {
  id: 2,
  name: 'Test Buyer',
  email: 'buyer@example.com',
  stellar_public_key: 'GBUYER123',
  stellar_secret_key: 'SSECRETBUYER',
  referred_by: null,
  referral_bonus_sent: 0,
};
const farmer = {
  id: 1,
  name: 'Test Farmer',
  email: 'farmer@example.com',
  stellar_public_key: 'GFARMER123',
};

describe('POST /api/orders', () => {
  it('successful order returns orderId, status "paid", and txHash', async () => {
    stellar.getBalance.mockResolvedValueOnce(9999);
    stellar.sendPayment.mockResolvedValueOnce('FAKE_TX_HASH_ABC');

    mockDb.query
      .mockResolvedValueOnce({ rows: [product], rowCount: 1 }) // product lookup
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 }) // buyer lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // stock decrement
      .mockResolvedValueOnce({ rows: [{ id: 42 }], rowCount: 1 }) // INSERT order
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE paid
      .mockResolvedValueOnce({ rows: [farmer], rowCount: 1 }) // farmer lookup
      .mockResolvedValueOnce({
        rows: [{ quantity: 8, low_stock_threshold: 5, low_stock_alerted: 0 }],
        rowCount: 1,
      }); // low-stock

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 2 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
    expect(res.body.txHash).toBe('FAKE_TX_HASH_ABC');
    expect(res.body.orderId).toBeDefined();
  });

  it('returns 403 when a farmer tries to place an order', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ product_id: 10, quantity: 1 });
    expect(res.status).toBe(403);
  });

  it('returns 409 when stock is insufficient', async () => {
  it('accepts quantity at MAX_ORDER_QUANTITY (10000)', async () => {
    stellar.getBalance.mockResolvedValueOnce(9999999);
    stellar.sendPayment.mockResolvedValueOnce('FAKE_TX_MAX');

    mockDb.query
      .mockResolvedValueOnce({ rows: [{ ...product, quantity: 10000 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [farmer], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ quantity: 0, low_stock_threshold: 5, low_stock_alerted: 0 }], rowCount: 1 });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 10000 });

    expect(res.status).toBe(200);
  });

  it('returns 400 when quantity exceeds MAX_ORDER_QUANTITY (10000)', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 10001 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 when stock is insufficient', async () => {
    stellar.getBalance.mockResolvedValueOnce(9999);
    mockDb.query
      .mockResolvedValueOnce({ rows: [product], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // stock decrement → 0 changes

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 999 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('out_of_stock');
  });

  it('sets order status to "failed" when payment throws', async () => {
    stellar.getBalance.mockResolvedValueOnce(9999);
    stellar.sendPayment.mockRejectedValueOnce(new Error('network timeout'));

    mockDb.query
      .mockResolvedValueOnce({ rows: [product], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 55 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE failed
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // restore stock

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 1 });

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('payment_failed');
    expect(res.body.orderId).toBeDefined();
  });

  it('stock is decremented after a successful order', async () => {
    stellar.getBalance.mockResolvedValueOnce(9999);
    stellar.sendPayment.mockResolvedValueOnce('FAKE_TX_HASH_STOCK');

    mockDb.query
      .mockResolvedValueOnce({ rows: [product], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 77 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [farmer], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ quantity: 8, low_stock_threshold: 5, low_stock_alerted: 0 }],
        rowCount: 1,
      });

    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 2 });

    // Verify query was called with stock-deduction SQL
    const calls = mockDb.query.mock.calls;
    const stockDeductCall = calls.find(([sql]) => sql.includes('quantity = quantity -'));
    expect(stockDeductCall).toBeDefined();
  });
});

describe('GET /api/orders', () => {
  it('buyer sees their order history', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ count: '2' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          { id: 1, product_name: 'Apples', status: 'paid' },
          { id: 2, product_name: 'Carrots', status: 'paid' },
        ],
        rowCount: 2,
      });

    const res = await request(app).get('/api/orders').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(20);
    expect(res.body.totalPages).toBe(1);
  });

  it("returns only the authenticated buyer's orders", async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ id: 5, product_name: 'Tomatoes', status: 'paid' }],
        rowCount: 1,
      });

    const res = await request(app).get('/api/orders').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    const calls = mockDb.query.mock.calls;
    const orderQueryCall = calls.find(([sql]) => sql.includes('buyer_id'));
    expect(orderQueryCall).toBeDefined();
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/orders');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/orders/sales', () => {
  it('farmer sees their incoming sales', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ count: '3' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          { id: 10, product_name: 'Apples', buyer_name: 'Alice' },
          { id: 11, product_name: 'Carrots', buyer_name: 'Bob' },
          { id: 12, product_name: 'Beets', buyer_name: 'Carol' },
        ],
        rowCount: 3,
      });

    const res = await request(app)
      .get('/api/orders/sales')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.total).toBe(3);
    expect(res.body.page).toBe(1);
    expect(res.body.totalPages).toBe(1);
  });

  it('returns 403 when a buyer tries to access sales', async () => {
    const res = await request(app)
      .get('/api/orders/sales')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Pre-order specific flows
// ---------------------------------------------------------------------------
describe('Pre-order flows', () => {
  it('creates a claimable balance when ordering a pre-order product', async () => {
    const preorderProduct = {
      ...product,
      is_preorder: 1,
      preorder_delivery_date: '2099-12-31',
    };

    stellar.getBalance.mockResolvedValueOnce(9999);
    stellar.createPreorderClaimableBalance.mockResolvedValueOnce({
      txHash: 'PREORDER_TX_HASH',
      balanceId: 'PREORDER_BALANCE_001',
    });

    mockGet
      .mockReturnValueOnce(preorderProduct) // product lookup
      .mockReturnValueOnce(buyer) // buyer lookup
      .mockReturnValueOnce(farmer) // farmer lookup for email
      .mockReturnValueOnce({ quantity: 8, low_stock_threshold: 5, low_stock_alerted: 0 }); // low-stock check

    mockRun
      .mockReturnValueOnce({ changes: 1 }) // stock deduct
      .mockReturnValueOnce({ lastInsertRowid: 91 }) // insert order
      .mockReturnValueOnce({}); // update paid + escrow fields

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 2 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
    expect(res.body.preorder).toBe(true);
    expect(res.body.claimableBalanceId).toBe('PREORDER_BALANCE_001');
  });

  it('returns 400 when farmer claims pre-order before delivery date', async () => {
    mockGet.mockReturnValueOnce({
      id: 200,
      buyer_id: 2,
      product_id: 10,
      is_preorder: 1,
      preorder_delivery_date: '2099-12-31',
      escrow_status: 'funded',
      escrow_balance_id: 'PREORDER_BALANCE_001',
    });

    const res = await request(app)
      .post('/api/orders/200/claim-preorder')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('preorder_not_deliverable');
  });
});
