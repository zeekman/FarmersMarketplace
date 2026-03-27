/**
 * Integration tests for the Orders API.
 *
 * Mocks:
 *  - better-sqlite3 (via jest.setup.js)
 *  - stellar.sendPayment → fake TX hash
 *  - mailer (fire-and-forget, not under test here)
 */

process.env.JWT_SECRET  = process.env.JWT_SECRET || 'test-secret-for-jest';
process.env.NODE_ENV    = 'test'; // disables CSRF protection

const jwt     = require('jsonwebtoken');
const request = require('supertest');
const app     = require('../app');

const mockDb  = jest.requireMock('../db/schema');
const stellar = jest.requireMock('../utils/stellar');

// Shared mock handles — wired up fresh before each test
const mockRun         = jest.fn().mockReturnValue({ lastInsertRowid: 1, changes: 1 });
const mockGet         = jest.fn();
const mockAll         = jest.fn().mockReturnValue([]);
const mockTransaction = jest.fn((fn) => (...args) => fn(...args));
const mockPrepare     = jest.fn(() => ({ get: mockGet, all: mockAll, run: mockRun }));

beforeEach(() => {
  jest.clearAllMocks();
  mockRun.mockReturnValue({ lastInsertRowid: 1, changes: 1 });
  mockAll.mockReturnValue([]);
  mockDb.prepare     = mockPrepare;
  mockDb.exec        = jest.fn();
  mockDb.transaction = mockTransaction;
});

const SECRET      = process.env.JWT_SECRET;
const buyerToken  = jwt.sign({ id: 2, role: 'buyer'  }, SECRET);
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);

// Fixtures
const product = {
  id: 10, name: 'Apples', price: 5.0, quantity: 10,
  farmer_id: 1, farmer_wallet: 'GFARMER123',
  low_stock_threshold: 5, low_stock_alerted: 0,
};
const buyer = {
  id: 2, name: 'Test Buyer', email: 'buyer@example.com',
  stellar_public_key: 'GBUYER123', stellar_secret_key: 'SSECRETBUYER',
};
const farmer = { id: 1, name: 'Test Farmer', email: 'farmer@example.com' };

// ---------------------------------------------------------------------------
// POST /api/orders
// ---------------------------------------------------------------------------
describe('POST /api/orders', () => {
  it('successful order returns orderId, status "paid", and txHash', async () => {
    stellar.getBalance.mockResolvedValueOnce(9999);
    stellar.sendPayment.mockResolvedValueOnce('FAKE_TX_HASH_ABC');

    mockGet
      .mockReturnValueOnce(product)   // product lookup
      .mockReturnValueOnce(buyer)     // buyer lookup
      .mockReturnValueOnce({ quantity: 8, low_stock_threshold: 5, low_stock_alerted: 0 }) // low-stock check
      .mockReturnValueOnce(farmer);   // farmer lookup for email

    // transaction: deduct stock → insert order
    mockRun
      .mockReturnValueOnce({ changes: 1 })           // UPDATE products (deduct)
      .mockReturnValueOnce({ lastInsertRowid: 42 })  // INSERT order
      .mockReturnValueOnce({});                      // UPDATE order status=paid

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

  it('returns 400 when stock is insufficient', async () => {
    stellar.getBalance.mockResolvedValueOnce(9999);

    mockGet
      .mockReturnValueOnce(product)
      .mockReturnValueOnce(buyer);

    // transaction: deduct returns changes=0 → route throws insufficient_stock
    mockRun.mockReturnValueOnce({ changes: 0 });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 999 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('insufficient_stock');
  });

  it('sets order status to "failed" when payment throws', async () => {
    stellar.getBalance.mockResolvedValueOnce(9999);
    stellar.sendPayment.mockRejectedValueOnce(new Error('network timeout'));

    mockGet
      .mockReturnValueOnce(product)
      .mockReturnValueOnce(buyer);

    mockRun
      .mockReturnValueOnce({ changes: 1 })           // deduct stock
      .mockReturnValueOnce({ lastInsertRowid: 55 })  // insert order
      .mockReturnValueOnce({})                       // stock restore (quantity + qty)
      .mockReturnValueOnce({});                      // UPDATE orders SET status='failed'

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

    mockGet
      .mockReturnValueOnce(product)
      .mockReturnValueOnce(buyer)
      .mockReturnValueOnce({ quantity: 8, low_stock_threshold: 5, low_stock_alerted: 0 })
      .mockReturnValueOnce(farmer);

    mockRun
      .mockReturnValueOnce({ changes: 1 })
      .mockReturnValueOnce({ lastInsertRowid: 77 })
      .mockReturnValueOnce({});

    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ product_id: 10, quantity: 2 });

    // Verify prepare was called with the stock-deduction SQL
    expect(mockPrepare).toHaveBeenCalledWith(
      expect.stringContaining('quantity = quantity -')
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/orders — buyer sees their orders
// ---------------------------------------------------------------------------
describe('GET /api/orders', () => {
  it('buyer sees their order history', async () => {
    mockGet.mockReturnValueOnce({ count: 2 });
    mockAll.mockReturnValueOnce([
      { id: 1, product_name: 'Apples',  status: 'paid' },
      { id: 2, product_name: 'Carrots', status: 'paid' },
    ]);

    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(20);
    expect(res.body.totalPages).toBe(1);
  });

  it('returns only the authenticated buyer\'s orders', async () => {
    mockGet.mockReturnValueOnce({ count: 1 });
    mockAll.mockReturnValueOnce([{ id: 5, product_name: 'Tomatoes', status: 'paid' }]);

    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    // The prepare SQL must filter by buyer_id
    expect(mockPrepare).toHaveBeenCalledWith(
      expect.stringContaining('buyer_id')
    );
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/orders');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/orders/sales — farmer sees their sales
// ---------------------------------------------------------------------------
describe('GET /api/orders/sales', () => {
  it('farmer sees their incoming sales', async () => {
    mockGet.mockReturnValueOnce({ count: 3 });
    mockAll.mockReturnValueOnce([
      { id: 10, product_name: 'Apples',  buyer_name: 'Alice' },
      { id: 11, product_name: 'Carrots', buyer_name: 'Bob'   },
      { id: 12, product_name: 'Beets',   buyer_name: 'Carol' },
    ]);

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
