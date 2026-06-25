/**
 * budgetGuard.test.js
 *
 * Tests for the atomic monthly budget guard and wallet budget endpoints.
 *
 * Strategy: mock both '../db/schema' and '../middleware/auth' at the top level,
 * then control the mock's behaviour per-test by replacing the query function.
 *
 * Key scenarios covered:
 *  - Only paid orders → budget check still works
 *  - Pending + paid orders → both counted
 *  - Zero budget → all orders rejected
 *  - Exact budget match → order at the limit is accepted
 *  - Race condition: two concurrent orders that individually fit but together exceed budget
 *    → exactly one succeeds, one is rejected (HTTP 402)
 *  - Previous-month orders excluded from monthly window
 *  - Budget rejection fires BEFORE any order INSERT (pre-payment enforcement)
 *  - GET /api/wallet/budget-status returns { limit_xlm, spent_xlm, remaining_xlm, reset_at }
 *  - PUT /api/wallet/budget sets, updates, and removes the monthly spending limit
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
 * Default query handler — simulates the DB for budget guard + stub order route
 * and wallet budget endpoints.
 */
async function handleQuery(sql, params = []) {
  const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();

  // SELECT monthly_budget FROM users WHERE id = $1
  if (s.includes('monthly_budget') && s.startsWith('select')) {
    const user = mockUsers.find((u) => u.id === params[0]);
    return { rows: user ? [{ monthly_budget: user.monthly_budget }] : [], rowCount: 1 };
  }

  // UPDATE users SET monthly_budget = $1 WHERE id = $2
  if (s.includes('update') && s.includes('users') && s.includes('monthly_budget')) {
    const budget = params[0];
    const userId = params[1];
    const user = mockUsers.find((u) => u.id === userId);
    if (user) user.monthly_budget = budget;
    return { rows: [], rowCount: 1 };
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
        (start == null || o.created_at >= start) &&
        (end == null || o.created_at < end),
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
// Build a minimal Express app (budget guard + stub orders route)
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());

  // Inject req.user from test header (simulates JWT auth)
  app.use((req, _res, next) => {
    const userId = parseInt(req.headers['x-test-user-id'], 10);
    req.user = { id: userId, role: req.headers['x-test-role'] || 'buyer' };
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
// Build a minimal Express app for wallet budget endpoints
// ---------------------------------------------------------------------------
function buildWalletApp() {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    const userId = parseInt(req.headers['x-test-user-id'], 10);
    req.user = { id: userId, role: req.headers['x-test-role'] || 'buyer' };
    next();
  });

  const walletBudget = require('../routes/walletBudget');
  app.use('/api/wallet', walletBudget);

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

function addOrderFromLastMonth(buyerId, totalPrice, status = 'paid') {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  mockOrders.push({
    id: mockNextOrderId++,
    buyer_id: buyerId,
    total_price: totalPrice,
    status,
    created_at: d.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Tests — Monthly Budget Guard (orderBudgetGuard middleware)
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
    expect(res.status).toBe(402);
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
    expect(res.status).toBe(402);
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
    expect(res.status).toBe(402);
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
  // Pre-payment enforcement
  // Verify the guard rejects BEFORE any INSERT so no order record is created.
  // -------------------------------------------------------------------------
  test('budget rejection fires before any order INSERT', async () => {
    addUser(8, 50);
    addOrder(8, 50, 'paid'); // at limit
    const ordersBefore = mockOrders.length;

    const res = await request(app)
      .post('/api/orders')
      .set('x-test-user-id', '8')
      .send({ total_price: 1 });

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('budget_exceeded');
    // Guard must reject before the stub handler calls INSERT
    expect(mockOrders.length).toBe(ordersBefore);
  });

  test('402 response includes limit_xlm and spent_xlm', async () => {
    addUser(9, 100);
    addOrder(9, 80, 'paid');
    const res = await request(app)
      .post('/api/orders')
      .set('x-test-user-id', '9')
      .send({ total_price: 30 });
    expect(res.status).toBe(402);
    expect(res.body.limit_xlm).toBe(100);
    expect(res.body.spent_xlm).toBe(80);
  });

  // -------------------------------------------------------------------------
  // Monthly window
  // Orders from a previous calendar month must not count against the current
  // month's budget — verifying the date_trunc / JS-UTC-boundary logic.
  // -------------------------------------------------------------------------
  test('previous-month orders excluded from monthly spending window', async () => {
    addUser(11, 100);
    addOrderFromLastMonth(11, 90, 'paid'); // last month — must NOT count
    const res = await request(app)
      .post('/api/orders')
      .set('x-test-user-id', '11')
      .send({ total_price: 80 }); // 0 (this month) + 80 < 100 → allowed
    expect(res.status).toBe(200);
  });

  test('mix of current and previous month orders — only current month counted', async () => {
    addUser(12, 100);
    addOrderFromLastMonth(12, 50, 'paid'); // last month — excluded
    addOrder(12, 60, 'paid');              // this month — included
    const res = await request(app)
      .post('/api/orders')
      .set('x-test-user-id', '12')
      .send({ total_price: 50 }); // 60 + 50 = 110 > 100 → rejected
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('budget_exceeded');
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
  // Expected: [200, 402] — one success, one rejection.
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

    // Exactly one success (200) and one rejection (402)
    expect(statuses).toEqual([200, 402]);

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

// ---------------------------------------------------------------------------
// Tests — Wallet Budget Endpoints (walletBudget router)
// ---------------------------------------------------------------------------
describe('Wallet Budget Endpoints', () => {
  let wApp;

  beforeEach(() => {
    resetState();
    wApp = buildWalletApp();
  });

  // --- GET /api/wallet/budget-status ---

  test('GET /budget-status returns limit_xlm, spent_xlm, remaining_xlm, reset_at', async () => {
    addUser(30, 200);
    addOrder(30, 80, 'paid');
    const res = await request(wApp)
      .get('/api/wallet/budget-status')
      .set('x-test-user-id', '30');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.limit_xlm).toBe(200);
    expect(res.body.spent_xlm).toBe(80);
    expect(res.body.remaining_xlm).toBe(120);
    // reset_at must be the 1st of a month at midnight UTC
    expect(res.body.reset_at).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
  });

  test('GET /budget-status with no budget set returns null limit_xlm and remaining_xlm', async () => {
    addUser(31, null);
    const res = await request(wApp)
      .get('/api/wallet/budget-status')
      .set('x-test-user-id', '31');
    expect(res.status).toBe(200);
    expect(res.body.limit_xlm).toBeNull();
    expect(res.body.remaining_xlm).toBeNull();
    expect(res.body.spent_xlm).toBe(0);
    expect(res.body.reset_at).toBeDefined();
  });

  test('GET /budget-status reset_at is the start of next month UTC', async () => {
    addUser(35, 100);
    const res = await request(wApp)
      .get('/api/wallet/budget-status')
      .set('x-test-user-id', '35');
    const resetAt = new Date(res.body.reset_at);
    const now = new Date();
    const expectedNextMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    expect(resetAt.getTime()).toBe(expectedNextMonth.getTime());
  });

  // --- PUT /api/wallet/budget ---

  test('PUT /budget sets a new spending limit', async () => {
    addUser(32, null);
    const res = await request(wApp)
      .put('/api/wallet/budget')
      .set('x-test-user-id', '32')
      .send({ limit_xlm: 500 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.limit_xlm).toBe(500);
    const user = mockUsers.find((u) => u.id === 32);
    expect(user.monthly_budget).toBe(500);
  });

  test('PUT /budget updates an existing limit', async () => {
    addUser(36, 100);
    const res = await request(wApp)
      .put('/api/wallet/budget')
      .set('x-test-user-id', '36')
      .send({ limit_xlm: 250 });
    expect(res.status).toBe(200);
    expect(res.body.limit_xlm).toBe(250);
    const user = mockUsers.find((u) => u.id === 36);
    expect(user.monthly_budget).toBe(250);
  });

  test('PUT /budget with null removes the limit', async () => {
    addUser(33, 300);
    const res = await request(wApp)
      .put('/api/wallet/budget')
      .set('x-test-user-id', '33')
      .send({ limit_xlm: null });
    expect(res.status).toBe(200);
    expect(res.body.limit_xlm).toBeNull();
    const user = mockUsers.find((u) => u.id === 33);
    expect(user.monthly_budget).toBeNull();
  });

  test('PUT /budget with 0 removes the limit', async () => {
    addUser(34, 300);
    const res = await request(wApp)
      .put('/api/wallet/budget')
      .set('x-test-user-id', '34')
      .send({ limit_xlm: 0 });
    expect(res.status).toBe(200);
    expect(res.body.limit_xlm).toBeNull();
    const user = mockUsers.find((u) => u.id === 34);
    expect(user.monthly_budget).toBeNull();
  });

  test('PUT /budget with negative value returns 400', async () => {
    addUser(37, 100);
    const res = await request(wApp)
      .put('/api/wallet/budget')
      .set('x-test-user-id', '37')
      .send({ limit_xlm: -10 });
    expect(res.status).toBe(400);
  });

  test('PUT /budget response includes current spent_xlm and remaining_xlm', async () => {
    addUser(38, null);
    addOrder(38, 40, 'paid');
    const res = await request(wApp)
      .put('/api/wallet/budget')
      .set('x-test-user-id', '38')
      .send({ limit_xlm: 100 });
    expect(res.status).toBe(200);
    expect(res.body.spent_xlm).toBe(40);
    expect(res.body.remaining_xlm).toBe(60);
  });
});
