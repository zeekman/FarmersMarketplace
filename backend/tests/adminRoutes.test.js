const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const mockDb = jest.requireMock('../src/db/schema');
const adminRouter = require('../src/routes/admin');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);

const adminToken = jwt.sign(
  { id: 99, role: 'admin' },
  process.env.JWT_SECRET || 'test-secret-for-jest'
);
const buyerToken = jwt.sign(
  { id: 5, role: 'buyer' },
  process.env.JWT_SECRET || 'test-secret-for-jest'
);
const secretKey = `S${'A'.repeat(55)}`;

function authorizeQueries(resolver) {
  mockDb.query.mockImplementation(async (sql, params) => {
    if (/SELECT active FROM users/i.test(sql)) {
      return { rows: [{ active: 1 }], rowCount: 1 };
    }
    return resolver(sql, params);
  });
}

function adminRequest(method, path) {
  return request(app)[method](path).set('Authorization', `Bearer ${adminToken}`);
}

beforeEach(() => {
  mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('admin routes using asynchronous database queries', () => {
  it('lists return requests with pagination and joined product/buyer fields', async () => {
    authorizeQueries(async (sql) => {
      if (/COUNT\(\*\) as count FROM returns/i.test(sql)) {
        return { rows: [{ count: '1' }], rowCount: 1 };
      }
      if (/FROM returns r/i.test(sql)) {
        return {
          rows: [{
            id: 7,
            status: 'pending',
            product_name: 'Organic Carrots',
            buyer_name: 'Buyer One',
            buyer_email: 'buyer@example.test',
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const response = await adminRequest('get', '/api/admin/returns?status=pending&page=1&limit=10');

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({
      product_name: 'Organic Carrots',
      buyer_name: 'Buyer One',
      buyer_email: 'buyer@example.test',
    });
    expect(response.body.pagination).toMatchObject({ page: 1, limit: 10, total: 1 });
    expect(mockDb.query.mock.calls.some(([sql]) => /r\.status = \$1/.test(sql))).toBe(true);
    expect(mockDb.query.mock.calls.some(([sql]) => /LIMIT \$2 OFFSET \$3/.test(sql))).toBe(true);
  });

  it('rejects a non-admin caller with 403', async () => {
    authorizeQueries(async () => ({ rows: [], rowCount: 0 }));

    const response = await request(app)
      .get('/api/admin/returns')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(response.status).toBe(403);
  });

  it('approves a return with an async query and records its refund', async () => {
    authorizeQueries(async (sql) => {
      if (/SELECT r\.\*/i.test(sql)) {
        return {
          rows: [{
            id: 7,
            status: 'pending',
            total_price: '20.00',
            shipping_cost: '2.00',
            buyer_wallet: 'GTESTBUYER',
            farmer_secret: secretKey,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    const response = await adminRequest('post', '/api/admin/returns/7/approve');

    expect(response.status).toBe(200);
    expect(response.body.refundAmount).toBe(22);
    expect(mockDb.query.mock.calls.some(([sql]) => /UPDATE returns SET status = \$1/i.test(sql))).toBe(true);
  });

  it('rejects a pending return', async () => {
    authorizeQueries(async (sql) => (
      /SELECT \* FROM returns/i.test(sql)
        ? { rows: [{ id: 7, status: 'pending' }], rowCount: 1 }
        : { rows: [], rowCount: 1 }
    ));

    const response = await adminRequest('post', '/api/admin/returns/7/reject');

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Return request rejected');
  });

  it('lists users with parameterized pagination', async () => {
    authorizeQueries(async (sql) => (
      /COUNT\(\*\) as count FROM users/i.test(sql)
        ? { rows: [{ count: '1' }], rowCount: 1 }
        : { rows: [{ id: 2, name: 'Buyer' }], rowCount: 1 }
    ));

    const response = await adminRequest('get', '/api/admin/users?page=1&limit=10&role=buyer');

    expect(response.status).toBe(200);
    expect(response.body.pagination.total).toBe(1);
    expect(response.body.data).toEqual([{ id: 2, name: 'Buyer' }]);
    expect(mockDb.query.mock.calls.some(([sql]) => /LIMIT \$2 OFFSET \$3/.test(sql))).toBe(true);
  });

  it('lists orders with parameterized pagination', async () => {
    authorizeQueries(async (sql) => (
      /COUNT\(\*\) as count FROM orders/i.test(sql)
        ? { rows: [{ count: '2' }], rowCount: 1 }
        : { rows: [{ id: 3, status: 'paid' }], rowCount: 1 }
    ));

    const response = await adminRequest('get', '/api/admin/orders');

    expect(response.status).toBe(200);
    expect(response.body.pagination.total).toBe(2);
    expect(mockDb.query.mock.calls.some(([sql]) => /LIMIT \$1 OFFSET \$2/.test(sql))).toBe(true);
  });

  it('deactivates an existing user', async () => {
    authorizeQueries(async (sql) => (
      /SELECT \* FROM users/i.test(sql)
        ? { rows: [{ id: 5 }], rowCount: 1 }
        : { rows: [], rowCount: 1 }
    ));

    const response = await adminRequest('delete', '/api/admin/users/5');

    expect(response.status).toBe(200);
    expect(mockDb.query.mock.calls.some(([sql]) => /UPDATE users SET active = false WHERE id = \$1/i.test(sql))).toBe(true);
  });

  it('returns dashboard statistics', async () => {
    authorizeQueries(async (sql) => {
      if (/COUNT\(\*\) as count FROM users/i.test(sql)) return { rows: [{ count: '2' }], rowCount: 1 };
      if (/COUNT\(\*\) as count FROM products/i.test(sql)) return { rows: [{ count: '3' }], rowCount: 1 };
      if (/COUNT\(\*\) as count FROM orders/i.test(sql)) return { rows: [{ count: '4' }], rowCount: 1 };
      if (/SUM\(total_price\)/i.test(sql)) return { rows: [{ total: '15.5' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const response = await adminRequest('get', '/api/admin/stats');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      totalUsers: 2,
      totalProducts: 3,
      totalOrders: 4,
      totalRevenue: 15.5,
    });
  });

  it('returns the analytics summary across supported SQL dialects', async () => {
    authorizeQueries(async (sql) => {
      if (/AS paid_orders/i.test(sql)) return { rows: [{ total: 20, paid_orders: 2 }], rowCount: 1 };
      if (/AS total_orders/i.test(sql)) return { rows: [{ total_orders: 0, paid_orders: 0, rate_pct: null }], rowCount: 1 };
      if (/AS units_sold/i.test(sql)) return { rows: [{ id: 3, units_sold: 5 }], rowCount: 1 };
      if (/COUNT\(DISTINCT user_id\)/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/AS gmv/i.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const response = await adminRequest('get', '/api/admin/analytics/summary');

    expect(response.status).toBe(200);
    expect(response.body.gmv.total).toBe(20);
    expect(response.body.conversion).toEqual({ total_orders: 0, paid_orders: 0, rate_pct: 0 });
    expect(mockDb.query.mock.calls.filter(([sql]) => /created_at >= \$1/.test(sql))).toHaveLength(5);
  });

  it('lists failed email records', async () => {
    authorizeQueries(async (sql) => (
      /FROM failed_emails/i.test(sql)
        ? { rows: [{ id: 8, email: 'failed@example.test' }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    ));

    const response = await adminRequest('get', '/api/admin/failed-emails');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ id: 8, email: 'failed@example.test' }]);
  });
});
