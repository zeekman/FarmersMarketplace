/**
 * budgetGuard.test.js
 *
 * Tests for the atomic monthly budget guard.
 *
 * Strategy: mock both '../db/schema' and '../middleware/auth' at the top level,
 * then control the mock's behaviour per-test by replacing the query function.
 *
 * Key scenarios:
 *  - Only paid orders → budget check still works
 *  - Pending + paid orders → both counted
 *  - Zero budget → all orders rejected
 *  - Exact budget match → order at the limit is accepted
 *  - Race condition: two concurrent orders that individually fit but together exceed budget
 *    → exactly one succeeds, one is rejected
 */

const express = require('express');
const request = require('supertest');

// ---------------------------------------------------------------------------
// Mock auth — just passes through; req.user is set by the test header middleware
// ---------------------------------------------------------------------------
jest.mock('../middleware/auth', () => (_req, _res, next) => next());

// ---------------------------------------------------------------------------
// Mock db/schema with a replaceable query function
// ---------------------------------------------------------------------------
const mockDb = {
  isPostgres: false,
  query: jest.fn(),
};
jest.mock('../db/schema', () => mockDb);

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
let mockUsers = [];
let mockOrders = [];
let mockNextOrderId = 1;

function resetState() {
  mockUsers = [];
  mockOrders = [];
  mockNextOrderId = 1;
  mockDb.query.mockReset();
  mockDb.query.mockImplementation(handleQuery);
}

/**
 * Default query handler — simulates the DB for budget guard + stub order route.
 */
