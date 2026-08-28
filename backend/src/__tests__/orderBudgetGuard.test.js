/**
 * Unit tests for routes/orderBudgetGuard.js — monthly XLM budget enforcement
 */

process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock db before requiring app
const mockDb = {
  query: jest.fn(),
  isPostgres: false,
  getClient: jest.fn(),
};
jest.mock('../db/schema', () => mockDb);

const app = require('../app');

const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, process.env.JWT_SECRET);
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, process.env.JWT_SECRET);

describe('orderBudgetGuard — non-Postgres (SQLite) path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.isPostgres = false;
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('allows order when within monthly budget', async () => {
    mockDb.query
      // Budget check: get monthly_budget
      .mockResolvedValueOnce({ rows: [{ monthly_budget: 100 }], rowCount: 1 })
      // Budget check: get spent this month
      .mockResolvedValueOnce({ rows: [{ spent: 50 }], rowCount: 1 })
      // Next middleware: product lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // Product not found (doesn't matter)

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440000')
      .send({ product_id: 10, quantity: 1, total_price: 30 });

    // Should pass budget guard (not 402)
    expect(res.status).not.toBe(402);
  });

  it('blocks order when monthly budget would be exceeded', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ monthly_budget: 100 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ spent: 90 }], rowCount: 1 });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440001')
      .send({ product_id: 10, quantity: 1, total_price: 20 }); // 90 + 20 > 100

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('budget_exceeded');
    expect(res.body.limit_xlm).toBe(100);
    expect(res.body.spent_xlm).toBe(90);
  });

  it('allows order when budget_override_confirmed is true', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ monthly_budget: 100 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ spent: 90 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // Product not found

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440002')
      .send({ product_id: 10, quantity: 1, total_price: 20, budget_override_confirmed: true });

    expect(res.status).not.toBe(402);
  });

  it('skips budget check when user has no monthly_budget set', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ monthly_budget: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // Product not found

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440003')
      .send({ product_id: 10, quantity: 1, total_price: 500 });

    expect(res.status).not.toBe(402);
  });

  it('includes pending orders in spend calculation', async () => {
    // Query will use: WHERE status IN ('pending', 'paid')
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ monthly_budget: 100 }], rowCount: 1 })
      // spent = 70 (includes both pending and paid)
      .mockResolvedValueOnce({ rows: [{ spent: 70 }], rowCount: 1 });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440004')
      .send({ product_id: 10, quantity: 1, total_price: 40 }); // 70 + 40 > 100

    expect(res.status).toBe(402);
    
    // Verify query includes both 'pending' and 'paid'
    const spentQuery = mockDb.query.mock.calls[1][0];
    expect(spentQuery).toMatch(/status IN \('pending', 'paid'\)/i);
  });

  it('skips budget check for farmers', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // Product not found

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440005')
      .send({ product_id: 10, quantity: 1, total_price: 1000 });

    // Should not call budget queries for farmers
    expect(mockDb.query).toHaveBeenCalledTimes(1); // Only product lookup
  });

  it('uses UTC month boundaries for spend calculation', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ monthly_budget: 100 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ spent: 50 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440006')
      .send({ product_id: 10, quantity: 1, total_price: 10 });

    // Verify the spend query uses UTC month boundaries
    const spentQuery = mockDb.query.mock.calls[1];
    const startParam = spentQuery[1][1]; // $2 parameter
    const endParam = spentQuery[1][2];   // $3 parameter
    
    // Both should be ISO date strings
    expect(startParam).toMatch(/^\d{4}-\d{2}-01T00:00:00/);
    expect(endParam).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00/);
  });

  it('serializes concurrent orders from same buyer', async () => {
    let firstCallComplete = false;
    let secondCallStarted = false;

    mockDb.query
      // First request: budget queries
      .mockImplementationOnce(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { rows: [{ monthly_budget: 100 }], rowCount: 1 };
      })
      .mockImplementationOnce(async () => {
        firstCallComplete = true;
        return { rows: [{ spent: 50 }], rowCount: 1 };
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // product lookup
      // Second request: budget queries
      .mockImplementationOnce(async () => {
        secondCallStarted = true;
        // If not properly serialized, secondCallStarted would be true before firstCallComplete
        expect(firstCallComplete).toBe(true);
        return { rows: [{ monthly_budget: 100 }], rowCount: 1 };
      })
      .mockResolvedValueOnce({ rows: [{ spent: 50 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    // Fire two concurrent requests
    await Promise.all([
      request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440007')
        .send({ product_id: 10, quantity: 1, total_price: 30 }),
      request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440008')
        .send({ product_id: 10, quantity: 1, total_price: 30 }),
    ]);

    expect(secondCallStarted).toBe(true);
  });
});

describe('orderBudgetGuard — Postgres path with advisory locks', () => {
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.isPostgres = true;
    
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    };
    
    mockDb.getClient.mockResolvedValue(mockClient);
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('uses advisory lock to serialize concurrent budget checks', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // pg_advisory_xact_lock
      .mockResolvedValueOnce({ rows: [{ monthly_budget: 100 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ spent: 50 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // COMMIT

    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // product lookup

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440009')
      .send({ product_id: 10, quantity: 1, total_price: 30 });

    expect(res.status).not.toBe(402);
    
    // Verify advisory lock was acquired
    const lockCall = mockClient.query.mock.calls.find(
      ([sql]) => sql.includes('pg_advisory_xact_lock')
    );
    expect(lockCall).toBeDefined();
    expect(lockCall[1]).toEqual([2]); // buyer_id
  });

  it('blocks order when budget exceeded with Postgres', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // lock
      .mockResolvedValueOnce({ rows: [{ monthly_budget: 100 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ spent: 95 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // ROLLBACK

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440010')
      .send({ product_id: 10, quantity: 1, total_price: 10 }); // 95 + 10 > 100

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('budget_exceeded');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('uses date_trunc for PostgreSQL month boundaries', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // lock
      .mockResolvedValueOnce({ rows: [{ monthly_budget: 100 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ spent: 50 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // COMMIT

    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440011')
      .send({ product_id: 10, quantity: 1, total_price: 20 });

    // Verify spent query uses date_trunc
    const spentQuery = mockClient.query.mock.calls.find(
      ([sql]) => sql.includes('SUM(total_price)')
    );
    expect(spentQuery).toBeDefined();
    expect(spentQuery[0]).toMatch(/date_trunc\('month', NOW\(\)\)/i);
  });

  it('releases client on error', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // BEGIN
      .mockRejectedValueOnce(new Error('Lock acquisition failed'));

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440012')
      .send({ product_id: 10, quantity: 1, total_price: 20 });

    expect(res.status).toBe(500);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('commits transaction and releases client on success', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // lock
      .mockResolvedValueOnce({ rows: [{ monthly_budget: 100 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ spent: 50 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // COMMIT

    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440013')
      .send({ product_id: 10, quantity: 1, total_price: 20 });

    const commitCall = mockClient.query.mock.calls.find(([sql]) => sql === 'COMMIT');
    expect(commitCall).toBeDefined();
    expect(mockClient.release).toHaveBeenCalled();
  });
});

describe('orderBudgetGuard — edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.isPostgres = false;
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('handles zero total_price gracefully', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ monthly_budget: 100 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ spent: 50 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440014')
      .send({ product_id: 10, quantity: 1, total_price: 0 });

    expect(res.status).not.toBe(402);
  });

  it('handles missing total_price by treating as 0', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ monthly_budget: 100 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ spent: 50 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440015')
      .send({ product_id: 10, quantity: 1 }); // No total_price

    expect(res.status).not.toBe(402);
  });

  it('handles exactly at budget limit', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ monthly_budget: 100 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ spent: 90 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440016')
      .send({ product_id: 10, quantity: 1, total_price: 10 }); // Exactly at limit

    expect(res.status).not.toBe(402);
  });

  it('blocks when exceeding budget by 0.01', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ monthly_budget: 100 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ spent: 90 }], rowCount: 1 });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('X-Idempotency-Key', '550e8400-e29b-41d4-a716-446655440017')
      .send({ product_id: 10, quantity: 1, total_price: 10.01 });

    expect(res.status).toBe(402);
  });
});
