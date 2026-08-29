/**
 * Unit tests for walletBudget route (issue #1155)
 * Tests monthly budget management for buyers
 */

const request = require('supertest');
const express = require('express');
const walletBudgetRouter = require('../routes/walletBudget');
const db = require('../db/schema');

jest.mock('../db/schema');
jest.mock('../middleware/auth', () => (req, res, next) => {
  req.user = { id: 100, role: 'buyer' };
  next();
});
jest.mock('../middleware/validate', () => ({
  updateBudget: (req, res, next) => next(),
}));

const app = express();
app.use(express.json());
app.use('/api/wallet', walletBudgetRouter);

describe('GET /api/wallet/budget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns budget summary with spending', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ monthly_budget: '100.00' }] }) // user budget
      .mockResolvedValueOnce({ rows: [{ spent: '45.50' }] }); // spent this month

    const res = await request(app).get('/api/wallet/budget');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.limit_xlm).toBe(100);
    expect(res.body.spent_xlm).toBe(45.5);
    expect(res.body.remaining_xlm).toBe(54.5);
    expect(res.body.reset_at).toBeDefined();
  });

  test('handles null budget (unlimited)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ monthly_budget: null }] })
      .mockResolvedValueOnce({ rows: [{ spent: '25.00' }] });

    const res = await request(app).get('/api/wallet/budget');

    expect(res.status).toBe(200);
    expect(res.body.limit_xlm).toBeNull();
    expect(res.body.spent_xlm).toBe(25);
    expect(res.body.remaining_xlm).toBeNull();
  });

  test('handles no spending', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ monthly_budget: '100.00' }] })
      .mockResolvedValueOnce({ rows: [{ spent: '0' }] });

    const res = await request(app).get('/api/wallet/budget');

    expect(res.status).toBe(200);
    expect(res.body.spent_xlm).toBe(0);
    expect(res.body.remaining_xlm).toBe(100);
  });

  test('only buyers can access budget', async () => {
    const farmerApp = express();
    farmerApp.use(express.json());
    jest.mock('../middleware/auth', () => (req, res, next) => {
      req.user = { id: 300, role: 'farmer' };
      next();
    }, { virtual: true });
    farmerApp.use('/api/wallet', walletBudgetRouter);

    const res = await request(farmerApp).get('/api/wallet/budget');

    expect(res.status).toBe(403);
  });
});

describe('GET /api/wallet/budget-status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns same data as /budget endpoint', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ monthly_budget: '50.00' }] })
      .mockResolvedValueOnce({ rows: [{ spent: '10.00' }] });

    const res = await request(app).get('/api/wallet/budget-status');

    expect(res.status).toBe(200);
    expect(res.body.limit_xlm).toBe(50);
    expect(res.body.spent_xlm).toBe(10);
    expect(res.body.remaining_xlm).toBe(40);
    expect(res.body.reset_at).toBeDefined();
  });
});

describe('PUT /api/wallet/budget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sets monthly budget', async () => {
    db.query
      .mockResolvedValueOnce() // UPDATE users
      .mockResolvedValueOnce({ rows: [{ monthly_budget: '150.00' }] })
      .mockResolvedValueOnce({ rows: [{ spent: '0' }] });

    const res = await request(app).put('/api/wallet/budget').send({ limit_xlm: 150 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.limit_xlm).toBe(150);
  });

  test('removes budget when set to null', async () => {
    db.query
      .mockResolvedValueOnce() // UPDATE users with NULL
      .mockResolvedValueOnce({ rows: [{ monthly_budget: null }] })
      .mockResolvedValueOnce({ rows: [{ spent: '25.00' }] });

    const res = await request(app).put('/api/wallet/budget').send({ limit_xlm: null });

    expect(res.status).toBe(200);
    expect(res.body.limit_xlm).toBeNull();
    expect(db.query).toHaveBeenCalledWith('UPDATE users SET monthly_budget = $1 WHERE id = $2', [
      null,
      100,
    ]);
  });

  test('removes budget when set to 0', async () => {
    db.query
      .mockResolvedValueOnce()
      .mockResolvedValueOnce({ rows: [{ monthly_budget: null }] })
      .mockResolvedValueOnce({ rows: [{ spent: '0' }] });

    const res = await request(app).put('/api/wallet/budget').send({ limit_xlm: 0 });

    expect(res.status).toBe(200);
    expect(res.body.limit_xlm).toBeNull();
  });

  test('rejects negative budget', async () => {
    const res = await request(app).put('/api/wallet/budget').send({ limit_xlm: -50 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('limit_xlm must be a non-negative number or null');
  });

  test('rejects non-numeric budget', async () => {
    const res = await request(app).put('/api/wallet/budget').send({ limit_xlm: 'invalid' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('limit_xlm must be a non-negative number or null');
  });
});

describe('PATCH /api/wallet/budget (backward compatibility)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sets budget using legacy endpoint', async () => {
    db.query
      .mockResolvedValueOnce()
      .mockResolvedValueOnce({ rows: [{ monthly_budget: '200.00' }] })
      .mockResolvedValueOnce({ rows: [{ spent: '50.00' }] });

    const res = await request(app).patch('/api/wallet/budget').send({ monthly_limit: 200 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.budgetGuardEnabled).toBe(true);
    expect(res.body.limit_xlm).toBe(200);
  });

  test('disables budget when monthly_limit is 0', async () => {
    db.query
      .mockResolvedValueOnce()
      .mockResolvedValueOnce({ rows: [{ monthly_budget: null }] })
      .mockResolvedValueOnce({ rows: [{ spent: '0' }] });

    const res = await request(app).patch('/api/wallet/budget').send({ monthly_limit: 0 });

    expect(res.status).toBe(200);
    expect(res.body.budgetGuardEnabled).toBe(false);
  });
});