async function handleQuery(sql, params = []) {
  const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();

  // SELECT monthly_budget FROM users WHERE id = $1
  if (s.includes('monthly_budget')) {
    const user = mockUsers.find((u) => u.id === params[0]);
    return { rows: user ? [{ monthly_budget: user.monthly_budget }] : [], rowCount: 1 };
  }

  // SELECT COALESCE(SUM(total_price)...) FROM orders WHERE buyer_id = $1 AND status IN (...)
  if (s.includes('coalesce') && s.includes('orders')) {
    const buyerId = params[0];
    const start = params[1];
    const end = params[2];
    const relevant = mockOrders.filter(
      (o) =>
        o.buyer_id === buyerId &&
        ['pending', 'paid'].includes(o.status) &&
        o.created_at >= start &&
        o.created_at < end,
    );
    const spent = relevant.reduce((sum, o) => sum + o.total_price, 0);
    return { rows: [{ spent }], rowCount: 1 };
  }

  // INSERT INTO orders ... RETURNING id
  if (s.includes('insert') && s.includes('orders')) {
    const id = mockNextOrderId++;
    mockOrders.push({
      id,
      buyer_id: params[0],
      product_id: params[1] ?? 1,
      quantity: params[2] ?? 1,
      total_price: params[3],
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    return { rows: [{ id }], rowCount: 1 };
  }

  return { rows: [], rowCount: 0 };
}

// ---------------------------------------------------------------------------
// Build a minimal Express app
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());

  // Inject req.user from test header (simulates JWT auth)
  app.use((req, _res, next) => {
    const userId = parseInt(req.headers['x-test-user-id'], 10);
    req.user = { id: userId, role: 'buyer' };
    next();
  });

  // Budget guard middleware under test
  const budgetGuard = require('../routes/orderBudgetGuard');
  app.use('/api/orders', budgetGuard);

  // Stub order creation route
  app.post('/api/orders', async (req, res) => {
    try {
      const { rows } = await mockDb.query(
        'INSERT INTO orders (buyer_id, product_id, quantity, total_price) VALUES ($1,$2,$3,$4) RETURNING id',
        [req.user.id, 1, 1, req.body.total_price],
      );
      res.json({ success: true, orderId: rows[0].id });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function addUser(id, monthlyBudget) {
  mockUsers.push({ id, monthly_budget: monthlyBudget });
}

function addOrder(buyerId, totalPrice, status = 'paid') {
  mockOrders.push({
    id: mockNextOrderId++,
    buyer_id: buyerId,
    total_price: totalPrice,
    status,
    created_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Monthly Budget Guard', () => {
  let app;

  beforeEach(() => {
    resetState();
    app = buildApp();
  });

  test('no budget set → order always allowed', async () => {
    addUser(1, null);
    const res = await request(app)
      .post('/api/orders')
      .set('x-test-user-id', '1')
      .send({ total_price: 999 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('only paid orders → counted against budget', async () => {
    addUser(2, 100);
    addOrder(2, 80, 'paid');
    const res = await request(app)
      .post('/api/orders')
      .set('x-test-user-id', '2')
      .send({ total_price: 30 }); // 80 + 30 = 110 > 100
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('budget_exceeded');
  });

  test('pending + paid orders → both counted', async () => {
    addUser(3, 100);
    addOrder(3, 50, 'paid');
    addOrder(3, 40, 'pending'); // 90 already committed
    const res = await request(app)
      .post('/api/orders')
      .set('x-test-user-id', '3')
      .send({ total_price: 20 }); // 90 + 20 = 110 > 100
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('budget_exceeded');
  });

  test('failed orders → NOT counted against budget', async () => {
    addUser(4, 100);
    addOrder(4, 80, 'failed');
    const res = await request(app)
      .post('/api/orders')
      .set('x-test-user-id', '4')
      .send({ total_price: 90 }); // 0 spent → 90 < 100
    expect(res.status).toBe(200);
  });

  test('zero budget → all orders rejected', async () => {
    addUser(5, 0);
    const res = await request(app)
      .post('/api/orders')
      .set('x-test-user-id', '5')
      .send({ total_price: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('budget_exceeded');
  });

  test('exact budget match → order accepted', async () => {
    addUser(6, 100);
    addOrder(6, 60, 'paid');
    const res = await request(app)
      .post('/api/orders')
      .set('x-test-user-id', '6')
      .send({ total_price: 40 }); // 60 + 40 = 100 === budget → allowed
    expect(res.status).toBe(200);
  });

  test('override flag bypasses budget check', async () => {
    addUser(7, 50);
    addOrder(7, 50, 'paid'); // already at limit
    const res = await request(app)
      .post('/api/orders')
      .set('x-test-user-id', '7')
      .send({ total_price: 10, budget_override_confirmed: true });
    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Race condition test
  //
  // Two concurrent requests for the same buyer, each individually valid (60 < 100)
  // but combined exceeding the budget (120 > 100).
  //
  // We simulate the race by wrapping the spend-sum query with a delay so both
  // requests read the same initial spend (0) before either inserts. Without the
  // advisory lock / serialisation in the guard, both would pass. With it, exactly
  // one succeeds and one is rejected.
  //
  // Expected: [200, 400] — one success, one rejection.
  // -------------------------------------------------------------------------
  test('race condition: two concurrent orders individually valid but combined exceed budget', async () => {
    const BUDGET = 100;
    const ORDER_PRICE = 60; // each is 60; together 120 > 100

    addUser(10, BUDGET);

    // Wrap the mock to delay the spend-sum read so both requests interleave
    const originalImpl = handleQuery;
    mockDb.query.mockImplementation(async (sql, params) => {
      const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (s.includes('coalesce') && s.includes('orders')) {
        await new Promise((r) => setTimeout(r, 5));
      }
      return originalImpl(sql, params);
    });

    const [r1, r2] = await Promise.all([
      request(app)
        .post('/api/orders')
        .set('x-test-user-id', '10')
        .send({ total_price: ORDER_PRICE }),
      request(app)
        .post('/api/orders')
        .set('x-test-user-id', '10')
        .send({ total_price: ORDER_PRICE }),
    ]);

    const statuses = [r1.status, r2.status].sort();

    // Exactly one success (200) and one rejection (400)
    expect(statuses).toEqual([200, 400]);

    // Only one order in the DB
    const inserted = mockOrders.filter(
      (o) => o.buyer_id === 10 && o.status === 'pending',
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0].total_price).toBe(ORDER_PRICE);

    // Total spend must not exceed budget
    const totalSpent = mockOrders
      .filter((o) => o.buyer_id === 10 && ['pending', 'paid'].includes(o.status))
      .reduce((sum, o) => sum + o.total_price, 0);
    expect(totalSpent).toBeLessThanOrEqual(BUDGET);
  });
});
